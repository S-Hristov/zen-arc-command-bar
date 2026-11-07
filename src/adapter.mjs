// Thin Zen adapter. Tab object identity, never URL-based switching or cloning.
export function storedTabs(win) {
  if (win.gZenWorkspaces?.workspaceEnabled) {
    const tabs = win.gZenWorkspaces.allStoredTabs;
    if (tabs) return Array.from(tabs);
    // Chrome DOM only; includes hidden Spaces and nested folders.
    return Array.from(win.document.querySelectorAll("tab.tabbrowser-tab"));
  }
  return Array.from(win.gBrowser.tabs);
}
export function validTab(tab, win) {
  return Boolean(win && !win.closed && tab?.isConnected && !tab.closing &&
    tab.ownerDocument === win.document && tab.linkedBrowser && !tab.hasAttribute("zen-empty-tab"));
}
export function destinationSpace(tab, spaces) {
  if (!spaces?.workspaceEnabled) return null;
  if (!tab.hasAttribute("zen-essential")) {
    const id = tab.getAttribute("zen-workspace-id");
    if (!id) throw new Error("Target tab has no Space identity; switch refused.");
    if (!spaces.getWorkspaceFromId(id)) throw new Error("Target Space no longer exists.");
    return id;
  }
  if (!spaces.containerSpecificEssentials) return null;
  const container = Number(tab.getAttribute("usercontextid") || 0);
  const workspaces = spaces.getWorkspaces();
  const matches = w => container ? Number(w.containerTabId || 0) === container : !Number(w.containerTabId || 0);
  const current = workspaces.find(w => w.uuid === spaces.activeWorkspace);
  if (current && matches(current)) return current.uuid;
  const destination = workspaces.find(matches);
  if (!destination) throw new Error("No Space exposes this container's Essential. No account was moved.");
  return destination.uuid;
}

export async function activateTab(record, isAlive = () => true) {
  const { tab, win } = record;
  // Shared per-target-window queue across Sine's per-window script globals.
  const key = Symbol.for("zen-arc-command-bar.activationQueue");
  const previous = win[key] || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    if (!isAlive() || !validTab(tab, win)) throw new Error("Tab closed or command bar disabled.");
    const spaces = win.gZenWorkspaces;
    if (spaces?.workspaceEnabled) {
      await spaces.promiseInitialized;
      if (!isAlive() || !validTab(tab, win)) throw new Error("Tab no longer available.");
      const destination = destinationSpace(tab, spaces);
      if (destination && destination !== spaces.activeWorkspace) {
        if (typeof spaces.changeWorkspaceWithID !== "function") throw new Error("Unsupported Zen Space API.");
        await spaces.changeWorkspaceWithID(destination);
        if (spaces.activeWorkspace !== destination) throw new Error("Zen could not activate the target Space.");
      }
    }
    if (!isAlive() || !validTab(tab, win)) throw new Error("Tab no longer available.");
    win.gBrowser.selectedTab = tab;
    if (win.gBrowser.selectedTab !== tab) throw new Error("Zen declined tab selection; retry after its Space transition.");
    win.focus();
    win.gBrowser.selectedBrowser.focus();
  });
  win[key] = task;
  try { await task; }
  finally { if (win[key] === task) delete win[key]; }
}

export function newTabContext(win) {
  // New searches use the active Space's container, not the previous tab's account.
  const spaces = win.gZenWorkspaces;
  const container = spaces?.workspaceEnabled ? spaces.getCurrentSpaceContainerId() :
    Number(win.gBrowser.selectedTab?.getAttribute("usercontextid") || 0);
  if (!Number.isInteger(container) || container < 0) throw new Error("Cannot determine destination container.");
  return { userContextId: container, spaceId: spaces?.activeWorkspace || "" };
}

export async function submitAction(win, action, context, services, isAlive = () => true) {
  let url, postData = null;
  if (action.type === "url" || action.type === "history") url = action.url;
  else if (action.type === "search") {
    await services.search.init();
    if (!isAlive()) return;
    const engine = context.engineName ? services.search.getEngineByName(context.engineName) :
      context.isPrivate ? await services.search.getDefaultPrivate() : await services.search.getDefault();
    if (!engine) throw new Error(`Search engine “${context.engineName}” is not installed. Choose one in Arc Command Bar settings.`);
    const submission = engine.getSubmission(action.query, null, "keyword");
    if (!submission?.uri) throw new Error("Search engine did not return a submission.");
    url = submission.uri.spec; postData = submission.postData;
  } else throw new Error("Unknown action.");
  if (!isAlive()) return;
  if (win.closed || (context.spaceId && win.gZenWorkspaces?.activeWorkspace !== context.spaceId)) {
    throw new Error("Active Space changed. Reopen the bar before navigating.");
  }
  // Scheme allowlist checked again at the privileged boundary, including engine URLs.
  if (!/^https?:\/\//iu.test(url) && !/^about:(blank|newtab|preferences|config|downloads|addons|support|profiles)(?:[?#].*)?$/iu.test(url)) {
    throw new Error("Unsafe navigation scheme blocked.");
  }
  win.openTrustedLinkIn(url, "tab", {
    inBackground: false, relatedToCurrent: false,
    userContextId: context.userContextId, postData,
    triggeringPrincipal: services.scriptSecurityManager.getSystemPrincipal(),
  });
}
