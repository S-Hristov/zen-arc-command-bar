> Historical development report. See [current publication validation](PUBLICATION-CHECKS.md) for the latest rerun.

# Test report — 2026-11-06

## Environment

- macOS host; installed `/Applications/Zen.app`, Info.plist version **1.24b**.
- Node **22.9.0**, Python 3; no npm/Python third-party dependencies.
- Browser runner creates empty, disposable profiles under the development workspace's `work/`. It never discovers or starts a live profile. Remote system access is granted only to the launched test process. All test processes are terminated and temporary profiles removed.

## Automated checks

Final local suite: **39 Node tests, 7 installer tests, 33 real-browser checks (31 assertions + 2 trusted native-key checks)**. Browser assertion counts and native-key outcomes are recorded in `browser-smoke-results.json`.

The current validated assertion lists accompany this report. Current browser assertions are listed in `browser-smoke-results.json`; the browser runner rewrites that file only after a successful run.

### Pure/adapter/manifest tests

`npm run check`: build the single `.uc.js`, syntax-check it, then Node tests for:

- Required query examples, actual selection-model action and manual search override.
- Ranking tiers/weights, conservative fuzzy matching, weak ambiguity, recency/Space ties.
- Unicode/NFKC/RTL, partial/full URLs, safe protocol classification, duplicate identities.
- Pins/discarded metadata and cross-Space/window records.
- Per-target activation serialization, closed/detached tabs, cancellation during transition, swallowed Space API failure detection.
- Original tab/container identity; explicit active-Space container for new navigation.
- Engine submission/postData handling, missing engine, private/default-engine selection path, unsafe engine URLs, async cancellation and Space drift.
- Manifest include/unload declaration, settings/default alignment, runtime privacy constraints.
- 1,001 prepared tabs, 100 timed ranking queries. Measured p50/p95 are printed by the Node test run; this is a host-specific microbenchmark, not a browser UI benchmark.

### Installer tests

`python3 -m unittest discover -s tests -p 'test_*.py'`: synthetic temporary registry/profile fixtures. Covers dry-run no-op, install/remove preserving other mod entries, ownership marker, duplicate refusal, absent Sine, symlink refusal, concurrent registry change, unowned-folder protection, running-Zen refusal. Test applies mock only the process/profile-lock guard, not filesystem mutations. **No live installer execution occurred.**

### Real Zen chrome smoke tests

`python3 tests/browser_smoke.py`: actual chrome dialog, browser commands, original tab selection, real Space/container manager, normal search-engine service, and native trusted navigation. Test pages are internal `about:` pages with synthetic titles, not authenticated Gmail/GitHub.

Sine injection is emulated with a trusted temporary chrome manifest and `loadSubScriptWithOptions()`. Its unload registration is a callback stub; real Sine Settings and bootloader are not installed in that test profile. Search submission is built using installed Google, but the test intercepts the final open call to avoid a Google network request. A separate internal-page action exercises real new-tab creation/container behavior.

The runner also attempts trusted WebDriver keyboard actions for Cmd+T and Cmd+L; passed keys appear separately in the JSON evidence. A platform that does not support that WebDriver command reports it explicitly rather than claiming hardware-key certification.

## Defects found during development and corrected

1. Gecko 159 tab elements no longer satisfy the older `ownerGlobal` assumption. Runtime now checks stable owner-document identity; actual-browser selection passes.
2. Firefox 159 removed `Services.search`. Runtime imports the real modern `SearchService` module; Google submission is tested in the installed binary.
3. The first test fixture queried a new background tab before navigation committed. Runner now waits on real location-change events, not arbitrary application sleeps.
4. Active-Space-only filtering now also excludes shared tabs belonging to another window.
5. Trusted keyboard testing found that the real Cmd+T key dispatches `cmd_newNavigatorTabNoEvent`, not the standard menu command ID. Both are now intercepted; synthetic-only testing would have missed this.
6. HTML modal keyset inhibition and keypress-target invalidation affected Cmd+L. The UI now uses a non-modal backdrop/focus trap and forwards Cmd+L to its XUL command and Cmd+W to the native close API with its original modifiers. Trusted Cmd+L focus and native close behavior are verified.

## Not yet certified

- Live Gmail/professional authentication, real accounts or container cookies (deliberately untouched).
- End-to-end Sine install → settings changes → disable/re-enable → browser restart.
- Simultaneous Zen Command Palette/other mods runtime, custom shortcut conflict resolution.
- Physical macOS keyboard/layout and real IME candidate handling; VoiceOver and high-contrast UI.
- Real nested folders, discarded-session restoration, and container-specific Essentials UI; all their adapters/metadata paths have source-backed implementation but need acceptance testing.
- Long-running session restore and native operations racing with external mods.

These gaps are tracked in `MANUAL-TESTS.md`. This package is implemented and locally tested, **not a guarantee that every combination in the user's existing profile has been validated**.

## Glass / recent tabs / drag follow-up

42 Node checks pass. 43 disposable-profile browser assertions plus 3 real native keyboard/pointer checks pass. Includes empty-query recent tabs, active-tab exclusion, local-cache favicon decoding, neutral translucent styling, help, pointer capture/release, drag bounds, close/reopen position, keyboard movement, center reset, and existing tab/container/Space lifecycle regression checks. No live account/page content used.

## 1.0.2 current-Space scope follow-up

43 Node tests and 45 native browser assertions (plus three native keyboard/pointer checks) passed in a disposable profile. Current-Space-only matching/recent suggestions are the new-install default; all-Spaces matching remains an explicit checkbox. Cross-Space/container/window regression tests explicitly enable it. A queued old dialog-close event no longer closes a freshly reopened bar. Production files/preferences were not updated as part of this staged change.
