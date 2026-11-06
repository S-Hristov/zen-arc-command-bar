# Research and architecture decision — 2026-11-06

Inspected real source before implementation. Sources fetched into development-only `work/research/`; upstream implementation was not copied into this MIT runtime.

## Source pins

- **Zen Beta 1.24b**, tag commit `f75390aa2b797ddc3524ff9ed52ceb32a839f9fa`. [Release](https://github.com/zen-browser/desktop/releases/tag/1.24b), [engine configuration](https://github.com/zen-browser/desktop/blob/1.24b/surfer.json): Firefox 159.0 base. The installed macOS app also identifies as 1.24b. Development branch was inspected for discovery only; implementation decisions use release source.
- **Sine v2.3.3**, commit `1d2879b4d2c69d11a84e447be994431376e6576b`. [Stable manager](https://github.com/CosmoCreeper/Sine/blob/v2.3.3/src/core/manager.sys.mjs), [stable utilities](https://github.com/CosmoCreeper/Sine/blob/v2.3.3/src/core/utils.sys.mjs), [preferences](https://github.com/CosmoCreeper/Sine/blob/v2.3.3/src/core/preferences.sys.mjs). Current main `fb0bd4ca6af888f10648e126947f7d1f82228433` was also inspected; the same per-window unload registration survives there.
- **Zen Command Palette 2.0.0**, commit `708c42875511a8eb57960a6482284b6af8ca32f2`. [Manifest](https://github.com/Vertex-Mods/Zen-Command-Palette/blob/708c42875511a8eb57960a6482284b6af8ca32f2/theme.json), [compiled implementation](https://github.com/Vertex-Mods/Zen-Command-Palette/blob/708c42875511a8eb57960a6482284b6af8ca32f2/zen-command-palette.uc.js). Relevant sections: `generateActiveTabCommands`, `attachUrlbarListeners`, `ZenCommandProvider`, shortcut registry.
- **Firefox current source**, commit `d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e`. [ProvidersManager](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/UrlbarProvidersManager.sys.mjs), [UrlbarUtils/UrlbarProvider](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/UrlbarUtils.sys.mjs), [UrlbarResult](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/content/UrlbarResult.mjs), [child controller](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/content/UrlbarChildController.mjs), [view](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/content/UrlbarView.mjs), [input](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/components/urlbar/content/UrlbarInputBase.mjs). This current Firefox commit is not asserted to be the exact Zen build base. Zen's corresponding release patches were cross-checked, and chosen APIs exercised in the installed Zen binary.

## Findings

### Native URL bar

Modern code separates provider management from child UI control; older tutorials' import paths/signatures are not a compatibility contract. The controller drives the query and keyboard flow; the view has actual `selectedRowIndex`/`selectedElement`, while `UrlbarInputBase.handleNavigation()` resolves an element to a result and applies heuristic/value/composition safety checks before `pickElement()`/`pickResult()`.

A CSS row move does not change those objects. Merely adding a tab result cannot guarantee Enter uses it: muxing, heuristic precedence, provider priority, stale-query handling, and the input's safety checks still apply. Zen also patches heuristic admission for its native action search mode.

Command Palette supplies its own heuristic `ZenCommandProvider`, named `TestProvider` in the inspected build. It constructs modern object-form `UrlbarResult`s, enters prefix mode, and changes temporary rich-result limits. Competing in that same pipeline would require coordinated selection/heuristic ownership and window-specific command-bar mode tracking. This implementation deliberately avoids touching it.

### Zen tab/Space storage

[ZenSpaceManager](https://github.com/zen-browser/desktop/blob/1.24b/src/zen/spaces/ZenSpaceManager.mjs) exposes `allStoredTabs`, traversing all workspace pinned/normal sections, nested tab groups and container Essentials. In contrast, [tabs.mjs patch](https://github.com/zen-browser/desktop/blob/1.24b/src/browser/components/tabbrowser/content/tabs-mjs.patch) builds the ordinary tab list from active workspace strips and the current Essentials container.

Tabs carry `zen-workspace-id`, `usercontextid`, `zen-essential`, and `pending`. The manager provides `promiseInitialized`, `activeWorkspace`, `getWorkspaceFromId()`, `getWorkspaces()`, `getCurrentSpaceContainerId()`, and async `changeWorkspaceWithID()`. Its native `switchTabIfNeeded()` illustrates the container-specific Essential resolution, but can return early during concurrent transitions and catches failures internally. The mod uses explicit resolve → await change → verify → select, with a shared per-target-window queue and cancellation guard.

[Tabbrowser selection patch](https://github.com/zen-browser/desktop/blob/1.24b/src/browser/components/tabbrowser/Tabbrowser-sys-mjs.patch) calls `gZenWorkspaces.onBeforeTabSelect()`. Selecting an inactive-Space tab directly can therefore trigger asynchronous work rather than selecting immediately. Awaiting the Space change first avoids assuming a synchronous selection.

Runtime ownership check uses `tab.ownerDocument === win.document`, not obsolete `ownerGlobal`; this was corrected through actual browser tests. Original tab references remain the activation identity. The mod neither assigns workspace attributes nor mutates container IDs.

### Sine contract

`theme.json` maps `.uc.js` script paths to browser XHTML includes. Stable Sine loads them with `Services.scriptloader.loadSubScriptWithOptions()` into each matching window. `window.addUnloadListener(callback)` keys cleanup by the calling script's chrome URI. `supportsUnload: true` declares cleanup capability; disable/remove/reload invokes the callback. Startup, duplicate injection, and shutdown must still be handled by the script.

Sine's script permission is `sine.allow-unsafe-js` for non-store mods. The local installer never sets `origin: "store"`, grants permission, or replaces Sine. Stable `mods.json` registration stores relative `preferences.json` paths and the script map. Stable Sine downloads GitHub archives rather than importing a local XPI/ZIP, so an opt-in, offline registration helper is included for this unpublished package.

### Shortcuts

[Zen keyboard implementation](https://github.com/zen-browser/desktop/blob/1.24b/src/zen/kbs/ZenKeyboardShortcuts.sys.mjs) delegates current customization to Firefox CustomKeys/about:keyboard. A capturing `command` listener for both `cmd_newNavigatorTab` and `cmd_newNavigatorTabNoEvent` follows the existing key dispatch, including keyboard-layout/customization handling. The installed Beta key uses **`cmd_newNavigatorTabNoEvent`**, verified with trusted WebDriver keyboard dispatch; the other ID covers the standard New Tab menu route. [Firefox command dispatch](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/base/content/browser-sets.js) defines both. There is no document-wide Cmd+T keydown listener. This also affects the standard New Tab menu command; it does not claim to replace every toolbar new-tab route.

## Options compared

| Approach | Benefits | Risks / maintenance | Decision |
|---|---|---|---|
| Extend Command Palette | Native rendering, existing commands | Separate project's global/provider contract; collision with heuristic/default behavior; depends on user version | Not chosen |
| Independent native URL-bar provider | Native autocomplete, familiar visuals | Must coordinate heuristic/result selection and Cmd+T mode; current multiprocess URL-bar refactor; conflicts with existing provider | Not chosen |
| Dedicated chrome-level command bar | Own actual action/selection model; no temporary tab; no native monkey-patches; isolated from provider versions | Separate UI; no native autocomplete/history/commands; its own accessibility and acceptance tests | **Chosen** |

No browser internals are monkey-patched by the shipped runtime. Test-only mocks of new-tab navigation/unload are confined to disposable profiles and are identified in the report.

### Search API migration

Firefox 159 no longer exposes `Services.search`. The runtime explicitly imports the singleton [SearchService](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/toolkit/components/search/SearchService.sys.mjs) from `moz-src:///toolkit/components/search/SearchService.sys.mjs`, calls `init()`, resolves the installed named or normal/private default engine, and uses its `getSubmission()` (including POST data). This was verified against the real installed Beta, not assumed from older examples.

### Overlay focus and native shortcuts

The HTML dialog uses non-modal `show()` plus a chrome backdrop and single-input keyboard focus trap. `showModal()` inhibits browser keysets. Dismissing an input during a Cmd+L/Cmd+W keydown also invalidates its later native keypress target in the tested build. Inside the overlay only, those keys cancel their original key event and invoke `Browser:OpenLocation.doCommand()` for address-bar focus, or the verified `BrowserCommands.closeTabOrWindow(originalEvent)` for close, exactly once. The original modifier-bearing close event is essential: Gecko checks it to exclude pinned tabs from keyboard closes, including multiselection. This is a native API handoff, not a synthesized keyboard event or monkey-patch. Cmd+L outside the overlay is untouched. Trusted WebDriver tests verify Cmd+L focus; the close handoff uses the real native close path in the disposable profile.

Native close semantics were cross-checked in [browser-commands.js](https://github.com/mozilla-firefox/firefox/blob/d9bd6be9a67efb1c2667ef91a89856f35eb7cf5e/browser/base/content/browser-commands.js) and Zen’s [release patch](https://github.com/zen-browser/desktop/blob/1.24b/src/browser/base/content/browser-commands-js.patch); preserving the original modifier event prevents accidentally closing a pinned tab.
