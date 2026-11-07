// Read-only, local Places history. The fixed candidate window bounds SQLite work.
const HISTORY_LIMIT = 8;
const HISTORY_SQL = `
  WITH recent AS MATERIALIZED (
    SELECT url, title, visit_count, hidden, last_visit_date
    FROM moz_places
    WHERE last_visit_date IS NOT NULL
    ORDER BY last_visit_date DESC
    LIMIT 5000
  ), pages AS (
    SELECT *, CASE WHEN substr(url, 1, 8) = 'https://' THEN substr(url, 9) ELSE substr(url, 8) END AS address
    FROM recent
    WHERE visit_count > 0 AND hidden = 0 AND (substr(url, 1, 8) = 'https://' OR substr(url, 1, 7) = 'http://')
  )
  SELECT url, title FROM pages
  WHERE instr(lower(address), lower(:term)) > 0 OR instr(lower(title), lower(:term)) > 0
  ORDER BY CASE WHEN instr(lower(address), lower(:term)) = 1
                 OR (substr(address, 1, 4) = 'www.' AND instr(lower(substr(address, 5)), lower(:term)) = 1)
                THEN 0 ELSE 1 END, last_visit_date DESC, url
  LIMIT :limit
`;

export async function lookupHistory(places, term, alive) {
  const db = await places.promiseDBConnection();
  if (!alive()) return [];
  const rows = await db.executeCached(HISTORY_SQL, { term, limit: HISTORY_LIMIT * 2 });
  if (!alive()) return [];
  return rows.flatMap(row => {
    try {
      const url = new URL(row.getResultByName("url"));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
      return [{ url: url.href, title: row.getResultByName("title") || "" }];
    } catch { return []; }
  });
}

export function historyInline(query, href) {
  if (!query || /\s/u.test(query)) return "";
  const url = new URL(href);
  if (url.search || url.hash) return "";
  const address = url.host + url.pathname;
  for (const candidate of [address, address.replace(/^www\./u, "")]) {
    const hostEnd = candidate.indexOf("/");
    const hostLength = hostEnd < 0 ? candidate.length : hostEnd;
    if (candidate.length > query.length &&
        candidate.slice(0, Math.min(query.length, hostLength)).toLowerCase() === query.slice(0, hostLength).toLowerCase() &&
        candidate.slice(hostLength, Math.max(hostLength, query.length)) === query.slice(hostLength)) {
      return query + candidate.slice(query.length);
    }
  }
  return "";
}

export function addHistoryActions(query, actions, matches, settings, promote = true) {
  if (!matches.length || !query.trim()) return actions;
  const seen = new Set(actions.flatMap(action => {
    try { return [new URL(action.tab?.url ?? action.url).href]; } catch { return []; }
  }));
  const history = [];
  for (const match of matches) {
    if (seen.has(match.url)) continue;
    seen.add(match.url);
    const url = new URL(match.url);
    const address = url.host + url.pathname;
    history.push({
      type: "history", id: "history:" + match.url, url: match.url,
      label: match.title || address, address, iconURL: url.origin + url.pathname, inline: historyInline(query, match.url),
    });
    if (history.length >= Math.min(HISTORY_LIMIT, settings.maxResults)) break;
  }
  // Never replace a confident tab switch or the exact address the user entered.
  // A URL prefix is a stronger intent signal than a title-only history match.
  if (promote && actions[0]?.type === "search") {
    const index = history.findIndex(action => action.inline);
    if (index >= 0) return [history[index], actions[0], ...actions.slice(1), ...history.filter((_, i) => i !== index)];
  }
  return [...actions, ...history];
}
