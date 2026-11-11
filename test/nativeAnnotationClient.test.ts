import { assert } from "chai";
import { config } from "../package.json";
import { FeishuAnnotationClient } from "../src/modules/annotations/client";
import {
  AnnotationStore,
  emptyAnnotationState,
} from "../src/modules/annotations/store";
import { FeishuTransport } from "../src/modules/feishu/transport";
import {
  ANNOTATION_SCOPES,
  FEISHU_SCOPES,
} from "../src/modules/feishuDeviceAuth";
import { OAuthService } from "../src/modules/oauthService";
import { annotationSettings } from "../src/modules/annotations/service";
import { getPref, setPref } from "../src/utils/prefs";

describe("native annotation API and persistence", function () {
  let originalRequest: typeof Zotero.HTTP.request;
  let toolkit: any;

  before(function () {
    originalRequest = Zotero.HTTP.request;
    toolkit = (globalThis as any).ztoolkit;
    (globalThis as any).ztoolkit = (
      Zotero[config.addonInstance] as any
    ).data.ztoolkit;
  });

  afterEach(function () {
    Zotero.HTTP.request = originalRequest;
  });

  after(function () {
    (globalThis as any).ztoolkit = toolkit;
  });

  const client = () =>
    new FeishuAnnotationClient(
      new FeishuTransport({
        getAccessToken: async () => "native-test-token",
      } as any),
    );

  it("creates with portable text provenance, updates the existing root, and patches a revision-bound selection", async function () {
    const requests: any[] = [];
    Zotero.HTTP.request = (async (method, url, options) => {
      requests.push({
        method,
        url,
        body: JSON.parse(String(options?.body)),
        authorization: (options?.headers as any)?.Authorization,
      });
      return {
        status: 200,
        response: { code: 0, data: { comment_id: "C1" } },
      } as any;
    }) as any;
    const api = client();
    const marker = "https://www.zotero.org/users/1/items/ABCD2345#zfs=abc";
    await api.create("Doc1", "Block1", "中文 <x> & y", marker);
    await api.update("Doc1", "C1", "R1", "edited", marker);
    await api.anchor("Doc1", "Block1", 42, [
      { text_run: { content: "sentence" } },
    ]);
    assert.equal(requests[0].authorization, "Bearer native-test-token");
    assert.equal(
      requests[0].url,
      "https://open.feishu.cn/open-apis/drive/v1/files/Doc1/new_comments",
    );
    assert.deepEqual(requests[0].body, {
      file_type: "docx",
      anchor: { block_id: "Block1" },
      reply_elements: [
        {
          type: "text",
          text: "中文 &lt;x&gt; & y\n[Zotero Feishu Sync] " + marker,
        },
      ],
    });
    assert.equal(requests[1].method, "PUT");
    assert.include(requests[1].url, "/comments/C1/replies/R1?file_type=docx");
    assert.deepEqual(requests[1].body.content.elements, [
      {
        type: "text_run",
        text_run: { text: "edited\n[Zotero Feishu Sync] " + marker },
      },
    ]);
    assert.equal(requests[2].method, "PATCH");
    assert.include(requests[2].url, "/blocks/Block1?document_revision_id=42");
    assert.deepEqual(requests[2].body.update_text_elements.elements, [
      { text_run: { content: "sentence" } },
    ]);
  });

  it("never retries creation after a 5xx response", async function () {
    let calls = 0;
    Zotero.HTTP.request = (async () => {
      calls++;
      return { status: 503, response: { code: 1, msg: "uncertain" } } as any;
    }) as any;
    let error: any;
    try {
      await client().create("Doc", "Block", "note", "marker");
    } catch (e) {
      error = e;
    }
    assert.equal(error.status, 503);
    assert.equal(calls, 1);
  });

  it("reads paginated active and resolved comments for recovery", async function () {
    const queries: URLSearchParams[] = [];
    Zotero.HTTP.request = (async (_method, url) => {
      const query = new URL(String(url)).searchParams;
      queries.push(query);
      return {
        status: 200,
        response: {
          code: 0,
          data: {
            items: [
              {
                comment_id:
                  query.get("is_solved") === "true" ? "resolved" : "active",
              },
            ],
            has_more: queries.length === 1,
            page_token: "next",
          },
        },
      } as any;
    }) as any;
    const comments = await client().comments("Doc");
    assert.deepEqual(
      comments.map((c) => c.comment_id),
      ["active", "resolved"],
    );
    assert.equal(queries.length, 3);
    assert.equal(queries[1].get("page_token"), "next");
    assert.isTrue(
      queries.every(
        (q) =>
          q.get("need_relation") === "true" && q.get("is_whole") === "false",
      ),
    );
  });

  it("rejects a document snapshot that changes during pagination", async function () {
    let metadataCalls = 0;
    Zotero.HTTP.request = (async (_method, url) => ({
      status: 200,
      response: {
        code: 0,
        data: String(url).includes("/blocks?")
          ? { items: [], has_more: false }
          : { document: { revision_id: ++metadataCalls } },
      },
    })) as any;
    let error: any;
    try {
      await client().snapshot("Doc");
    } catch (e) {
      error = e;
    }
    assert.include(error.message, "变化");
  });

  it("requires the three comment scopes from native OAuth", function () {
    assert.isTrue(ANNOTATION_SCOPES.every((s) => FEISHU_SCOPES.includes(s)));
    const oauth = new OAuthService(undefined, {
      getTokens: () => ({ scope: "docs:document.comment:read" }),
    } as any);
    assert.deepEqual(oauth.missingAnnotationScopes(), [
      "docs:document.comment:create",
      "docs:document.comment:update",
    ]);
  });

  it("writes atomic state using the host IO API and refuses corrupt records", async function () {
    const globals = (Zotero[config.addonInstance] as any).data.ztoolkit;
    const io = globals.getGlobal("IOUtils");
    const paths = globals.getGlobal("PathUtils");
    const file = paths.join(
      paths.profileDir,
      "native-annotation-store-test.json",
    );
    try {
      const store = new AnnotationStore(file);
      const state = emptyAnnotationState();
      state.records["paper:doc:annotation"] = {
        phase: "creating",
        blockId: "B1",
      };
      state.pending.paper = {
        itemKey: "paper",
        attempts: 1,
        lastAttempt: Date.now(),
        reason: "response lost",
      };
      await store.save(state);
      const recovered = await new AnnotationStore(file).load();
      assert.deepEqual(recovered, state);
      assert.equal((await io.stat(file)).permissions & 0o777, 0o600);
      for (const corrupt of [
        "{",
        JSON.stringify({ ...state, records: [] }),
        JSON.stringify({ ...state, pending: { paper: null } }),
        JSON.stringify({ ...state, history: [null] }),
      ]) {
        await io.writeUTF8(file, corrupt);
        let error: any;
        try {
          await store.load();
        } catch (e) {
          error = e;
        }
        assert.include(error.message, "损坏");
        assert.equal(await io.readUTF8(file), corrupt);
      }
    } finally {
      await io.remove(file, { ignoreAbsent: true });
    }
  });

  it("bounds invalid delay and retry preferences", function () {
    const oldDelay = getPref("annotationDelaySeconds"),
      oldRetry = getPref("annotationRetrySeconds");
    try {
      setPref("annotationDelaySeconds", "0");
      setPref("annotationRetrySeconds", "99999");
      assert.equal(annotationSettings().delay, 1500);
      assert.equal(annotationSettings().retryDelay, 60000);
      setPref("annotationDelaySeconds", "2.5");
      setPref("annotationRetrySeconds", "120");
      assert.equal(annotationSettings().delay, 2500);
      assert.equal(annotationSettings().retryDelay, 120000);
    } finally {
      setPref("annotationDelaySeconds", oldDelay);
      setPref("annotationRetrySeconds", oldRetry);
    }
  });
});
