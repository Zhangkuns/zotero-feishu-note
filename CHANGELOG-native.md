# 0.8.0-beta.3

- Rename to zotero-feishu-note with a new Zhangkuns plugin identity and update feed.
- Add in-plugin manual/automatic upgrades through Zotero AddonManager and a guarded
  GitHub release publisher; preserve old local associations during first startup.

- Synchronize cloud-confirmed annotation deletions, including historical deletions
  discovered on a fresh computer through the existing invisible provenance.
- Delete only the plugin-owned root reply when it has no follow-up replies.
  Preserve and resolve discussions with replies, recording a hidden deletion marker.
- Suppress stale-computer resurrection; recheck cloud deletion evidence and current
  item existence before writes, and support restored annotations.
- Add a deletion switch, native delete-permission reauthorization, bilingual
  history statuses, deletion/sync-finish notifications, and restart-safe retries.
- Keep independent remote edits and unverifiable deletions pending.

# 0.8.0-beta.2

- Replace the visible source suffix with invisible Unicode provenance text.
- Migrate verified legacy comments in place while preserving comment/reply IDs.
- Keep cross-computer recovery and duplicate reconciliation independent of Syncthing.
- Cover split text runs, malformed metadata, legacy migration, and rendered width.
- Document that copying may carry metadata and manual edits may strip it.

# 0.8.0-beta.1

- Reuse the original Feishu OAuth and API transport for mapped PDF / HTML annotations.
- Request comment read/create/update scopes with an in-plugin reauthorization action.
- Add native sentence-range matching, verified style preservation, source markers,
  durable checkpoints, conflict handling, retries, and cross-computer recovery.
- Allow multiple computers to sync. Reconcile duplicate first uploads onto a common
  canonical comment and mark untouched duplicate threads resolved while retaining history.
- Add bilingual settings with a master switch, automatic/manual mode, mapped-paper
  or collection scope, delays, retries, periodic reconciliation, matching,
  previews, connection checks, and local sync history.
- Remove the CLI/Python/localhost bridge requirement and upstream auto-update URL.
- Extend manifest compatibility through Zotero 10; host tests use Zotero 10.0.8.

This is a local candidate, not an upstream release. Native account-authorized
Feishu verification is tracked separately in verification/REPORT.md.
