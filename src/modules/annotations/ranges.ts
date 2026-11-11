import { requireValue } from "./mapping";
export type NativeBlock = Record<string, any> & { block_id: string };
export interface TextMatch {
  blockId: string;
  start: number;
  end: number;
  selectedText: string;
  blockText: string;
  method: "exact" | "normalized" | "citations";
}
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
export function stableJSON(v: any): string {
  return JSON.stringify(sort(v));
}
function sort(v: any): any {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sort(v[k])]),
    );
  return v;
}
export function textContainer(
  block: NativeBlock,
): { elements: any[] } | undefined {
  return Object.values(block).find(
    (v) => v && typeof v === "object" && Array.isArray(v.elements),
  );
}
export function elementText(e: any): string {
  return e.text_run ? e.text_run.content : "\ufffc";
}
export function blockText(b: NativeBlock): string {
  return (textContainer(b)?.elements || []).map(elementText).join("");
}
function normalized(
  raw: string,
  citations: boolean,
): { text: string; starts: number[]; ends: number[] } {
  const skipped = new Set<number>();
  if (citations)
    for (const m of raw.matchAll(/\[\d+(?:\s*[,–-]\s*\d+)*\]/g)) {
      for (let i = m.index; i < m.index + m[0].length; i++) skipped.add(i);
    }
  let text = "",
    offset = 0;
  const starts: number[] = [],
    ends: number[] = [];
  for (const char of raw) {
    const start = offset;
    offset += char.length;
    if (skipped.has(start)) continue;
    for (const c of char.normalize("NFKC").toLowerCase().replace(/ß/g, "ss")) {
      if (/[\p{P}\p{Z}\p{Cc}\p{Cf}\s]/u.test(c)) continue;
      text += c;
      for (let i = 0; i < c.length; i++) {
        starts.push(start);
        ends.push(offset);
      }
    }
  }
  return { text, starts, ends };
}
export function findRange(
  blocks: NativeBlock[],
  quote: string,
  relaxed = true,
): TextMatch {
  requireValue(
    typeof quote === "string" && quote.trim(),
    "批注没有选中的原文文字",
  );
  const methods = (
    relaxed ? ["exact", "normalized", "citations"] : ["exact"]
  ) as TextMatch["method"][];
  for (const method of methods) {
    const matches: TextMatch[] = [];
    for (const b of blocks) {
      const raw = blockText(b);
      const mapped =
        method === "exact"
          ? undefined
          : normalized(raw, method === "citations");
      const haystack = mapped?.text ?? raw;
      const needle =
        method === "exact"
          ? quote
          : normalized(quote, method === "citations").text;
      if (!needle || (method !== "exact" && needle.length < 12)) continue;
      let offset = 0,
        found;
      while ((found = haystack.indexOf(needle, offset)) >= 0) {
        const start = mapped ? mapped.starts[found] : found;
        const end = mapped
          ? mapped.ends[found + needle.length - 1]
          : found + needle.length;
        matches.push({
          blockId: b.block_id,
          start,
          end,
          selectedText: raw.slice(start, end),
          blockText: raw,
          method,
        });
        offset = found + 1;
      }
    }
    if (matches.length) {
      requireValue(
        matches.length === 1,
        "选中文字存在多处匹配，保留待处理（" + matches.length + " 处）",
      );
      return matches[0];
    }
  }
  throw new Error("未能在一个正文块中唯一定位所选文字，保留待处理");
}
export function characterSignature(elements: any[], ignored?: string): string {
  const result: any[] = [];
  for (const source of elements) {
    const e = clone(source);
    if (e.text_run) {
      const text = e.text_run.content;
      delete e.text_run.content;
      const style = (e.text_run.text_element_style ||= {});
      const ids = (style.comment_ids || [])
        .filter((c: string) => c !== ignored)
        .sort();
      if (ids.length) style.comment_ids = ids;
      else delete style.comment_ids;
      for (const c of text) result.push([c, e]);
    } else result.push(["\ufffc", e]);
  }
  return stableJSON(result);
}
export function commentRanges(elements: any[], id: string): number[] {
  const result: number[] = [];
  let offset = 0;
  for (const e of elements) {
    const n = elementText(e).length;
    if (e.text_run?.text_element_style?.comment_ids?.includes(id))
      for (let i = offset; i < offset + n; i++) result.push(i);
    offset += n;
  }
  return result;
}
export function withRange(
  elements: any[],
  id: string,
  start: number,
  end: number,
): any[] {
  const result: any[] = [];
  let offset = 0;
  for (const e of elements) {
    const text = elementText(e),
      stop = offset + text.length;
    if (!e.text_run) {
      requireValue(
        !(start < stop && end > offset),
        "无法在公式或内联对象内部设置评论选区",
      );
      result.push(clone(e));
    } else {
      const cuts = [
        ...new Set([
          offset,
          stop,
          ...[start, end].filter((x) => offset < x && x < stop),
        ]),
      ].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const [left, right] = [cuts[i], cuts[i + 1]],
          part = clone(e);
        part.text_run.content = text.slice(left - offset, right - offset);
        const style = (part.text_run.text_element_style ||= {});
        const ids = (style.comment_ids || []).filter((c: string) => c !== id);
        if (start <= left && right <= end) ids.push(id);
        if (ids.length) style.comment_ids = ids;
        else delete style.comment_ids;
        result.push(part);
      }
    }
    offset = stop;
  }
  requireValue(
    0 <= start && start < end && end <= offset,
    "invalid selected range",
  );
  requireValue(
    characterSignature(elements, id) === characterSignature(result, id),
    "正文、样式或其他评论范围发生变化",
  );
  return result;
}
