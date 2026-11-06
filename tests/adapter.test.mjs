import test from "node:test";
import assert from "node:assert/strict";
import { storedTabs, validTab, destinationSpace, activateTab, newTabContext, submitAction } from "../src/adapter.mjs";
function fixture(extra = {}) {
  const events = [];
  const win = { document: {}, closed:false, focus:()=>events.push("window-focus") };
  const attributes = { "zen-workspace-id":"other", "usercontextid":"2", ...extra };
  const tab = { isConnected:true, closing:false, ownerDocument:win.document, linkedBrowser:{},
    getAttribute:k=>attributes[k]??"", hasAttribute:k=>k in attributes };
  const spaces = { workspaceEnabled:true,activeWorkspace:"current",promiseInitialized:Promise.resolve(),
    getWorkspaceFromId:id=>spaces.getWorkspaces().find(w=>w.uuid===id),
    getWorkspaces:()=>[{uuid:"current",containerTabId:1},{uuid:"other",containerTabId:2}],
    changeWorkspaceWithID:async id=>{events.push(`space:${id}`);spaces.activeWorkspace=id;},
    getCurrentSpaceContainerId:()=>1,
  };
  win.gZenWorkspaces=spaces;
  let selected;
  win.gBrowser={get selectedTab(){return selected;},set selectedTab(value){selected=value;events.push("select");},selectedBrowser:{focus:()=>events.push("browser-focus")}};
  return {win,tab,spaces,events,attributes};
}
test("inactive Space collection uses allStoredTabs not visible tabs",()=>{
  const f=fixture();f.spaces.allStoredTabs=[f.tab];f.win.gBrowser.tabs=[];
  assert.deepEqual(storedTabs(f.win),[f.tab]);
});
test("activation awaits Space, selects original object, no navigation/close",async()=>{
  const f=fixture();await activateTab({tab:f.tab,win:f.win});
  assert.deepEqual(f.events,["space:other","select","window-focus","browser-focus"]);
  assert.equal(f.win.gBrowser.selectedTab,f.tab);assert.equal(f.attributes.usercontextid,"2");
});
test("container-specific Essential resolves matching Space",()=>{
  const f=fixture({"zen-essential":"true"});f.spaces.containerSpecificEssentials=true;
  assert.equal(destinationSpace(f.tab,f.spaces),"other");
  f.attributes.usercontextid="9";assert.throws(()=>destinationSpace(f.tab,f.spaces),/No Space/);
  f.spaces.containerSpecificEssentials=false;assert.equal(destinationSpace(f.tab,f.spaces),null);
});
test("failed Space API does not select, mutate, or duplicate",async()=>{
  const f=fixture();f.spaces.changeWorkspaceWithID=async()=>{};
  await assert.rejects(activateTab(f),/could not activate/);assert.deepEqual(f.events,[]);
});
test("closed/deleted/detached/mismatched owner fails safely",async()=>{
  for (const mutate of [f=>f.tab.closing=true,f=>f.tab.isConnected=false,f=>f.win.closed=true,f=>f.tab.ownerDocument={},f=>delete f.tab.linkedBrowser]) {
    const f=fixture();mutate(f);assert.equal(validTab(f.tab,f.win),false);await assert.rejects(activateTab(f));assert.deepEqual(f.events,[]);
  }
});
test("disable during async Space switch prevents selection",async()=>{
  const f=fixture();let alive=true;
  f.spaces.changeWorkspaceWithID=async id=>{f.spaces.activeWorkspace=id;alive=false;};
  await assert.rejects(activateTab(f,()=>alive));assert.deepEqual(f.events,[]);
});
test("two callers in different source windows serialize per target",async()=>{
  const f=fixture();let release;const gate=new Promise(r=>release=r);
  f.spaces.changeWorkspaceWithID=async id=>{f.events.push("start");await gate;f.spaces.activeWorkspace=id;f.events.push("end");};
  const a=activateTab(f), b=activateTab(f); await Promise.resolve();await Promise.resolve(); release();
  await Promise.all([a,b]);assert.equal(f.events.filter(x=>x==="start").length,1);
  assert.ok(f.events.indexOf("end")<f.events.indexOf("select"));assert.equal(f.win[Symbol.for("zen-arc-command-bar.activationQueue")],undefined);
});
test("new search container is active Space, not selected tab account",()=>{
  const f=fixture();assert.deepEqual(newTabContext(f.win),{userContextId:1,spaceId:"current"});
});
function searchServices(engine) {
  return {search:{init:async()=>{},getEngineByName:()=>engine,getDefault:async()=>engine,getDefaultPrivate:async()=>engine},scriptSecurityManager:{getSystemPrincipal:()=>"system"}};
}
test("search uses installed engine submission + postData + explicit container",async()=>{
  const f=fixture();const calls=[];f.win.openTrustedLinkIn=(...args)=>calls.push(args);
  const s=searchServices({getSubmission:q=>({uri:{spec:`https://google.example/search?q=${encodeURIComponent(q)}`},postData:"post"})});
  await submitAction(f.win,{type:"search",query:"weather tomorrow"},{engineName:"Google",userContextId:1,spaceId:"current"},s);
  assert.equal(calls.length,1);assert.equal(calls[0][1],"tab");assert.equal(calls[0][2].userContextId,1);assert.equal(calls[0][2].postData,"post");
});
test("missing engine never silently chooses another provider",async()=>{
  const f=fixture();await assert.rejects(submitAction(f.win,{type:"search",query:"x"},{engineName:"Missing"},searchServices(null)),/not installed/);
});
test("async disable or Space change cannot create wrong-container tab",async()=>{
  const f=fixture();let opened=false;f.win.openTrustedLinkIn=()=>opened=true;
  await submitAction(f.win,{type:"url",url:"https://example.com/"},{spaceId:"current"},searchServices(),()=>false);assert.equal(opened,false);
  await assert.rejects(submitAction(f.win,{type:"url",url:"https://example.com/"},{spaceId:"other"},searchServices()),/Space changed/);assert.equal(opened,false);
});
test("privileged navigation boundary rejects unsafe URL or engine submission",async()=>{
  const f=fixture();await assert.rejects(submitAction(f.win,{type:"url",url:"javascript:bad()"},{},searchServices()),/Unsafe/);
  const s=searchServices({getSubmission:()=>({uri:{spec:"file:///bad"}})});
  await assert.rejects(submitAction(f.win,{type:"search",query:"x"},{engineName:"Google"},s),/Unsafe/);
});

test("empty engine name respects private default rather than normal default",async()=>{
  const f=fixture();let usedPrivate=false;f.win.openTrustedLinkIn=()=>{};
  const s=searchServices({getSubmission:()=>({uri:{spec:"https://private.example/search"}})});
  const privateEngine=await s.search.getDefaultPrivate();
  s.search.getDefaultPrivate=async()=>{usedPrivate=true;return privateEngine;};
  s.search.getDefault=async()=>{throw new Error("normal engine must not be used");};
  await submitAction(f.win,{type:"search",query:"q"},{engineName:"",isPrivate:true},s);
  assert.equal(usedPrivate,true);
});
