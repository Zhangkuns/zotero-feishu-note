import { FeishuError, FeishuTransport } from "../feishu/transport";
import { requireValue } from "./mapping";
import type { NativeBlock } from "./ranges";
export interface AnnotationClient {
  document(doc: string): Promise<any>;
  snapshot(doc: string): Promise<{ document: any; blocks: NativeBlock[] }>;
  block(doc: string, block: string, revision: number): Promise<NativeBlock>;
  comments(doc: string): Promise<any[]>;
  rootReply(doc: string, comment: string): Promise<any>;
  replies(doc: string, comment: string): Promise<any[]>;
  resolve(doc: string, comment: string, solved?: boolean): Promise<void>;
  deleteReply(doc: string, comment: string, reply: string): Promise<void>;
  create(
    doc: string,
    block: string,
    comment: string,
    marker: string,
  ): Promise<{ comment_id: string }>;
  update(
    doc: string,
    comment: string,
    reply: string,
    text: string,
    marker: string,
  ): Promise<void>;
  anchor(
    doc: string,
    block: string,
    revision: number,
    elements: any[],
  ): Promise<void>;
}
function escaped(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function commentText(text: string): string {
  return (text || "Zotero 高亮") + "\n";
}
const markerPattern =
  /\n\[Zotero Feishu Sync\] (https:\/\/www\.zotero\.org\/users\/(?:[0-9]+|local)\/items\/[A-Z0-9]{8}#zfs=[a-f0-9]+(?:&duplicate=[A-Za-z0-9_-]+)?(?:&deleted=1)?)\n?$/;
const hiddenPattern =
  /\u2063\u2060\u2063([\uFE00-\uFE0F]+)\u2063\u2064\u2063(?=\n?$)/;
const validSource =
  /^https:\/\/www\.zotero\.org\/users\/(?:[0-9]+|local)\/items\/[A-Z0-9]{8}(?:#zfs=[a-f0-9]+(?:&duplicate=[A-Za-z0-9_-]+)?(?:&deleted=1)?)?$/;
export function hiddenMarker(marker: string): string {
  requireValue(
    marker.length <= 2048 && /^[\x20-\x7E]+$/.test(marker),
    "invalid annotation source marker",
  );
  // Default-ignorable Unicode selectors carry the provenance without adding
  // visible text. Delimiters keep selectors away from the last visible glyph.
  return (
    "\u2063\u2060\u2063" +
    [...marker]
      .map((c) =>
        String.fromCharCode(
          0xfe00 + (c.charCodeAt(0) >> 4),
          0xfe00 + (c.charCodeAt(0) & 15),
        ),
      )
      .join("") +
    "\u2063\u2064\u2063"
  );
}
function rawReplyText(reply: any): string {
  return (reply.content?.elements || [])
    .map((e: any) => e.text_run?.text || "")
    .join("");
}
export function hiddenSourceMarker(reply: any): string | undefined {
  const encoded = rawReplyText(reply).match(hiddenPattern)?.[1];
  if (!encoded || encoded.length % 2 || encoded.length > 4096) return;
  let decoded = "";
  for (let i = 0; i < encoded.length; i += 2)
    decoded += String.fromCharCode(
      ((encoded.charCodeAt(i) - 0xfe00) << 4) |
        (encoded.charCodeAt(i + 1) - 0xfe00),
    );
  return validSource.test(decoded) ? decoded : undefined;
}
export function createElements(text: string, marker: string): any[] {
  const raw = commentText(text).replace(/\n$/, hiddenMarker(marker) + "\n");
  requireValue([...raw].length <= 10000, "批注过长（飞书评论最多 10000 字符）");
  const chars = [...raw],
    elements: any[] = [];
  // Do not create a standalone whitespace-only run; it is rejected by Feishu.
  for (let i = 0; i < chars.length; i += 900)
    elements.push({
      type: "text",
      text: escaped(chars.slice(i, i + 900).join("")),
    });
  if (elements.length > 1 && !elements[elements.length - 1].text.trim())
    elements[elements.length - 2].text += elements.pop().text;
  return elements;
}
export function replyText(reply: any): string {
  const raw = rawReplyText(reply);
  return (
    hiddenSourceMarker(reply) ? raw.replace(hiddenPattern, "") : raw
  ).replace(markerPattern, "\n");
}
export function sourceMarker(reply: any, key: string): string | undefined {
  const text = rawReplyText(reply);
  const marker = text.match(markerPattern)?.[1];
  const links = (reply.content?.elements || [])
    .map((e: any) => e.docs_link?.url)
    .filter((x: any) => typeof x === "string");
  return [hiddenSourceMarker(reply), marker, ...links]
    .filter(Boolean)
    .find((url: string) =>
      new RegExp(
        "^https://www\\.zotero\\.org/users/(?:[0-9]+|local)/items/" +
          key +
          "(?:#zfs=[a-f0-9]+(?:&duplicate=[A-Za-z0-9_-]+)?(?:&deleted=1)?)?$",
      ).test(url),
    );
}
export function sourceIdentity(
  reply: any,
): { user: string; key: string; marker: string } | undefined {
  const candidates = [
    hiddenSourceMarker(reply),
    rawReplyText(reply).match(markerPattern)?.[1],
    ...(reply.content?.elements || []).map((e: any) => e.docs_link?.url),
  ];
  for (const marker of candidates) {
    if (typeof marker !== "string" || !validSource.test(marker)) continue;
    const m = marker.match(/\/users\/([0-9]+|local)\/items\/([A-Z0-9]{8})/)!;
    return { user: m[1], key: m[2], marker };
  }
}
export class FeishuAnnotationClient implements AnnotationClient {
  constructor(private readonly transport: FeishuTransport) {}
  private async request(
    ...args: Parameters<FeishuTransport["request"]>
  ): Promise<Record<string, unknown>> {
    try {
      return await this.transport.request(...args);
    } catch (error) {
      if (!(error instanceof FeishuError)) throw error;
      throw new FeishuError(
        args[0] +
          " " +
          args[1].split("?")[0] +
          ": " +
          error.message +
          " (HTTP " +
          error.status +
          ", code " +
          error.code +
          ")",
        error.status,
        error.code,
      );
    }
  }
  private path(doc: string): string {
    return "/drive/v1/files/" + encodeURIComponent(doc);
  }
  async document(doc: string): Promise<any> {
    const data = await this.request(
      "GET",
      "/docx/v1/documents/" + encodeURIComponent(doc),
    );
    requireValue(data.document, "document metadata missing");
    return data.document;
  }
  async snapshot(
    doc: string,
  ): Promise<{ document: any; blocks: NativeBlock[] }> {
    const document = await this.document(doc),
      blocks: NativeBlock[] = [];
    let token = "";
    for (let page = 0; page < 1000; page++) {
      const query = new URLSearchParams({
        page_size: "500",
        document_revision_id: String(document.revision_id),
      });
      if (token) query.set("page_token", token);
      const data = await this.request(
        "GET",
        "/docx/v1/documents/" + encodeURIComponent(doc) + "/blocks?" + query,
      );
      requireValue(Array.isArray(data.items), "document blocks missing");
      blocks.push(...(data.items as NativeBlock[]));
      if (!data.has_more) {
        requireValue(
          (await this.document(doc)).revision_id === document.revision_id,
          "文档在读取期间发生变化，请重试",
        );
        return { document, blocks };
      }
      requireValue(
        typeof data.page_token === "string" && data.page_token !== token,
        "invalid block pagination",
      );
      token = data.page_token;
    }
    throw new Error("too many document blocks");
  }
  async block(
    doc: string,
    block: string,
    revision: number,
  ): Promise<NativeBlock> {
    const data = await this.request(
      "GET",
      "/docx/v1/documents/" +
        encodeURIComponent(doc) +
        "/blocks/" +
        encodeURIComponent(block) +
        "?document_revision_id=" +
        revision,
    );
    requireValue(data.block, "target block missing");
    return data.block as NativeBlock;
  }
  async comments(doc: string): Promise<any[]> {
    const result: any[] = [];
    // Both active and resolved comments participate in recovery and deduplication.
    for (const solved of [false, true]) {
      let token = "";
      for (let page = 0; page < 1000; page++) {
        const query = new URLSearchParams({
          file_type: "docx",
          page_size: "100",
          is_whole: "false",
          is_solved: String(solved),
          need_relation: "true",
        });
        if (token) query.set("page_token", token);
        const data = await this.request(
          "GET",
          this.path(doc) + "/comments?" + query,
        );
        requireValue(Array.isArray(data.items), "comment list missing");
        result.push(...data.items);
        if (!data.has_more) break;
        requireValue(
          typeof data.page_token === "string" &&
            data.page_token !== token &&
            page < 999,
          "invalid comment pagination",
        );
        token = data.page_token;
      }
    }
    return [...new Map(result.map((c) => [c.comment_id, c])).values()];
  }
  async rootReply(doc: string, comment: string): Promise<any> {
    const replies = await this.replies(doc, comment);
    requireValue(replies.length, "comment has no root reply");
    return replies[0];
  }
  async replies(doc: string, comment: string): Promise<any[]> {
    const items: any[] = [];
    let token = "";
    for (let page = 0; page < 1000; page++) {
      const data = await this.request(
        "GET",
        this.path(doc) +
          "/comments/" +
          encodeURIComponent(comment) +
          "/replies?file_type=docx&page_size=100" +
          (token ? "&page_token=" + encodeURIComponent(token) : ""),
      );
      requireValue(Array.isArray(data.items), "comment replies missing");
      items.push(...data.items);
      if (!data.has_more) return items;
      requireValue(
        typeof data.page_token === "string" && data.page_token !== token,
        "invalid reply pagination",
      );
      token = data.page_token;
    }
    throw new Error("too many comment replies");
  }
  async resolve(doc: string, comment: string, solved = true): Promise<void> {
    await this.transport.waitForDocumentWrite();
    await this.request(
      "PATCH",
      this.path(doc) +
        "/comments/" +
        encodeURIComponent(comment) +
        "?file_type=docx",
      { is_solved: solved },
    );
  }
  async deleteReply(
    doc: string,
    comment: string,
    reply: string,
  ): Promise<void> {
    await this.transport.waitForDocumentWrite();
    await this.request(
      "DELETE",
      this.path(doc) +
        "/comments/" +
        encodeURIComponent(comment) +
        "/replies/" +
        encodeURIComponent(reply) +
        "?file_type=docx",
    );
  }
  async create(
    doc: string,
    block: string,
    text: string,
    marker: string,
  ): Promise<{ comment_id: string }> {
    await this.transport.waitForDocumentWrite();
    // POST creation must not be blindly retried on a lost response/5xx.
    const data = await this.request(
      "POST",
      this.path(doc) + "/new_comments",
      {
        file_type: "docx",
        anchor: { block_id: block },
        reply_elements: createElements(text, marker),
      },
      false,
    );
    requireValue(
      typeof data.comment_id === "string" && data.comment_id,
      "missing created comment ID",
    );
    return { comment_id: data.comment_id };
  }
  async update(
    doc: string,
    comment: string,
    reply: string,
    text: string,
    marker: string,
  ): Promise<void> {
    const elements = createElements(text, marker).map((e) =>
      e.type === "text"
        ? { type: "text_run", text_run: { text: e.text } }
        : { type: "docs_link", docs_link: { url: e.link } },
    );
    await this.transport.waitForDocumentWrite();
    await this.request(
      "PUT",
      this.path(doc) +
        "/comments/" +
        encodeURIComponent(comment) +
        "/replies/" +
        encodeURIComponent(reply) +
        "?file_type=docx",
      { content: { elements } },
    );
  }
  async anchor(
    doc: string,
    block: string,
    revision: number,
    elements: any[],
  ): Promise<void> {
    await this.transport.waitForDocumentWrite();
    await this.request(
      "PATCH",
      "/docx/v1/documents/" +
        encodeURIComponent(doc) +
        "/blocks/" +
        encodeURIComponent(block) +
        "?document_revision_id=" +
        revision,
      { update_text_elements: { elements } },
    );
  }
}
