// Real-browser test harness: launches a Chromium-based browser with the built
// extension loaded and drives it over the Chrome DevTools Protocol. No
// dependencies — Node's built-in fetch, WebSocket, and http are enough.
//
// Branded Google Chrome (137+) ignores --load-extension, so point
// LINKTRAIL_BROWSER at Chrome for Testing, Chromium, or Microsoft Edge.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bucketOf } from '../../storage.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const EXT_DIR = resolve(import.meta.dirname, '..', '..', 'dist', 'chrome');

const BROWSER_CANDIDATES = [
  process.env.LINKTRAIL_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean);

export function findBrowser() {
  const found = BROWSER_CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error('No browser for e2e tests. Set LINKTRAIL_BROWSER to Chrome for Testing, Chromium, or Edge.');
  }
  return found;
}

/** Poll `fn` until it returns a truthy value or the timeout passes. */
export async function waitFor(fn, { timeout = 10000, interval = 150, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${message} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

class Client {
  static async connect(wsUrl) {
    const c = new Client();
    c.ws = new WebSocket(wsUrl);
    c.nextId = 0;
    c.pending = new Map();
    c.listeners = new Map();
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = rej; });
    c.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.method) for (const fn of c.listeners.get(m.method) ?? []) fn(m.params);
      const p = m.id && c.pending.get(m.id);
      if (!p) return;
      c.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    };
    c.ws.onclose = () => {
      for (const p of c.pending.values()) p.reject(new Error('connection closed'));
      c.pending.clear();
      c.closed = true;
    };
    return c;
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('connection closed'));
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  close() {
    if (!this.closed) this.ws.close();
  }
}

/** A tiny local web server. Every path is a page; ?title= sets its title. */
function startSiteServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const title = url.searchParams.get('title') || `Page ${url.pathname}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>${title.replace(/[<&]/g, '')}</title><p>${url.pathname}</p>`);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let nextPort = 9400 + (process.pid % 200);

export class Session {
  /** Launch a fresh browser profile with the extension at `extDir` loaded. */
  static async start({ extDir = EXT_DIR, profileDir } = {}) {
    if (!existsSync(join(extDir, 'manifest.json'))) {
      throw new Error(`No built extension at ${extDir}. Run "npm run build" first.`);
    }
    const s = new Session();
    s.extDir = extDir;
    s.ownsProfile = !profileDir;
    s.profileDir = profileDir ?? mkdtempSync(join(tmpdir(), 'linktrail-e2e-'));
    s.port = nextPort++;
    s.proc = spawn(findBrowser(), [
      '--headless=new',
      `--user-data-dir=${s.profileDir}`,
      `--remote-debugging-port=${s.port}`,
      `--load-extension=${extDir}`,
      `--disable-extensions-except=${extDir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-sync',
      '--disable-background-networking', '--disable-component-update',
      // Extra flags, e.g. "--no-sandbox" on CI runners that disallow sandboxing.
      ...(process.env.LINKTRAIL_BROWSER_ARGS ?? '').split(/\s+/).filter(Boolean),
      'about:blank'
    ], { stdio: 'ignore' });
    s.base = `http://127.0.0.1:${s.port}`;
    await waitFor(() => fetch(`${s.base}/json/version`).then(r => r.ok), { timeout: 15000, message: 'browser to start' });
    const site = await startSiteServer();
    s.site = site.server;
    s.sitePort = site.port;
    await s.worker(); // also resolves the extension id
    return s;
  }

  /** URL on the local test site. Use a *.localhost host to vary domains. */
  url(path, { host = '127.0.0.1', title } = {}) {
    const u = new URL(`http://${host}:${this.sitePort}${path}`);
    if (title) u.searchParams.set('title', title);
    return u.href;
  }

  async targets() {
    return (await fetch(`${this.base}/json/list`)).json();
  }

  /** Connection to LinkTrail's service worker, reconnecting if it restarted. */
  async worker() {
    if (this._worker && !this._worker.closed) return this._worker;
    const target = await waitFor(async () => {
      for (const t of await this.targets()) {
        if (t.type !== 'service_worker' || !t.url.endsWith('/background.js')) continue;
        const c = await Client.connect(t.webSocketDebuggerUrl);
        const name = await c.eval('typeof chrome !== "undefined" && chrome.runtime?.getManifest?.().name').catch(() => null);
        if (name === 'LinkTrail') { this._worker = c; return t; }
        c.close();
      }
      // Wake the worker if it went idle.
      if (this.extId) await this.openRaw(`chrome-extension://${this.extId}/manifest.json`).then(t => this.closeTarget(t.id));
      return null;
    }, { timeout: 20000, message: 'LinkTrail service worker (extension not loaded? branded Chrome ignores --load-extension)' });
    this.extId = new URL(target.url).host;
    await waitFor(() => this._worker.eval('!!chrome.storage?.local'), { message: 'extension APIs' });
    return this._worker;
  }

  async evalWorker(expression) {
    try {
      return await (await this.worker()).eval(expression);
    } catch (err) {
      if (!/connection closed|Cannot find context|Target closed/i.test(err.message)) throw err;
      this._worker = null; // worker restarted; retry once on a fresh connection
      return (await this.worker()).eval(expression);
    }
  }

  storage() {
    return this.evalWorker('chrome.storage.local.get(null)');
  }

  /** Saved links as url -> record, read from LinkTrail's storage buckets. */
  async links() {
    const all = await this.storage();
    return Object.assign({}, ...Object.entries(all)
      .filter(([key, value]) => key.startsWith('links:') && value && typeof value === 'object')
      .map(([, bucket]) => bucket));
  }

  /** Store links (url -> record) directly, as if LinkTrail had saved them. */
  seedLinks(links) {
    const buckets = {};
    for (const [url, record] of Object.entries(links)) (buckets[bucketOf(url)] ??= {})[url] = record;
    return this.evalWorker(`chrome.storage.local.set(${JSON.stringify(buckets)}).then(() => 'ok', e => 'error: ' + e.message)`);
  }

  setStorage(items) {
    return this.evalWorker(`chrome.storage.local.set(${JSON.stringify(items)})`);
  }

  /** Fire the periodic snapshot now (a one-shot alarm with the same name). */
  async heartbeat() {
    await this.evalWorker(`chrome.alarms.create('snapshot', { when: Date.now() })`);
  }

  async openRaw(url) {
    return (await fetch(`${this.base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  }

  closeTarget(id) {
    return fetch(`${this.base}/json/close/${id}`);
  }

  /** Open a web page in a new tab; resolves once it has loaded. */
  async open(url) {
    const t = await this.openRaw(url);
    const c = await Client.connect(t.webSocketDebuggerUrl);
    await waitFor(() => c.eval('document.readyState === "complete"'), { message: `load of ${url}` });
    return { id: t.id, client: c, close: () => { c.close(); return this.closeTarget(t.id); } };
  }

  /** Open an extension page (popup.html, options.html) in a tab. */
  async page(path) {
    const t = await this.openRaw(`chrome-extension://${this.extId}/${path}`);
    const c = await Client.connect(t.webSocketDebuggerUrl);
    await waitFor(() => c.eval('document.readyState === "complete"'), { message: path });
    await sleep(300); // let the page's async init finish
    c.targetId = t.id;
    c.closeTab = () => { c.close(); return this.closeTarget(t.id); };
    return c;
  }

  /** Browser-level connection (downloads, etc.). */
  async browserClient() {
    if (this._browser && !this._browser.closed) return this._browser;
    const { webSocketDebuggerUrl } = await (await fetch(`${this.base}/json/version`)).json();
    this._browser = await Client.connect(webSocketDebuggerUrl);
    return this._browser;
  }

  async close() {
    for (const c of [this._worker, this._browser]) c?.close();
    this.site?.close();
    if (this.proc.exitCode === null) {
      const exited = new Promise(r => this.proc.once('exit', r));
      this.proc.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    if (this.ownsProfile) {
      for (let i = 0; i < 10; i++) {
        try { rmSync(this.profileDir, { recursive: true, force: true }); break; } catch { await sleep(300); }
      }
    }
  }
}
