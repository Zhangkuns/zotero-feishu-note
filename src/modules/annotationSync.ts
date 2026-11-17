import { mappingNote } from "./annotations/mapping";
import {
  annotationSettings,
  annotationScopeReason,
} from "./annotations/service";
export { mappingNote } from "./annotations/mapping";

export class AnnotationObserver {
  private observerID?: string;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private alive = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private discoveryTimer?: ReturnType<typeof setTimeout>;

  register(): void {
    if (this.observerID) return;
    this.alive = true;
    this.scheduleRetry();
    this.observerID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids) => {
          if (
            this.alive &&
            annotationSettings().auto &&
            ((type === "item" && (event === "delete" || event === "trash")) ||
              (type === "sync" && String(event) === "finish"))
          ) {
            addon.sync.annotations.requestDiscovery();
            if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
            this.discoveryTimer = setTimeout(() => {
              if (this.alive && annotationSettings().auto)
                void addon.sync.annotations
                  .retryPending()
                  .catch((e) =>
                    ztoolkit.log("Deletion reconciliation failed", e),
                  );
            }, annotationSettings().delay);
            return;
          }
          if (
            !this.alive ||
            !annotationSettings().auto ||
            type !== "item" ||
            (event !== "add" && event !== "modify")
          )
            return;
          // Keep network IO outside Zotero's save/notifier transaction.
          for (const id of ids) {
            const changed = Zotero.Items.get(Number(id));
            if (!changed || changed.deleted) continue;
            let paper: Zotero.Item | undefined;
            if (changed.isAnnotation()) {
              const attachment = Zotero.Items.get(changed.parentID as number);
              if (attachment?.parentID)
                paper = Zotero.Items.get(attachment.parentID);
            } else if (
              changed.isNote() &&
              changed.parentID &&
              changed.getNote().includes("zotero-feishu-mapping/")
            )
              paper = Zotero.Items.get(changed.parentID);
            else if (changed.isRegularItem()) paper = changed;
            if (
              !paper?.isRegularItem() ||
              paper.libraryID !== Zotero.Libraries.userLibraryID
            )
              continue;
            if (annotationScopeReason(paper)) continue;
            const pending = this.timers.get(paper.id);
            if (pending) clearTimeout(pending);
            const item = paper;
            this.timers.set(
              item.id,
              setTimeout(() => {
                this.timers.delete(item.id);
                void this.sync(item);
              }, annotationSettings().delay),
            );
          }
        },
      },
      ["item", "sync"],
      "zotero-feishu-annotation-sync",
    );
  }

  unregister(): void {
    this.alive = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
    this.observerID = undefined;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private scheduleRetry(): void {
    this.retryTimer = setTimeout(() => {
      if (!this.alive) return;
      void addon.sync.annotations
        .retryPending()
        .catch((error) => ztoolkit.log("Annotation retry failed", error))
        .finally(() => {
          if (this.alive) this.scheduleRetry();
        });
    }, 30000);
  }

  private async sync(item: Zotero.Item): Promise<void> {
    if (
      !this.alive ||
      !annotationSettings().auto ||
      annotationScopeReason(item)
    )
      return;
    try {
      if (!mappingNote(item)) return;
      addon.syncStatus.markSyncing([item]);
      const result = await addon.sync.syncItem(item);
      if (this.alive) addon.syncStatus.markResult(result);
    } catch (error) {
      if (this.alive)
        addon.syncStatus.markFailed(
          [item],
          error instanceof Error ? error.message : String(error),
        );
    }
  }
}
