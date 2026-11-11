import { hashValue } from "../../utils/hash";
import { FeishuError } from "../feishu/transport";
import {
  type AnnotationClient,
  commentText,
  createElements,
  replyText,
  sourceMarker,
} from "./client";
import { requireValue } from "./mapping";
import {
  blockText,
  characterSignature,
  commentRanges,
  findRange,
  stableJSON,
  textContainer,
  withRange,
  type TextMatch,
} from "./ranges";
import type {
  AnnotationDetail,
  AnnotationState,
  AnnotationStateRepository,
} from "./store";
export interface SourceAnnotation {
  key: string;
  type: string;
  text: string;
  comment: string;
}
export interface AnnotationInput {
  itemKey: string;
  title: string;
  documentId: string;
  documentUrl: string;
  userId: string;
  annotations: SourceAnnotation[];
}
export interface AnnotationOptions {
  dryRun?: boolean;
  relaxed: boolean;
  includeHighlights: boolean;
  canWrite?: () => boolean;
}
export class AnnotationEngine {
  constructor(
    private readonly client: AnnotationClient,
    private readonly store: AnnotationStateRepository,
  ) {}
  async sync(
    input: AnnotationInput,
    state: AnnotationState,
    options: AnnotationOptions,
  ): Promise<AnnotationDetail[]> {
    let { blocks } = await this.client.snapshot(input.documentId);
    let cards: any[] | undefined;
    const results: AnnotationDetail[] = [];
    for (const a of input.annotations) {
      const result: AnnotationDetail = {
        annotationKey: a.key,
        status: "pending",
      };
      try {
        if (
          !["highlight", "underline"].includes(a.type) ||
          (!options.includeHighlights && !a.comment.trim())
        ) {
          result.status = "skipped";
          results.push(result);
          continue;
        }
        const match = findRange(blocks, a.text, options.relaxed);
        result.selectedText = match.selectedText;
        if (options.dryRun) result.status = "matched";
        else {
          cards ||= await this.client.comments(input.documentId);
          await this.writeOne(
            input,
            a,
            match,
            cards,
            state,
            result,
            options.canWrite,
          );
          ({ blocks } = await this.client.snapshot(input.documentId));
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
    }
    return results;
  }
  private async writeOne(
    input: AnnotationInput,
    a: SourceAnnotation,
    m: TextMatch,
    cards: any[],
    state: AnnotationState,
    result: AnnotationDetail,
    canWrite?: () => boolean,
  ): Promise<void> {
    const check = () =>
      requireValue(
        !canWrite || canWrite(),
        "批注同步已关闭或范围已改变，停止后续写入",
      );
    check();
    const doc = input.documentId;
    const identity = [input.itemKey, doc, a.key].join(":");
    const expected = commentText(a.comment);
    const marker =
      "https://www.zotero.org/users/" +
      input.userId +
      "/items/" +
      a.key +
      "#zfs=" +
      (await hashValue(expected));
    createElements(a.comment, marker); // Validate before entering the uncertain-create phase.
    let record = state.records[identity];
    let recovered = false,
      created = false;
    // Every machine selects the same smallest ID, including when local state
    // points to a later duplicate created by a concurrent first upload.
    const found: any[] = [];
    for (const card of cards) {
      let root = card.reply_list?.replies?.[0];
      if (!root) root = await this.client.rootReply(doc, card.comment_id);
      card.reply_list = { ...card.reply_list, replies: [root] };
      const provenance = sourceMarker(root, a.key);
      if (provenance && !provenance.includes("&duplicate=")) found.push(card);
    }
    found.sort(
      (x, y) =>
        String(x.comment_id).length - String(y.comment_id).length ||
        String(x.comment_id).localeCompare(String(y.comment_id)),
    );
    let merged = false;
    if (found.length > 1) {
      const canonical = found[0];
      const duplicates: { card: any; root: any; provenance: string }[] = [];
      // Validate every candidate before changing any remote discussion.
      for (const card of found) {
        const replies = await this.client.replies(doc, card.comment_id);
        const root = replies[0];
        const provenance = sourceMarker(root, a.key);
        const current = replyText(root);
        const remoteHash = provenance?.split("#zfs=")[1]?.split("&")[0];
        requireValue(
          (card.extra?.content_anchor_id || relationBlock(card)) ===
            m.blockId &&
            provenance &&
            (current === expected ||
              Boolean(remoteHash && remoteHash === (await hashValue(current)))),
          "重复评论的来源、正文或位置发生变化，保留待处理",
        );
        if (card.comment_id !== canonical.comment_id) {
          requireValue(
            replies.length === 1,
            "重复评论已有后续回复，已保留讨论并列入待处理",
          );
          duplicates.push({ card, root, provenance: provenance! });
        }
      }
      for (const duplicate of duplicates) {
        check();
        const alias =
          duplicate.provenance.split("#")[0] +
          "#zfs=" +
          (await hashValue(replyText(duplicate.root))) +
          "&duplicate=" +
          canonical.comment_id;
        // Mark the alias before resolving; never delete replies or discussions.
        // The marker remains recoverable after a crash or a machine change.
        await this.client.update(
          doc,
          duplicate.card.comment_id,
          duplicate.root.reply_id,
          replyText(duplicate.root).replace(/\n$/, ""),
          alias,
        );
        check();
        requireValue(
          (await this.client.replies(doc, duplicate.card.comment_id)).length ===
            1,
          "重复评论新增了后续回复，已保留讨论",
        );
        await this.client.resolve(doc, duplicate.card.comment_id);
        const root = await this.client.rootReply(
          doc,
          duplicate.card.comment_id,
        );
        requireValue(
          sourceMarker(root, a.key) === alias,
          "重复评论标记回读不一致",
        );
        duplicate.card.reply_list = { replies: [root] };
        duplicate.card.is_solved = true;
        merged = true;
      }
    }
    // A crash between aliasing and resolving is repaired on the next pass.
    for (const card of cards) {
      const root = card.reply_list?.replies?.[0];
      const provenance = root && sourceMarker(root, a.key);
      if (provenance?.includes("&duplicate=") && !card.is_solved) {
        check();
        const replies = await this.client.replies(doc, card.comment_id);
        const liveMarker = sourceMarker(replies[0], a.key);
        const savedHash = liveMarker?.split("#zfs=")[1]?.split("&")[0];
        requireValue(
          replies.length === 1 &&
            liveMarker === provenance &&
            savedHash === (await hashValue(replyText(replies[0]))),
          "重复评论已有后续回复或独立修改，已保留讨论",
        );
        await this.client.resolve(doc, card.comment_id);
        card.is_solved = true;
        merged = true;
      }
    }
    if (
      !record?.commentId ||
      (found.length && record.commentId !== found[0].comment_id)
    ) {
      if (found.length) {
        const card = found[0];
        // The actual range readback below also verifies the block. Metadata
        // alone is not enough to assert a sentence-level anchor.
        const blockId = card.extra?.content_anchor_id || relationBlock(card);
        requireValue(
          blockId === m.blockId,
          "恢复的评论位于其他正文块，保留待处理",
        );
        record = {
          commentId: card.comment_id,
          blockId: m.blockId,
          phase: "anchoring",
        };
        state.records[identity] = record;
        recovered = true;
        await this.store.save(state);
      } else {
        requireValue(
          record?.phase !== "creating",
          "上次创建结果不确定；未恢复到评论前不会重复创建",
        );
        record = { phase: "creating", blockId: m.blockId };
        state.records[identity] = record;
        await this.store.save(state);
        let response;
        try {
          if (canWrite && !canWrite()) {
            record.phase = "not_created";
            await this.store.save(state);
          }
          check();
          response = await this.client.create(
            doc,
            m.blockId,
            a.comment,
            marker,
          );
        } catch (error) {
          if (
            error instanceof FeishuError &&
            ((error.status && error.status >= 400 && error.status < 500) ||
              (error.status &&
                error.status >= 200 &&
                error.status < 300 &&
                error.code))
          ) {
            record.phase = "not_created";
            await this.store.save(state);
          }
          throw error;
        }
        record.commentId = response.comment_id;
        record.phase = "anchoring";
        created = true;
        await this.store.save(state);
        cards.push({
          comment_id: record.commentId,
          extra: { content_anchor_id: m.blockId },
          reply_list: { replies: [] },
        });
      }
    }
    requireValue(
      record?.commentId && record.blockId === m.blockId,
      "选区移到了其他正文块，保留待处理",
    );
    const commentId = record.commentId;
    const root = await this.client.rootReply(doc, commentId);
    const oldMarker = sourceMarker(root, a.key);
    requireValue(oldMarker, "远端评论已失去 Zotero 来源标记，保留待处理");
    requireValue(
      !oldMarker.includes("&duplicate="),
      "等待恢复重复评论对应的主评论",
    );
    const current = replyText(root);
    const remoteHash = oldMarker.split("#zfs=")[1];
    const trustworthy =
      current === expected ||
      current === record.lastComment ||
      Boolean(remoteHash && remoteHash === (await hashValue(current)));
    requireValue(
      trustworthy,
      "飞书评论被独立修改或旧版记录不可验证，未覆盖；请先核对这条评论",
    );
    record.replyId = root.reply_id;
    const edited = current !== expected || oldMarker !== marker;
    if (edited) {
      check();
      await this.client.update(
        doc,
        commentId,
        root.reply_id,
        a.comment,
        marker,
      );
    }
    const rootAfter = await this.client.rootReply(doc, commentId);
    requireValue(
      replyText(rootAfter) === expected &&
        sourceMarker(rootAfter, a.key) === marker,
      "评论正文回读不一致",
    );
    const revision = (await this.client.document(doc)).revision_id;
    const before = await this.client.block(doc, m.blockId, revision);
    requireValue(
      blockText(before) === m.blockText,
      "目标正文已变化，请重新同步定位",
    );
    const elements = textContainer(before)?.elements;
    requireValue(elements, "target text elements missing");
    const wanted = Array.from(
      { length: m.end - m.start },
      (_, i) => m.start + i,
    );
    const changed =
      stableJSON(commentRanges(elements, commentId)) !== stableJSON(wanted);
    if (changed) {
      check();
      await this.client.anchor(
        doc,
        m.blockId,
        revision,
        withRange(elements, commentId, m.start, m.end),
      );
    }
    const after = await this.client.block(
      doc,
      m.blockId,
      (await this.client.document(doc)).revision_id,
    );
    const final = textContainer(after)?.elements;
    requireValue(
      final &&
        stableJSON(commentRanges(final, commentId)) === stableJSON(wanted),
      "评论选区回读不一致",
    );
    requireValue(
      characterSignature(elements, commentId) ===
        characterSignature(final, commentId),
      "正文、样式或其他评论发生变化",
    );
    record.phase = "verified";
    record.lastComment = expected;
    record.start = m.start;
    record.end = m.end;
    record.selectedText = m.selectedText;
    await this.store.save(state);
    result.status =
      created || recovered || edited || changed || merged
        ? "synced"
        : "unchanged";
    result.commentId = commentId;
  }
}
function relationBlock(card: any): string | undefined {
  try {
    const relation =
      typeof card.relation?.relation === "string"
        ? JSON.parse(card.relation.relation)
        : card.relation?.relation;
    return (Object.values(relation || {}) as any[]).find(
      (v) => v?.positionInfo?.blockID,
    )?.positionInfo.blockID;
  } catch {
    return undefined;
  }
}
