// Privacy & security helpers.
//
// TabJournal stores tab URLs and titles. URLs are the dangerous part: query
// strings and fragments routinely carry session tokens, password-reset links,
// search terms, and other secrets. By default TabJournal therefore stores only
// the origin + path (e.g. "https://mail.example.com/inbox") and throws away the
// query string, fragment, and any embedded credentials. Users who want the full
// URL can opt in from the options page.
//
// These functions are intentionally pure (no browser APIs) so the redaction
// behaviour is simple to read, reason about, and audit.

const CAPTURABLE_SCHEMES = ['http:', 'https:'];

/**
 * Redact a URL for storage. Returns null if it can't be parsed.
 * - Default: origin + path only (query, fragment, and credentials removed).
 * - storeFullUrl: keep the full URL but still strip embedded credentials.
 */
export function sanitizeUrl(rawUrl, storeFullUrl = false) {
  try {
    const u = new URL(rawUrl);
    u.username = '';
    u.password = '';
    if (storeFullUrl) return u.href;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/** Hostname of a URL, or null. */
export function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a tab should be journaled at all. Only http/https pages are captured
 * (never browser-internal pages, extensions, or file://), and anything matching
 * the user's excluded-domains list is skipped — domain match also covers
 * subdomains (excluding "example.com" also excludes "mail.example.com").
 */
export function shouldCapture(rawUrl, excludedDomains = []) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!CAPTURABLE_SCHEMES.includes(u.protocol)) return false;

  const host = u.hostname.toLowerCase();
  return !excludedDomains.some(entry => {
    const d = String(entry).trim().toLowerCase();
    return d && (host === d || host.endsWith('.' + d));
  });
}
