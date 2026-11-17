import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // This fork uses its own release channel and a distinct plugin identity.
  updateURL:
    process.env.ZOTERO_FEISHU_UPDATE_URL ||
    "https://github.com/Zhangkuns/zotero-feishu-note/releases/download/updates/update.json",
  xpiDownloadLink:
    "https://github.com/Zhangkuns/zotero-feishu-note/releases/download/v{{version}}/zotero-feishu-note.xpi",

  build: {
    assets: ["addon/**/*.*", "LICENSE", "THIRD_PARTY_NOTICES.md"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  release: {
    bumpp: {
      commit: "chore(release): publish v%s",
    },
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
