// The saved-links data model. Pure functions only — no browser APIs — so every rule
// here is unit-tested.
//
// Saved links are a map of url -> { title, firstSeen, lastSeen } (epoch ms): one
// record per unique link, rather than repeated full snapshots of every tab.
// Unchanged tabs cost nothing extra, so history spans months instead of days
// and the stored data stays small enough to load instantly.

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
 * Record the given browser tabs into `links` (mutated in place). Private/
 * incognito tabs, excluded domains, and non-web pages are never recorded.
 * Returns true if a new link appeared or a stored title changed.
 */
export function recordTabs(links, tabs, config, now) {
  let changed = false;
  for (const tab of tabs) {
    if (tab.incognito) continue;
    if (!shouldCapture(tab.url, config.excludedDomains)) continue;
    const url = sanitizeUrl(tab.url, config.storeFullUrl);
    if (!url) continue;

    const title = cleanTitle(tab.title, config.storeTitles);
    const link = links[url];
    if (!link) {
      links[url] = { title, firstSeen: now, lastSeen: now };
      changed = true;
    } else {
      link.lastSeen = now;
      if (title && title !== link.title) {
        link.title = title;
        changed = true;
      }
    }
  }
  return changed;
}

/** Drop the least-recently-seen links beyond `max`. Returns how many were removed. */
export function evictOldest(links, max) {
  const urls = Object.keys(links);
  const excess = urls.length - max;
  if (excess <= 0) return 0;
  urls.sort((a, b) => links[a].lastSeen - links[b].lastSeen);
  for (const url of urls.slice(0, excess)) delete links[url];
  return excess;
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
