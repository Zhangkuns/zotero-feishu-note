import { assert } from "chai";
import { config } from "../package.json";
import { mappingNote } from "../src/modules/annotationSync";
import {
  annotationTargets,
  validateMapping,
  uniqueJSON,
  TITLES,
} from "../src/modules/annotations/mapping";
import { SyncService } from "../src/modules/syncService";
import {
  NativeAnnotationService,
  annotationScopeReason,
} from "../src/modules/annotations/service";
import { emptyAnnotationState } from "../src/modules/annotations/store";
import { getPref, setPref } from "../src/utils/prefs";

describe("mapped annotation synchronization", function () {
  this.timeout(15000);
  const created: Zotero.Item[] = [];
  let previousAuto: boolean;
  let previousDeletion: boolean;
  let previousDelay: string;
  let previousEnabled: boolean;
  let previousScope: string;
  let previousCollection: string;
  let originalRequest: typeof Zotero.HTTP.request;
  let plugin: any;
  let originalSync: any;
  let originalToolkit: any;
  let originalAddon: any;

  before(function () {
    previousAuto = getPref("autoSyncAnnotations");
    previousDeletion = getPref("syncDeletedAnnotations");
    setPref("syncDeletedAnnotations", false);
    previousEnabled = getPref("enableAnnotationSync");
    previousScope = getPref("annotationScope");
    previousCollection = getPref("annotationCollectionKey");
    setPref("enableAnnotationSync", true);
    setPref("annotationScope", "all");
    previousDelay = getPref("annotationDelaySeconds");
    setPref("annotationDelaySeconds", "1.5");
    setPref("autoSyncAnnotations", false);
    originalRequest = Zotero.HTTP.request;
    plugin = Zotero[config.addonInstance];
    originalSync = plugin.sync.syncItem;
    originalToolkit = (globalThis as any).ztoolkit;
    originalAddon = (globalThis as any).addon;
    (globalThis as any).ztoolkit = plugin.data.ztoolkit;
    (globalThis as any).addon = plugin;
  });

  afterEach(async function () {
    setPref("autoSyncAnnotations", false);
    setPref("enableAnnotationSync", true);
    setPref("annotationScope", "all");
    setPref("annotationCollectionKey", "");
    (Zotero.HTTP as any).request = originalRequest;
    plugin.sync.syncItem = originalSync;
    for (const item of created.splice(0).reverse()) {
      if (Zotero.Items.get(item.id)) await item.eraseTx();
    }
  });

  after(function () {
    setPref("autoSyncAnnotations", previousAuto);
    setPref("syncDeletedAnnotations", previousDeletion);
    setPref("enableAnnotationSync", previousEnabled);
    setPref("annotationScope", previousScope);
    setPref("annotationCollectionKey", previousCollection);
    setPref("annotationDelaySeconds", previousDelay);
    (globalThis as any).ztoolkit = originalToolkit;
    (globalThis as any).addon = originalAddon;
  });

  async function paper(mapped = true) {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", "Mapped annotation test");
    await item.saveTx();
    created.push(item);
    if (mapped) await addMapping(item);
    return item;
  }

  async function addMapping(
    item: Zotero.Item,
    schema = "zotero-feishu-mapping/v1",
  ) {
    const note = new Zotero.Item("note");
    note.parentID = item.id;
    const source = new Zotero.Item("attachment");
    source.libraryID = item.libraryID;
    source.parentID = item.id;
    source.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
    source.attachmentContentType = "application/pdf";
    source.setField("title", "Original PDF");
    await source.saveTx();
    created.push(source);
    const archive = new Zotero.Item("attachment");
    archive.libraryID = item.libraryID;
    archive.parentID = item.id;
    archive.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
    archive.attachmentContentType = "text/markdown";
    archive.setField("title", "英文全文");
    await archive.saveTx();
    created.push(archive);
    const data = {
      schema,
      zotero: {
        library_id: item.libraryID,
        item_key: item.key,
        source_url: "https://example.org/paper",
        source_attachments: [
          { key: source.key, content_type: "application/pdf" },
        ],
      },
      documents: {
        "outline-expanded": null,
        "full-translation": null,
        "structured-synthesis": null,
        "english-original": {
          title: "英文全文",
          document_id: "Example123",
          url: "https://my.feishu.cn/docx/Example123",
          archive_attachment_key: archive.key,
        },
      },
      default_annotation_target: "english-original",
    };
    note.setNote(
      "<p>飞书文档映射</p><pre>" +
        JSON.stringify(data).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
        "</pre>",
    );
    await note.saveTx();
    created.push(note);
    return note;
  }

  async function annotation(item: Zotero.Item, mime: string) {
    const source = new Zotero.Item("attachment");
    source.libraryID = item.libraryID;
    source.parentID = item.id;
    source.setField("title", "Original source");
    source.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
    source.attachmentContentType = mime;
    await source.saveTx();
    created.push(source);
    const note = new Zotero.Item("annotation");
    note.libraryID = item.libraryID;
    note.parentID = source.id;
    note.annotationType = "highlight";
    note.annotationText = "Unique selected words.";
    note.annotationComment = "中文 annotation";
    note.annotationColor = "#ffd400";
    note.annotationSortIndex =
      mime === "text/html" ? "0000000" : "00000|000000|00000";
    note.annotationPosition = JSON.stringify(
      mime === "application/pdf"
        ? { pageIndex: 0, rects: [[1, 1, 2, 2]] }
        : {
            type: "CssSelector",
            value: "p",
            refinedBy: { type: "TextPositionSelector", start: 0, end: 21 },
          },
    );
    await note.saveTx();
    created.push(note);
    return note;
  }

  async function pdfPaper() {
    const item = await paper(false);
    const note = await addMapping(item);
    const pre = note.getNote().match(/<pre>(.*?)<\/pre>/s)![1];
    const data = JSON.parse(pre.replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    data.schema = "zotero-feishu-mapping/v2";
    const english = data.documents["english-original"];
    english.pdf_attachment_key = english.archive_attachment_key;
    delete english.archive_attachment_key;
    const pdf = Zotero.Items.getByLibraryAndKey(
      item.libraryID,
      english.pdf_attachment_key,
    )!;
    pdf.attachmentContentType = "application/pdf";
    await pdf.saveTx();
    for (const mode of ["outline-expanded", "full-translation"] as const) {
      const attachment = new Zotero.Item("attachment");
      attachment.parentID = item.id;
      attachment.attachmentLinkMode =
        Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
      attachment.attachmentContentType = "application/pdf";
      attachment.setField("title", TITLES[mode]);
      await attachment.saveTx();
      created.push(attachment);
      const id = mode === "outline-expanded" ? "Outline123" : "Chinese123";
      data.documents[mode] = {
        title: TITLES[mode],
        document_id: id,
        url: "https://my.feishu.cn/docx/" + id,
        pdf_attachment_key: attachment.key,
      };
    }
    const save = async () => {
      note.setNote(
        "<p>飞书文档映射</p><pre>" + JSON.stringify(data) + "</pre>",
      );
      await note.saveTx();
    };
    await save();
    return { item, note, data, save };
  }

  it("accepts v2 PDFs and routes every reading mode plus original sources explicitly", async function () {
    const { item, data } = await pdfPaper();
    const mapping = mappingNote(item)!.mapping;
    const targets = annotationTargets(mapping);
    assert.equal(targets.length, 3);
    for (const target of targets) {
      assert.include(
        target.attachmentKeys,
        data.documents[target.mode].pdf_attachment_key,
      );
      assert.equal(
        target.attachmentKeys.length,
        target.mode === "english-original" ? 2 : 1,
      );
    }
    assert.equal(
      annotationTargets(mapping)[2].document.document_id,
      "Example123",
    );
  });

  it("rejects mixed versions, duplicate PDF keys, unknown fields and live MIME mismatches", async function () {
    const { item, data } = await pdfPaper();
    const copy = () => JSON.parse(JSON.stringify(data));
    const mixed = copy();
    mixed.documents["english-original"].archive_attachment_key = "ARCHIVE1";
    assert.throws(() => validateMapping(mixed), "wrong fields");
    const duplicate = copy();
    duplicate.documents["full-translation"].pdf_attachment_key =
      duplicate.documents["english-original"].pdf_attachment_key;
    assert.throws(() => validateMapping(duplicate), "duplicate");
    assert.throws(() => uniqueJSON('{"schema":1,"schema":2}'), "duplicate");
    const pdf = Zotero.Items.getByLibraryAndKey(
      item.libraryID,
      data.documents["english-original"].pdf_attachment_key,
    )!;
    pdf.attachmentContentType = "text/markdown";
    await pdf.saveTx();
    assert.throws(() => mappingNote(item), "阅读附件");
  });

  it("syncs selected text to all three destinations and isolates one destination failure", async function () {
    const { item } = await pdfPaper();
    const mapping = mappingNote(item)!;
    const targets = annotationTargets(mapping.mapping);
    for (const target of targets)
      for (const key of target.attachmentKeys) {
        const a = await annotation(item, "application/pdf");
        a.parentID = Zotero.Items.getByLibraryAndKey(item.libraryID, key)!.id;
        await a.saveTx();
      }
    const state = emptyAnnotationState();
    const visited: string[] = [];
    let failChinese = false;
    const client = {
      snapshot: async (id: string) => {
        visited.push(id);
        if (failChinese && id === "Chinese123")
          throw new Error("offline fixture");
        return {
          blocks: [
            {
              block_id: id,
              text: {
                elements: [{ text_run: { content: "Unique selected words." } }],
              },
            },
          ],
        };
      },
    };
    const service = new NativeAnnotationService(
      { isAuthorized: () => true, missingAnnotationScopes: () => [] } as any,
      client as any,
      { load: async () => state, save: async () => undefined },
    );
    const first = await service.syncItem(item, mapping, true);
    assert.isEmpty(first.errors);
    assert.sameMembers(visited, ["Outline123", "Chinese123", "Example123"]);
    const details = state.history[0].details;
    assert.equal(details.length, 4);
    assert.equal(
      details.filter((d) => d.documentTitle === "英文全文").length,
      2,
    );
    assert.isTrue(
      details.every((d) => d.status === "matched" && !!d.documentUrl),
    );
    failChinese = true;
    visited.length = 0;
    const second = await service.syncItem(item, mapping, true);
    assert.equal(second.outcome, "partial");
    assert.include(second.errors[0], "中文全文");
    assert.include(visited, "Example123");
    assert.equal(state.history[0].details.length, 3);
  });

  it("stops writes to every target when the mapping changes during a request", async function () {
    const { item, data, save } = await pdfPaper();
    const original = mappingNote(item)!;
    for (const target of annotationTargets(original.mapping)) {
      const a = await annotation(item, "application/pdf");
      a.parentID = Zotero.Items.getByLibraryAndKey(
        item.libraryID,
        target.attachmentKeys[0],
      )!.id;
      await a.saveTx();
    }
    let changed = false;
    let writes = 0;
    const state = emptyAnnotationState();
    const client = {
      snapshot: async (id: string) => {
        if (!changed) {
          changed = true;
          data.documents["outline-expanded"].document_id = "Replaced123";
          data.documents["outline-expanded"].url =
            "https://my.feishu.cn/docx/Replaced123";
          await save();
        }
        return {
          blocks: [
            {
              block_id: id,
              text: {
                elements: [{ text_run: { content: "Unique selected words." } }],
              },
            },
          ],
        };
      },
      comments: async () => [],
      create: async () => {
        writes++;
        throw new Error("unexpected write");
      },
    };
    const service = new NativeAnnotationService(
      { isAuthorized: () => true, missingAnnotationScopes: () => [] } as any,
      client as any,
      { load: async () => state, save: async () => undefined },
    );
    const result = await service.syncItem(item, original);
    assert.equal(writes, 0);
    assert.equal(result.outcome, "partial");
    assert.lengthOf(state.history[0].details, 3);
    assert.isTrue(
      state.history[0].details.every((d) => d.error?.includes("映射已变化")),
    );
  });

  it("supports a Chinese-only v2 target without inventing an English document", async function () {
    const { item, data, save } = await pdfPaper();
    data.documents["outline-expanded"] = null;
    data.documents["english-original"] = null;
    data.default_annotation_target = null;
    await save();
    const targets = annotationTargets(mappingNote(item)!.mapping);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].mode, "full-translation");
    assert.equal(targets[0].attachmentKeys.length, 1);
  });

  it("reads the versioned JSON pre block and English target", async function () {
    const item = await paper();
    const mapping = mappingNote(item)!;
    assert.isString(mapping.noteKey);
    assert.equal(mapping.documentUrl, "https://my.feishu.cn/docx/Example123");
  });

  it("rejects duplicate mappings rather than choosing one", async function () {
    const item = await paper();
    await addMapping(item);
    assert.throws(() => mappingNote(item), "多条");
  });

  it("fails invalid mappings without exporting or creating a document", async function () {
    const item = await paper(false);
    await addMapping(item, "unsupported/v2");
    let builds = 0;
    const service = new SyncService({
      buildDocument: async () => {
        builds++;
        throw new Error("must not reach legacy export");
      },
    });
    const result = await service.syncItem(item);
    assert.equal(result.outcome, "failed");
    assert.include(result.errors[0], "schema");
    assert.equal(builds, 0);
  });

  it("uses the native authorized client without a CLI or bridge", async function () {
    const item = await paper();
    let calls = 0;
    const service = new SyncService({
      oauth: {
        isAuthorized: () => true,
        missingAnnotationScopes: () => [],
      } as any,
      client: {
        annotations: {
          snapshot: async () => {
            calls++;
            return { document: { revision_id: 1 }, blocks: [] };
          },
        },
      } as any,
      buildDocument: async () => {
        throw new Error("legacy export reached");
      },
    });
    const result = await service.syncItem(item);
    assert.equal(result.outcome, "unchanged", result.errors.join("\n"));
    assert.equal(calls, 1);
  });

  it("accepts a portable mapping whose internal library ID came from another machine", async function () {
    const item = await paper();
    const note = Zotero.Items.get(item.getNotes()[0]);
    note.setNote(
      note
        .getNote()
        .replace('"library_id":' + item.libraryID, '"library_id":99'),
    );
    await note.saveTx();
    assert.equal(mappingNote(item)!.mapping.zotero.library_id, 99);
  });

  it("discovers existing mapped papers after connecting on another machine and periodically reconciles them", async function () {
    const item = await paper();
    const state = emptyAnnotationState();
    const service = new NativeAnnotationService(
      { isAuthorized: () => true, missingAnnotationScopes: () => [] } as any,
      {} as any,
      { load: async () => state, save: async () => undefined },
    );
    const calls: string[] = [];
    plugin.sync.syncItem = async (paper: Zotero.Item) => {
      calls.push(paper.key);
      return {
        libraryID: paper.libraryID,
        itemKey: paper.key,
        title: "test",
        outcome: "unchanged",
        errors: [],
      };
    };
    setPref("autoSyncAnnotations", true);
    await service.retryPending();
    assert.include(calls, item.key);
    calls.length = 0;
    state.watched![item.key] = Date.now() - 1;
    await service.retryPending();
    assert.deepEqual(calls, [item.key]);
    calls.length = 0;
    setPref("autoSyncAnnotations", false);
    await service.retryPending();
    assert.deepEqual(calls, []);
  });

  it("protects mapped paper documents from the legacy delete action", async function () {
    const item = await paper();
    let message = "";
    try {
      await new SyncService().deleteItem(item);
    } catch (error) {
      message = (error as Error).message;
    }
    assert.include(message, "受保护");
  });

  it("blocks manual and preview sync under the master switch before any native IO", async function () {
    const item = await paper();
    setPref("enableAnnotationSync", false);
    let requests = 0;
    const service = new NativeAnnotationService(
      { isAuthorized: () => true, missingAnnotationScopes: () => [] } as any,
      {} as any,
      {
        load: async () => {
          requests++;
          return emptyAnnotationState();
        },
        save: async () => undefined,
      },
    );
    for (const preview of [false, true]) {
      const result = await service.syncItem(item, mappingNote(item)!, preview);
      assert.equal(result.outcome, "failed");
      assert.include(result.errors[0], "已关闭");
    }
    assert.equal(requests, 0);
  });

  it("limits manual and automatic eligibility to the selected collection subtree", async function () {
    const item = await paper();
    const collection = new Zotero.Collection({
      name: "Annotation scope test",
      libraryID: item.libraryID,
    });
    await collection.saveTx();
    const child = new Zotero.Collection({
      name: "Nested scope test",
      libraryID: item.libraryID,
      parentID: collection.id,
    });
    await child.saveTx();
    try {
      setPref("annotationScope", "collection");
      setPref("annotationCollectionKey", collection.key);
      assert.include(annotationScopeReason(item), "不在");
      item.addToCollection(child.id);
      await item.saveTx();
      assert.isUndefined(annotationScopeReason(item));
      setPref("annotationCollectionKey", "MISSING1");
      assert.include(annotationScopeReason(item), "有效");
      setPref("annotationScope", "all");
      assert.isUndefined(annotationScopeReason(item));
    } finally {
      await child.eraseTx();
      await collection.eraseTx();
    }
  });

  for (const mime of ["application/pdf", "text/html"]) {
    it(
      "automatically debounces saved " + mime + " annotations",
      async function () {
        const item = await paper();
        const calls: string[] = [];
        plugin.sync.syncItem = async (target: Zotero.Item) => {
          calls.push(target.key);
          return {
            libraryID: target.libraryID,
            itemKey: target.key,
            title: "Test",
            outcome: "unchanged",
            errors: [],
          };
        };
        setPref("autoSyncAnnotations", true);
        const highlight = await annotation(item, mime);
        highlight.annotationComment = "edited comment";
        await highlight.saveTx();
        await new Promise((resolve) => setTimeout(resolve, 1900));
        assert.deepEqual(calls, [item.key]);
      },
    );
  }

  it("does not automatically export annotations from unmapped papers", async function () {
    const item = await paper(false);
    let calls = 0;
    plugin.sync.syncItem = async () => {
      calls++;
    };
    setPref("autoSyncAnnotations", true);
    await annotation(item, "text/html");
    await new Promise((resolve) => setTimeout(resolve, 1900));
    assert.equal(calls, 0);
  });

  it("discovers deleted sources after delete and native sync-finish notifications", async function () {
    const item = await paper(),
      highlight = await annotation(item, "text/html");
    const service = plugin.sync.annotations;
    const original = service.retryPending;
    let calls = 0;
    service.retryPending = async () => {
      calls++;
    };
    try {
      setPref("autoSyncAnnotations", true);
      await highlight.eraseTx();
      await Zotero.Promise.delay(1800);
      assert.equal(calls, 1);
      await Zotero.Notifier.trigger("finish" as any, "sync", [item.libraryID]);
      await Zotero.Promise.delay(1800);
      assert.equal(calls, 2);
      setPref("autoSyncAnnotations", false);
      await Zotero.Notifier.trigger("finish" as any, "sync", [item.libraryID]);
      await Zotero.Promise.delay(1800);
      assert.equal(calls, 2);
    } finally {
      service.retryPending = original;
    }
  });

  it("blocks annotation writes while the legacy plugin is still active", async function () {
    const item = await paper(),
      previous = (Zotero as any).ZoteroFeishu;
    try {
      (Zotero as any).ZoteroFeishu = { data: { alive: true } };
      assert.include(annotationScopeReason(item), "卸载旧的");
    } finally {
      if (previous) (Zotero as any).ZoteroFeishu = previous;
      else delete (Zotero as any).ZoteroFeishu;
    }
  });
});
