import type { AnnotationInput, AnnotationOptions } from "./engine";
import type { AnnotationClient } from "./client";
import { replyText, sourceIdentity } from "./client";
import { FeishuError } from "../feishu/transport";
import { requireValue } from "./mapping";
import { hashValue } from "../../utils/hash";
import type {
  AnnotationDetail,
  AnnotationState,
  AnnotationStateRepository,
} from "./store";

const gone = (error: unknown) =>
  error instanceof FeishuError &&
  error.status === 404 &&
  error.code === 1069307;

/** Only plugin-owned roots with authoritative Zotero deletion evidence qualify. */
export async function reconcileDeletions(
  input: AnnotationInput,
  state: AnnotationState,
  options: AnnotationOptions,
  client: AnnotationClient,
  store: AnnotationStateRepository,
  cards: any[],
): Promise<{ details: AnnotationDetail[]; blocked: Set<string> }> {
  const details: AnnotationDetail[] = [],
    blocked = new Set<string>();
  if (!options.confirmDeleted) return { details, blocked };
  const prefix = input.itemKey + ":" + input.documentId + ":";
  const live = new Set(input.annotations.map((a) => a.key));
  const keys = new Set(live);
  const owned = new Map<string, any[]>();
  for (const card of cards) {
    const root =
      card.reply_list?.replies?.[0] ||
      (await client.rootReply(input.documentId, card.comment_id));
    const source = sourceIdentity(root);
    if (!source || source.user !== input.userId) continue;
    keys.add(source.key);
    const list = owned.get(source.key) || [];
    list.push(card);
    owned.set(source.key, list);
  }
  for (const identity of Object.keys(state.records))
    if (identity.startsWith(prefix)) keys.add(identity.slice(prefix.length));

  for (const key of keys) {
    const identity = prefix + key,
      record = state.records[identity];
    const result: AnnotationDetail = { annotationKey: key, status: "pending" };
    try {
      if (
        !(await options.confirmDeleted(
          key,
          live.has(key) &&
            (!record?.commentId ||
              record.phase === "deleted" ||
              record.phase === "resolved"),
        ))
      ) {
        if (live.has(key)) continue;
        if (
          (record?.phase === "deleted" || record?.phase === "resolved") &&
          !owned.get(key)?.length
        )
          continue;
        throw new Error(
          "尚未由 Zotero 云端删除记录确认，保留飞书评论；请完成 Zotero 数据同步",
        );
      }
      blocked.add(key); // A stale computer must not recreate this annotation.
      let removed = false,
        resolved = false,
        changedResolved = false;
      const candidates = owned.get(key) || [];
      if (record?.phase === "resolved" && !candidates.length) {
        result.status = "unchanged";
        details.push(result);
        continue;
      }
      if (
        record?.commentId &&
        !candidates.some((c) => c.comment_id === record.commentId)
      )
        requireValue(
          !cards.some((c) => c.comment_id === record.commentId),
          "已有评论的来源标记被修改，保留待处理",
        );
      for (const card of candidates) {
        // After a root-deletion race the surviving discussion may have a new
        // root without our marker. A completed resolution needs no further write.
        if (
          record?.phase === "resolved" &&
          record.commentId === card.comment_id &&
          card.is_solved
        ) {
          resolved = true;
          continue;
        }
        const check = async () => {
          requireValue(
            (!options.canWrite || options.canWrite()) &&
              (!options.canReconcileDeletions ||
                options.canReconcileDeletions()),
            "批注删除同步已关闭或范围已改变",
          );
          requireValue(
            await options.confirmDeleted!(key, true),
            "批注已恢复或删除状态已变化，停止删除",
          );
        };
        let replies: any[];
        try {
          replies = await client.replies(input.documentId, card.comment_id);
        } catch (error) {
          if (gone(error)) continue;
          throw error;
        }
        if (!replies.length) continue;
        let root = replies[0],
          source = sourceIdentity(root);
        requireValue(
          source?.user === input.userId && source.key === key,
          "评论来源无法验证，保留待处理",
        );
        const text = replyText(root),
          remoteHash = source.marker.split("#zfs=")[1]?.split("&")[0];
        requireValue(
          remoteHash
            ? remoteHash === (await hashValue(text))
            : text === record?.lastComment,
          "飞书评论已被独立修改，保留待处理",
        );
        if (card.is_solved && source.marker.includes("&deleted=1")) {
          resolved = true;
          continue;
        }
        if (options.dryRun) {
          result.status = replies.length > 1 ? "would-resolve" : "would-delete";
          continue;
        }
        await check();
        state.records[identity] = {
          ...record,
          phase: "deleting",
          commentId: card.comment_id,
          replyId: root.reply_id,
          blockId: record?.blockId || card.extra?.content_anchor_id || "",
          lastComment: text,
        };
        await store.save(state);
        // Re-read before deleting only our root reply. Never delete anyone else's reply.
        try {
          replies = await client.replies(input.documentId, card.comment_id);
        } catch (error) {
          if (gone(error)) continue;
          throw error;
        }
        if (!replies.length) continue;
        root = replies[0];
        source = sourceIdentity(root);
        requireValue(
          source?.user === input.userId &&
            source.key === key &&
            replyText(root) === text,
          "删除前评论来源或内容发生变化，保留待处理",
        );
        await check();
        if (replies.length > 1) {
          const marker =
            source.marker.replace(/&deleted=1$/, "") + "&deleted=1";
          await client.update(
            input.documentId,
            card.comment_id,
            root.reply_id,
            text.replace(/\n$/, ""),
            marker,
          );
          await check();
          await client.resolve(input.documentId, card.comment_id);
          const after = await client.comments(input.documentId);
          requireValue(
            after.some((c) => c.comment_id === card.comment_id && c.is_solved),
            "已解决状态尚未确认，请重试",
          );
          card.is_solved = true;
          resolved = true;
          changedResolved = true;
        } else {
          options.canDelete?.();
          try {
            await client.deleteReply(
              input.documentId,
              card.comment_id,
              root.reply_id,
            );
          } catch (error) {
            if (!gone(error)) throw error;
          }
          let remaining: any[] = [];
          try {
            remaining = await client.replies(input.documentId, card.comment_id);
          } catch (error) {
            if (!gone(error)) throw error;
          }
          requireValue(
            !remaining.some(
              (r) => r.reply_id === root.reply_id && !r.is_deleted,
            ),
            "删除结果尚未确认，请重试",
          );
          // A reply arriving between the check and DELETE survives; resolve its discussion.
          if (remaining.some((r) => !r.is_deleted)) {
            await check();
            await client.resolve(input.documentId, card.comment_id);
            resolved = true;
            changedResolved = true;
          } else removed = true;
          cards.splice(cards.indexOf(card), 1);
        }
        result.commentId = card.comment_id;
      }
      if (!options.dryRun) {
        state.records[identity] = {
          ...state.records[identity],
          blockId: state.records[identity]?.blockId || "",
          phase: resolved ? "resolved" : "deleted",
        };
        await store.save(state);
        result.status = changedResolved
          ? "resolved"
          : removed
            ? "deleted"
            : "unchanged";
      } else if (!candidates.length) result.status = "unchanged";
    } catch (error) {
      result.status = "pending";
      blocked.add(key);
      result.error = error instanceof Error ? error.message : String(error);
    }
    details.push(result);
  }
  return { details, blocked };
}
