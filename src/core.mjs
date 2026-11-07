// Pure matching and action model. No browser APIs, network, or persisted history.
export const DEFAULTS = Object.freeze({
  enabled: true, tabFirst: true, allSpaces: false, historySuggestions: true, minQueryLength: 2,
  fuzzy: true, exactMatches: true, currentSpaceFirst: true,
  includeDiscarded: true, debug: false, maxResults: 8, minScore: 80,
  ambiguityGap: 8, searchEngine: "Google",
  exactWeight: 120, prefixWeight: 105, domainWeight: 96,
  partialWeight: 84, urlWeight: 70, fuzzyWeight: 56,
});

export function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
export function words(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
}
export function prepare(meta) {
  const title = normalize(meta.title);
  const url = normalize(meta.url);
  let host = "";
  try { host = new URL(meta.url).hostname.toLowerCase().replace(/^www\./u, ""); } catch {}
  return { ...meta, titleKey: title, urlKey: url, host, titleWords: words(title), hostWords: words(host) };
}

// Damerau distance <= 1 only. Unicode code points, bounded candidate lengths.
export function oneTypo(a, b) {
  const x = Array.from(a), y = Array.from(b);
  if (Math.abs(x.length - y.length) > 1) return false;
  if (x.length === y.length) {
    const d = [];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d.push(i);
    return d.length === 0 || d.length === 1 ||
      (d.length === 2 && d[1] === d[0] + 1 && x[d[0]] === y[d[1]] && x[d[1]] === y[d[0]]);
  }
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; }
    else if (skipped) return false;
    else { skipped = true; j++; }
  }
  return true;
}

export function scoreTab(query, tab, settings = DEFAULTS) {
  const s = { ...DEFAULTS, ...settings }, q = normalize(query);
  if (Array.from(q).length < s.minQueryLength) return null;
  const qw = words(q), title = tab.titleKey, host = tab.host;
  const candidates = [];
  const add = (kind, score) => candidates.push({ kind, score });
  if (s.exactMatches && title === q) add("exact-title", s.exactWeight);
  if (title.startsWith(q)) add("title-prefix", s.prefixWeight);
  // Word-prefix allows 'docs' -> Google Docs, but not arbitrary substrings.
  if (qw.length && qw.every(w => tab.titleWords.some(t => t.startsWith(w)))) {
    add("title-word-prefix", s.prefixWeight - 6);
  }
  if (host === q) add("domain-exact", s.domainWeight + 6);
  else if (host.startsWith(q) || tab.hostWords.some(w => w.startsWith(q))) add("domain-prefix", s.domainWeight);
  else if (!q.includes(" ") && q.length >= 3 && host.includes(q)) add("domain-partial", s.domainWeight - 12);
  if (title.includes(q)) add("title-partial", s.partialWeight);
  if (tab.urlKey === q || tab.urlKey === `${q}/`) add("url-exact", s.urlWeight + 32);
  if (tab.urlKey.includes(q)) add("url-partial", s.urlWeight);
  if (s.fuzzy && qw.length === 1 && Array.from(q).length >= 4 && Array.from(q).length <= 64 &&
      [...tab.titleWords, ...tab.hostWords].some(w => w.length <= 65 && oneTypo(q, w))) {
    add("fuzzy", s.fuzzyWeight);
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.score - a.score)[0];
}

export function rankTabs(query, tabs, settings = DEFAULTS, context = {}) {
  const s = { ...DEFAULTS, ...settings };
  return tabs.filter(t => (s.includeDiscarded || !t.discarded) &&
      (s.allSpaces || t.windowId === context.windowId && (!t.spaceId || t.spaceId === context.spaceId)))
    .map(tab => { const match = scoreTab(query, tab, s); return match && { ...tab, ...match }; })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score ||
      (s.currentSpaceFirst ? Number(b.spaceId === context.spaceId && b.windowId === context.windowId) -
        Number(a.spaceId === context.spaceId && a.windowId === context.windowId) : 0) ||
      (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id.localeCompare(b.id));
}

// Recent OPEN tabs only: no history queries, network, or persisted title/URL list.
export function recentTabs(tabs, settings = DEFAULTS, context = {}) {
  const s = { ...DEFAULTS, ...settings };
  return tabs.filter(t => t.id !== context.selectedId && (s.includeDiscarded || !t.discarded) &&
      (s.allSpaces || t.windowId === context.windowId && (!t.spaceId || t.spaceId === context.spaceId)))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id.localeCompare(b.id))
    .slice(0, Math.min(6, s.maxResults));
}

export function clampBarPosition(point, size, viewport) {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(point.x, Math.max(margin, viewport.width - size.width - margin))),
    y: Math.max(margin, Math.min(point.y, Math.max(margin, viewport.height - size.height - margin))),
  };
}

export function confident(matches, settings = DEFAULTS) {
  const s = { ...DEFAULTS, ...settings }, best = matches[0], second = matches[1];
  if (!s.tabFirst || !best || best.score < s.minScore || best.kind === "fuzzy") return false;
  // Exact/prefix/domain hits are deliberate, even with several Gmail instances.
  if (["exact-title", "title-prefix", "title-word-prefix", "domain-exact", "domain-prefix", "url-exact"].includes(best.kind)) return true;
  return !second || best.score - second.score >= s.ambiguityGap;
}

// Safe, explicit browser navigation. No javascript:, data:, file:, or arbitrary schemes.
export function navigationURL(input) {
  const q = String(input).trim();
  if (!q || /\s/u.test(q)) return null;
  if (/^about:(blank|newtab|preferences|config|downloads|addons|support|profiles)(?:[?#].*)?$/iu.test(q)) return q;
  if (/^[a-z][a-z\d+.-]*:/iu.test(q) && !/^https?:\/\//iu.test(q) && !/^localhost:\d/iu.test(q)) return null;
  const explicit = /^https?:\/\//iu.test(q);
  const looksLikeHost = /^(?:localhost|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+|\[[a-f\d:]+\])(?::\d+)?(?:[/?#].*)?$/iu.test(q);
  if (!explicit && !looksLikeHost) return null;
  try {
    const url = new URL(explicit ? q : `${/^localhost(?::|\/|$)/iu.test(q) ? "http" : "https"}://${q}`);
    if (!url.hostname || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch { return null; }
}

export function makeActions(query, matches, settings = DEFAULTS) {
  const s = { ...DEFAULTS, ...settings }, text = String(query).trim();
  const tabs = matches.slice(0, s.maxResults).map(t => ({ type: "tab", id: t.id, tab: t, label: t.title || t.url }));
  if (!text) return tabs;
  const url = navigationURL(text);
  const search = { type: "search", id: "search", query: text, label: `Search ${s.searchEngine || "default engine"} for “${text}”` };
  const fallback = url ? [{ type: "url", id: "url", url, label: `Go to ${url}` }, search] : [search];
  // Full URLs are never redirected to a partial-title or fuzzy tab match.
  const exactURL = url && matches[0] && (() => {
    try { return new URL(matches[0].url).href === url; } catch { return false; }
  })();
  if (confident(matches, s) && (!url || exactURL)) {
    // Search stays one Arrow Down away from the selected best tab.
    return [tabs[0], ...fallback, ...tabs.slice(1)];
  }
  return [...fallback, ...tabs];
}

export class SelectionModel {
  constructor() { this.actions = []; this.index = -1; this.query = ""; this.manual = false; }
  update(query, actions) {
    const same = query === this.query, id = same && this.manual ? this.selected?.id : null;
    this.query = query; this.actions = actions;
    const found = id ? actions.findIndex(a => a.id === id) : -1;
    this.index = actions.length ? Math.max(0, found) : -1;
    this.manual = Boolean(id && found >= 0);
  }
  move(delta) {
    if (!this.actions.length) return;
    this.index = (this.index + delta + this.actions.length) % this.actions.length;
    this.manual = true;
  }
  choose(index) { if (index >= 0 && index < this.actions.length) { this.index = index; this.manual = true; } }
  get selected() { return this.actions[this.index] || null; }
}
