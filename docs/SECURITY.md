# Security and compatibility boundaries

## Privilege

A Sine userscript runs with browser-chrome privileges, not WebExtension isolation. Review it before installation. ZIP SHA-256 checks detect corruption against supplied hashes, **not publisher authenticity**; no signed publisher or marketplace approval is claimed. No external runtime dependencies/CDN scripts exist.

## Metadata access

Only browser tab objects' titles, URIs, ownership, access time, unloaded/pinned/closing state, container IDs, and workspace identities/names are used. Indexing traverses browser chrome, not content documents. The code never reads cookies, history databases, password managers, 1Password, form values, extension storage, or page contents. Debug output is generic. There is no fetch/XHR, suggestion provider, analytics, telemetry, or AI model call in the runtime. Zen itself may perform its normal startup/service network activity; the mod does not disable unrelated browser services.

Normal search explicitly sends the submitted query to the installed, selected search engine when the user executes that action. Direct navigation makes the ordinary browser request. Merely typing in the bar causes no mod-originated network request. Labels use `textContent`, not HTML parsing; remote favicons are not requested. URL/title text is treated as untrusted display data. Normal/private tabs never mix in the index.

## Fail closed

No matching-tab failure navigates a copy of that tab's URL. Closed/detached/closing tabs, deleted Spaces, unsupported APIs, cancelled operations, and wrong active Space are refused. Container-specific Essentials without an exposing Space are excluded. Target tab account identity is never rewritten. No temporary tab ownership guessing or blank-tab deletion code exists.

The navigation classifier supports HTTP(S), host/path inputs and a short allowlist of normal `about:` pages. It intentionally does not implement `javascript:`, `data:`, `file:`, `chrome:`, credentials embedded in URLs, extension schemes, arbitrary protocol handlers, or URL-bar keyword syntax. Use Cmd+L for native capabilities. Search engine submissions are also scheme-checked at the privileged boundary. Firefox's normal new-tab loader still enforces its navigation/security policy.

## Lifetime

Sine unload callback + window unload + idempotent duplicate-injection cleanup. Per-session metadata listeners and MutationObservers are removed when the bar closes. The settings observer and New Tab command listener are removed on unload. No background full-profile scan, polling loop, arbitrary activation sleep, or synthetic keyboard event exists in the shipped runtime. Tests use synthetic events only in disposable profiles.

Only one execution per open bar; shared Promise queue serializes this mod's switches into a target window. Native operations from other mods or users cannot be globally locked. If Zen declines selection during a competing change, the mod shows an error and refuses duplication. An already-started native workspace transition may complete after cancellation.

## Supported / not certified

Source target and real binary smoke test: Zen Beta 1.24b on macOS. Sine contract inspected at v2.3.3 and current main. No Twilight-only dependency. Future internal APIs remain a compatibility risk. Windows/Linux are not certified, although command dispatch and Ctrl shortcuts are accommodated. Hardware keyboard layout, real CJK IME, VoiceOver, private-window UI, folders/Essentials and simultaneous Command Palette execution require the manual acceptance matrix.

Local installer requires an explicit profile path and `--apply --confirm-zen-closed`; it never discovers, clones, or launches a live profile. It refuses existing mod directories and symlinked managed paths. It preserves other registry entries and backs up before atomic replacement. A low-level disk failure after registry commit is not a transaction across the entire filesystem; retain the backup and inspect only this mod's entry if recovery is needed. Do not run multiple profile-management tools concurrently.
