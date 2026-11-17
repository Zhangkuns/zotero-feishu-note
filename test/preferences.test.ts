import { assert } from "chai";
import { config } from "../package.json";
import { getPref, setPref } from "../src/utils/prefs";

const PREFERENCE_PANE_ID = "zotero-feishu-note-preferences";

describe("preferences", function () {
  this.timeout(10_000);

  it("renders a single connection action without advanced app settings", async function () {
    let preferencesWindow: Window | null = null;
    try {
      Zotero.Utilities.Internal.openPreferences(PREFERENCE_PANE_ID);
      preferencesWindow = await waitForPreferencesWindow();
      const document = preferencesWindow.document;
      const plugin = Zotero[config.addonInstance] as any;
      const action = await waitForElement<HTMLButtonElement>(
        document,
        "zotero-feishu-connection-action",
        (element) =>
          element.dataset.bound === "true" || plugin.data.prefs?.error,
      );
      if (plugin.data.prefs?.error) throw plugin.data.prefs.error;
      const status = document.getElementById(
        "zotero-feishu-connection-status",
      ) as HTMLElement;
      const title = document.getElementById(
        "zotero-feishu-status-title",
      ) as HTMLElement;
      const help = document.getElementById("zotero-feishu-target-help");
      const stylesheet = document.getElementById(
        "zotero-feishu-preferences-style",
      ) as HTMLLinkElement;

      assert.include(["neutral", "success", "warning"], status.dataset.state);
      assert.isNotEmpty(title.textContent);
      assert.isNotEmpty(action.textContent);
      assert.equal(action.parentElement?.className, "status-line");
      assert.equal(
        help?.namespaceURI,
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      );
      assert.equal(help?.getAttribute("value"), "?");
      assert.isNotEmpty(help?.getAttribute("tooltiptext"));
      assert.include(stylesheet.href, "preferences.css?v=");
      assert.equal(
        action.dataset.mode,
        status.dataset.state === "neutral" ? "connect" : "disconnect",
      );
      assert.lengthOf(document.querySelectorAll(".connection-action"), 1);
      for (const id of [
        "test-connection",
        "check-updates",
        "automatic-updates",
        "current-version",
        "auto-annotations",
        "enable-annotations",
        "delete-annotations",
        "annotation-scope",
        "annotation-collection",
        "annotation-delay",
        "retry-annotations",
        "annotation-retry",
        "annotation-reconcile",
        "relaxed-matching",
        "include-highlights",
        "preview-annotations",
        "sync-annotations",
        "retry-pending",
        "refresh-history",
        "annotation-history",
      ]) {
        assert.exists(document.getElementById("zotero-feishu-" + id), id);
      }
      assert.notExists(
        document.getElementById("zotero-feishu-annotation-config"),
      );
      const delay = document.getElementById(
        "zotero-feishu-annotation-delay",
      ) as HTMLInputElement;
      assert.equal(delay.min, "0.5");
      assert.equal(delay.max, "300");
      assert.equal(
        (
          document.getElementById(
            "zotero-feishu-annotation-retry",
          ) as HTMLInputElement
        ).min,
        "30",
      );
      assert.notExists(document.getElementById("zotero-feishu-app-id"));
      assert.notExists(document.querySelector(".advanced-settings"));
      const enabled = document.getElementById(
        "zotero-feishu-enable-annotations",
      ) as HTMLInputElement;
      const deletion = document.getElementById(
        "zotero-feishu-delete-annotations",
      ) as HTMLInputElement;
      const mode = document.getElementById(
        "zotero-feishu-auto-annotations",
      ) as HTMLSelectElement;
      const scope = document.getElementById(
        "zotero-feishu-annotation-scope",
      ) as HTMLSelectElement;
      const collection = document.getElementById(
        "zotero-feishu-annotation-collection",
      ) as HTMLSelectElement;
      const manual = document.getElementById(
        "zotero-feishu-sync-annotations",
      ) as HTMLButtonElement;
      const previous = {
        enabled: getPref("enableAnnotationSync"),
        deletion: getPref("syncDeletedAnnotations"),
        auto: getPref("autoSyncAnnotations"),
        scope: getPref("annotationScope"),
      };
      const change = (control: Element) =>
        control.dispatchEvent(
          new (preferencesWindow as any).Event("change", { bubbles: true }),
        );
      try {
        enabled.checked = false;
        change(enabled);
        assert.isFalse(getPref("enableAnnotationSync"));
        assert.isTrue(manual.disabled);
        assert.isTrue(mode.disabled);
        assert.isTrue(deletion.disabled);
        enabled.checked = true;
        change(enabled);
        deletion.checked = false;
        change(deletion);
        assert.isFalse(getPref("syncDeletedAnnotations"));
        mode.value = "manual";
        change(mode);
        assert.isFalse(getPref("autoSyncAnnotations"));
        assert.isFalse(manual.disabled);
        assert.isTrue(delay.disabled);
        scope.value = "collection";
        change(scope);
        assert.equal(getPref("annotationScope"), "collection");
        assert.isFalse(collection.disabled);
        scope.value = "all";
        change(scope);
        assert.isTrue(collection.disabled);
        mode.value = "auto";
        change(mode);
        assert.isTrue(getPref("autoSyncAnnotations"));
        assert.isFalse(delay.disabled);
        const services = (Zotero.getMainWindow() as any).Services;
        const screenshot = services.env.get("ZFS_UI_SCREENSHOT_PATH");
        if (screenshot) {
          const win = preferencesWindow as any;
          const canvas = document.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "canvas",
          ) as HTMLCanvasElement;
          canvas.width = win.innerWidth;
          canvas.height = win.innerHeight;
          const context = canvas.getContext("2d") as any;
          context.drawWindow(
            win,
            0,
            0,
            win.innerWidth,
            win.innerHeight,
            "white",
          );
          const bytes = new Uint8Array(
            await (
              await win.fetch(canvas.toDataURL("image/png"))
            ).arrayBuffer(),
          );
          await win.IOUtils.write(screenshot, bytes);
        }
      } finally {
        setPref("enableAnnotationSync", previous.enabled);
        setPref("syncDeletedAnnotations", previous.deletion);
        setPref("autoSyncAnnotations", previous.auto);
        setPref("annotationScope", previous.scope);
      }
    } finally {
      try {
        preferencesWindow?.close();
      } catch {
        // The Zotero test runner may close the preferences window first.
      }
    }
  });
});

async function waitForElement<T extends HTMLElement>(
  document: Document,
  id: string,
  ready: (element: T) => boolean,
): Promise<T> {
  let found: T | null = null;
  await waitUntil(() => {
    found = document.getElementById(id) as T | null;
    return Boolean(found && ready(found));
  });
  return found!;
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await Zotero.Promise.delay(50);
  }
  throw new Error("Timed out waiting for the preferences UI");
}

async function waitForPreferencesWindow(): Promise<Window> {
  const services = (Zotero.getMainWindow() as any).Services;
  let found: Window | null = null;
  await waitUntil(() => {
    found = services.wm.getMostRecentWindow("zotero:pref") as Window | null;
    return Boolean(found);
  });
  return found!;
}
