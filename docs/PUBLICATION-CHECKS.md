# Publication validation — 2026-11-07

- `npm run check`: **43 Node tests passed**; generated runtime syntax passed.
- Disposable native-profile smoke tests: **48 checks passed** on macOS Zen **1.24.1b**. No existing profile opened or modified by these tests.
- Native results are in `browser-smoke-results.json`. Sine injection/unload is emulated; this is not a full Sine marketplace installer test.
- No Windows/Linux GUI certification. Native app/desktop focus, fullscreen, multiple monitors, and physical Dock behavior remain manual acceptance where applicable.
- Publication-only changes: repository metadata/docs, self-contained test tooling and explicit safe packaging; installed browser files/settings were not changed. No profile state, credentials, raw browser logs or third-party Little Zen source are distributed.
- Seven synthetic installer tests passed after `npm run package`.


## 1.1.0 history update (local build)

48 Node tests, 57 native-browser checks (54 scenario assertions and 3 trusted input checks), and 9 synthetic installer tests passed. Zen 1.24.1b used a fresh disposable profile. History fixtures were inserted into that profile only; no real browsing history was inspected. The checks cover the selected suffix, exact visited-page navigation in the active Space container, literal search fallback, query cancellation, disabled-history behavior, and the private-context gate.
