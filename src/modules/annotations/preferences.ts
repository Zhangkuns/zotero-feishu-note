import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import type { FluentMessageId } from "../../../typings/i10n";
import { mappingNote } from "./mapping";
import { annotationSettings } from "./service";
export async function preferenceText(
  document: Document,
  id: string,
  args?: Record<string, unknown>,
): Promise<string> {
  return (
    (await (document as any).l10n?.formatValue(
      getLocaleID(id as FluentMessageId),
      args,
    )) || id
  );
}
export async function registerAnnotationPreferences(
  window: Window,
): Promise<void> {
  const doc = window.document;
  const settings = annotationSettings();
  const control = (id: string) =>
    doc.getElementById("zotero-feishu-" + id) as
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement;
  const mode = control("auto-annotations") as HTMLSelectElement;
  const scope = control("annotation-scope") as HTMLSelectElement;
  const collection = control("annotation-collection") as HTMLSelectElement;
  mode.value = getPref("autoSyncAnnotations") ? "auto" : "manual";
  scope.value = String(getPref("annotationScope"));
  const option = (value: string, label: string) => {
    const o = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
    o.setAttribute("value", value);
    o.textContent = label;
    collection.append(o);
  };
  option("", await preferenceText(doc, "pref-collection-select"));
  const path = (c: Zotero.Collection): string =>
    c.parentID
      ? path(Zotero.Collections.get(c.parentID)) + " / " + c.name
      : c.name;
  for (const c of Zotero.Collections.getByLibrary(
    Zotero.Libraries.userLibraryID,
    true,
  ))
    option(c.key, path(c));
  const collectionKey = String(getPref("annotationCollectionKey") || "");
  if (
    collectionKey &&
    ![...collection.options].some(
      (o) => (o as HTMLOptionElement).value === collectionKey,
    )
  )
    option(
      collectionKey,
      await preferenceText(doc, "pref-collection-missing", {
        key: collectionKey,
      }),
    );
  collection.value = collectionKey;
  const updateControls = () => {
    const enabled = Boolean(getPref("enableAnnotationSync"));
    const auto = enabled && Boolean(getPref("autoSyncAnnotations"));
    for (const id of [
      "auto-annotations",
      "delete-annotations",
      "annotation-scope",
      "relaxed-matching",
      "include-highlights",
      "preview-annotations",
      "sync-annotations",
      "retry-pending",
    ])
      control(id).disabled = !enabled;
    for (const id of [
      "annotation-delay",
      "retry-annotations",
      "annotation-retry",
      "annotation-reconcile",
    ])
      control(id).disabled = !auto;
    collection.disabled = !enabled || scope.value !== "collection";
  };
  mode.addEventListener("change", () => {
    setPref("autoSyncAnnotations", mode.value === "auto");
    updateControls();
    addon.sync.annotations.requestDiscovery();
  });
  scope.addEventListener("change", () => {
    setPref("annotationScope", scope.value);
    updateControls();
    addon.sync.annotations.requestDiscovery();
  });
  collection.addEventListener("change", () => {
    setPref("annotationCollectionKey", collection.value);
    addon.sync.annotations.requestDiscovery();
  });
  const bools = [
    ["enable-annotations", "enableAnnotationSync"],
    ["delete-annotations", "syncDeletedAnnotations"],
    ["retry-annotations", "retryAnnotations"],
    ["relaxed-matching", "relaxedAnnotationMatching"],
    ["include-highlights", "syncUncommentedHighlights"],
  ] as const;
  for (const [id, pref] of bools) {
    const input = doc.getElementById("zotero-feishu-" + id) as HTMLInputElement;
    input.checked = Boolean(getPref(pref));
    input.addEventListener("change", () => {
      setPref(pref, input.checked);
      updateControls();
      if (pref === "enableAnnotationSync" || pref === "syncDeletedAnnotations")
        addon.sync.annotations.requestDiscovery();
    });
  }
  for (const [id, pref, value, min, max] of [
    [
      "annotation-delay",
      "annotationDelaySeconds",
      settings.delay / 1000,
      0.5,
      300,
    ],
    [
      "annotation-retry",
      "annotationRetrySeconds",
      settings.retryDelay / 1000,
      30,
      3600,
    ],
    [
      "annotation-reconcile",
      "annotationReconcileSeconds",
      settings.reconcileDelay / 1000,
      60,
      3600,
    ],
  ] as const) {
    const input = doc.getElementById("zotero-feishu-" + id) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (!input.checkValidity() || !Number.isFinite(n) || n < min || n > max) {
        input.reportValidity();
        input.value = String(getPref(pref));
        return;
      }
      setPref(pref, String(n));
    });
  }
  const feedback = doc.getElementById("zotero-feishu-annotation-feedback")!;
  const bind = (id: string, run: () => Promise<void>) => {
    const button = doc.getElementById(
      "zotero-feishu-" + id,
    ) as HTMLButtonElement;
    button.addEventListener(
      "click",
      () =>
        void (async () => {
          button.disabled = true;
          feedback.textContent = await preferenceText(
            doc,
            "pref-annotation-working",
          );
          try {
            await run();
            feedback.textContent = await preferenceText(
              doc,
              "pref-annotation-finished",
            );
          } catch (error) {
            feedback.textContent =
              error instanceof Error ? error.message : String(error);
          } finally {
            button.disabled = false;
            updateControls();
            await renderHistory(doc);
          }
        })(),
    );
  };
  const selected = async (dryRun: boolean) => {
    const items = Zotero.getMainWindow().ZoteroPane.getSelectedItems();
    const parents = new Map<number, Zotero.Item>();
    for (const a of items) {
      const item = a.topLevelItem || a;
      if (item.isRegularItem() && mappingNote(item)) parents.set(item.id, item);
    }
    if (!parents.size)
      throw new Error(await preferenceText(doc, "pref-annotation-select"));
    for (const item of parents.values()) {
      addon.syncStatus.markSyncing([item]);
      const note = mappingNote(item)!;
      const result = dryRun
        ? await addon.sync.annotations.syncItem(item, note, true)
        : await addon.sync.syncItem(item);
      addon.syncStatus.markResult(result);
      if (result.errors.length) throw new Error(result.errors.join("\n"));
    }
  };
  bind("preview-annotations", () => selected(true));
  bind("sync-annotations", () => selected(false));
  bind("retry-pending", () => addon.sync.annotations.retryPending(true));
  bind("refresh-history", () => renderHistory(doc));
  updateControls();
  await renderHistory(doc);
}
async function renderHistory(doc: Document): Promise<void> {
  const container = doc.getElementById("zotero-feishu-annotation-history");
  if (!container) return;
  const create = (tag: string, text?: string) => {
    const e = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElement;
    if (text) e.textContent = text;
    return e;
  };
  try {
    const history = await addon.sync.annotations.history();
    container.replaceChildren();
    if (!history.length) {
      container.append(
        create("p", await preferenceText(doc, "pref-history-empty")),
      );
      return;
    }
    for (const entry of history) {
      const article = create("article");
      const outcome =
        entry.outcome === "preview"
          ? await preferenceText(doc, "pref-outcome-preview")
          : getString(("sync-outcome-" + entry.outcome) as any);
      article.append(
        create(
          "strong",
          await preferenceText(doc, "pref-history-result", {
            time: new Date(entry.time).toLocaleString(),
            title: entry.title,
            outcome,
          }),
        ),
      );
      const counts = Object.fromEntries(
        [
          "synced",
          "unchanged",
          "matched",
          "pending",
          "skipped",
          "deleted",
          "resolved",
        ].map((status) => [
          status,
          entry.details.filter((d) => d.status === status).length,
        ]),
      );
      article.append(
        create("p", await preferenceText(doc, "pref-history-counts", counts)),
      );
      for (const detail of entry.details) {
        const status = await preferenceText(
          doc,
          "pref-status-" + detail.status,
        );
        const line = create(
          "p",
          (await preferenceText(doc, "pref-annotation-state", {
            key: detail.annotationKey,
            status,
          })) + (detail.error ? "\n" + detail.error : ""),
        );
        if (detail.error) line.className = "history-error";
        if (detail.documentTitle)
          line.append(create("span", " · " + detail.documentTitle));
        if (
          detail.documentUrl &&
          /^https:\/\/my\.feishu\.cn\/docx\/[A-Za-z0-9]+$/.test(
            detail.documentUrl,
          )
        ) {
          const button = create(
            "button",
            await preferenceText(doc, "pref-history-open"),
          );
          button.addEventListener("click", () =>
            Zotero.launchURL(detail.documentUrl!),
          );
          line.append(button);
        }
        article.append(line);
      }
      if (entry.errors.length) {
        const line = create("p", entry.errors.join("\n"));
        line.className = "history-error";
        article.append(line);
      }
      if (
        entry.documentUrl &&
        /^https:\/\/my\.feishu\.cn\/docx\/[A-Za-z0-9]+$/.test(entry.documentUrl)
      ) {
        const button = create(
          "button",
          await preferenceText(doc, "pref-history-open"),
        );
        button.addEventListener("click", () =>
          Zotero.launchURL(entry.documentUrl!),
        );
        article.append(button);
      }
      container.append(article);
    }
  } catch (error) {
    container.textContent =
      error instanceof Error ? error.message : String(error);
  }
}
