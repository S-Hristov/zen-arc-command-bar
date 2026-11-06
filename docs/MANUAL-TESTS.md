# Manual acceptance plan

Run first in a separate throwaway Zen profile with Sine installed normally. Do not copy your live profile. Open synthetic/test URLs and set up two Spaces with different containers; only use real Gmail/work accounts after the safety checks pass. Record exact Zen/Sine/Command Palette versions, macOS version, keyboard layout, date, and pass/fail evidence without account data.

Automated evidence is in TEST-REPORT.md. **Do not mark unchecked rows passed just because an adapter mock passed.**

## Gate A — install / lifecycle / compatibility

- [ ] Install from the supplied local package, with Zen fully quit. Verify other Sine registry records remain identical; only this mod's record/folder plus registry backup appear.
- [ ] Launch through the real Sine loader, not the smoke-test stub. Cmd+T opens one bar. No errors in Browser Console.
- [ ] Open a second window after startup. Cmd+T works there, too. Close it with the bar open; no errors/leaked references.
- [ ] Disable through Sine while bar is open: UI disappears immediately; Cmd+T performs normal Zen New Tab. Re-enable: exactly one bar and one handler.
- [ ] Change `enabled` false/true in Sine Settings, then `tabFirst` false/true: immediate effect, no restart required.
- [ ] Restart Zen twice. Same settings and behavior; no duplicate overlay/listeners or lost tabs/Spaces.
- [ ] Remove via Sine. No mod nodes or command interception remain. Other mods and their settings remain.
- [ ] Enable Zen Command Palette 2.0.0 concurrently. Its usual command/prefix and Cmd+L remain functional; this mod's Cmd+T does not alter its result limits. If both bind Cmd+T, remove one assignment and recheck.
- [ ] Test other installed Sine mods one by one. Do not bypass a mod that deliberately cancels New Tab commands.
- [ ] Customize New Tab to another shortcut in `about:keyboard`: bar follows that command; original Cmd+T is not forcibly reclaimed. Restore original key afterward.

## Gate B — decisive workflow / account safety

Count existing real tabs before each case (exclude Zen's internal empty placeholder); record container IDs and original tab references where practical.

| Check | Fixture / action | Required result |
|---|---|---|
| [ ] | Gmail open; Cmd+T → `gma` | Gmail first, visibly highlighted, Enter switches original object |
| [ ] | Gmail only in inactive Space | Destination Space active before selection; no new tab |
| [ ] | Gmail in another container | Original container unchanged; no URL copied into current account |
| [ ] | Gmail in another window | Correct window focused, original tab selected, source overlay closed |
| [ ] | Several Gmail tabs/accounts | Current Space wins equal score, then recency, then stable ID; correct original container |
| [ ] | Pinned Gmail | Pin state unchanged; no new unpinned duplicate |
| [ ] | Gmail nested in collapsed folder | Found and activated through normal Zen selection; folder/pin/account not reassigned |
| [ ] | Global Essential | Found from every Space; original object stays essential |
| [ ] | Container-specific Essential | Switch to exposing Space for its container; no container mutation |
| [ ] | Essential whose container has no Space | Excluded; no unsafe selection/navigation fallback |
| [ ] | Discarded Gmail | Existing tab selected/restored by Gecko, not recreated; no extra forced reload |
| [ ] | No Gmail | Search highlighted; Enter submits `gma` to selected Google engine |
| [ ] | `weather tomorrow` | Search default; exactly one new tab in active Space's container |
| [ ] | Strong Gmail → Down → Enter | Google search executes, never the Gmail action |
| [ ] | `https://example.com` with no match | Direct navigation; one new tab; manual Google action also available |
| [ ] | `example.com/path` / `localhost:3000` | HTTPS host/path or HTTP localhost action respectively |
| [ ] | Two weak partial matches | Search default; both tabs remain manual choices |
| [ ] | Typo `gmial` | Conservative fuzzy tab can appear but search stays default |
| [ ] | Private + normal windows | No cross-private metadata exposure or switching; default private engine honored when engine setting empty |

## Gate C — keyboard / cancellation / races

- [ ] Escape after typing returns focus to original selected tab; no blank tab created or existing blank tab closed.
- [ ] Click backdrop; same cancellation result. Click a result; it executes once.
- [ ] Up/Down wrap; selected row, `aria-activedescendant`, and Enter action agree. Metadata updates do not reset a manual choice while the query is unchanged.
- [ ] Cmd+L with bar open dismisses it and focuses native address bar. Cmd+L outside bar remains ordinary Zen behavior.
- [ ] Cmd+W closes what Zen normally closes, not a hidden temporary tab. Cmd+Shift+T and other browser shortcuts are unaffected.
- [ ] Repeated/held Cmd+T: one overlay, no new tabs. Rapid typing/backspacing + Enter: no stale action.
- [ ] Real Japanese/Chinese IME: candidate-confirm Enter never switches/searches prematurely; committed input can then execute. Real non-US keyboard layout: native customized New Tab key works.
- [ ] Queries with Cyrillic, Japanese, accents/decomposed Unicode, RTL, and emoji do not corrupt the UI.
- [ ] Target closes/moves to another Space/window while highlighted: switch current valid identity or show safe error; never recreate its URL.
- [ ] Change Space while engine initializes: refuse wrong-context navigation. Escape/reopen uses new Space's container.
- [ ] Escape/disable during switch: no subsequent mod selection/new navigation; an already-started native Space animation may finish.
- [ ] Concurrent commands in two windows targeting one window: no duplicated tabs; any native conflict surfaces safely.
- [ ] 500+ tabs across Spaces: type continuously; no obvious input lag. Verify indexing happens on open/metadata changes, not a full DOM/profile scan every character.

## Gate D — accessibility / appearance

- [ ] Native light/dark appearance; compact mode; sidebar right; narrow window; 200% UI scale.
- [ ] VoiceOver announces dialog, input, result list and selected option. Tab remains in modal; Escape releases focus.
- [ ] High-contrast mode and keyboard-only use remain legible. Long/untrusted titles and URLs remain plain text, ellipsized without UI injection.

Release acceptance requires Gate A, the first four decisive Gate B rows, Google override, direct navigation, no-stray-tab cancellation, and real keyboard/IME checks. Automated tests alone do not certify those live-environment combinations.
