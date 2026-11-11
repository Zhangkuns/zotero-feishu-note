import { assert } from "chai";
import { FeishuError } from "../src/modules/feishu/transport";
import {
  AnnotationEngine,
  type AnnotationInput,
} from "../src/modules/annotations/engine";
import {
  commentText,
  replyText,
  sourceMarker,
  createElements,
  hiddenMarker,
  hiddenSourceMarker,
} from "../src/modules/annotations/client";
import {
  findRange,
  withRange,
  characterSignature,
  commentRanges,
  clone,
  textContainer,
} from "../src/modules/annotations/ranges";
import {
  uniqueJSON,
  validateMapping,
} from "../src/modules/annotations/mapping";
import {
  emptyAnnotationState,
  type AnnotationState,
} from "../src/modules/annotations/store";
function block(text = "Before tied weights after.", key = "block1"): any {
  return {
    block_id: key,
    block_type: 2,
    text: {
      elements: [
        {
          text_run: {
            content: text,
            text_element_style: { bold: true, comment_ids: ["other"] },
          },
        },
      ],
    },
  };
}
class MemoryStore {
  value = emptyAnnotationState();
  async load() {
    return clone(this.value);
  }
  async save(s: AnnotationState) {
    this.value = clone(s);
  }
}
class FakeClient {
  blocks = [block()];
  revision = 1;
  creates = 0;
  updates = 0;
  patches = 0;
  cards: any[] = [];
  roots: Record<string, any> = {};
  loseCreate = false;
  failPatch = false;
  resolutions = 0;
  repliesById: Record<string, any[]> = {};
  async document() {
    return { revision_id: this.revision };
  }
  async snapshot() {
    return { document: await this.document(), blocks: clone(this.blocks) };
  }
  async block(_doc: string, key: string) {
    return clone(this.blocks.find((b) => b.block_id === key));
  }
  async comments() {
    return clone(this.cards);
  }
  async rootReply(_doc: string, id: string) {
    return clone(this.roots[id]);
  }
  async replies(_doc: string, id: string) {
    return clone([this.roots[id], ...(this.repliesById[id] || [])]);
  }
  async resolve(_doc: string, id: string) {
    this.cards.find((c) => c.comment_id === id).is_solved = true;
    this.resolutions++;
  }
  setRoot(id: string, text: string, marker: string) {
    this.roots[id] = {
      reply_id: "reply-" + id,
      content: {
        elements: [
          {
            type: "text_run",
            text_run: {
              text: marker.includes("#zfs=")
                ? commentText(text).replace(/\n$/, hiddenMarker(marker) + "\n")
                : commentText(text),
            },
          },
          ...(!marker.includes("#zfs=")
            ? [
                {
                  type: "docs_link",
                  docs_link: { url: marker },
                  text_run: null,
                },
              ]
            : []),
        ],
      },
    };
  }
  async create(_doc: string, key: string, text: string, marker: string) {
    const id = "comment" + ++this.creates;
    this.setRoot(id, text, marker);
    this.cards.push({
      comment_id: id,
      extra: { content_anchor_id: key },
      reply_list: { replies: [clone(this.roots[id])] },
    });
    for (const e of textContainer(this.blocks.find((b) => b.block_id === key))!
      .elements)
      e.text_run?.text_element_style?.comment_ids.push(id);
    this.revision++;
    if (this.loseCreate) {
      this.loseCreate = false;
      throw new Error("lost create response");
    }
    return { comment_id: id };
  }
  async update(
    _doc: string,
    id: string,
    _reply: string,
    text: string,
    marker: string,
  ) {
    this.updates++;
    this.setRoot(id, text, marker);
    this.cards.find((c) => c.comment_id === id).reply_list.replies = [
      clone(this.roots[id]),
    ];
  }
  async anchor(_doc: string, key: string, revision: number, elements: any[]) {
    if (this.failPatch) {
      this.failPatch = false;
      throw new Error("revision conflict");
    }
    assert.equal(revision, this.revision);
    this.blocks.find((b) => b.block_id === key).text.elements = clone(elements);
    this.revision++;
    this.patches++;
  }
}
function input(): AnnotationInput {
  return {
    itemKey: "PAPER123",
    title: "Test paper",
    documentId: "Document123",
    documentUrl: "https://my.feishu.cn/docx/Document123",
    userId: "42",
    annotations: [
      {
        key: "ANNOT123",
        type: "highlight",
        text: "tied weights",
        comment: "中文 comment.",
      },
    ],
  };
}
const options = { relaxed: true, includeHighlights: true };

describe("native selected-range annotations", function () {
  let client: FakeClient,
    store: MemoryStore,
    engine: AnnotationEngine,
    source: AnnotationInput,
    state: AnnotationState;

  beforeEach(function () {
    client = new FakeClient();
    store = new MemoryStore();
    engine = new AnnotationEngine(client, store);
    source = input();
    state = emptyAnnotationState();
  });
  const sync = async () => (await engine.sync(source, state, options))[0];

  it("supports exact word and midword selections", function () {
    assert.equal(findRange([block()], "weights").selectedText, "weights");
    assert.equal(findRange([block()], "ied wei").selectedText, "ied wei");
  });

  it("preserves Unicode, rich styles and other comment overlaps", function () {
    const b = block("中文 😀 Before tied weights after.");
    b.text.elements.push({
      text_run: {
        content: " Other text.",
        text_element_style: { italic: true },
      },
    });
    const m = findRange([b], "tied weights");
    const after = withRange(b.text.elements, "new", m.start, m.end);
    assert.equal(
      characterSignature(b.text.elements, "new"),
      characterSignature(after, "new"),
    );
    assert.deepEqual(
      commentRanges(b.text.elements, "other"),
      commentRanges(after, "other"),
    );
    assert.deepEqual(
      commentRanges(after, "new"),
      Array.from({ length: m.end - m.start }, (_, i) => m.start + i),
    );
  });

  it("normalizes citations while retaining the original selected offsets", function () {
    const m = findRange(
      [
        block(
          "Cross-Layer. We base our analysis on transcoders [6], which grow.",
        ),
      ],
      "Cross-Layer.\u00a0We base our analysis on transcoders , which gr",
    );
    assert.equal(m.method, "citations");
    assert.isTrue(m.selectedText.endsWith("which gr"));
  });

  it("can disable relaxed matching", function () {
    assert.throws(() =>
      findRange(
        [block("Some nonbreaking\u00a0space text")],
        "Some nonbreaking space text",
        false,
      ),
    );
  });

  it("rejects ambiguous and cross-block selections", function () {
    assert.throws(() =>
      findRange([block(), block(undefined, "block2")], "tied weights"),
    );
    assert.throws(() =>
      findRange([block("tied"), block("weights", "b2")], "tied weights"),
    );
  });

  it("keeps math symbols and inline objects distinct", function () {
    assert.throws(() =>
      findRange(
        [block("a larger variable value > another value")],
        "a larger variable value < another value",
      ),
    );
    const b = block("begin ");
    b.text.elements.push(
      { equation: { content: "x" } },
      { text_run: { content: " end", text_element_style: {} } },
    );
    assert.throws(() => findRange([b], "begin end"));
  });

  it("rejects duplicate JSON property names and missing mapping fields", function () {
    assert.throws(() => uniqueJSON('{"x":1,"x":2}'));
    assert.throws(() => uniqueJSON('{"x":{"a":1,"a":2}}'));
    assert.deepEqual(uniqueJSON('{"a":[{"x":1},{"x":2}]}'), {
      a: [{ x: 1 }, { x: 2 }],
    });
    assert.throws(() =>
      validateMapping({ schema: "zotero-feishu-mapping/v1" }),
    );
  });

  it("uses invisible provenance, escapes angle brackets, and rejects oversized comments", function () {
    const e = createElements("a < b & c > d", "https://example.org");
    assert.equal(
      e[0].text,
      "a &lt; b & c &gt; d" + hiddenMarker("https://example.org") + "\n",
    );
    assert.throws(() =>
      createElements("x".repeat(10000), "https://example.org"),
    );
  });

  it("decodes invisible provenance across split runs without changing visible text", function () {
    const marker =
      "https://www.zotero.org/users/42/items/ANNOT123#zfs=abc&duplicate=C1";
    const raw = "中文 🧠 comment" + hiddenMarker(marker) + "\n";
    const reply = {
      content: {
        elements: [
          { text_run: { text: raw.slice(0, 43) } },
          { text_run: { text: raw.slice(43) } },
        ],
      },
    };
    assert.equal(replyText(reply), "中文 🧠 comment\n");
    assert.equal(sourceMarker(reply, "ANNOT123"), marker);
    assert.equal(hiddenSourceMarker(reply), marker);
    assert.isUndefined(sourceMarker(reply, "OTHER123"));
    assert.notInclude(raw, marker);
    assert.notInclude(raw, "Zotero Feishu Sync");
    const canvas = Zotero.getMainWindow().document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    ) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "16px sans-serif";
    assert.equal(
      ctx.measureText(raw.trimEnd()).width,
      ctx.measureText("中文 🧠 comment").width,
    );
  });

  it("leaves malformed invisible data intact instead of accepting a source identity", function () {
    const raw = "comment\u2063\u2060\u2063\ufe01\u2063\u2064\u2063\n";
    const reply = { content: { elements: [{ text_run: { text: raw } }] } };
    assert.isUndefined(hiddenSourceMarker(reply));
    assert.equal(replyText(reply), raw);
  });

  it("migrates a visible suffix in place and leaves the next sync unchanged", async function () {
    const first = await sync();
    const marker = sourceMarker(client.roots[first.commentId!], "ANNOT123")!;
    client.roots[first.commentId!].content.elements = [
      {
        type: "text_run",
        text_run: {
          text:
            commentText(source.annotations[0].comment) +
            "[Zotero Feishu Sync] " +
            marker,
        },
      },
    ];
    client.cards[0].reply_list.replies = [
      clone(client.roots[first.commentId!]),
    ];
    state = emptyAnnotationState();
    const migrated = await sync();
    assert.equal(migrated.status, "synced");
    assert.equal(migrated.commentId, first.commentId);
    assert.equal(client.creates, 1);
    assert.equal(client.updates, 1);
    assert.equal(hiddenSourceMarker(client.roots[first.commentId!]), marker);
    assert.notInclude(
      client.roots[first.commentId!].content.elements[0].text_run.text,
      "[Zotero Feishu Sync]",
    );
    assert.equal((await sync()).status, "unchanged");
  });

  it("recovers trailing provenance across split runs and keeps legacy links readable", function () {
    const marker =
      "https://www.zotero.org/users/1/items/ANNOT123#zfs=abc&duplicate=C1";
    const raw = commentText("中文 question") + "[Zotero Feishu Sync] " + marker;
    const reply = {
      content: {
        elements: [
          { text_run: { text: raw.slice(0, 50) } },
          { text_run: { text: raw.slice(50) } },
        ],
      },
    };
    assert.equal(sourceMarker(reply, "ANNOT123"), marker);
    assert.isUndefined(sourceMarker(reply, "OTHER123"));
    assert.equal(replyText(reply), commentText("中文 question"));
    const legacy = {
      content: {
        elements: [
          { text_run: { text: "old\n" } },
          { docs_link: { url: marker.split("#")[0] } },
        ],
      },
    };
    assert.equal(replyText(legacy), "old\n");
    assert.equal(sourceMarker(legacy, "ANNOT123"), marker.split("#")[0]);
    reply.content.elements.push({ text_run: { text: "independent edit" } });
    assert.isUndefined(sourceMarker(reply, "ANNOT123"));
  });

  it("previews without saving a checkpoint or writing remotely", async function () {
    const r = (
      await engine.sync(source, state, { ...options, dryRun: true })
    )[0];
    assert.equal(r.status, "matched");
    assert.equal(client.creates, 0);
    assert.deepEqual(store.value, emptyAnnotationState());
  });

  it("repeats without a duplicate card or another patch", async function () {
    assert.equal((await sync()).status, "synced");
    assert.equal((await sync()).status, "unchanged");
    assert.equal(client.creates, 1);
    assert.equal(client.patches, 1);
  });

  it("updates the same root reply after source edits", async function () {
    const first = await sync();
    source.annotations[0].comment = "updated 中文";
    const second = await sync();
    assert.equal(second.commentId, first.commentId);
    assert.equal(client.creates, 1);
    assert.equal(client.updates, 1);
  });

  it("recovers a lost create response from the remote source marker", async function () {
    client.loseCreate = true;
    assert.equal((await sync()).status, "pending");
    assert.equal((await sync()).status, "synced");
    assert.equal(client.creates, 1);
  });

  it("recovers a failed patch without creating another comment", async function () {
    client.failPatch = true;
    assert.equal((await sync()).status, "pending");
    assert.equal((await sync()).status, "synced");
    assert.equal(client.creates, 1);
  });

  it("recovers on a fresh machine and updates an unchanged remote root", async function () {
    const first = await sync();
    state = emptyAnnotationState();
    store = new MemoryStore();
    engine = new AnnotationEngine(client, store);
    source.annotations[0].comment = "source edit after switching machines";
    const second = await sync();
    assert.equal(second.commentId, first.commentId);
    assert.equal(client.creates, 1);
    assert.equal(
      replyText(client.roots[first.commentId!]),
      commentText(source.annotations[0].comment),
    );
  });

  it("recovers resolved remote comments without creating another", async function () {
    await sync();
    client.cards[0].is_solved = true;
    state = emptyAnnotationState();
    assert.equal((await sync()).status, "synced");
    assert.equal(client.creates, 1);
  });

  it("does not overwrite independently edited remote comments after changing machines", async function () {
    const first = await sync();
    const marker = sourceMarker(client.roots[first.commentId!], "ANNOT123")!;
    client.roots[first.commentId!].content.elements[0].text_run.text =
      "manual remote edit" + hiddenMarker(marker) + "\n";
    client.cards[0].reply_list.replies = [
      clone(client.roots[first.commentId!]),
    ];
    state = emptyAnnotationState();
    source.annotations[0].comment = "source edit";
    assert.equal((await sync()).status, "pending");
    assert.equal(client.updates, 0);
  });

  it("keeps a known comment pending if a manual edit removes its metadata", async function () {
    const first = await sync();
    client.roots[first.commentId!].content.elements[0].text_run.text =
      "manual remote edit\n";
    client.cards[0].reply_list.replies = [
      clone(client.roots[first.commentId!]),
    ];
    assert.equal((await sync()).status, "pending");
    assert.equal(client.creates, 1);
    assert.equal(client.updates, 0);
  });

  it("does not blindly recreate an uncertain comment", async function () {
    state.records["PAPER123:Document123:ANNOT123"] = {
      phase: "creating",
      blockId: "block1",
    };
    assert.equal((await sync()).status, "pending");
    assert.equal(client.creates, 0);
  });

  it("keeps a 5xx creation uncertain even when it includes an API code", async function () {
    let calls = 0;
    client.create = async () => {
      calls++;
      throw new FeishuError("response uncertain", 503, 1);
    };
    assert.equal((await sync()).status, "pending");
    assert.equal((await sync()).status, "pending");
    assert.equal(calls, 1);
    assert.equal(
      state.records["PAPER123:Document123:ANNOT123"].phase,
      "creating",
    );
  });

  it("recovers old bridge comments and upgrades their provenance in place", async function () {
    const first = await sync();
    const old = "https://www.zotero.org/users/42/items/ANNOT123";
    client.setRoot(first.commentId!, source.annotations[0].comment, old);
    client.cards[0].reply_list.replies = [
      clone(client.roots[first.commentId!]),
    ];
    state = emptyAnnotationState();
    assert.equal((await sync()).status, "synced");
    assert.equal(client.creates, 1);
    assert.include(
      sourceMarker(client.roots[first.commentId!], "ANNOT123"),
      "#zfs=",
    );
  });

  it("skips nontext annotations and optionally uncommented highlights", async function () {
    source.annotations[0].type = "image";
    assert.equal((await sync()).status, "skipped");
    source.annotations[0].type = "underline";
    source.annotations[0].comment = "";
    assert.equal(
      (
        await engine.sync(source, state, {
          ...options,
          includeHighlights: false,
        })
      )[0].status,
      "skipped",
    );
    assert.equal(client.creates, 0);
  });

  it("converges simultaneous first uploads from two machines onto one active comment", async function () {
    const secondState = emptyAnnotationState();
    const second = new AnnotationEngine(client, new MemoryStore());
    // Both machines observe no remote comments before either POST completes.
    const comments = client.comments.bind(client);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.comments = async () => {
      if (++reads <= 2) {
        if (reads === 2) release();
        await barrier;
        return [];
      }
      return comments();
    };
    await Promise.all([sync(), second.sync(source, secondState, options)]);
    assert.equal(client.creates, 2);
    await sync();
    await second.sync(source, secondState, options);
    assert.equal(client.cards.filter((c) => !c.is_solved).length, 1);
    assert.equal(
      state.records["PAPER123:Document123:ANNOT123"].commentId,
      "comment1",
    );
    assert.equal(
      secondState.records["PAPER123:Document123:ANNOT123"].commentId,
      "comment1",
    );
    assert.include(
      sourceMarker(client.roots.comment2, "ANNOT123"),
      "&duplicate=comment1",
    );
    assert.equal((await sync()).status, "unchanged");
    assert.equal(client.creates, 2);
  });

  it("retains duplicate discussions with replies instead of resolving them", async function () {
    await sync();
    await client.create(
      "Document123",
      "block1",
      source.annotations[0].comment,
      sourceMarker(client.roots.comment1, "ANNOT123")!,
    );
    client.repliesById.comment2 = [
      { reply_id: "discussion", content: { elements: [] } },
    ];
    assert.equal((await sync()).status, "pending");
    assert.equal(client.resolutions, 0);
    assert.notInclude(
      sourceMarker(client.roots.comment2, "ANNOT123"),
      "&duplicate=",
    );
  });

  it("repairs a crash between duplicate marking and resolving", async function () {
    await sync();
    const marker = sourceMarker(client.roots.comment1, "ANNOT123")!;
    await client.create(
      "Document123",
      "block1",
      source.annotations[0].comment,
      marker + "&duplicate=comment1",
    );
    assert.equal((await sync()).status, "synced");
    assert.isTrue(client.cards[1].is_solved);
  });

  it("uploads different annotations separately and preserves overlapping ranges", async function () {
    source.annotations.push({
      ...source.annotations[0],
      key: "ANNOT456",
      text: "weights",
      comment: "a different note",
    });
    const results = await engine.sync(source, state, options);
    assert.isTrue(results.every((r) => r.status === "synced"));
    assert.equal(client.creates, 2);
    assert.equal(client.resolutions, 0);
    assert.lengthOf(
      commentRanges(client.blocks[0].text.elements, "comment1"),
      12,
    );
    assert.lengthOf(
      commentRanges(client.blocks[0].text.elements, "comment2"),
      7,
    );
  });

  it("preserves replies added to an unresolved duplicate after an interrupted cleanup", async function () {
    await sync();
    const marker = sourceMarker(client.roots.comment1, "ANNOT123")!;
    await client.create(
      "Document123",
      "block1",
      source.annotations[0].comment,
      marker + "&duplicate=comment1",
    );
    client.repliesById.comment2 = [{ reply_id: "discussion" }];
    assert.equal((await sync()).status, "pending");
    assert.equal(client.resolutions, 0);
  });

  it("stops before a POST if disabled while the local creation checkpoint is saved", async function () {
    let enabled = true;
    const save = store.save.bind(store);
    store.save = async (state) => {
      await save(state);
      enabled = false;
    };
    const result = await engine.sync(source, state, {
      ...options,
      canWrite: () => enabled,
    });
    assert.equal(result[0].status, "pending");
    assert.equal(client.creates, 0);
    assert.equal(
      state.records["PAPER123:Document123:ANNOT123"].phase,
      "not_created",
    );
    store.save = save;
    assert.equal((await sync()).status, "synced");
    assert.equal(client.creates, 1);
  });
});
