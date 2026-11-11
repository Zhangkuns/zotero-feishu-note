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
