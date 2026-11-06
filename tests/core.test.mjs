import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { DEFAULTS, normalize, prepare, oneTypo, scoreTab, rankTabs as rankTabsCore, recentTabs, clampBarPosition, confident, navigationURL, makeActions, SelectionModel } from "../src/core.mjs";
const meta = (id, title, url, extra = {}) => prepare({ id, title, url, windowId: "w1", spaceId: "s1", lastAccessed: 1, ...extra });
const tabs = [
  meta("gmail", "Gmail inbox", "https://mail.google.com/mail/u/0/"),
  meta("git", "GitHub dashboard", "https://github.com/"),
  meta("jira", "Jira issue", "https://team.atlassian.net/browse/TEAM-1"),
  meta("trello", "Trello board", "https://trello.com/b/board"),
  meta("docs", "Google Docs", "https://docs.google.com/document/d/abc"),
];
const context = { windowId: "w1", spaceId: "s1" };
const rankTabs = (q,t,s=DEFAULTS,c=context) => rankTabsCore(q,t,s,c);
test("recent tabs sort by recency, exclude active, honor Space/discarded limits", () => {
  const list = [meta("selected", "Active", "https://a.test", {lastAccessed: 999}),
    meta("old", "Old", "https://b.test", {lastAccessed: 10}),
    meta("new", "New", "https://c.test", {lastAccessed: 30, spaceId: "s2"}),
    meta("discarded", "Lazy", "https://d.test", {lastAccessed: 40, discarded: true})];
  const ctx = {...context, selectedId: "selected"};
  assert.deepEqual(recentTabs(list, {allSpaces:true}, ctx).map(t=>t.id), ["discarded", "new", "old"]);
  assert.deepEqual(recentTabs(list, {allSpaces:false,includeDiscarded:false}, ctx).map(t=>t.id), ["old"]);
  assert.equal(recentTabs(list,{maxResults:1},ctx).length,1);
  assert.deepEqual(makeActions("",recentTabs(list,{allSpaces:true},ctx)).map(a=>a.type),["tab","tab","tab"]);
  assert.deepEqual(makeActions(" ",[]),[]);
  assert.equal(recentTabs(Array.from({length:20},(_,i)=>meta(`${i}`,"Tab","https://x.test")),{allSpaces:true}).length,6);
});
test("drag positions stay in bounds through viewport and result size changes", () => {
  assert.deepEqual(clampBarPosition({x:-500,y:-1},{width:720,height:350},{width:1000,height:800}),{x:8,y:8});
  assert.deepEqual(clampBarPosition({x:9999,y:9999},{width:720,height:350},{width:1000,height:800}),{x:272,y:442});
  assert.deepEqual(clampBarPosition({x:40,y:40},{width:100,height:90},{width:10,height:10}),{x:8,y:8});
});
function actions(query, input = tabs, settings = DEFAULTS) { return makeActions(query, rankTabs(query, input, settings, context), settings); }
for (const [query, id] of [["gma", "gmail"], ["git", "git"], ["jira", "jira"], ["trel", "trello"], ["docs", "docs"]]) {
  test(`${query}: actual first action is existing ${id} tab`, () => {
    const model = new SelectionModel(); model.update(query, actions(query));
    assert.equal(model.index, 0); assert.equal(model.selected.type, "tab"); assert.equal(model.selected.id, id);
    model.move(1); assert.equal(model.selected.type, "search");
  });
}
test("weather/no Gmail fallback searches", () => {
  assert.equal(actions("weather tomorrow")[0].type, "search");
  assert.equal(actions("gma", tabs.slice(1))[0].type, "search");
});
test("full and partial URL normal navigation, search retained", () => {
  for (const q of ["https://example.com", "example.com/path", "docs.google.com/document"]) {
    const list = actions(q); assert.equal(list[0].type, "url"); assert.equal(list[1].type, "search");
  }
});
test("score priorities and configurable weights", () => {
  const sample = [meta("exact", "jira", "https://example.com/"), meta("prefix", "Jira issue", "https://example.com/"),
    meta("domain", "Issues", "https://jira.example.com/"), meta("partial", "Team: abjira project", "https://example.com/"),
    meta("url", "Other", "https://example.com/jira")];
  const ranked = rankTabs("jira", sample);
  assert.deepEqual(ranked.map(x => x.id), ["exact", "prefix", "domain", "partial", "url"]);
  assert.equal(scoreTab("jira", sample[4], { urlWeight: 999 }).score, 999);
});
test("fuzzy bounded, conservative, never defaults", () => {
  assert.equal(actions("gmial")[0].type, "search");
  const matches = rankTabs("gmial", tabs);
  assert.equal(matches[0].id, "gmail"); assert.equal(matches[0].kind, "fuzzy");
  assert.equal(confident(matches, { minScore: 0 }), false);
  assert.equal(rankTabs("gmial", tabs, { fuzzy: false }).length, 0);
  assert.equal(rankTabs("gm", tabs).some(t => t.kind === "fuzzy"), false);
});
test("Damerau one edit, Unicode code points", () => {
  for (const [a,b] of [["gmail","gmial"],["gmail","gmal"],["gmail","gmaill"],["gmail","gmaol"],["東京駅","東京"],["😀a","😀b"]]) assert.equal(oneTypo(a,b),true);
  assert.equal(oneTypo("gml", "gmail"),false); assert.equal(oneTypo("gmaxx", "gmail"),false);
});
test("ambiguous weak partial hits keep search selected", () => {
  const list = [meta("a","Team abjira","https://a.example/"),meta("b","Work abjira","https://b.example/")];
  assert.equal(actions("jira",list)[0].type,"search");
  assert.equal(actions("jira",list.slice(0,1))[0].type,"tab");
  assert.equal(actions("jira",list.slice(0,1), { minScore: 200 })[0].type,"search");
});
test("duplicates stable; Space then recency tie-break", () => {
  const list = [meta("remote", "Gmail inbox", "https://mail.google.com/", { spaceId: "s2", lastAccessed: 100 }),
    meta("currentOld", "Gmail inbox", "https://mail.google.com/", { lastAccessed: 5 }),
    meta("currentNew", "Gmail inbox", "https://mail.google.com/", { lastAccessed: 10 })];
  assert.deepEqual(rankTabs("gma",list,{allSpaces:true},context).map(x=>x.id),["currentNew","currentOld","remote"]);
  assert.equal(rankTabs("gma",list,{currentSpaceFirst:false,allSpaces:true},context)[0].id,"remote");
});
test("all Spaces/windows/containers/pins/discarded included without mutation", () => {
  const list = [meta("pinned","Gmail pinned","https://mail.google.com/",{ pinned:true,discarded:true,containerId:7,spaceId:"other",windowId:"w2" })];
  const snapshot = JSON.stringify(list);
  assert.equal(actions("gma",list,{allSpaces:true})[0].type,"tab");
  assert.equal(rankTabs("gma",list,{includeDiscarded:false},context).length,0);
  assert.equal(rankTabs("gma",list,{allSpaces:false},context).length,0);
  assert.equal(JSON.stringify(list),snapshot);
});
test("Unicode, NFKC, RTL and decomposed text", () => {
  assert.equal(normalize("  ＧＭＡ  "),"gma");
  const list = [meta("ja","東京メモ","https://example.jp/"),meta("bg","Поща работа","https://example.bg/"),meta("ar","البريد الوارد","https://example.com/"),meta("accent","Café docs","https://example.com/")];
  for (const [q,id] of [["東京","ja"],["ПОЩА","bg"],["البريد","ar"],["Cafe\u0301","accent"]]) assert.equal(actions(q,list)[0].id,id);
});
test("disabled ranking/minimum length retain manual tab choices", () => {
  const list = actions("gma",tabs,{tabFirst:false}); assert.equal(list[0].type,"search"); assert.ok(list.some(a=>a.type==="tab"));
  assert.equal(actions("g")[0].type,"search"); assert.equal(actions("gma",tabs,{minQueryLength:4})[0].type,"search");
  assert.equal(actions("").length,0);
});
test("manual choice persists across metadata refresh, resets for new input", () => {
  const m = new SelectionModel(); m.update("gma",actions("gma")); m.move(1);
  m.update("gma",actions("gma")); assert.equal(m.selected.type,"search");
  m.update("gmai",actions("gmai")); assert.equal(m.selected.type,"tab");
  m.move(-1); assert.equal(m.index,m.actions.length-1);
  m.update("",[]); m.move(1); assert.equal(m.selected,null);
});
test("rapid typing model is synchronous and deterministic", () => {
  const m = new SelectionModel(); for (const q of ["g","gm","gma","gmai","gmail","weather tomorrow","gma"]) m.update(q,actions(q));
  assert.equal(m.selected.id,"gmail");
});
test("URL classifier is safe; search allowed for non-navigation text", () => {
  for (const input of ["javascript:alert(1)","data:text/html,bad","file:///etc/passwd","chrome://browser/content/browser.xhtml","https://u:p@example.com","http://", "weather tomorrow"]) assert.equal(navigationURL(input),null,input);
  assert.equal(navigationURL("about:config"),"about:config");
  assert.equal(navigationURL("localhost:3000/a"),"http://localhost:3000/a");
  assert.equal(navigationURL("https://例え.テスト/"),"https://xn--r8jz45g.xn--zckzah/");
});
test("1000-tab ranking latency (metadata prepared once)", t => {
  const list = Array.from({length:1000},(_,i)=>meta(`t${i}`,`Project ${i} dashboard`,`https://site${i}.example.com/project`));
  list.push(tabs[0]);
  for(let i=0;i<10;i++) rankTabs("gma",list);
  const samples=[];
  for(let i=0;i<100;i++) {const start=performance.now();const r=rankTabs("gma",list);samples.push(performance.now()-start);assert.equal(r[0].id,"gmail");}
  samples.sort((a,b)=>a-b); t.diagnostic(`1001 tabs: p50=${samples[50].toFixed(2)}ms, p95=${samples[95].toFixed(2)}ms`);
  assert.ok(samples[95] < 100, "ranking should not block a frame for hundreds of milliseconds");
});

test("exact HTTP URL can switch original tab; partial URL does not hijack navigation", () => {
  const list=[meta("original","Example page","https://example.com/")];
  assert.equal(actions("https://example.com",list)[0].type,"tab");
  assert.equal(actions("https://example.com/other",list)[0].type,"url");
});
test("current-Space-only setting excludes shared Essentials in another window",()=>{
  const list=[meta("shared-remote","Gmail","https://mail.google.com/",{spaceId:"",windowId:"w2"})];
  assert.equal(rankTabs("gma",list,{allSpaces:false},context).length,0);
});


test("current Space is default for matching and recent suggestions; cross-Space is opt-in",()=>{
 assert.equal(DEFAULTS.allSpaces,false);
 const list=[meta("here","Gmail","https://mail.google.com/"),meta("there","Gmail","https://mail.google.com/",{spaceId:"s2"})];
 assert.deepEqual(rankTabs("gma",list).map(t=>t.id),["here"]);
 assert.deepEqual(recentTabs(list,DEFAULTS,context).map(t=>t.id),["here"]);
 assert.equal(rankTabs("gma",list,{allSpaces:true}).length,2);
});
