import { version } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { getPref } from "../utils/prefs";

export async function registerUpdatePreferences(window: Window): Promise<void> {
  const doc = window.document;
  const control = (id: string) => doc.getElementById("zotero-feishu-" + id)!;
  const automatic = control("automatic-updates") as HTMLInputElement;
  const check = control("check-updates") as HTMLButtonElement;
  const install = control("install-update") as HTMLButtonElement;
  const status = control("update-status");
  const text = (id: string, args?: any) =>
    (doc as any).l10n.formatValue(getLocaleID(id as any), args);
  const render = async (id: string, args?: any) => {
    status.textContent = await text(id, args);
  };
  control("current-version").textContent = await text("pref-current-version", {
    version,
  });
  automatic.checked = Boolean(getPref("autoUpdatePlugin"));
  automatic.addEventListener("change", () => {
    void addon.updates.setAutomatic(automatic.checked).catch((e) => {
      automatic.checked = !automatic.checked;
      void render("pref-update-error", { error: String(e.message || e) });
    });
  });
  check.addEventListener("click", () => {
    check.disabled = true;
    install.hidden = true;
    void (async () => {
      await render("pref-update-checking");
      const result = await addon.updates.check();
      await render(
        result.available ? "pref-update-available" : "pref-update-current",
        {
          version: result.available || result.version,
        },
      );
      install.hidden = !result.available;
    })()
      .catch((e) =>
        render("pref-update-error", { error: String(e.message || e) }),
      )
      .finally(() => {
        check.disabled = false;
      });
  });
  install.addEventListener("click", () => {
    install.disabled = true;
    void (async () => {
      await render("pref-update-installing");
      await addon.updates.install();
      install.hidden = true;
      await render("pref-update-installed");
    })()
      .catch((e) =>
        render("pref-update-error", { error: String(e.message || e) }),
      )
      .finally(() => {
        install.disabled = false;
      });
  });
}
