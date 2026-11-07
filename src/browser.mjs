import { DEFAULTS, prepare, rankTabs, recentTabs, clampBarPosition, makeActions, SelectionModel } from "./core.mjs";
import { storedTabs, validTab, destinationSpace, activateTab, newTabContext, submitAction } from "./adapter.mjs";
import { lookupHistory, addHistoryActions } from "./history.mjs";

class ArcBar {
  constructor(win, services, privateUtils, searchService, getPlaces) {
    this.win = win; this.services = services; this.privateUtils = privateUtils;
    this.navigationServices = { search: searchService, scriptSecurityManager: services.scriptSecurityManager };
    this.getPlaces = getPlaces;
    this.document = win.document; this.model = new SelectionModel();
    this.disposed = false; this.opened = false; this.busy = false; this.composing = false;
    this.generation = 0; this.ids = new WeakMap(); this.nextId = 0; this.windowIds = new WeakMap(); this.nextWindowId = 0;
    this.cleanups = []; this.sessionCleanups = []; this.index = []; this.dirty = true;
    this.position = null; this.drag = null;
    this.historyRequest = null; this.historyTimer = null; this.historyRunning = false;
    this.completion = null; this.allowInline = false;
    this.onCommand = this.onCommand.bind(this); this.onInputKey = this.onInputKey.bind(this);
    this.settings = this.readSettings();
  }
  readSettings() {
    const prefs = this.services.prefs, settings = {};
    for (const [name, fallback] of Object.entries(DEFAULTS)) {
      const key = `arc-command-bar.${name}`;
      try {
        settings[name] = typeof fallback === "boolean" ? prefs.getBoolPref(key, fallback) :
          typeof fallback === "number" ? prefs.getIntPref(key, fallback) : prefs.getStringPref(key, fallback);
      } catch { settings[name] = fallback; }
    }
    for (const name of ["minQueryLength", "minScore", "ambiguityGap", "exactWeight", "prefixWeight", "domainWeight", "partialWeight", "urlWeight", "fuzzyWeight"]) {
      settings[name] = Math.max(0, Math.min(1000, settings[name]));
    }
    settings.minQueryLength = Math.max(1, settings.minQueryLength);
    settings.maxResults = Math.max(1, Math.min(30, settings.maxResults));
    return settings;
  }
  listen(target, type, callback, options, bag = this.cleanups) {
    target.addEventListener(type, callback, options);
    bag.push(() => target.removeEventListener(type, callback, options));
  }
  init() {
    if (this.disposed) return;
    this.listen(this.win, "command", this.onCommand, true);
    this.listen(this.win, "unload", () => this.destroy(), { once: true });
    const observer = { observe: () => {
      this.settings = this.readSettings();
      if (!this.settings.enabled) this.close();
      else if (this.opened) this.refresh();
    } };
    for (const pref of ["arc-command-bar.", "browser.urlbar.suggest.history", "browser.urlbar.autoFill"]) {
      this.services.prefs.addObserver(pref, observer);
      this.cleanups.push(() => this.services.prefs.removeObserver(pref, observer));
    }
  }
  onCommand(event) {
    // Honor Zen/Firefox's native key dispatch and about:keyboard customization.
    // Also covers the standard New Tab menu command. No global keydown hook.
    if (event.defaultPrevented || event.target?.ownerDocument !== this.document ||
        !["cmd_newNavigatorTab", "cmd_newNavigatorTabNoEvent"].includes(event.target?.id) ||
        !this.settings.enabled || this.disposed) return;
    try {
      this.open(); // If the UI cannot be constructed, leave native New Tab alone.
      event.preventDefault(); event.stopImmediatePropagation();
    } catch {
      this.close(false);
      this.warn("Command bar unavailable; using Zen New Tab.");
    }
  }
  element(tag, attrs = {}, text = "") {
    const node = this.document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    return node;
  }
  icon(kind) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = this.document.createElementNS(ns, "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "1.65", "stroke-linecap": "round", "stroke-linejoin": "round", class: "arc-svg", "aria-hidden": "true" })) svg.setAttribute(key, value);
    const path = this.document.createElementNS(ns, "path");
    const paths = {
      search: "M11 11l3 3M11.5 6.5a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
      tab: "M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM2 5.5h12",
      arrow: "M3 8h10M8 3l5 5-5 5",
      globe: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0ZM2 8h12M8 2c3 3 3 9 0 12M8 2c-3 3-3 9 0 12",
      info: "M8 7.5v4M8 4.5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z",
    };
    path.setAttribute("d", paths[kind] || paths.tab); svg.append(path); return svg;
  }
  build() {
    if (this.dialog) return;
    this.style = this.element("style", {}, ARC_STYLE);
    const dialog = this.element("dialog", { id: "arc-command-bar", "aria-label": "Arc Command Bar", "aria-modal": "true" });
    this.backdrop = this.element("div", { id: "arc-command-backdrop", hidden: "", "aria-hidden": "true" });
    const inputWrap = this.element("div", { class: "arc-input-wrap" });
    const searchMark = this.element("button", { type: "button", class: "arc-search-mark arc-drag-handle", "aria-label": "Move command bar. Drag, or use arrow keys. Double-click to center.", title: "Drag to move · Double-click to center" });
    searchMark.append(this.icon("search"));
    const input = this.element("input", {
      id: "arc-command-input", type: "text", role: "combobox", autocomplete: "off",
      spellcheck: "false", "aria-label": "Find a tab, search, or enter a URL",
      "aria-autocomplete": "both", "aria-expanded": "true", "aria-controls": "arc-command-results",
      placeholder: "Search or Enter URL…",
    });
    const list = this.element("div", { id: "arc-command-results", role: "listbox", "aria-label": "Actions" });
    const status = this.element("div", { class: "arc-status", role: "status", "aria-live": "polite" }, "Type to find an open tab. No new tab until you navigate.");
    const help = this.element("button", { type: "button", class: "arc-info", "aria-label": "Command bar help", "aria-expanded": "false", "aria-controls": "arc-command-help" });
    help.append(this.icon("info"));
    this.help = this.element("div", { id: "arc-command-help", hidden: "" }, "Recent open tabs appear first. Type to find a tab, visited page, or search. ↑/↓ selects; Enter opens; Esc closes. Drag the search icon to move; double-click it to center. Position lasts until Zen closes.");
    this.listen(help, "click", () => { this.help.hidden = !this.help.hidden; help.setAttribute("aria-expanded", String(!this.help.hidden)); this.constrainPosition(); });
    inputWrap.append(searchMark, input, help);
    dialog.append(inputWrap, list, this.help, status);
    this.document.documentElement.append(this.style, this.backdrop, dialog);
    this.dialog = dialog; this.input = input; this.list = list; this.status = status;
    this.dragHandle = searchMark;
    this.listen(searchMark, "pointerdown", e => {
      if (e.button !== 0 || this.busy) return;
      e.preventDefault();
      const rect = dialog.getBoundingClientRect();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      searchMark.setPointerCapture(e.pointerId);
      dialog.setAttribute("data-dragging", "true");
    });
    this.listen(searchMark, "pointermove", e => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.position = { x: this.drag.left + e.clientX - this.drag.x, y: this.drag.top + e.clientY - this.drag.y };
      this.constrainPosition();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) this.listen(searchMark, type, () => this.endDrag());
    this.listen(searchMark, "dblclick", () => {
      this.endDrag(); this.position = null;
      for (const prop of ["left", "top", "transform"]) dialog.style.removeProperty(prop);
      this.constrainPosition(); this.input.focus();
    });
    this.listen(searchMark, "keydown", e => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const rect = dialog.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      this.position = { x: rect.left + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), y: rect.top + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) };
      this.constrainPosition();
    });
    this.listen(this.win, "resize", () => { if (this.opened) this.constrainPosition(); });
    this.listen(input, "input", e => {
      this.completion = null;
      this.allowInline = !e.inputType?.startsWith("delete");
      if (!this.composing) this.refresh();
    });
    this.listen(input, "compositionstart", () => { this.composing = true; this.cancelHistory(); });
    this.listen(input, "compositionend", () => { this.composing = false; if (this.opened) this.refresh(); });
    this.listen(dialog, "keydown", this.onInputKey, true);
    this.listen(dialog, "cancel", e => { e.preventDefault(); this.close(); });
    this.listen(dialog, "close", () => { if (this.opened && !dialog.open) this.close(); });
    this.listen(this.backdrop, "click", () => this.close());
    this.listen(dialog, "click", e => {
      if (e.target === dialog && !this.busy) {
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close();
      }
    });
  }
  endDrag() {
    const drag = this.drag; this.drag = null;
    this.dialog?.removeAttribute("data-dragging");
    if (drag && this.dragHandle.hasPointerCapture(drag.id)) this.dragHandle.releasePointerCapture(drag.id);
  }
  constrainPosition() {
    if (!this.opened) return;
    const rect = this.dialog.getBoundingClientRect();
    const point = this.position || { x: rect.left, y: rect.top };
    const clamped = clampBarPosition(point, rect, { width: this.win.innerWidth, height: this.win.innerHeight });
    if (!this.position && point.x === clamped.x && point.y === clamped.y) return;
    this.position = clamped;
    Object.assign(this.dialog.style, { left: `${clamped.x}px`, top: `${clamped.y}px`, transform: "none" });
  }
  open() {
    if (this.disposed || !this.settings.enabled) return;
    if (this.opened) { this.input.focus(); return; }
    this.build();
    this.originFocus = this.document.activeElement;
    this.originTab = this.win.gBrowser.selectedTab;
    this.context = { ...newTabContext(this.win), engineName: this.settings.searchEngine,
      isPrivate: this.privateUtils.isWindowPrivate(this.win) };
    this.generation++; this.busy = false; this.composing = false;
    this.input.readOnly = false; this.input.value = ""; this.model = new SelectionModel();
    this.index = []; this.dirty = true; this.opened = true;
    this.watchWindows();
    try { this.backdrop.hidden = false; this.dialog.show(); this.input.focus(); this.refresh(); }
    catch (error) { this.close(false); throw error; }
  }
  watchWindows() {
    const refreshSoon = () => {
      this.dirty = true;
      if (this.refreshQueued) return;
      this.refreshQueued = true;
      this.win.queueMicrotask(() => {
        this.refreshQueued = false;
        if (this.opened && !this.busy && !this.composing) this.refresh();
      });
    };
    const watched = new WeakSet();
    const watch = win => {
      if (watched.has(win) || win.closed || !win.gBrowser || this.privateUtils.isWindowPrivate(win) !== this.context.isPrivate) return;
      watched.add(win);
      for (const type of ["TabOpen", "TabClose", "TabAttrModified", "TabSelect", "TabMove", "SSTabRestored", "TabBrowserInserted"]) {
        this.listen(win.document, type, refreshSoon, true, this.sessionCleanups);
      }
      this.listen(win, "unload", refreshSoon, { once: true }, this.sessionCleanups);
      // Restrict observation to chrome tab metadata. Never content DOM.
      const observer = new this.win.MutationObserver(refreshSoon);
      observer.observe(win.document.getElementById("tabbrowser-tabs"), {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["label", "zen-workspace-id", "usercontextid", "pending", "zen-essential"],
      });
      this.sessionCleanups.push(() => observer.disconnect());
    };
    for (const win of this.services.wm.getEnumerator("navigator:browser")) watch(win);
    const windowObserver = { observe: subject => { watch(subject); refreshSoon(); } };
    this.services.obs.addObserver(windowObserver, "browser-delayed-startup-finished");
    this.sessionCleanups.push(() => this.services.obs.removeObserver(windowObserver, "browser-delayed-startup-finished"));
  }
  getWindowId(win) {
    if (!this.windowIds.has(win)) this.windowIds.set(win, `w${++this.nextWindowId}`);
    return this.windowIds.get(win);
  }
  rebuildIndex() {
    const records = [];
    for (const win of this.services.wm.getEnumerator("navigator:browser")) {
      if (win.closed || !win.gBrowser || this.privateUtils.isWindowPrivate(win) !== this.context.isPrivate) continue;
      for (const tab of storedTabs(win)) {
        if (!validTab(tab, win) || tab.hasAttribute("zen-glance-tab")) continue;
        if (!this.ids.has(tab)) this.ids.set(tab, `t${++this.nextId}`);
        const url = tab.linkedBrowser.currentURI?.spec || "";
        // Zen/Gecko exposes the original URI for lazy/discarded browsers.
        if (!url || /^(?:about:blank|about:newtab)$/u.test(url)) continue;
        let spaceId;
        try { spaceId = destinationSpace(tab, win.gZenWorkspaces) || ""; }
        catch { continue; } // Fail closed when a hidden Essential has no Space.
        const spaceName = win.gZenWorkspaces?.getWorkspaceFromId?.(spaceId)?.name || "Shared";
        records.push(prepare({
          id: this.ids.get(tab), windowId: this.getWindowId(win), tab, win,
          title: tab.label || "", url, spaceId, spaceName,
          containerId: Number(tab.getAttribute("usercontextid") || 0),
          discarded: tab.hasAttribute("pending"), pinned: tab.pinned,
          lastAccessed: Number(tab.lastAccessed || tab._lastAccessed || 0),
        }));
      }
    }
    this.index = records; this.dirty = false;
  }
  cancelHistory() {
    if (this.historyTimer !== null) this.win.clearTimeout(this.historyTimer);
    this.historyTimer = null;
    this.historyRequest = null;
  }
  historyEnabled() {
    return this.settings.historySuggestions && !this.context.isPrivate &&
      this.services.prefs.getBoolPref("browser.urlbar.suggest.history", true);
  }
  setHistoryQuery(query) {
    const term = query.trim();
    if (!this.historyEnabled() || term.length < Math.max(2, this.settings.minQueryLength) || term.length > 256) {
      this.cancelHistory();
      return;
    }
    if (this.historyRequest?.query === query) return;
    this.cancelHistory();
    this.historyRequest = { query, term, ready: false, results: [] };
    this.historyTimer = this.win.setTimeout(() => {
      this.historyTimer = null;
      void this.runHistory();
    }, 95);
  }
  async runHistory() {
    const request = this.historyRequest;
    if (this.historyRunning || !request || request.ready) return;
    const alive = () => this.opened && !this.busy && !this.composing && request === this.historyRequest && this.historyEnabled();
    if (!alive()) return;
    this.historyRunning = true;
    try {
      request.results = await lookupHistory(this.getPlaces(), request.term, alive);
    } catch {
      // Places unavailable: keep tabs/search. Never log URL, title, or query.
    } finally {
      this.historyRunning = false;
      request.ready = true;
      if (alive()) this.refresh();
      if (request !== this.historyRequest && this.historyTimer === null) void this.runHistory();
    }
  }
  clearCompletion() {
    if (!this.completion) return;
    const { query, value } = this.completion;
    this.completion = null;
    if (this.input.value === value) this.input.value = query;
  }
  updateCompletion(query) {
    const fill = !this.model.manual && this.model.selected?.type === "history" ? this.model.selected.inline : "";
    if (this.completion?.value === fill) return;
    this.clearCompletion();
    if (!fill || this.document.activeElement !== this.input ||
        this.input.selectionStart !== query.length || this.input.selectionEnd !== query.length) return;
    this.input.value = fill;
    this.input.setSelectionRange(query.length, fill.length);
    this.completion = { query, value: fill };
  }
  refresh() {
    if (!this.opened || this.busy || this.composing) return;
    const query = this.completion?.query ?? this.input.value;
    this.setHistoryQuery(query);
    let matches = [], failed = false;
    try {
      if (this.dirty) this.rebuildIndex();
      const context = {
        spaceId: this.win.gZenWorkspaces?.activeWorkspace || "", windowId: this.getWindowId(this.win),
        selectedId: this.ids.get(this.win.gBrowser.selectedTab),
      };
      matches = query.trim() ? rankTabs(query, this.index, this.settings, context) : recentTabs(this.index, this.settings, context);
    } catch { failed = true; }
    const actions = makeActions(query, matches, this.settings);
    const promote = this.allowInline && this.services.prefs.getBoolPref("browser.urlbar.autoFill", true) &&
      this.document.activeElement === this.input && (this.completion ||
        (this.input.selectionStart === query.length && this.input.selectionEnd === query.length));
    this.model.update(query, addHistoryActions(query, actions, this.historyRequest?.results ?? [], this.settings, promote));
    this.updateCompletion(query);
    this.render();
    if (failed) this.warn("Tab index unavailable. Search and direct navigation remain available.");
  }
  render() {
    this.list.replaceChildren();
    this.model.actions.forEach((action, index) => {
      const row = this.element("div", {
        id: `arc-command-result-${index}`, role: "option", class: "arc-row",
        "aria-selected": String(index === this.model.index), "data-action": action.type,
      });
      const leading = this.element("span", { class: "arc-kind", "aria-hidden": "true" });
      const iconURL = action.type === "tab" ? action.tab.url : action.type === "history" ? action.iconURL : "";
      if (/^https?:\/\//iu.test(iconURL)) {
        // Gecko's page-icon protocol reads its local favicon cache, not the site.
        const fallback = this.icon("tab");
        const image = this.element("img", { class: "arc-favicon", src: `page-icon:${iconURL}`, alt: "", referrerpolicy: "no-referrer" });
        image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
        leading.append(image);
      }
      else if (action.type === "search" && this.settings.searchEngine === "Google") leading.append(this.element("span", { class: "arc-google" }, "G"));
      else leading.append(this.icon(action.type === "tab" ? "tab" : action.type === "search" ? "search" : "globe"));
      row.append(leading);
      const text = this.element("span", { class: "arc-text" });
      const displayLabel = action.type === "search" ? action.query : action.label;
      text.append(this.element("span", { class: "arc-label", dir: "auto" }, displayLabel));
      const sub = action.type === "tab" ?
        `${action.tab.spaceName} · Container ${action.tab.containerId}${action.tab.win !== this.win ? " · Other window" : ""}${action.tab.discarded ? " · Unloaded" : ""} · ${action.tab.url}` :
        action.type === "search" ? "New tab · Active Space container" : action.type === "history" ? `History · ${action.address} · Active Space container` : "New tab · Direct navigation";
      // Keep full Space/container identity available to assistive tech and hover,
      // without turning each compact Arc-like row into two lines of debug data.
      row.title = `${action.label} — ${sub}`;
      row.setAttribute("aria-label", `${action.label}. ${sub}`);
      const context = action.type === "search" ? `— ${this.settings.searchEngine || "Default engine"}` :
        action.type === "history" && action.label !== action.address ? `— ${action.address}` : "";
      if (context) text.append(this.element("span", { class: "arc-sub", dir: "auto" }, context));
      row.append(text);
      row.append(this.element("span", { class: "arc-action", "aria-hidden": "true" }, action.type === "tab" ? "Switch to Tab" : action.type === "search" ? "Search" : "Open"));
      const key = this.element("span", { class: "arc-enter", "aria-hidden": "true" });
      key.append(this.icon("arrow")); row.append(key);
      row.addEventListener("mousedown", e => e.preventDefault());
      row.addEventListener("click", () => { if (!this.busy) { this.model.choose(index); this.render(); void this.execute(); } });
      this.list.append(row);
    });
    if (this.model.selected) this.input.setAttribute("aria-activedescendant", `arc-command-result-${this.model.index}`);
    else this.input.removeAttribute("aria-activedescendant");
    this.status.dataset.state = "normal";
    this.status.textContent = this.model.actions.length ? `${this.model.index + 1} of ${this.model.actions.length} · ${this.model.selected.type === "tab" ? "Switch to existing tab" : this.model.selected.type === "search" ? "Search in new tab" : "Navigate in new tab"}` : "Type to find an open tab. No new tab until you navigate.";
    this.list.children[this.model.index]?.scrollIntoView({ block: "nearest" });
    this.constrainPosition();
  }
  onInputKey(event) {
    const accel = this.services.appinfo.OS === "Darwin" ? event.metaKey : event.ctrlKey;
    // A non-modal overlay leaves native XUL shortcuts dispatchable.
    // Cycle only the three controls; result navigation remains on arrow keys.
    if (event.key === "Tab" && !accel && !event.altKey && !event.ctrlKey) {
      event.preventDefault();
      const stops = [this.dragHandle, this.input, this.dialog.querySelector(".arc-info")];
      const index = stops.indexOf(this.document.activeElement);
      stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus(); return;
    }
    // Let native address-bar/close shortcuts run after dismissing the overlay.
    if (accel && !event.altKey && !event.shiftKey && ["l", "w"].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      const location = event.key.toLowerCase() === "l";
      this.close(false);
      // Handoff once, never synthesize a key. Close MUST retain the original
      // modifier-bearing event: Gecko uses it to protect pinned/multiselected tabs.
      if (location) this.document.getElementById("Browser:OpenLocation").doCommand();
      else this.win.BrowserCommands.closeTabOrWindow(event);
      return;
    }
    if (event.isComposing || this.composing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.target !== this.input) return;
    if (this.busy || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation(); this.clearCompletion(); this.model.move(event.key === "ArrowDown" ? 1 : -1); this.render();
    } else if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation(); void this.execute();
    }
  }
  async execute() {
    if (!this.opened || this.busy || this.composing) return;
    // Input processing is synchronous: Enter always dispatches the visible model,
    // not a hidden browser heuristic. Do not re-rank after an Arrow selection.
    const action = this.model.selected;
    if (!action) return;
    const generation = this.generation;
    const isAlive = () => !this.disposed && this.opened && this.settings.enabled && this.generation === generation;
    this.busy = true; this.input.readOnly = true; this.status.dataset.state = "busy"; this.status.textContent = "Opening…";
    try {
      if (action.type === "tab") await activateTab(action.tab, isAlive);
      else await submitAction(this.win, action, { ...this.context, engineName: this.settings.searchEngine }, this.navigationServices, isAlive);
      if (isAlive()) {
        this.close(false);
        const target = action.type === "tab" ? action.tab.win : this.win;
        if (!target.closed) { target.focus(); target.gBrowser.selectedBrowser.focus(); }
      }
    } catch {
      if (isAlive()) {
        this.busy = false; this.input.readOnly = false; this.input.focus();
        this.dirty = true;
        this.warn(action.type === "tab" ? "Tab switch failed or tab closed. Retry, or select Search. Nothing was duplicated." :
          "Navigation failed. Check the selected search engine in Sine settings and reopen if the Space changed.");
      }
    }
  }
  warn(message) {
    if (this.status && this.opened) { this.status.dataset.state = "error"; this.status.textContent = message; }
    if (this.settings.debug) this.win.console.warn(`[Arc Command Bar] ${message}`);
  }
  close(restoreFocus = true) {
    if (!this.opened) return;
    this.opened = false; this.generation++; this.busy = false; this.composing = false;
    this.cancelHistory(); this.completion = null; this.allowInline = false;
    this.endDrag(); this.help.hidden = true;
    this.dialog.querySelector(".arc-info").setAttribute("aria-expanded", "false");
    for (const cleanup of this.sessionCleanups.splice(0)) cleanup();
    this.index = []; this.model = new SelectionModel();
    this.input.value = ""; this.input.readOnly = false;
    this.list.replaceChildren(); this.input.removeAttribute("aria-activedescendant");
    this.backdrop.hidden = true;
    if (this.dialog.open) this.dialog.close();
    if (restoreFocus && !this.win.closed && this.win.gBrowser.selectedTab === this.originTab) {
      if (this.originFocus?.isConnected && typeof this.originFocus.focus === "function") this.originFocus.focus();
      else this.win.gBrowser.selectedBrowser.focus();
    }
    this.originFocus = null; this.originTab = null;
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.close();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.dialog?.remove(); this.backdrop?.remove(); this.style?.remove();
    if (this.win.ArcCommandBar === this) delete this.win.ArcCommandBar;
  }
}

function bootstrap() {
  const win = window;
  if (win.location.href !== "chrome://browser/content/browser.xhtml") return;
  if (typeof win.addUnloadListener !== "function") {
    win.console.warn("[Arc Command Bar] Sine unload API missing; not intercepting New Tab.");
    return;
  }
  win.ArcCommandBar?.destroy();
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const app = new ArcBar(win, Services, PrivateBrowsingUtils, SearchService,
    () => ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs").PlacesUtils);
  win.ArcCommandBar = app;
  // Called from this .uc.js file, so Sine associates cleanup with its chrome URI.
  win.addUnloadListener(() => app.destroy());
  if (win.gBrowserInit?.delayedStartupFinished) app.init();
  else {
    const observer = (subject) => {
      if (subject !== win) return;
      Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      if (!app.disposed) app.init();
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
    app.cleanups.push(() => { try { Services.obs.removeObserver(observer, "browser-delayed-startup-finished"); } catch {} });
    app.listen(win, "unload", () => app.destroy(), { once: true });
  }
}
bootstrap();
