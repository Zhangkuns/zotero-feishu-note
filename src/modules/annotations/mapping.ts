export const TITLES = {
  "outline-expanded": "逐节精读",
  "full-translation": "中文全文",
  "english-original": "英文全文",
  "structured-synthesis": "精读笔记",
} as const;
export type MappingMode = keyof typeof TITLES;
export interface MappingDocument {
  title: string;
  document_id: string;
  url: string;
}
type ArchiveDocument = MappingDocument & { archive_attachment_key: string };
type ReadingDocument = MappingDocument & { pdf_attachment_key: string };
interface MappingBase {
  zotero: {
    library_id: number;
    item_key: string;
    source_url: string;
    source_attachments: { key: string; content_type: string }[];
  };
  default_annotation_target: "english-original" | null;
}
export type PaperMapping = MappingBase &
  (
    | {
        schema: "zotero-feishu-mapping/v1";
        documents: Record<MappingMode, ArchiveDocument | null>;
      }
    | {
        schema: "zotero-feishu-mapping/v2";
        documents: Record<MappingMode, ReadingDocument | null>;
      }
  );
export function documentAttachmentKey(
  document: ArchiveDocument | ReadingDocument,
): string {
  return "pdf_attachment_key" in document
    ? document.pdf_attachment_key
    : document.archive_attachment_key;
}
export interface AnnotationTarget {
  mode: MappingMode;
  document: MappingDocument;
  attachmentKeys: string[];
}
/** Explicit attachment keys determine routing; filenames and language guesses do not. */
export function annotationTargets(mapping: PaperMapping): AnnotationTarget[] {
  return (Object.keys(TITLES) as MappingMode[]).flatMap((mode) => {
    const document = mapping.documents[mode];
    if (!document) return [];
    const attachmentKeys: string[] = [];
    if (mapping.schema === "zotero-feishu-mapping/v2")
      attachmentKeys.push(documentAttachmentKey(document));
    if (mode === mapping.default_annotation_target)
      attachmentKeys.push(
        ...mapping.zotero.source_attachments.map((a) => a.key),
      );
    return attachmentKeys.length ? [{ mode, document, attachmentKeys }] : [];
  });
}
export interface PaperMappingNote {
  noteKey: string;
  documentUrl?: string;
  mapping: PaperMapping;
}
export function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function keys(value: any, expected: string[], name: string): void {
  requireValue(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === expected.sort().join("|"),
    name + ": wrong fields",
  );
}
export function itemKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{8}$/.test(value);
}
// JSON.parse alone silently accepts duplicate property names. Scan the already
// validated JSON token stream before accepting the mapping contract.
export function uniqueJSON(raw: string): any {
  const parsed = JSON.parse(raw);
  const stack: { object: boolean; key: boolean; seen: Set<string> }[] = [];
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:"]+/g) || [];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token === "{" || token === "[")
      stack.push({ object: token === "{", key: true, seen: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && top?.object) top.key = true;
    else if (token === ":" && top?.object) top.key = false;
    else if (token.startsWith('"') && top?.object && top.key) {
      const name = JSON.parse(token);
      requireValue(!top.seen.has(name), "duplicate JSON key: " + name);
      top.seen.add(name);
    }
  }
  return parsed;
}
export function validateMapping(m: any): PaperMapping {
  keys(
    m,
    ["schema", "zotero", "documents", "default_annotation_target"],
    "mapping",
  );
  requireValue(
    ["zotero-feishu-mapping/v1", "zotero-feishu-mapping/v2"].includes(m.schema),
    "unsupported mapping schema",
  );
  const attachmentField =
    m.schema === "zotero-feishu-mapping/v2"
      ? "pdf_attachment_key"
      : "archive_attachment_key";
  const z = m.zotero;
  keys(
    z,
    ["library_id", "item_key", "source_url", "source_attachments"],
    "zotero",
  );
  requireValue(
    Number.isSafeInteger(z.library_id) && z.library_id > 0,
    "invalid library_id",
  );
  requireValue(itemKey(z.item_key), "invalid parent item_key");
  requireValue(
    typeof z.source_url === "string" &&
      /^https?:\/\/[^\s]+$/.test(z.source_url),
    "invalid source_url",
  );
  requireValue(
    Array.isArray(z.source_attachments) && z.source_attachments.length,
    "original source attachment required",
  );
  const sourceKeys: string[] = [];
  for (const a of z.source_attachments) {
    keys(a, ["key", "content_type"], "source attachment");
    requireValue(itemKey(a.key) && a.key !== z.item_key, "invalid source key");
    requireValue(
      ["application/pdf", "text/html", "application/xhtml+xml"].includes(
        a.content_type,
      ),
      "invalid source MIME type",
    );
    sourceKeys.push(a.key);
  }
  requireValue(
    JSON.stringify(sourceKeys) ===
      JSON.stringify([...new Set(sourceKeys)].sort()),
    "source keys must be unique and sorted",
  );
  keys(m.documents, Object.keys(TITLES), "documents");
  const ids: string[] = [],
    archives: string[] = [];
  for (const [mode, title] of Object.entries(TITLES)) {
    const d = m.documents[mode];
    if (d === null) continue;
    keys(d, ["title", "document_id", "url", attachmentField], mode);
    requireValue(d.title === title, mode + ": wrong title");
    requireValue(
      typeof d.document_id === "string" && /^[A-Za-z0-9]+$/.test(d.document_id),
      "invalid document_id",
    );
    requireValue(
      d.url === "https://my.feishu.cn/docx/" + d.document_id,
      "URL/ID mismatch",
    );
    requireValue(
      itemKey(d[attachmentField]) &&
        !sourceKeys.includes(d[attachmentField]) &&
        d[attachmentField] !== z.item_key,
      "invalid archive key",
    );
    ids.push(d.document_id);
    archives.push(d[attachmentField]);
  }
  requireValue(
    ids.length &&
      ids.length === new Set(ids).size &&
      archives.length === new Set(archives).size,
    "missing or duplicate document/archive mapping",
  );
  requireValue(
    m.default_annotation_target ===
      (m.documents["english-original"] ? "english-original" : null),
    "wrong default_annotation_target",
  );
  return m;
}
export function mappingNote(item: Zotero.Item): PaperMappingNote | undefined {
  const notes = (item.getNotes?.() || [])
    .map((id) => Zotero.Items.get(id))
    .filter((n) => {
      const html = n?.getNote() || "";
      return (
        html.includes("飞书文档映射") || html.includes("zotero-feishu-mapping/")
      );
    });
  if (!notes.length) return undefined;
  requireValue(notes.length === 1, "存在多条飞书文档映射，请先消除歧义");
  const note = notes[0];
  const parser = new (Zotero.getMainWindow() as any).DOMParser();
  const document = parser.parseFromString(
    note.getNote(),
    "text/html",
  ) as Document;
  const pre = document.querySelectorAll("pre");
  requireValue(pre.length === 1, "飞书文档映射必须包含一个 JSON pre 块");
  const mapping = validateMapping(uniqueJSON(pre[0].textContent || ""));
  requireValue(
    mapping.zotero.item_key === item.key,
    "飞书文档映射的父文献不匹配",
  );
  requireValue(
    item.libraryID === Zotero.Libraries.userLibraryID,
    "仅支持我的文库",
  );
  // Internal numeric library IDs are machine-local. Resolve all keys against
  // the current personal library instead of treating that number as portable.
  for (const source of mapping.zotero.source_attachments) {
    const a = Zotero.Items.getByLibraryAndKey(item.libraryID, source.key);
    requireValue(
      a &&
        a.isAttachment() &&
        a.parentID === item.id &&
        a.attachmentContentType === source.content_type &&
        !a.deleted,
      "原文附件与当前 Zotero 不匹配: " + source.key,
    );
  }
  for (const d of Object.values(mapping.documents)) {
    if (!d) continue;
    const a = Zotero.Items.getByLibraryAndKey(
      item.libraryID,
      documentAttachmentKey(d),
    );
    requireValue(
      a &&
        a.isAttachment() &&
        a.parentID === item.id &&
        a.getField("title") === d.title &&
        (mapping.schema === "zotero-feishu-mapping/v2"
          ? a.attachmentContentType === "application/pdf"
          : ["text/markdown", "text/plain"].includes(
              a.attachmentContentType,
            )) &&
        !a.deleted,
      "阅读附件与当前 Zotero 不匹配: " + documentAttachmentKey(d),
    );
  }
  return {
    noteKey: note.key,
    mapping,
    documentUrl:
      mapping.documents["english-original"]?.url ||
      Object.values(mapping.documents).find((d) => d)?.url,
  };
}
