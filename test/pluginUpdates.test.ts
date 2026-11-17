import { assert } from "chai";
import { PluginUpdates } from "../src/modules/pluginUpdates";
import { config } from "../package.json";

describe("plugin updates", function () {
  let manager: any, installed: any, listener: any, candidate: any;

  beforeEach(function () {
    candidate = {
      version: "0.9.0",
      installs: 0,
      addListener: (l: any) => {
        listener = l;
      },
      removeListener: () => undefined,
      install: () => {
        candidate.installs++;
        listener.onInstallEnded();
      },
    };
    installed = {
      version: "0.8.0",
      applyBackgroundUpdates: 1,
      checks: 0,
      findUpdates: (l: any, reason: number) => {
        assert.equal(reason, 1);
        installed.checks++;
        Promise.resolve().then(() => {
          l.onUpdateAvailable(installed, candidate);
          l.onUpdateFinished(installed, 0);
        });
      },
    };
    manager = {
      AUTOUPDATE_ENABLE: 2,
      AUTOUPDATE_DISABLE: 0,
      UPDATE_WHEN_USER_REQUESTED: 1,
      getAddonByID: async (id: string) => {
        assert.equal(id, config.addonID);
        return installed;
      },
    };
  });

  it("uses the new independent plugin identity", function () {
    assert.equal(config.addonID, "zotero-feishu-note@zhangkuns.github.io");
    assert.equal(config.addonName, "zotero-feishu-note");
  });

  it("coalesces checks and does not install during a manual check", async function () {
    const updates = new PluginUpdates(() => manager);
    const [a, b] = await Promise.all([updates.check(), updates.check()]);
    assert.deepEqual(a, b);
    assert.equal(a.available, "0.9.0");
    assert.equal(installed.checks, 1);
    assert.equal(candidate.installs, 0);
    await updates.install();
    assert.equal(candidate.installs, 1);
  });

  it("reports no update and permits retry after a failed check", async function () {
    let failed = false;
    installed.findUpdates = (l: any) => l.onUpdateFinished(installed, 1);
    const updates = new PluginUpdates(() => manager);
    try {
      await updates.check();
    } catch {
      failed = true;
    }
    assert.isTrue(failed);
    installed.findUpdates = (l: any) => l.onUpdateFinished(installed, 0);
    assert.isUndefined((await updates.check()).available);
  });

  it("updates only this add-on's automatic-update preference", async function () {
    const updates = new PluginUpdates(() => manager);
    await updates.setAutomatic(false);
    assert.equal(installed.applyBackgroundUpdates, 0);
    await updates.setAutomatic(true);
    assert.equal(installed.applyBackgroundUpdates, 2);
  });

  it("reports an installation failure instead of claiming an upgrade", async function () {
    const updates = new PluginUpdates(() => manager);
    await updates.check();
    candidate.install = () => listener.onInstallFailed();
    let failed = false;
    try {
      await updates.install();
    } catch {
      failed = true;
    }
    assert.isTrue(failed);
  });
});
