import { getPref } from "../../utils/prefs";
import type { OAuthService } from "../oauthService";
import type { SyncResult } from "../types";
import type { AnnotationClient } from "./client";
import { AnnotationEngine, type AnnotationInput } from "./engine";
import { mappingNote, requireValue, type PaperMappingNote } from "./mapping";
import {
  AnnotationStore,
  type AnnotationStateRepository,
  type AnnotationHistory,
} from "./store";
export function annotationSettings() {
  return {
    enabled: Boolean(getPref("enableAnnotationSync")),
    delay: bounded(getPref("annotationDelaySeconds"), 1.5, 0.5, 300) * 1000,
    retryDelay: bounded(getPref("annotationRetrySeconds"), 60, 30, 3600) * 1000,
    reconcileDelay:
      bounded(getPref("annotationReconcileSeconds"), 300, 60, 3600) * 1000,
    auto:
      Boolean(getPref("enableAnnotationSync")) &&
      Boolean(getPref("autoSyncAnnotations")),
    retry: Boolean(getPref("retryAnnotations")),
    relaxed: Boolean(getPref("relaxedAnnotationMatching")),
    includeHighlights: Boolean(getPref("syncUncommentedHighlights")),
  };
}
export function annotationScopeReason(item: Zotero.Item): string | undefined {
  if (!getPref("enableAnnotationSync"))
    return "原文批注同步已关闭，请先在插件设置中启用";
  const scope = String(getPref("annotationScope"));
  if (scope === "all") return;
  if (scope !== "collection") return "批注同步范围无效，请在设置中重新选择";
  const key = String(getPref("annotationCollectionKey") || "");
  const collection =
    key && Zotero.Collections.getByLibraryAndKey(item.libraryID, key);
  if (!collection) return "请在插件设置中选择有效的同步分类";
  const contains = (c: Zotero.Collection): boolean =>
    c.hasItem(item.id) || c.getChildCollections().some(contains);
  if (!contains(collection)) return "文献不在批注同步的指定分类范围内";
}
function bounded(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
export class NativeAnnotationService {
  private tail: Promise<void> = Promise.resolve();
  private alive = true;
  private discovered = false;
  constructor(
    private readonly oauth: OAuthService,
    private readonly client: AnnotationClient,
    readonly store: AnnotationStateRepository = new AnnotationStore(),
  ) {}
  stop(): void {
    this.alive = false;
  }
  requestDiscovery(): void {
    this.discovered = false;
  }
  private exclusive<T>(f: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(f, f);
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
  syncItem(
    item: Zotero.Item,
    note: PaperMappingNote,
    dryRun = false,
  ): Promise<SyncResult> {
    return this.exclusive(async () => {
      const title = String(item.getField("title") || item.key);
      const result: SyncResult = {
        libraryID: item.libraryID,
        itemKey: item.key,
        title,
        documentUrl: note.documentUrl,
        outcome: "failed",
        errors: [],
      };
      const excluded = annotationScopeReason(item);
      if (excluded) return { ...result, errors: [excluded] };
      const state = await this.store.load();
      let details: AnnotationHistory["details"] = [];
      try {
        requireValue(this.alive, "插件正在关闭");
        requireValue(
          this.oauth.isAuthorized(),
          "请先在 Zotero Feishu Sync 设置中点击“连接飞书”完成授权",
        );
        const missing = this.oauth.missingAnnotationScopes();
        requireValue(
          !missing.length,
          "需要重新连接飞书，补充评论权限: " + missing.join(", "),
        );
        // Re-read the note and live attachments immediately before any request.
        const verified = mappingNote(item);
        requireValue(
          verified?.noteKey === note.noteKey,
          "飞书文档映射已变化，请重试",
        );
        requireValue(
          verified.mapping.default_annotation_target === "english-original",
          "没有可用的英文全文目标",
        );
        const target = verified.mapping.documents["english-original"]!;
        const annotations: AnnotationInput["annotations"] = [];
        for (const source of verified.mapping.zotero.source_attachments) {
          const attachment = Zotero.Items.getByLibraryAndKey(
            item.libraryID,
            source.key,
          )!;
          requireValue(
            attachment && attachment.isAttachment(),
            "原文附件不可用",
          );
          for (const a of attachment.getAnnotations(false))
            annotations.push({
              key: a.key,
              type: a.annotationType,
              text: a.annotationText || "",
              comment: a.annotationComment || "",
            });
        }
        const input: AnnotationInput = {
          itemKey: item.key,
          title,
          documentId: target.document_id,
          documentUrl: target.url,
          userId: String(Zotero.Users.getCurrentUserID() || "local"),
          annotations,
        };
        const settings = annotationSettings();
        details = await new AnnotationEngine(this.client, this.store).sync(
          input,
          state,
          {
            dryRun,
            relaxed: settings.relaxed,
            includeHighlights: settings.includeHighlights,
            canWrite: () => this.alive && !annotationScopeReason(item),
          },
        );
        result.errors = details
          .filter((d) => d.status === "pending")
          .map((d) => d.annotationKey + ": " + d.error);
        result.outcome = result.errors.length
          ? "partial"
          : details.some((d) => d.status === "synced")
            ? "updated"
            : "unchanged";
      } catch (error) {
        result.errors = [
          error instanceof Error ? error.message : String(error),
        ];
      }
      if (!dryRun) {
        state.watched ||= {};
        state.watched[item.key] =
          Date.now() +
          (details.some((d) => d.status === "synced")
            ? 30000
            : annotationSettings().reconcileDelay);
        if (result.errors.length)
          state.pending[item.key] = {
            itemKey: item.key,
            attempts: (state.pending[item.key]?.attempts || 0) + 1,
            lastAttempt: Date.now(),
            reason: result.errors.join("\n"),
          };
        else delete state.pending[item.key];
      }
      state.history.unshift({
        time: new Date().toISOString(),
        itemKey: item.key,
        title,
        documentUrl: result.documentUrl,
        outcome: dryRun ? "preview" : result.outcome,
        details,
        errors: result.errors,
      });
      state.history = state.history.slice(0, 100);
      await this.store.save(state);
      return result;
    });
  }
  async history(): Promise<AnnotationHistory[]> {
    await this.tail;
    return (await this.store.load()).history;
  }
  async retryPending(force = false): Promise<void> {
    if (
      !this.alive ||
      !this.oauth.isAuthorized() ||
      this.oauth.missingAnnotationScopes().length
    )
      return;
    const settings = annotationSettings();
    if (!force && !settings.auto) return;
    const state = await this.store.load();
    const due = new Set<string>();
    if (!force && !this.discovered) {
      const search = new Zotero.Search({
        libraryID: Zotero.Libraries.userLibraryID,
      });
      search.addCondition("itemType", "is", "note");
      search.addCondition("note", "contains", "zotero-feishu-mapping/v1");
      for (const id of await search.search()) {
        const child = Zotero.Items.get(id);
        const paper = child?.topLevelItem;
        if (paper?.isRegularItem() && !paper.deleted) due.add(paper.key);
      }
      this.discovered = true;
    }
    for (const p of Object.values(state.pending)) {
      if (!this.alive) return;
      const delay = Math.min(
        3600000,
        settings.retryDelay * 2 ** Math.min(p.attempts - 1, 5),
      );
      if (!force && (!settings.retry || Date.now() - p.lastAttempt < delay))
        continue;
      due.add(p.itemKey);
    }
    if (!force)
      for (const [key, nextCheck] of Object.entries(state.watched || {})) {
        if (!state.pending[key] && Date.now() >= nextCheck) due.add(key);
      }
    for (const key of due) {
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      );
      if (!item || item.deleted) continue;
      if (annotationScopeReason(item)) continue;
      // Removed mappings must never fall through to the legacy exporter.
      try {
        if (!mappingNote(item)) continue;
      } catch (error) {
        addon.syncStatus.markFailed(
          [item],
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      // SyncService serializes manual and automatic work for this paper.
      addon.syncStatus.markSyncing([item]);
      const result = await addon.sync.syncItem(item);
      if (this.alive) addon.syncStatus.markResult(result);
    }
  }
}
