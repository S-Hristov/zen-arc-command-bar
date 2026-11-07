import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, makeActions, prepare } from "../src/core.mjs";
import { addHistoryActions, historyInline, lookupHistory } from "../src/history.mjs";

const url = "https://studio.example.invalid/teams/work";
const match = { url, title: "Studio workspace" };
const merge = (q, results = [match], tabs = [], promote = true) =>
  addHistoryActions(q, makeActions(q, tabs, DEFAULTS), results, DEFAULTS, promote);

test("URL prefix completes an exact visited page and leaves raw search second", () => {
  const [first, second] = merge("studi");
  assert.deepEqual([first.type, first.url, first.inline], ["history", url, "studio.example.invalid/teams/work"]);
  assert.equal(second.query, "studi");
});
test("only literal URL prefixes autocomplete, with case-sensitive paths", () => {
  assert.equal(historyInline("STUDI", url), "STUDIo.example.invalid/teams/work");
  assert.equal(historyInline("studio.example.invalid/Teams", url), "");
  assert.equal(historyInline("studi", url + "?token=fixture"), "");
  assert.equal(historyInline("studio", "https://www.studio.invalid/"), "studio.invalid/");
  assert.equal(historyInline("workspace", url), "");
});
test("title matches are listed without overriding search or explicit navigation", () => {
  assert.deepEqual(merge("workspace").map(a => a.type), ["search", "history"]);
  assert.deepEqual(merge("studi", [match], [], false).map(a => a.type), ["search", "history"]);
  assert.equal(merge("https://other.invalid")[0].type, "url");
  assert.deepEqual(merge(""), []);
});
test("open tabs retain priority and duplicate history rows disappear", () => {
  const tab = { ...prepare({ id: "tab:1", title: "Studio", url }), kind: "title-prefix", score: 105 };
  assert.deepEqual(merge("studi", [match, match], [tab]).map(a => a.type), ["tab", "search"]);
  assert.equal(merge("studi", [match, match]).filter(a => a.type === "history").length, 1);
});
test("local query binds literal input and rejects unsafe and stale results", async () => {
  let live = true, count = 0;
  const places = { async promiseDBConnection() {
    return { async executeCached(sql, params) {
      count++;
      assert.match(sql, /SELECT .*FROM pages/su);
      assert.equal(params.term, "studi%'");
      assert.ok(!sql.includes(params.term));
      return [match, { url: "javascript:alert(1)" }, { url: "https://user:pass@invalid.test/" }]
        .map(data => ({ getResultByName: key => data[key] }));
    } };
  } };
  assert.deepEqual(await lookupHistory(places, "studi%'", () => live), [match]);
  live = false;
  assert.deepEqual(await lookupHistory(places, "studi%'", () => live), []);
  assert.equal(count, 1);
});
