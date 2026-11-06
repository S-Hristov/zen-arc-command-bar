# Arc Command Bar for Zen + Sine

**Cmd+T → `gma` → Enter → select the original Gmail tab, in its original Space and container.**

Independent privileged chrome UI. No tab is created on open/cancel/switch. Cmd+L and the native URL bar remain unmodified. Search stays one Arrow Down away from a strong tab match. Google is the default search-engine setting; it must be installed under that name.

## Status

Targets Zen Beta 1.24b; subsequently smoke-tested on macOS Zen 1.24.1b. Native automated tests use empty disposable profiles and emulate Sine's injection/unload interface. Cross-platform and full Sine lifecycle acceptance remain manual; no Windows/Linux certification is claimed. See [test report](docs/TEST-REPORT.md).

## Install with Sine

In Sine's repository installer, enter **`S-Hristov/zen-arc-command-bar`** (or [https://github.com/S-Hristov/zen-arc-command-bar](https://github.com/S-Hristov/zen-arc-command-bar)). The repository root contains `theme.json`. This is a community, unreviewed privileged-JavaScript mod, not an approved Sine Store listing. Review source and back up your profile first.

Sine must explicitly permit unverified JavaScript; that permission permits other unverified Sine scripts too. Review all enabled scripts. No browser-bundle edits, re-signing, or weakened extension signing are needed. Restart Zen if Sine requests it. Configure this mod independently; installing it installs no companion mods. ZIPs are source archives, not XPI files or an assumed Sine local-ZIP import format.

## Install on macOS — local package, no publishing required

Requires existing Sine with a valid `chrome/sine-mods/mods.json`, Python 3, and Zen fully quit when applying. No npm dependencies; Node is only needed to rebuild/test.

1. Extract `arc-command-bar-1.0.2.zip` to a normal folder. Read the code/security notes: this is **privileged browser JavaScript**, not a sandboxed WebExtension.
2. In Zen, open `about:profiles`. Copy the **Root Directory** of the intended profile, not Local Directory. Do not guess the default profile path.
3. Quit **all Zen windows with Cmd+Q**. Do not just close one window.
4. Open Terminal in the extracted `arc-command-bar` folder. Preview first:

   ```sh
   python3 scripts/install.py install --profile '/absolute/profile/root'
   ```

5. After reviewing the printed destination, install explicitly:

   ```sh
   python3 scripts/install.py install --profile '/absolute/profile/root' --apply --confirm-zen-closed
   ```

6. Start Zen. In Sine Settings, explicitly permit unverified JavaScript if it is not already allowed (`sine.allow-unsafe-js`). **This permission covers other unverified mods too: review every installed script before enabling it.** The installer never changes that preference or mislabels this mod as store-verified.
7. Restart Zen once after granting permission. Open **Sine → Arc Command Bar → Settings**. Confirm the search-engine name (`Google` by default; empty uses the normal/private browser default).
8. Run the first acceptance check: enable `allSpaces` for this cross-Space check; open a test tab normally in another Space; return; Cmd+T, type its title, Enter. Confirm original tab/container, correct Space, unchanged tab count.

Installer behavior: dry-run by default; rejects missing Sine, existing mod IDs/folders, symlinked managed paths, and a running/locked profile. Every registry write has a timestamped backup. It changes only its own registry entry and its new mod directory. It does not install Sine, modify its loader, or overwrite existing browser configuration.

## Use

| Key | Action |
|---|---|
| Cmd+T | Command bar, without creating a tab |
| Enter | Execute the actual highlighted model action |
| Down / Up | Change highlighted action; wraps |
| Escape / outside click | Cancel, no tab created |
| Cmd+L | Dismiss overlay; invoke Zen’s native address-bar command |
| Cmd+W | Dismiss overlay; invoke Zen’s native close command once |

The standard **New Tab menu command** also opens this bar. Toolbar/new-tab buttons that call different Zen code paths are deliberately left alone. Zen's `about:keyboard` customization of the native New Tab shortcut is honored: the mod follows the command, not a hard-coded physical T key. It does not remap a customized shortcut back to Cmd+T.

The first row is both visibly selected (`aria-selected`) and the selection model's action. Enter dispatches that exact object. There is no CSS-only reorder or hidden Google heuristic.

Switches use the original tab element. Full HTTP(S) URLs and plausible host/path inputs get a direct-navigation action. Text otherwise searches. The bar intentionally has no remote suggestions, Places/history/bookmark autocomplete, commands from other mods, keyword aliases, or arbitrary custom-protocol execution. Use Cmd+L for the complete native navigation interface.

## Settings

Sine stores only names under `arc-command-bar.*`. The runtime supplies read-only fallbacks; it never writes global browser preferences. Sine's own settings UI may initialize/save these mod-owned values.

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | true | Restore native New Tab immediately when false |
| `tabFirst` | true | False keeps tab results but selects search/navigation first |
| `allSpaces` | false | False restricts to the current window/Space, plus shared Essentials |
| `minQueryLength` | 2 | Minimum for matching tabs |
| `fuzzy` | true | Whole-token edit/transposition distance ≤1, at least 4 characters |
| `exactMatches` | true | Extra exact-title boost |
| `currentSpaceFirst` | true | Equal-score tie-break before recency |
| `includeDiscarded` | true | Include existing unloaded tab objects |
| `searchEngine` | Google | Installed engine name; empty = normal/private default |
| `maxResults` | 8 | Max tab rows; search is never removed |
| `minScore` | 80 | Auto-selection threshold |
| `ambiguityGap` | 8 | Weak partial matches need this lead over second place |
| `debug` | false | Generic local warnings only, no browsing metadata |

Weights: exact title 120, title prefix 105, title word prefix 99, domain exact 102 / prefix 96 / substring 84, title substring 84, exact URL 102 / URL substring 70, fuzzy 56. All six base weights are editable in Sine. Fuzzy results are **never** automatic, even if their numeric weight is raised. Weak ambiguous partial matches leave search selected. Strong exact/prefix/domain ties resolve by current Space, recency, then lifetime-stable tab ID. No online model or external AI.

Normal Google search is an invariant, not a setting that can accidentally hide the escape hatch. Missing engine → visible error, no silent switch to another provider, query retained for retry. To use browser default instead, clear `searchEngine`.

## Container, Space, and tab safety

- By default, suggestions stay in the current window/Space (plus shared Essentials). With `allSpaces=true`, current-profile browser windows are searched **within the same normal/private mode**. A normal window never exposes private tabs, or vice versa.
- Zen's `allStoredTabs` includes inactive Spaces, pins, nested folders, Essentials, and unloaded tabs. It is not equivalent to `gBrowser.tabs` in this release.
- Resolve destination Space, await the native `changeWorkspaceWithID()`, verify the active Space, select the same tab, focus its browser/window. Container-specific Essentials use a Space assigned to their container. No exposing Space → no unsafe fallback.
- Tab identity is the tab element plus owner document, tracked with WeakMap IDs—not its title, URL, or positional index. Duplicate URLs/accounts never collapse into one session.
- No `removeTab()`, URL assignment to matched tabs, explicit reload, discard, cookie access, page inspection, or password access exists in the runtime.
- Selecting an unloaded tab necessarily lets Gecko restore/load it. The mod does not force a separate reload.
- Search/navigation creates exactly one normal tab, only on execution, in the **active Space's container**. No owned temporary tab exists to clean up. If the Space changed while a search initialized, submission fails closed; reopen the bar.
- Closing the bar clears its query, model, strong tab references, and session listeners. Escape restores focus only if the origin tab is still selected; it never changes an unrelated selection back.
- Disabling during a Space transition suppresses subsequent selection/navigation. A native Space transition already underway may finish; the mod does not try to undo another browser operation.

## Command Palette and other mods

The inspected Zen Command Palette 2.0.0 registers a heuristic URL-bar provider. This mod neither extends it nor registers another provider. Native Cmd+L/Command Palette commands still use their own URL-bar pipeline; this bar has its own DOM/model. It does not change `browser.urlbar.maxRichResults` or rewrite their functions.

**Not magic conflict resolution:** if another mod consumes/remaps Cmd+T before Zen dispatches its command, this mod cannot receive it. Remove the duplicate assignment in that mod or turn `enabled` off here. No listener-order arms race is attempted. Concurrent runtime compatibility still needs manual verification.

## Exact installed files and removal

The local installer copies:

```text
<profile>/chrome/sine-mods/arc-command-bar/
  theme.json
  preferences.json
  arc-command-bar.uc.js
  LICENSE
  .arc-command-bar-local-install.json
```

It adds just `mods.json["arc-command-bar"]`, with `enabled: true`, `supportsUnload: true`, and `no-updates: true`. Registry backups sit beside `mods.json` with `mods.json.arc-command-bar.<UTC>.bak` names. No source CSS is installed: the compiled script creates/removes its scoped style node. No edits to `userChrome.css`, Sine's loader, or `prefs.js` are needed. A normal GitHub/Sine installation extracts that repository's archive into the same mod folder, so it also contains whatever source/docs/tests were published, but only the declared `.uc.js` executes.

**Preferred uninstall:** Sine → Arc Command Bar → Disable or Remove. Sine invokes `addUnloadListener()` in each loaded window; cleanup removes the command hook, pref observer, listeners, dialog, and style. Native New Tab behavior returns. The overlay uses a non-modal HTML dialog, backdrop, and input focus trap. Cmd+L/Cmd+W inside it hand off to native address-bar/close APIs once (retaining close modifiers); outside it those shortcuts are untouched. A restart is the recovery path if a future Sine version fails to unload.

**Offline fallback for a local installation:** fully quit Zen, then:

```sh
python3 scripts/install.py uninstall --profile '/absolute/profile/root'
python3 scripts/install.py uninstall --profile '/absolute/profile/root' --apply --confirm-zen-closed
```

This removes only this mod's registration and owned folder. Do not delete `sine-mods`, `mods.json`, the profile, or other mods. Old `arc-command-bar.*` preference values can safely remain; optionally reset only that prefix in `about:config`. Never restore an entire registry backup over later mod changes; merge only this mod's record if recovering. Keep unverified-JS permission as you need for your other trusted mods—do not reset it blindly.

## Debugging

1. Confirm Sine and the mod are enabled; confirm unverified JS permission, restart after changing it.
2. Temporarily disable other Cmd+T assignments; verify Zen's New Tab key in `about:keyboard`.
3. Enable `debug` for generic warnings in Browser Console. It never logs queries, titles, URLs, container names, or account data.
4. From **Browser Console** (not page DevTools), inspect `Services.wm.getMostRecentWindow("navigator:browser").ArcCommandBar`. `opened`, `busy`, and `settings` show local state. Calling that object’s `open()` can distinguish a shortcut conflict from UI failure. Do not paste privileged console snippets from untrusted sources.
5. Wrong search engine/missing Google: set the exact installed name or clear it for default. Query stays on failure.
6. Tab closed or Space changed while open: Escape, reopen. The mod refuses to duplicate the URL as a fallback for a failed switch.
7. Unsupported Sine unload API: script logs a generic warning and does **not** intercept the New Tab command.

## Build and test

```sh
npm run check                 # Build, syntax, Node pure/adapter/manifest tests
npm run package               # SHA256SUMS + reproducible ZIP in parent folder
python3 -m unittest discover -s tests -p 'test_*.py'  # Synthetic installer tests
python3 tests/browser_smoke.py # Real headless Zen, disposable empty profile
```

Browser runner accepts `--binary /absolute/path/to/zen`. Its temporary profiles live under the workspace's `work/`, are removed after the test, and use process-only remote system access. It never auto-discovers a real profile. See [research/architecture](docs/RESEARCH.md), [manual acceptance plan](docs/MANUAL-TESTS.md), and [security notes](docs/SECURITY.md).

## 1.0.1 — Arc-inspired visual refresh

Compact single-line result rows, borderless search field, macOS typography, right-aligned Switch to Tab labels and arrow keys, Space-tinted selection, and no visible diagnostic footer. Space/container details remain in each row’s accessible label and hover text. Errors remain visible. Scoring, activation, containers and native shortcuts are unchanged.


## Neutral glass / recent-tab / drag follow-up

Matches the supplied first reference: translucent neutral-dark surface, gray selection (no Zen purple accent), compact single-line tab rows with cached site favicons, and info affordance. Text/icons stay opaque; forced-colors mode remains opaque and readable. The full-page dimmer is removed so underlying text stays readable.

With an empty query, up to six recently accessed **open** tabs appear, excluding the active tab. The existing same-private-mode window filter, Space preference, discarded-tab setting, original tab identity, and container boundaries remain in force. This does not read browsing-history autocomplete or fetch online suggestions. Site icons use Gecko's local `page-icon:` cache with a generic fallback; the command bar never contacts a favicon host itself.

Drag the search icon to reposition within Zen's window. Pointer capture keeps dragging stable outside the handle. Position survives close/reopen for this browser window, not a browser restart; nothing is persisted. Double-click the search icon to center again. Tab/Shift+Tab reaches the handle and help; arrow keys on the handle move by 10px (Shift: 40px). Browser resizing and result-list growth constrain the bar back onscreen. Escape/close/unload cancel dragging and release capture. Search input selection and result clicks do not start a drag.

Scope follow-up (1.0.2): **current Space only by default**, including empty-query recent suggestions. Sine → Arc Command Bar → settings → **Search across all Spaces and windows** explicitly enables the wider scope. Existing saved user preferences are retained; uncheck that option to change an already-installed profile. This development package does not silently rewrite your live preference or restart Zen.

## Publication checks

See [current validation](docs/PUBLICATION-CHECKS.md). Earlier reports describe their historical test run, not additional platform certification.
