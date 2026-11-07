#!/usr/bin/env python3
"""Real Gecko chrome smoke tests in an EMPTY temporary profile; never use your live profile.
Usage: python3 tests/browser_smoke.py [--binary /Applications/Zen.app/Contents/MacOS/zen]
No Selenium dependency. Small Marionette protocol client. No browsing-data logging.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]

class Marionette:
    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=2)
        self.sock.settimeout(45)
        self.seq = 0
        self.read()
    def read(self):
        length = b""
        while True:
            char = self.sock.recv(1)
            if not char:
                raise EOFError("Marionette disconnected")
            if char == b":":
                break
            length += char
        data = b""
        while len(data) < int(length):
            chunk = self.sock.recv(int(length) - len(data))
            if not chunk:
                raise EOFError("Marionette disconnected")
            data += chunk
        return json.loads(data)
    def call(self, name, params=None):
        self.seq += 1
        msg = json.dumps([0, self.seq, name, params or {}]).encode()
        self.sock.sendall(str(len(msg)).encode() + b":" + msg)
        reply = self.read()
        if reply[2]:
            raise RuntimeError(json.dumps(reply[2]))
        return reply[3]
    def js(self, script, args=None, async_=False):
        result = self.call("WebDriver:ExecuteAsyncScript" if async_ else "WebDriver:ExecuteScript", {
            "script": script, "args": args or [], "newSandbox": False,
            "sandbox": "system", "line": 0, "filename": "arc-command-bar-test",
        })
        return result.get("value") if isinstance(result, dict) else result

def run(binary, scratch=None):
    default_work = ROOT.parent.parent / "work"
    scratch = scratch or (default_work if default_work.is_dir() else Path(tempfile.gettempdir()))
    with tempfile.TemporaryDirectory(prefix="arc-command-bar-test-", dir=scratch) as tmp:
        profile = Path(tmp)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0)); port = probe.getsockname()[1]
        prefs = {
            "marionette.port": port, "marionette.log.level": "Warn",
            "browser.shell.checkDefaultBrowser": False, "browser.startup.page": 0,
            "browser.startup.homepage": "about:blank", "browser.aboutwelcome.enabled": False,
            "zen.welcome-screen.seen": True, "zen.welcome-screen.enabled": False,
            "zen.workspaces.skip-workspace-switch-animation": True,
            "datareporting.policy.dataSubmissionEnabled": False,
            "toolkit.telemetry.enabled": False,
        }
        (profile / "chrome.manifest").write_text(f"content arc-command-test {ROOT.as_uri()}/\n")
        (profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()))
        with (profile / "process.log").open("w") as log:
            proc = subprocess.Popen([binary, "--headless", "--no-remote", "--profile", str(profile),
                                     "--marionette", "--remote-allow-system-access"], stdout=log, stderr=log, env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1", "MOZ_DISABLE_UPDATE_PROCESSING": "1"})
            try:
                client = None
                deadline = time.monotonic() + 55
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        raise RuntimeError("Zen exited: " + (profile / "process.log").read_text()[-3000:])
                    try:
                        client = Marionette(port); break
                    except (OSError, EOFError):
                        time.sleep(.2)  # Process/socket readiness only, not application behavior.
                if client is None:
                    raise RuntimeError("Marionette startup timed out: " + (profile / "process.log").read_text()[-3000:])
                caps = client.call("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
                client.call("Marionette:SetContext", {"value": "chrome"})
                client.call("WebDriver:SetTimeouts", {"script": 45000})
                print("Browser:", client.js("return Services.appinfo.version + ' / ' + Services.appinfo.name"))
                print("Inspect:", client.js("return {newTabCommand: !!document.getElementById('cmd_newNavigatorTab'), spaces: !!window.gZenWorkspaces, init: gBrowserInit.delayedStartupFinished, space: gZenWorkspaces.activeWorkspace};"))
                result = client.js("""
                  const done = arguments[arguments.length - 1];
                  (async () => {
                    const w = window; await gZenWorkspaces.promiseInitialized;
                    w.__arcUnload = [];
                    w.addUnloadListener = cb => w.__arcUnload.push(cb);
                    const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
                    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(new FileUtils.File(arguments[0]));
                    Services.scriptloader.loadSubScriptWithOptions("chrome://arc-command-test/content/arc-command-bar.uc.js", {target: w, ignoreCache: true});
                    done({loaded: !!w.ArcCommandBar, dialog: !!document.getElementById('arc-command-bar')});
                  })().catch(e => done({error: String(e), stack: e.stack}));
                """, [str(profile / "chrome.manifest")], async_=True)
                print("Load:", result)
                if not result.get("loaded"): raise AssertionError(result)
                print("DOM:", client.js("return {stored:gZenWorkspaces.allStoredTabs.length, tabbox: !!document.getElementById('tabbrowser-tabs'), api: typeof gZenWorkspaces.createAndSaveWorkspace};"))
                # Test the OS-independent native key dispatch too, not just a synthetic command.
                key_results = []
                try:
                    def keys(text):
                        client.call("WebDriver:PerformActions", {"actions": [{"type":"key","id":"arc-keyboard","actions": [
                            {"type":"keyDown","value":"\ue03d"}, {"type":"keyDown","value":text},
                            {"type":"keyUp","value":text}, {"type":"keyUp","value":"\ue03d"}]}]})
                    keys("t")
                    state = client.js("return !!window.ArcCommandBar.opened")
                    if not state:
                        print("Key diagnostics:", client.js("return {key:document.getElementById('key_newNavigatorTab')?.outerHTML,command:document.getElementById('cmd_newNavigatorTab')?.outerHTML,focus:document.activeElement?.id};"))
                        raise AssertionError("native Cmd+T did not open bar")
                    key_results.append("native WebDriver Cmd+T opens bar")
                    keys("l")
                    state = client.js("return {closed: !ArcCommandBar.opened, urlbar: !!gURLBar.focused || document.commandDispatcher.focusedElement === gURLBar.inputField, active:document.activeElement?.id, focused:document.commandDispatcher.focusedElement?.id}")
                    if not state["closed"] or not state["urlbar"]: raise AssertionError(state)
                    key_results.append("native WebDriver Cmd+L focuses unchanged URL bar")
                except RuntimeError as error:
                    print("Native key harness unavailable:", str(error)[:180])
                    client.js("window.ArcCommandBar.close()")
                # Real chrome pointer events: drag handle, pointer capture, reset.
                handle=client.js("ArcCommandBar.open();const r=ArcCommandBar.dragHandle.getBoundingClientRect();const b=ArcCommandBar.dialog.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),left:b.left,top:b.top};")
                client.call("WebDriver:PerformActions", {"actions":[{"type":"pointer","id":"arc-drag","parameters":{"pointerType":"mouse"},"actions":[
                    {"type":"pointerMove","duration":0,"x":handle["x"],"y":handle["y"],"origin":"viewport"},
                    {"type":"pointerDown","button":0},
                    {"type":"pointerMove","duration":200,"x":handle["x"]+80,"y":handle["y"]+70,"origin":"viewport"},
                    {"type":"pointerUp","button":0}]}]})
                drag=client.js("const r=ArcCommandBar.dialog.getBoundingClientRect();return {left:r.left,top:r.top,dragging:!!ArcCommandBar.drag};")
                if abs(drag["top"]-handle["top"]-70)>2 or drag["dragging"]:raise AssertionError({"dragBefore":handle,"dragAfter":drag})
                key_results.append("real pointer drag moves chrome overlay and releases capture")
                client.js("ArcCommandBar.dragHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));ArcCommandBar.close();")
                # Synthetic titles on internal pages; no authenticated accounts/network needed.
                # URL matching itself is covered by pure tests; titles suffice to prove native selection.
                tests = client.js(r"""
                  const done = arguments[arguments.length - 1];
                  (async () => {
                    const results = [];
                    const assert = (condition, name) => { if (!condition) throw new Error(name); results.push(name); };
                    const bar = window.ArcCommandBar;
                    const principal = Services.scriptSecurityManager.getSystemPrincipal();
                    const createTab = async (url, container, owner = window) => {
                      const gb = owner.gBrowser;
                      let target;
                      const ready = new Promise(resolve => {
                        const listener = {onLocationChange(browser, progress, request, location) {
                          if (target && browser === target.linkedBrowser && location.spec === url) {
                            gb.removeTabsProgressListener(listener); resolve();
                          }
                        }};
                        gb.addTabsProgressListener(listener);
                        target = gb.addTab(url, {triggeringPrincipal: principal, userContextId: container, skipAnimation:true});
                        if (target.linkedBrowser.currentURI.spec === url) {gb.removeTabsProgressListener(listener); resolve();}
                      });
                      await ready; return target;
                    };
                    const tab = await createTab('about:robots', 1);
                    // A stable chrome label, not content metadata.
                    tab.label = 'Gmail inbox arc integration';
                    const count = () => gZenWorkspaces.allStoredTabs.filter(t => !t.closing && !t.hasAttribute('zen-empty-tab')).length;
                    const before = count();
                    document.getElementById('cmd_newNavigatorTab').dispatchEvent(new Event('command', { bubbles: true, cancelable: true }));
                    assert(bar.opened && bar.dialog.open, 'native New Tab command opens bar');
                    assert(count() === before, 'open creates no tab');
                    assert(bar.model.actions.length>0 && bar.model.actions.length<=6 && bar.model.actions.every(a=>a.type==='tab'), 'empty input shows bounded recent open tabs');
                    assert(bar.model.actions.every(a=>a.tab.tab!==gBrowser.selectedTab), 'recent suggestions exclude current active tab');
                    const iconRecord=bar.index.find(r=>r.tab===tab), savedIconURL=iconRecord.url;
                    iconRecord.url='https://arc-favicon-fixture.invalid/';bar.refresh();
                    const cachedIcon=bar.list.querySelector('.arc-favicon');
                    assert(cachedIcon?.getAttribute('src')==='page-icon:https://arc-favicon-fixture.invalid/', 'site icons use local-cache page-icon protocol, never site URLs');
                    await cachedIcon.decode();
                    assert(cachedIcon.naturalWidth>0, 'cache-backed favicon or native fallback decodes in chrome');
                    iconRecord.url=savedIconURL;bar.refresh();

                    const style=getComputedStyle(bar.dialog);
                    const alpha=Number(style.backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1]);
                    assert(alpha>0 && alpha<1 && style.backdropFilter.includes('blur'), 'translucent surface with blur, not faded text');
                    assert(!style.getPropertyValue('--arc-selection').includes('zen-primary-color'), 'neutral gray selection ignores purple Zen accent');
                    assert(!bar.list.querySelector('.arc-sub'), 'tab rows omit visible Space/debug text');
                    const info=bar.dialog.querySelector('.arc-info'); info.click();
                    assert(!bar.help.hidden && info.getAttribute('aria-expanded')==='true', 'info button explains drag and shortcuts'); info.click();
                    bar.position={x:99999,y:99999};bar.constrainPosition();
                    let moved=bar.dialog.getBoundingClientRect();
                    assert(moved.right<=innerWidth-7 && moved.bottom<=innerHeight-7, 'drag position constrained to visible browser viewport');
                    const kept={...bar.position};bar.close();bar.open();
                    assert(Math.abs(bar.dialog.getBoundingClientRect().left-kept.x)<1, 'drag position survives close and reopen');
                    bar.dragHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
                    assert(Math.abs(bar.dialog.getBoundingClientRect().left+bar.dialog.getBoundingClientRect().width/2-innerWidth/2)<1, 'double-click drag handle recenters');
                    bar.dragHandle.focus();
                    const oldLeft=bar.dialog.getBoundingClientRect().left;
                    bar.dragHandle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
                    assert(Math.abs(bar.dialog.getBoundingClientRect().left-oldLeft+10)<1, 'drag handle supports keyboard positioning');
                    bar.input.focus();

                    bar.input.value = 'gma'; bar.input.dispatchEvent(new Event('input', {bubbles: true}));
                    assert(bar.model.selected?.tab?.tab === tab, 'Gmail is actual selected model action');
                    assert(bar.list.firstChild.getAttribute('aria-selected') === 'true', 'visible first result selected');
                    bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}));
                    assert(bar.model.selected?.type === 'search', 'Arrow Down selects search');
                    bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true, cancelable:true}));
                    assert(bar.model.selected?.type === 'tab', 'Arrow Up selects Gmail');
                    await new Promise(resolve => {
                      bar.dialog.addEventListener('close', resolve, {once:true});
                      bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
                    });
                    assert(gBrowser.selectedTab === tab && !bar.opened, 'Enter action selects original container tab');
                    assert(tab.getAttribute('usercontextid') === '1', 'container identity unchanged');
                    assert(count() === before, 'switch creates no tab');
                    bar.open(); bar.input.value = 'weather tomorrow'; bar.refresh();
                    assert(bar.model.selected?.type === 'search', 'unknown text defaults to search');
                    bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true,cancelable:true}));
                    assert(!bar.opened && count() === before, 'Escape creates no tab');
                    bar.open(); bar.open(); bar.open();
                    assert(document.querySelectorAll('#arc-command-bar').length === 1, 'rapid open is idempotent');
                    bar.close();bar.open();await new Promise(resolve=>setTimeout(resolve,0));
                    assert(bar.opened && bar.dialog.open,'queued old dialog-close event does not dismiss a reopened bar');
                    bar.input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
                    bar.input.value = 'gma';
                    bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', isComposing:true, bubbles:true,cancelable:true}));
                    assert(bar.opened, 'IME Enter does not execute');
                    document.getElementById('cmd_newNavigatorTabNoEvent').dispatchEvent(new Event('command',{bubbles:true,cancelable:true}));
                    assert(bar.opened && count() === before, 'repeated New Tab during IME creates no tab');
                    bar.input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
                    bar.close();
                    Services.prefs.setBoolPref('arc-command-bar.enabled', false);
                    const event = new Event('command', {bubbles:true, cancelable:true});
                    // Capture a second listener instead of executing native New Tab in this assertion.
                    let passed = false; const listener = e => { if (e.target.id === 'cmd_newNavigatorTab') { passed = true; e.preventDefault(); e.stopImmediatePropagation(); } };
                    window.addEventListener('command', listener, true);
                    document.getElementById('cmd_newNavigatorTab').dispatchEvent(event);
                    window.removeEventListener('command', listener, true);
                    assert(passed && !bar.opened, 'disabled shortcut passes to browser');
                    Services.prefs.clearUserPref('arc-command-bar.enabled');
                    const linkCalls = []; const openLink = window.openTrustedLinkIn;
                    window.openTrustedLinkIn = (...args) => linkCalls.push(args);
                    try {
                      tab.label = 'Gmail inbox arc integration';
                      bar.open(); bar.input.value = 'gma'; bar.refresh();
                      assert(bar.model.selected.type === 'tab', 'tab remains first before manual search override');
                      bar.model.move(1); bar.render();
                      await bar.execute();
                      assert(linkCalls.length === 1 && linkCalls[0][0].includes('google.') && linkCalls[0][0].includes('gma'), 'Arrow Down then search uses installed Google submission');
                      assert(linkCalls[0][2].userContextId === gZenWorkspaces.getCurrentSpaceContainerId(), 'new search uses active Space container');
                      bar.open(); bar.input.value = 'https://example.com/arc-test'; bar.refresh();
                      assert(bar.model.selected.type === 'url', 'full URL selects navigation');
                      await bar.execute();
                      assert(linkCalls[1][0] === 'https://example.com/arc-test' && linkCalls[1][1] === 'tab', 'URL action uses native trusted new-tab navigation');
                    } finally { window.openTrustedLinkIn = openLink; }
                    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
                    const visited = 'https://studio-arc-fixture.invalid/projects/team';
                    const otherVisit = 'https://studio-arc-fixture.invalid/projects/review';
                    await PlacesUtils.history.insert({url: otherVisit, title: 'Review history fixture',
                      visits:[{date:new Date(Date.now() - 60000)}]});
                    await PlacesUtils.history.insert({url: visited, title: 'Studio history fixture', visits:[{date:new Date()}]});
                    Services.prefs.setBoolPref('browser.urlbar.suggest.history', true);
                    Services.prefs.setBoolPref('browser.urlbar.autoFill', true);
                    const typeQuery = (query, inputType = 'insertText') => {
                      bar.input.value = query;
                      bar.input.setSelectionRange(query.length, query.length);
                      bar.input.dispatchEvent(new InputEvent('input', {inputType, bubbles:true}));
                    };
                    const waitForHistory = async () => {
                      for (let i = 0; i < 100; i++) {
                        if (bar.historyRequest?.ready) return;
                        await new Promise(resolve => setTimeout(resolve, 20));
                      }
                      throw new Error('History lookup did not finish');
                    };
                    bar.open(); typeQuery('studi'); await waitForHistory();
                    assert(bar.model.selected?.url === visited && bar.model.selected?.type === 'history',
                      'recent visited page ranks first without an open tab');
                    assert(bar.model.actions[1]?.query === 'studi' && bar.model.actions.some(a => a.url === otherVisit),
                      'history shows alternate pages and retains literal search');
                    assert(bar.input.value === 'studio-arc-fixture.invalid/projects/team' &&
                      bar.input.selectionStart === 5 && bar.input.selectionEnd === bar.input.value.length,
                      'inline autocomplete selects only the suffix');
                    const down = () => bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true,cancelable:true}));
                    down();
                    assert(bar.input.value === 'studi' && bar.model.selected.type === 'search', 'Arrow Down restores the literal query and selects Search');
                    bar.close(); bar.open(); typeQuery('studi'); await waitForHistory();
                    typeQuery('studi','deleteContentBackward');
                    assert(bar.input.value === 'studi' && bar.model.selected.type === 'search',
                      'deleting a suffix does not reinsert it');
                    typeQuery('stud'); await waitForHistory();
                    const historyCalls = [];
                    window.openTrustedLinkIn = (...args) => historyCalls.push(args);
                    try {
                      await bar.execute();
                      assert(historyCalls[0]?.[0] === visited &&
                        historyCalls[0]?.[2]?.userContextId === gZenWorkspaces.getCurrentSpaceContainerId(),
                        'history action opens the exact URL in the active Space container');
                    } finally { window.openTrustedLinkIn = openLink; }
                    bar.open(); typeQuery('studi'); typeQuery('qzx-no-visit'); await waitForHistory();
                    assert(bar.model.actions.length === 1 && bar.model.selected.query === 'qzx-no-visit',
                      'stale history results cannot replace a newer query');
                    typeQuery('studi'); await waitForHistory();
                    Services.prefs.setBoolPref('browser.urlbar.suggest.history', false);
                    assert(!bar.historyRequest && bar.input.value === 'studi' && !bar.model.actions.some(a => a.type === 'history'),
                      'turning off native history suggestions removes rows and suffix');
                    Services.prefs.setBoolPref('browser.urlbar.suggest.history', true);
                    bar.close(); bar.open(); bar.context.isPrivate = true;
                    typeQuery('studi');
                    assert(!bar.historyRequest && !bar.model.actions.some(a => a.type === 'history'), 'private context does not schedule a history query');
                    bar.close();
                    const directCount = count();
                    const destinationContainer = gZenWorkspaces.getCurrentSpaceContainerId();
                    bar.open(); bar.input.value = 'about:downloads'; bar.refresh(); await bar.execute();
                    assert(count() === directCount + 1, 'real native navigation creates exactly one tab');
                    assert(Number(gBrowser.selectedTab.getAttribute('usercontextid') || 0) === destinationContainer, 'real new tab has active Space container');
                    bar.open();
                    await new Promise(resolve => {
                      const closingTab = gBrowser.selectedTab;
                      const listener = event => { if (event.target === closingTab) {
                        window.removeEventListener('TabClose', listener, true); queueMicrotask(resolve);
                      }};
                      window.addEventListener('TabClose', listener, true);
                      bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'w',metaKey:true,bubbles:true,cancelable:true}));
                    });
                    assert(!bar.opened && count() === directCount, 'Cmd+W invokes native close exactly once without stray tab');
                    gBrowser.pinTab(tab); gBrowser.selectedTab = tab;
                    const pinnedCount = count(); bar.open();
                    bar.input.dispatchEvent(new KeyboardEvent('keydown', {key:'w',metaKey:true,bubbles:true,cancelable:true}));
                    assert(tab.isConnected && !tab.closing && tab.pinned && count() === pinnedCount, 'Cmd+W retains native pinned-tab protection');
                    gBrowser.unpinTab(tab);
                    const firstSpace = gZenWorkspaces.activeWorkspace;
                    const other = await gZenWorkspaces.createAndSaveWorkspace('Arc isolated test', undefined, false, 2);
                    const otherTab = await createTab('about:license', 2);
                    await gZenWorkspaces.changeWorkspaceWithID(firstSpace);
                    otherTab.label = 'GitHub dashboard arc integration';
                    bar.open(); bar.input.value = 'git'; bar.refresh();
                    assert(!bar.model.actions.some(a=>a.tab?.tab===otherTab), 'current-Space default excludes inactive-Space tabs');
                    bar.close(); Services.prefs.setBoolPref('arc-command-bar.allSpaces',true);
                    bar.open(); bar.input.value = 'git'; bar.refresh();
                    assert(bar.model.selected?.tab?.tab === otherTab, 'inactive Space indexed after explicit All Spaces opt-in');
                    await bar.execute();
                    assert(gBrowser.selectedTab === otherTab && gZenWorkspaces.activeWorkspace === other.uuid, 'cross-Space switch selects original tab');
                    assert(otherTab.getAttribute('usercontextid') === '2', 'cross-Space container preserved');
                    const second = OpenBrowserWindow();
                    await new Promise(resolve => {
                      if (second.gBrowserInit?.delayedStartupFinished) {resolve();return;}
                      const observer = subject => {if(subject === second){Services.obs.removeObserver(observer,'browser-delayed-startup-finished');resolve();}};
                      Services.obs.addObserver(observer,'browser-delayed-startup-finished');
                    });
                    await second.gZenWorkspaces.promiseInitialized;
                    const remoteTab = await createTab('about:robots', 1, second);
                    remoteTab.label = 'Trello board remote window';
                    bar.open(); bar.input.value='trel'; bar.refresh();
                    assert(bar.model.selected?.tab?.tab === remoteTab, 'another window is indexed');
                    await bar.execute();
                    assert(second.gBrowser.selectedTab === remoteTab && remoteTab.ownerDocument === second.document, 'cross-window switch keeps original tab and owner');
                    second.close();
                    bar.open(); bar.input.value='git'; bar.refresh();
                    bar.input.dispatchEvent(new KeyboardEvent('keydown',{key:'l',metaKey:true,bubbles:true,cancelable:true}));
                    assert(!bar.opened, 'Cmd+L dismisses overlay and invokes native address-bar command');
                    window.__arcUnload[0]();
                    assert(!window.ArcCommandBar && !document.getElementById('arc-command-bar'), 'Sine unload removes UI and runtime');
                    done({passed: results});
                  })().catch(e => done({error: String(e), stack:e.stack, passed: false}));
                """, async_=True)
                print(json.dumps(tests, indent=2))
                if not tests.get("passed"): raise AssertionError(tests)
                tests["native_keys"] = key_results
                tests["browser"] = client.js("return Services.appinfo.name + ' ' + Services.appinfo.version") + " / headless disposable profile"
                tests["sine_lifecycle"] = "script injection and unload callback emulated; full Sine UI manual"
                (ROOT / "docs/browser-smoke-results.json").write_text(json.dumps(tests, indent=2) + "\n")
                # Static preview from test fixtures only. Never reads a live profile.
                client.js("""
                  Services.scriptloader.loadSubScriptWithOptions('chrome://arc-command-test/content/arc-command-bar.uc.js',{target:window,ignoreCache:true});
                  const tab = gZenWorkspaces.allStoredTabs.find(t=>t.linkedBrowser && !t.hasAttribute('zen-empty-tab') && t.linkedBrowser.currentURI.spec !== 'about:blank');
                  tab.label='Gmail inbox · test fixture';
                  ArcCommandBar.open(); ArcCommandBar.input.value='gma'; ArcCommandBar.refresh();
                """)
                try:
                    shot = client.call("WebDriver:TakeScreenshot", {"id": None, "full": False, "scroll": False})
                    (ROOT / "docs/preview.png").write_bytes(base64.b64decode(shot["value"]))
                    print("Saved test-fixture preview.")
                finally: client.js("window.ArcCommandBar.destroy()")
                return tests
            finally:
                proc.terminate()
                try: proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default="/Applications/Zen.app/Contents/MacOS/zen")
    parser.add_argument("--scratch-dir", type=Path, help="Existing directory for disposable profiles; defaults to workspace work/ or OS temp")
    args = parser.parse_args()
    run(args.binary, args.scratch_dir)
