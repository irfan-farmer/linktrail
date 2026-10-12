// The saved-links data model. Pure functions only — no browser APIs — so every rule
// here is unit-tested.
//
// Saved links are a map of url -> { title, firstSeen, lastSeen } (epoch ms): one
// record per unique link, rather than repeated full snapshots of every tab.
// Unchanged tabs cost nothing extra, so history spans months instead of days.

import { cleanTitle, sanitizeUrl, shouldCapture } from './privacy.js';

function merge(a, b) {
  if (!a) return b;
  const newer = b.lastSeen >= a.lastSeen ? b : a;
  return {
    title: newer.title ?? a.title ?? b.title,
    firstSeen: Math.min(a.firstSeen, b.firstSeen),
    lastSeen: Math.max(a.lastSeen, b.lastSeen)
  };
}

/**
 * Decide which open tabs a snapshot may record, and the next snapshot state.
 *
 * - While paused, nothing is recorded.
 * - The first snapshot after resuming records nothing and marks every open tab
 *   as suppressed, so pages opened during the pause are never saved.
 * - A suppressed tab (also set by "Delete all") is skipped until its address
 *   changes, i.e. until the user navigates; suppressions for tabs that closed
 *   or navigated are forgotten.
 *
 * `state` is { wasEnabled, suppressed: { [tabId]: url } }.
 */
export function planSnapshot(tabs, state, captureEnabled) {
  const suppressed = state?.suppressed && typeof state.suppressed === 'object' ? state.suppressed : {};
  if (!captureEnabled) return { tabs: [], state: { wasEnabled: false, suppressed } };
  if (state?.wasEnabled === false) return { tabs: [], state: { wasEnabled: true, suppressed: suppressAll(tabs) } };

  const record = [];
  const kept = {};
  for (const tab of tabs) {
    if (Object.hasOwn(suppressed, tab.id) && suppressed[tab.id] === tab.url) kept[tab.id] = tab.url;
    else record.push(tab);
  }
  return { tabs: record, state: { wasEnabled: true, suppressed: kept } };
}

/** Suppress every given tab at its current address. */
export function suppressAll(tabs) {
  return Object.fromEntries(tabs.map(tab => [tab.id, tab.url]));
}

/**
 * After a browser restart tabs get new ids: carry suppressions over to the
 * restored tabs that are still at a suppressed address.
 */
export function remapSuppressed(state, tabs) {
  const urls = new Set(Object.values(state?.suppressed ?? {}));
  const suppressed = {};
  for (const tab of tabs) if (urls.has(tab.url)) suppressed[tab.id] = tab.url;
  return { ...state, suppressed };
}

/**
 * The pages worth recording among `tabs`, as url -> title, after the privacy
 * rules: private/incognito tabs, excluded domains, and non-web pages are
 * dropped; addresses are redacted; titles are cleaned (or null when off).
 */
export function capture(tabs, config) {
  const pages = new Map();
  for (const tab of tabs) {
    if (tab.incognito || !shouldCapture(tab.url, config.excludedDomains)) continue;
    const url = sanitizeUrl(tab.url, config.storeFullUrl);
    if (!url) continue;
    const title = cleanTitle(tab.title, config.storeTitles);
    if (!pages.has(url) || title) pages.set(url, title ?? pages.get(url) ?? null);
  }
  return pages;
}

/**
 * Merge captured pages (url -> title) into their existing records. Returns the
 * records to write, how many links are new, and whether anything changed
 * besides lastSeen (a new link or a new title).
 */
export function recordPages(existing, pages, now, { storeTitles = true } = {}) {
  const records = {};
  let added = 0;
  let changed = false;
  for (const [url, title] of pages) {
    const old = existing[url];
    if (!old) {
      records[url] = { title, firstSeen: now, lastSeen: now };
      added++;
      changed = true;
      continue;
    }
    const nextTitle = storeTitles ? title || old.title || null : null;
    if (nextTitle !== old.title) changed = true;
    records[url] = { title: nextTitle, firstSeen: old.firstSeen, lastSeen: Math.max(old.lastSeen, now) };
  }
  return { records, added, changed };
}

/** The least-recently-seen urls beyond `max`, i.e. the ones to evict. */
export function oldestBeyond(links, max) {
  const urls = Object.keys(links);
  const excess = urls.length - Math.max(0, max);
  if (excess <= 0) return [];
  urls.sort((a, b) => links[a].lastSeen - links[b].lastSeen);
  return urls.slice(0, excess);
}

/**
 * Re-apply the current privacy settings to already-stored links: remove newly
 * excluded domains, strip query strings when full URLs are switched off
 * (merging links that collapse to the same address), and erase titles when
 * titles are switched off. Returns a new map plus whether anything changed.
 */
export function scrubLinks(links, config) {
  const out = {};
  let changed = false;
  for (const [url, link] of Object.entries(links)) {
    const clean = shouldCapture(url, config.excludedDomains)
      ? sanitizeUrl(url, config.storeFullUrl)
      : null;
    if (!clean) {
      changed = true;
      continue;
    }
    const title = cleanTitle(link.title, config.storeTitles);
    if (clean !== url || title !== link.title) changed = true;
    out[clean] = merge(out[clean], { title, firstSeen: link.firstSeen, lastSeen: link.lastSeen });
  }
  return { links: out, changed };
}

/**
 * Fold a pre-1.2 snapshot history (array of { ts, windows }) into a link map.
 * The result still needs scrubLinks() to apply the current privacy settings.
 */
export function migrateSnapshots(snapshots, links = {}) {
  for (const entry of Array.isArray(snapshots) ? snapshots : []) {
    const ts = Date.parse(entry?.ts);
    if (!Number.isFinite(ts)) continue;
    for (const tabs of Object.values(entry.windows ?? {})) {
      for (const tab of Array.isArray(tabs) ? tabs : []) {
        if (typeof tab?.url !== 'string') continue;
        const title = typeof tab.title === 'string' ? tab.title : null;
        links[tab.url] = merge(links[tab.url], { title, firstSeen: ts, lastSeen: ts });
      }
    }
  }
  return links;
}

/**
 * Merge a stored link map (e.g. one saved under an older storage key) into
 * `links`, skipping malformed records. The result still needs scrubLinks().
 */
export function mergeLinks(links, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return links;
  for (const [url, link] of Object.entries(source)) {
    if (!Number.isFinite(link?.firstSeen) || !Number.isFinite(link?.lastSeen)) continue;
    const title = typeof link.title === 'string' ? link.title : null;
    links[url] = merge(links[url], { title, firstSeen: link.firstSeen, lastSeen: link.lastSeen });
  }
  return links;
}

/** Links as an array, most recently seen first. */
export function toSortedList(links) {
  return Object.entries(links)
    .map(([url, link]) => ({ url, ...link }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}
