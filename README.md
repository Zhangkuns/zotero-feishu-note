# zotero-feishu-note

[简体中文](doc/README-zhCN.md)

zotero-feishu-note is an unofficial Zotero plugin that publishes literature
metadata, notes, images, and PDF attachments to Feishu cloud documents. This
0.8.0-beta.3 fork also synchronizes PDF / HTML snapshot text annotations as
sentence-level comments in an existing English paper document. It uses the
original plugin’s Feishu OAuth and API client directly. No CLI, Python, or
bridge service is required.

Mapped papers use the versioned “飞书文档映射” child note from the import workflow.
Other items retain the original document-export behavior. See
[annotation sync](doc/mapped-annotations.md) for matching and recovery details.

## Requirements

- Zotero 8–10. This candidate is host-tested on Zotero 10.0.8.
- A mainland Feishu account that can create a personal application and grant
  the requested permissions. Tenant policy may require administrator approval.
- Local PDF and note-image files must be available to Zotero when synchronizing.

## Installation

1. Install the `zotero-feishu-note.xpi` from this candidate’s artifact directory.
   Download the versioned XPI from Zhangkuns/zotero-feishu-note releases.
2. In Zotero, open **Tools → Plugins**.
3. Choose **Install Add-on From File**, select the XPI, and restart Zotero if
   requested.

## Connect Feishu

1. Open **Zotero Settings → zotero-feishu-note** and select **Connect Feishu**.
2. Confirm creation of the dedicated personal application in the browser.
3. If the Feishu permission console opens, enable the listed permissions and
   complete any required app publication or administrator approval.
4. Complete account authorization in the browser and return to Zotero.

Existing users should use **Grant comment permissions** when prompted. Comment
read, create, update, and delete permissions are added to the original OAuth scopes.
Deleting a source annotation removes an untouched comment without follow-up replies;
threads with replies are preserved and resolved after Zotero confirms the deletion.
No App ID, App Secret, or redirect URL needs to be entered manually. Leave the
target folder empty to use the root of My Space, or enter a Feishu Drive folder
URL or token.

## Usage

- Right-click a regular Zotero item, child note, or child attachment and choose
  **zotero-feishu-note → Sync selected items**.
- Right-click a collection and choose **Sync current collection to Feishu**.
- Use the same item menu to open or explicitly delete its mapped document.
- Check the Feishu status column for syncing, success, or failure details.

Each regular item maps to one Feishu Docx. Unchanged sources are skipped after
the mapped document is verified. Child notes retain Markdown-equivalent
structure, embedded note images are uploaded, and local child PDFs are appended
to the document.

## Mapped paper annotations

Both computers may leave automatic sync enabled after connecting the same
Feishu account. Saving a highlight / underline queues a sync after 1.5 seconds
(default). The plugin skips unchanged comments, updates the same root reply
when source text changes, and uploads distinct annotations separately. On a
new computer it discovers mapping notes and recovers comment IDs from Feishu
invisible provenance suffixes. The suffix is Unicode text, not a native Feishu
metadata field, and may travel when copying a comment. Removing it during manual
editing or export prevents recovery from that comment. Recovery does not depend
on Syncthing or a shared local index. Existing visible suffixes migrate in place.

If simultaneous first uploads create duplicates, all machines choose the
smallest comment ID. Untouched duplicates without replies receive a canonical
marker and are marked resolved. Their history remains available. Duplicates
with replies or independent edits stay pending for review. A recheck runs
30 seconds after changes, then every 300 seconds by default; this is eventual
reconciliation, not a server-side lock or an exactly-once creation guarantee.
Zotero data must still synchronize between the computers.

Settings include a master enable switch, automatic / manual mode, all mapped
papers / selected collection subtree, debounce (0.5–300 seconds), retries (30–3600 seconds),
periodic reconciliation (60–3600 seconds), relaxed matching, uncommented
highlights, preview, manual sync, connection checks, and the last 100 results.

## Limitations

- Only My Library and mainland Feishu are currently supported.
- Standalone notes and standalone attachments are not synchronized. Selecting a
  child note or attachment synchronizes its regular parent item.
- In original export mode, PDF annotations must first be added to a note.
  Mapped-paper annotation mode reads highlights / underlines directly.
- In original export mode, Feishu edits may be replaced by synchronization.
  Mapped-paper mode preserves the body, styles, images, formulas, and other
  comments; independently edited comments are reported as conflicts.
- Original export mappings are local; losing them may create another document.
  Versioned paper mappings travel with Zotero child notes, and comment identity
  is recovered remotely. Each machine authorizes Feishu separately.

## Privacy And Removal

Literature content is sent directly from Zotero to Feishu; the plugin does not
use a developer-operated relay server. App credentials and OAuth tokens are
stored in Zotero's Firefox Login Manager. Item mappings are stored in
`<Zotero profile>/zotero-feishu/state.json`. Annotation checkpoints, pending
work, reconciliation schedules, and history are stored locally in
`<Zotero profile>/zotero-feishu/annotations.json`. Do not edit or share OAuth
credentials. This fork omits the upstream automatic-update URL; install future
fork versions manually until a release repository is configured.

Disconnecting removes the OAuth tokens but retains the generated application
credentials for a later reconnect. Uninstalling the plugin does not delete the
personal application or synchronized documents from Feishu; remove them from
the Feishu Open Platform and Drive when they are no longer needed.

## Development

```bash
npm install
npm start
npm run lint:check
npm run build
npm test
```

Copy `.env.example` to `.env` and use a dedicated Zotero development profile.
Production packages and update manifests are written to `.scaffold/build/`.

## License

AGPL-3.0-or-later. See `THIRD_PARTY_NOTICES.md` for incorporated third-party
software notices. Feishu and its logo are trademarks of their respective owner;
this project is not affiliated with or endorsed by Feishu.

## Identity, migration and updates

This fork uses `zotero-feishu-note@zhangkuns.github.io`, independently of the original
`zotero-feishu@wu-uk.github.io`. Uninstall/disable Zotero Feishu Sync before using it,
install this XPI and connect Feishu. The bibliography is untouched. Local association
files are copied once to `<profile>/zotero-feishu-note`; original files are retained.
Remote source markers recover existing comments after authorization.

The **Plugin updates** section above **Sync location** shows the current version,
**Check for updates**, an available-update install button and a default-enabled
**Automatically check for and install plugin updates** checkbox. The native Zotero
add-on manager validates identity, compatibility and the SHA-512 update hash.
The plugin checks one minute after startup and daily, and stops its own background
checks when disabled. Normal Zotero add-on update controls apply to the same add-on.

The HTTPS update feed is the `update.json` asset in this repository's `updates`
release. Versioned XPI assets are immutable prereleases; the feed points to the
current preview. Publisher workflow after increasing the version and committing:

```sh
npm run lint:check
npm run build
# Run the documented isolated-host tests, commit and push the reviewed source.
npm run publish:update             # validate and prepare metadata only
npm run publish:update -- --publish # publish XPI/source and update the feed
```

Publishing requires the maintainer's existing `gh` login. Users need only Zotero;
no GitHub login, CLI, Python, or bridge is used for updates.

The manual **Publish fork update** Actions workflow and `npm run release` use
this same guarded publisher. Increase the version, commit and push first, then run
**Actions → Publish fork update → Run workflow**. Existing version releases cannot
be overwritten. The upstream tag-triggered workflow is replaced so another rebuild
cannot overwrite an XPI without updating its channel checksum. Plugin users receive
updates from the published feed and do not need GitHub authorization.
