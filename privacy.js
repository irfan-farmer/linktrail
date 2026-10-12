// Privacy & security rules. Pure functions (no browser APIs) so the behaviour is
// easy to read, audit, and test.
//
// URLs are the dangerous part of a tab: query strings and fragments routinely
// carry session tokens, password-reset links, and search terms. By default only
// origin + path is kept (e.g. "https://mail.example.com/inbox"); credentials are
// always removed. Titles can also contain personal data (an inbox title often
// shows your email address), so storing them is a separate, switchable setting.

const WEB_SCHEMES = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const HOSTNAME = /^[a-z0-9.-]+$/;

/** True for http/https URLs — the only kind TabJournal stores or opens. */
export function isWebUrl(rawUrl) {
  try {
    return WEB_SCHEMES.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

/**
 * Redact a URL for storage. Returns null for non-web or unparseable URLs.
 * - Default: origin + path only (query, fragment, and credentials removed).
 * - storeFullUrl: keep query and fragment, still strip credentials. Falls back
 *   to origin + path if the full URL is unreasonably long.
 */
export function sanitizeUrl(rawUrl, storeFullUrl = false) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!WEB_SCHEMES.has(u.protocol)) return null;

  u.username = '';
  u.password = '';
  const short = u.origin + u.pathname;
  const url = storeFullUrl && u.href.length <= MAX_URL_LENGTH ? u.href : short;
  return url.length <= MAX_URL_LENGTH ? url : null;
}

/** Title as stored: trimmed and length-capped, or null when titles are off. */
export function cleanTitle(title, storeTitles = true) {
  if (!storeTitles || typeof title !== 'string') return null;
  const t = title.trim();
  return t ? t.slice(0, MAX_TITLE_LENGTH) : null;
}

/**
 * Turn whatever a user typed into a bare hostname, or null if it isn't one.
 * Accepts "bank.com", "https://bank.com/login", "BANK.COM:443", "*.bank.com",
 * and "www.bank.com" — all become "bank.com" (subdomains match later anyway).
 */
export function normalizeDomain(entry) {
  const s = String(entry ?? '').trim().toLowerCase().replace(/^\*\./, '');
  if (!s) return null;

  let host;
  try {
    host = new URL(s.includes('://') ? s : `http://${s}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  return host && HOSTNAME.test(host) ? host : null;
}

/** Normalize a list of user entries; blank lines are dropped silently. */
export function normalizeDomains(entries) {
  const valid = new Set();
  const invalid = [];
  for (const entry of entries) {
    if (!String(entry ?? '').trim()) continue;
    const domain = normalizeDomain(entry);
    if (domain) valid.add(domain);
    else invalid.push(String(entry).trim());
  }
  return { valid: [...valid], invalid };
}

/**
 * Whether a URL may be journaled: http/https only (never browser-internal,
 * extension, or file pages) and not on an excluded domain or its subdomains.
 */
export function shouldCapture(rawUrl, excludedDomains = []) {
  if (!isWebUrl(rawUrl)) return false;
  const host = new URL(rawUrl).hostname.replace(/\.$/, '');
  return !excludedDomains.some(entry => {
    const d = normalizeDomain(entry);
    return d && (host === d || host.endsWith('.' + d));
  });
}
