import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = "Zhangkuns/zotero-feishu-note";
const channel =
  "https://github.com/" + repo + "/releases/download/updates/update.json";
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const tag = "v" + pkg.version;
const xpi = resolve(root, ".scaffold/build/zotero-feishu-note.xpi");
const manifest = JSON.parse(
  await readFile(resolve(root, ".scaffold/build/addon/manifest.json"), "utf8"),
);
const digest =
  "sha512:" +
  createHash("sha512")
    .update(await readFile(xpi))
    .digest("hex");
const metadata = {
  addons: {
    [pkg.config.addonID]: {
      updates: [
        {
          version: pkg.version,
          update_link: `https://github.com/${repo}/releases/download/${tag}/zotero-feishu-note.xpi`,
          update_hash: digest,
          applications: {
            zotero: {
              strict_min_version:
                manifest.applications.zotero.strict_min_version,
              strict_max_version:
                manifest.applications.zotero.strict_max_version,
            },
          },
        },
      ],
    },
  },
};
const update = metadata.addons[pkg.config.addonID].updates[0];
if (
  pkg.config.addonID !== "zotero-feishu-note@zhangkuns.github.io" ||
  manifest.name !== "zotero-feishu-note" ||
  manifest.version !== pkg.version ||
  manifest.applications.zotero.id !== pkg.config.addonID ||
  manifest.applications.zotero.update_url !== channel ||
  update?.version !== pkg.version ||
  update?.update_hash !== digest ||
  update?.update_link !==
    `https://github.com/${repo}/releases/download/${tag}/zotero-feishu-note.xpi`
) {
  throw new Error(
    "Build identity, update channel, version, link or checksum is invalid. Run npm run build first.",
  );
}
const output = resolve(root, ".scaffold/build/update.json");
await writeFile(output, JSON.stringify(metadata, null, 2) + "\n");
const notes = resolve(root, ".scaffold/build/release-notes.md");
await writeFile(
  notes,
  `zotero-feishu-note ${pkg.version}\n\n` +
    "- Route outline, Chinese and English reading PDF annotations to their corresponding Feishu documents.\n" +
    "- Preserve original PDF / HTML to English routing and legacy v1 mappings.\n" +
    "- Validate v2 attachment identity and stop writes when mappings change.\n" +
    "- Show the destination document for each annotation in sync history.\n" +
    "- Retain cross-machine deduplication, deletion recovery and automatic updates.\n" +
    "- Zotero 10.0.8 host-tested. See verification/REPORT.md for validation boundaries.\n",
);
console.log(
  JSON.stringify({ repo, tag, pluginId: pkg.config.addonID, channel, digest }),
);
if (!process.argv.includes("--publish")) process.exit(0);
const run = (args) => {
  const r = spawnSync(args[0], args.slice(1), { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
if (run(["git", "status", "--porcelain"]))
  throw new Error("Commit the reviewed source before publishing");
const commit = run(["git", "rev-parse", "HEAD"]);
run(["gh", "api", `repos/${repo}/commits/${commit}`, "--jq", ".sha"]);
const source = resolve(root, ".scaffold/build/zotero-feishu-note-source.zip");
run(["git", "archive", "--format=zip", "-o", source, "HEAD"]);
const exists = (release) =>
  spawnSync("gh", ["release", "view", release, "--repo", repo], {
    encoding: "utf8",
    stdio: "ignore",
  }).status === 0;
if (exists(tag))
  throw new Error(
    "Version release already exists. Increase the version rather than replacing it.",
  );
run([
  "gh",
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--prerelease",
  "--target",
  commit,
  "--title",
  `zotero-feishu-note ${pkg.version}`,
  "--notes-file",
  notes,
  xpi,
  source,
]);
if (exists("updates"))
  run([
    "gh",
    "release",
    "upload",
    "updates",
    output,
    "--repo",
    repo,
    "--clobber",
  ]);
else
  run([
    "gh",
    "release",
    "create",
    "updates",
    "--repo",
    repo,
    "--prerelease",
    "--target",
    commit,
    "--title",
    "Plugin update channel",
    "--notes",
    "Mutable update.json for this fork. Versioned XPI releases remain immutable.",
    output,
  ]);
console.log("Published versioned XPI and update channel.");
