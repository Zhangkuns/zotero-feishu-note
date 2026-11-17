import { config, version } from "../../package.json";

export interface UpdateResult {
  version: string;
  available?: string;
}
export class PluginUpdates {
  private checking?: Promise<UpdateResult>;
  private candidate?: any;
  private timer?: ReturnType<typeof setTimeout>;
  private alive = false;
  constructor(
    private readonly manager = () =>
      (ztoolkit.getGlobal("ChromeUtils") as any).importESModule(
        "resource://gre/modules/AddonManager.sys.mjs",
      ).AddonManager,
    private readonly enabled = () =>
      Zotero.Prefs.get(config.prefsPrefix + ".autoUpdatePlugin", true) !==
      false,
  ) {}

  async setAutomatic(enabled: boolean): Promise<void> {
    const manager = this.manager(),
      installed = await manager.getAddonByID(config.addonID);
    if (!installed) throw new Error("Plugin is not installed");
    installed.applyBackgroundUpdates = enabled
      ? manager.AUTOUPDATE_ENABLE
      : manager.AUTOUPDATE_DISABLE;
    Zotero.Prefs.set(config.prefsPrefix + ".autoUpdatePlugin", enabled, true);
  }

  start(): void {
    this.alive = true;
    void this.setAutomatic(this.enabled()).catch((e) =>
      ztoolkit.log("Update preferences", e),
    );
    this.schedule(60000);
  }
  stop(): void {
    this.alive = false;
    if (this.timer) clearTimeout(this.timer);
  }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      if (!this.alive) return;
      void (async () => {
        if (this.enabled()) {
          const result = await this.check();
          if (this.alive && this.enabled() && result.available)
            await this.install();
        }
      })()
        .catch((e) => ztoolkit.log("Plugin update check", e))
        .finally(() => {
          if (this.alive) this.schedule(24 * 60 * 60 * 1000);
        });
    }, delay);
  }
  check(): Promise<UpdateResult> {
    if (!this.checking) {
      const pending = this.findUpdate();
      this.checking = pending;
      void pending
        .finally(() => {
          if (this.checking === pending) this.checking = undefined;
        })
        .catch(() => undefined);
    }
    return this.checking;
  }
  private async findUpdate(): Promise<UpdateResult> {
    const manager = this.manager(),
      installed = await manager.getAddonByID(config.addonID);
    if (!installed) throw new Error("Plugin is not installed");
    this.candidate = undefined;
    return new Promise((resolve, reject) => {
      let finished = false,
        candidate: any;
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error);
        else {
          this.candidate = candidate;
          resolve({
            version: installed.version || version,
            available: candidate?.version,
          });
        }
      };
      const timer = setTimeout(
        () => done(new Error("Update request timed out")),
        60000,
      );
      try {
        installed.findUpdates(
          {
            onUpdateAvailable: (_addon: any, install: any) => {
              if (!finished) candidate = install;
            },
            onNoUpdateAvailable: () => undefined,
            onUpdateFinished: (_addon: any, error: number) =>
              done(
                error
                  ? new Error("Update check failed (" + error + ")")
                  : undefined,
              ),
          },
          manager.UPDATE_WHEN_USER_REQUESTED,
        );
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async install(): Promise<void> {
    const candidate = this.candidate;
    if (!candidate) throw new Error("Check for updates first");
    this.candidate = undefined;
    return new Promise((resolve, reject) => {
      let finished = false;
      const done = (error?: Error) => {
        if (finished) return;
        finished = true;
        candidate.removeListener(listener);
        if (error) reject(error);
        else resolve();
      };
      const listener = {
        onInstallEnded: () => done(),
        onDownloadFailed: () => done(new Error("Update download failed")),
        onInstallFailed: () => done(new Error("Update installation failed")),
        onDownloadCancelled: () => done(new Error("Update cancelled")),
        onInstallCancelled: () => done(new Error("Update cancelled")),
      };
      candidate.addListener(listener);
      try {
        const pending = candidate.install();
        if (pending?.catch) void pending.catch((e: Error) => done(e));
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

/** Carry over local association files, without modifying the old installation. */
export async function migrateLegacyState(): Promise<void> {
  const paths = ztoolkit.getGlobal("PathUtils") as any,
    io = ztoolkit.getGlobal("IOUtils") as any;
  const destination = paths.join(paths.profileDir, "zotero-feishu-note");
  for (const name of ["state.json", "annotations.json"]) {
    const old = paths.join(paths.profileDir, "zotero-feishu", name),
      target = paths.join(destination, name);
    if (!(await io.exists(target)) && (await io.exists(old))) {
      await io.makeDirectory(destination, { ignoreExisting: true });
      await io.copy(old, target, { noOverwrite: true });
      await io.setPermissions(target, 0o600);
    }
  }
}
