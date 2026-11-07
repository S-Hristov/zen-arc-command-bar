import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DEFAULTS } from "../src/core.mjs";
const root = new URL("../",import.meta.url);
const json = file=>JSON.parse(readFileSync(new URL(file,root),"utf8"));
test("Sine script manifest and live unload declaration",()=>{
  const manifest=json("theme.json");
  assert.equal(manifest.id,"arc-command-bar");assert.equal(manifest.supportsUnload,true);
  for(const [file,props] of Object.entries(manifest.scripts)){
    assert.ok(existsSync(new URL(file,root)));assert.deepEqual(props.include,["chrome://browser/content/browser.xhtml"]);
  }
});
test("all runtime defaults are exposed as mod-owned Sine preferences",()=>{
  const prefs=json("preferences.json").filter(p=>p.property);
  for(const [key,value] of Object.entries(DEFAULTS)){
    const pref=prefs.find(p=>p.property===`arc-command-bar.${key}`);assert.ok(pref,key);assert.equal(pref.defaultValue,value,key);
    if(pref.type==="dropdown") assert.ok(pref.options.some(o=>o.value===value),key);
  }
  assert.ok(prefs.every(p=>p.property.startsWith("arc-command-bar.")));
});
test("generated runtime has cleanup, no global keydown interception or networking",()=>{
  const text=readFileSync(new URL("arc-command-bar.uc.js",root),"utf8");
  assert.ok(text.includes("win.addUnloadListener(() => app.destroy())"));
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|\.cookies\b|\.logins\b|removeTab\s*\(|discardBrowser\s*\(/u.test(text));
  assert.ok(!text.includes('listen(this.win, "keydown"'));
});

test("real Beta keyboard command is intercepted, not just menu command",()=>{
  const text=readFileSync(new URL("arc-command-bar.uc.js",root),"utf8");
  assert.ok(text.includes('"cmd_newNavigatorTabNoEvent"'));
  assert.ok(text.includes('event.target?.ownerDocument !== this.document'));
});

test("Arc restyle keeps semantics, drops debug-style header/footer, preserves errors",()=>{
  const source=readFileSync(new URL("src/browser.mjs",root),"utf8");
  const css=readFileSync(new URL("src/style.css",root),"utf8");
  assert.ok(source.includes('placeholder: "Search or Enter URL…"'));
  assert.ok(source.includes('"Switch to Tab"'));
  assert.ok(source.includes('row.setAttribute("aria-label"'));
  assert.ok(!source.includes('"Tabs, then the web"'));
  assert.ok(!source.includes('class: "arc-hint"'));
  assert.ok(css.includes('.arc-status[data-state="error"]'));
});


test("favicons stay local, history is private-window gated, and drag cleans up",()=>{
 const source=readFileSync(new URL("src/browser.mjs",root),"utf8");
 assert.ok(source.includes('page-icon:${iconURL}'));
 assert.match(source, /historySuggestions && !this.context.isPrivate/u);
 assert.ok(source.includes('this.endDrag(); this.help.hidden = true'));
 assert.ok(source.includes('setPointerCapture(e.pointerId)'));
 assert.ok(source.includes('releasePointerCapture(drag.id)'));
 assert.ok(!/localStorage|FormHistory|SessionStore/u.test(source));
});
