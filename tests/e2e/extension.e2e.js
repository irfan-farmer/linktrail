// End-to-end tests: the built extension running in a real Chromium browser.
// Run with `npm run test:e2e` (after `npm run build`).

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bucketOf } from '../../storage.js';
import { EXT_DIR, Session, sleep, waitFor } from './harness.js';

const has = (links, fragment) => Object.keys(links).some(u => u.includes(fragment));
const settle = () => sleep(2500); // > default event delay (2s)

/** Click "Delete all data" twice in the popup and wait for the result. */
async function deleteAllFromPopup(popup) {
  await popup.eval(`document.getElementById('clear').click()`);
  await sleep(200);
  await popup.eval(`document.getElementById('clear').click()`);
  await waitFor(() => popup.eval(`!document.getElementById('clear').disabled`), { message: 'delete to finish' });
}

describe('recording', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('records open pages, redacted, and never browser-internal pages', async () => {
    await s.open(s.url('/docs/guide?token=s3cret#top', { title: 'Guide' }));
    const links = await waitFor(async () => { const l = await s.links(); return has(l, '/docs/guide') && l; }, { message: 'page to be recorded' });
    assert.ok(!Object.keys(links).some(u => u.includes('s3cret') || u.includes('#top')), 'query/fragment must be stripped');
    assert.ok(Object.keys(links).every(u => u.startsWith('http')), 'only web pages are stored');
    assert.equal(links[s.url('/docs/guide')].title, 'Guide');
  });

  test('a burst of 25 tabs is recorded completely (no lost writes)', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.open(s.url(`/burst/${i}`))));
    await waitFor(async () => {
      const l = await s.links();
      return Array.from({ length: 25 }, (_, i) => `/burst/${i}`).every(p => has(l, p));
    }, { timeout: 15000, message: 'all 25 burst pages' });
  });

  test('the periodic alarm survives a manual heartbeat (self-healing)', async () => {
    await s.heartbeat();
    const alarm = await waitFor(async () => {
      const a = await s.evalWorker(`chrome.alarms.get('snapshot')`);
      return a?.periodInMinutes ? a : null;
    }, { message: 'periodic alarm to be restored' });
    assert.equal(alarm.periodInMinutes, 5);
  });
});

describe('delete all', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('deleted links stay deleted, including pages that are still open', async () => {
    const closed = await s.open(s.url('/closed-before-delete'));
    const stillOpen = await s.open(s.url('/still-open'));
    await waitFor(async () => { const l = await s.links(); return has(l, '/closed-before-delete') && has(l, '/still-open'); }, { message: 'both pages recorded' });
    await closed.close();

    const popup = await s.page('popup.html');
    await deleteAllFromPopup(popup);
    assert.deepEqual(await s.links(), {}, 'storage is empty right after delete');
    assert.match(await popup.eval(`document.getElementById('notice').textContent`), /won.t be saved again/, 'the popup explains what happens to open tabs');

    await s.heartbeat();
    await settle();
    const links = await s.links();
    assert.ok(!has(links, '/closed-before-delete'), 'a closed page must not come back');
    assert.ok(!has(links, '/still-open'), 'a page that was already open must not be re-saved just because it is still open');

    // Navigating that tab to a new page is new activity and is recorded.
    await stillOpen.client.eval(`location.href = ${JSON.stringify(s.url('/visited-after-delete'))}`);
    await waitFor(async () => has(await s.links(), '/visited-after-delete'), { message: 'new navigation recorded' });
    await popup.closeTab();
  });

  test('export after delete contains only what was visited since', async () => {
    const downloads = mkdtempSync(join(tmpdir(), 'linktrail-dl-'));
    try {
      const browser = await s.browserClient();
      await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
      const done = new Promise(res => browser.on('Browser.downloadProgress', p => p.state === 'completed' && res(p.guid)));
      const popup = await s.page('popup.html');
      await popup.eval(`document.getElementById('export').click()`);
      const guid = await Promise.race([done, sleep(10000).then(() => null)]);
      assert.ok(guid, 'export download completed');
      const exported = JSON.parse(readFileSync(join(downloads, guid), 'utf8'));
      const urls = exported.map(l => l.url);
      assert.ok(urls.some(u => u.includes('/visited-after-delete')));
      assert.ok(!urls.some(u => u.includes('/closed-before-delete') || u.includes('/still-open')), `export must not contain deleted links: ${urls}`);
      for (const l of exported) {
        assert.ok(Date.parse(l.firstSeen) && Date.parse(l.lastSeen), 'ISO timestamps');
      }
      await popup.closeTab();
    } finally {
      rmSync(downloads, { recursive: true, force: true });
    }
  });
});

describe('pause', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('pages opened while paused are not saved after resuming', async () => {
    const popup = await s.page('popup.html');
    await popup.eval(`document.getElementById('recording').click()`);
    await waitFor(async () => (await s.storage()).linktrail_config?.captureEnabled === false, { message: 'paused' });

    const privateTab = await s.open(s.url('/opened-while-paused'));
    await settle();
    assert.ok(!has(await s.links(), '/opened-while-paused'), 'nothing recorded while paused');

    await popup.eval(`document.getElementById('recording').click()`);
    await waitFor(async () => (await s.storage()).linktrail_config?.captureEnabled === true, { message: 'resumed' });
    await s.heartbeat();
    await settle();
    assert.ok(!has(await s.links(), '/opened-while-paused'), 'resuming must not retroactively save pages opened during the pause');

    await privateTab.client.eval(`location.href = ${JSON.stringify(s.url('/after-resume'))}`);
    await waitFor(async () => has(await s.links(), '/after-resume'), { message: 'recording after resume' });
    await popup.closeTab();
  });
});

describe('settings', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('saving the options page does not undo a pause made in the popup', async () => {
    const options = await s.page('options.html');
    const popup = await s.page('popup.html');
    await popup.eval(`document.getElementById('recording').click()`);
    await waitFor(async () => (await s.storage()).linktrail_config?.captureEnabled === false, { message: 'paused' });

    await options.eval(`document.getElementById('maxLinks').value = '1000'; document.getElementById('save').click()`);
    await waitFor(async () => (await s.storage()).linktrail_config?.maxLinks === 1000, { message: 'options saved' });
    assert.equal((await s.storage()).linktrail_config.captureEnabled, false, 'recording must stay paused');
    assert.equal(await options.eval(`document.getElementById('captureEnabled').checked`), false, 'options page reflects the pause');
    await popup.closeTab();
    await options.closeTab();
  });

  test('excluding a site that is open removes it and keeps it out', async () => {
    await s.setStorage({ linktrail_config: { captureEnabled: true } });
    await s.open(s.url('/account', { host: 'bank.localhost' }));
    await s.open(s.url('/news', { host: 'news.localhost' }));
    await waitFor(async () => { const l = await s.links(); return has(l, 'bank.localhost') && has(l, 'news.localhost'); }, { message: 'both recorded' });

    const options = await s.page('options.html');
    await options.eval(`document.getElementById('excludedDomains').value = 'https://www.bank.localhost/login'; document.getElementById('save').click()`);
    await waitFor(async () => !has(await s.links(), 'bank.localhost'), { message: 'excluded site purged' });
    await s.heartbeat();
    await settle();
    const links = await s.links();
    assert.ok(!has(links, 'bank.localhost'), 'excluded site stays out');
    assert.ok(has(links, 'news.localhost'), 'other sites kept');
    await options.closeTab();
  });

  test('a blank number field saves a safe default', async () => {
    const options = await s.page('options.html');
    await options.eval(`document.getElementById('maxLinks').value = ''; document.getElementById('save').click()`);
    await waitFor(async () => (await s.storage()).linktrail_config?.maxLinks === 5000, { message: 'default maxLinks' });
    await options.closeTab();
  });
});

describe('popup', () => {
  let s;
  before(async () => {
    s = await Session.start();
    const now = Date.now();
    const links = {};
    for (let i = 0; i < 120; i++) links[`https://example${i}.test/page`] = { title: `Sample page ${i}`, firstSeen: now - i * 60000, lastSeen: now - i * 60000 };
    await s.seedLinks(links);
  });
  after(() => s?.close());

  test('shows the installed version', async () => {
    const popup = await s.page('popup.html');
    const text = await popup.eval('document.body.innerText');
    assert.match(text, /v1\.\d+\.\d+/, 'version visible for support/troubleshooting');
    await popup.closeTab();
  });

  test('says when only part of the history is listed', async () => {
    const popup = await s.page('popup.html');
    const text = await popup.eval('document.body.innerText');
    assert.match(text, /Showing 50 of 120/, 'user must know older links exist');
    await popup.closeTab();
  });

  test('results are reachable and openable with the keyboard', async () => {
    const popup = await s.page('popup.html');
    const focusable = await popup.eval(`[...document.querySelectorAll('#results li:not(.empty):not(.more)')].every(li => li.tabIndex >= 0 || li.querySelector('a,button'))`);
    assert.ok(focusable, 'every result must be keyboard-focusable');
    const before = (await s.targets()).filter(t => t.type === 'page').length;
    await popup.eval(`(() => { const s = document.getElementById('search'); s.value = 'Sample page 7'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await waitFor(async () => (await s.targets()).filter(t => t.type === 'page').length > before, { message: 'Enter in search opens the top result' });
    await popup.closeTab();
  });
});

describe('robustness', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('recovers from corrupt stored data', async () => {
    await s.setStorage({ 'links:0': 'garbage', 'links:1': { 'https://corrupt.test/': { lastSeen: 'x' } }, linktrail_config: 42 });
    await s.open(s.url('/after-corruption'));
    await waitFor(async () => has(await s.links(), '/after-corruption'), { message: 'recording after corruption' });
    const popup = await s.page('popup.html');
    assert.match(await popup.eval(`document.getElementById('info').textContent`), /saved link/);
    await popup.closeTab();
  });

  test('keeps recording when storage is near the browser quota', async () => {
    const bigTitle = 'x'.repeat(280);
    const links = {};
    for (let i = 0; i < 21000; i++) links[`https://filler${i}.test/${'p'.repeat(60)}`] = { title: bigTitle, firstSeen: i, lastSeen: i };
    await s.setStorage({ linktrail_config: { maxLinks: 50000 } });
    assert.equal(await s.seedLinks(links), 'ok');
    const bytes = await s.evalWorker(`chrome.storage.local.getBytesInUse(null)`);
    assert.ok(bytes > 8e6, `seeded ${bytes} bytes`);

    for (let i = 0; i < 5; i++) await s.open(s.url(`/near-quota/${i}`, { title: 'q'.repeat(300) }));
    await waitFor(async () => has(await s.links(), '/near-quota/4'), { timeout: 20000, message: 'new pages saved at quota' });
    const after = await s.evalWorker(`chrome.storage.local.getBytesInUse(null)`);
    assert.ok(after <= 10 * 1024 * 1024, `within quota: ${after}`);
  });

});

describe('upgrade', () => {
  // An update is simulated the way the browser sees one: the same extension
  // folder and profile, relaunched with a higher version. (chrome.runtime.reload()
  // would be simpler, but Chrome for Testing unloads command-line extensions on
  // reload instead of restarting them.)
  const profileDir = mkdtempSync(join(tmpdir(), 'linktrail-upgrade-profile-'));
  const extDir = mkdtempSync(join(tmpdir(), 'linktrail-upgrade-ext-'));
  let s;
  after(async () => {
    await s?.close();
    rmSync(profileDir, { recursive: true, force: true });
    rmSync(extDir, { recursive: true, force: true });
  });

  test('migrates TabJournal and LinkTrail 1.3 data on update and deletes the old keys', async () => {
    cpSync(EXT_DIR, extDir, { recursive: true });
    s = await Session.start({ extDir, profileDir });
    await s.setStorage({
      tab_journal_config: { excludedDomains: ['old-bank.test'] },
      tab_journal_links: { 'https://kept.test/a': { title: 'Kept', firstSeen: 1, lastSeen: 2 }, 'https://old-bank.test/x': { title: 'Bank', firstSeen: 1, lastSeen: 2 } },
      tab_journal: [{ ts: '2026-01-01T00:00:00Z', windows: { 1: [{ url: 'https://legacy.test/p?session=leak', title: 'Legacy' }] } }],
      linktrail_links: { 'https://v13.test/page': { title: 'From 1.3', firstSeen: 5, lastSeen: 6 } }
    });
    await s.evalWorker('chrome.storage.local.remove("linktrail_config")');
    await s.close();

    const manifestPath = join(extDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.version = manifest.version.replace(/d+$/, n => String(Number(n) + 1));
    writeFileSync(manifestPath, JSON.stringify(manifest));

    s = await Session.start({ extDir, profileDir });
    assert.equal(await s.evalWorker('chrome.runtime.getManifest().version'), manifest.version, 'running the updated version');
    const data = await waitFor(async () => { const d = await s.storage(); return !('tab_journal' in d) && !('linktrail_links' in d) && d; }, { timeout: 15000, message: 'migration' });
    const urls = Object.keys(await s.links());
    assert.ok(urls.includes('https://v13.test/page'), 'LinkTrail 1.3 single-key data migrated');
    assert.ok(urls.includes('https://kept.test/a'));
    assert.ok(urls.includes('https://legacy.test/p'), 'legacy URL migrated without its query string');
    assert.ok(!urls.some(u => u.includes('old-bank.test')), 'old exclusions applied');
    assert.ok(!['tab_journal', 'tab_journal_links', 'tab_journal_config', 'linktrail_links'].some(k => k in data), 'old keys removed');
    assert.deepEqual((await s.storage()).linktrail_config?.excludedDomains, ['old-bank.test'], 'old settings carried over');
  });
});

describe('performance at maximum size', () => {
  let s;
  before(async () => { s = await Session.start(); });
  after(() => s?.close());

  test('50,000 saved links: snapshot, popup, and search stay fast', async () => {
    const links = {};
    const now = Date.now();
    for (let i = 0; i < 50000; i++) links[`https://site${i % 900}.test/article/${i}`] = { title: `Article number ${i} about topic ${i % 97}`, firstSeen: now - i * 1000, lastSeen: now - i * 1000 };
    await s.setStorage({ linktrail_config: { maxLinks: 50000 } });
    assert.equal(await s.seedLinks(links), 'ok');

    const tab = await s.open(s.url('/perf-probe'));
    await waitFor(async () => has(await s.links(), '/perf-probe'), { timeout: 20000, message: 'probe recorded' });
    await sleep(3000); // let the one-time recount after seeding finish

    // Median of 5 heartbeats, timed inside the browser from trigger until the
    // probe's bucket is written (observed via storage.onChanged, so the
    // measurement itself doesn't load the storage it is measuring).
    const key = bucketOf(s.url('/perf-probe'));
    await s.evalWorker(`globalThis.__writes = []; globalThis.__fired = []; chrome.alarms.onAlarm.addListener(() => __fired.push(performance.now())); chrome.storage.onChanged.addListener(c => { if (c[${JSON.stringify(key)}]) __writes.push(performance.now()); }); true`);
    const timings = [];
    const alarmDelays = [];
    for (let i = 0; i < 5; i++) {
      const t0 = await s.evalWorker(`(() => { __writes.length = 0; __fired.length = 0; const t = performance.now(); chrome.alarms.create('snapshot', { when: Date.now() }); return t; })()`);
      const t1 = await waitFor(() => s.evalWorker('__writes[0]'), { timeout: 20000, interval: 20, message: 'heartbeat write' });
      const fired = await s.evalWorker('__fired[0]');
      timings.push(Math.round(t1 - fired)); // LinkTrail's own work, from alarm to write
      alarmDelays.push(Math.round(fired - t0)); // the browser's alarm scheduling, not ours
      await sleep(300);
    }
    const snapshotMs = timings.sort((a, b) => a - b)[2];

    const p0 = Date.now();
    const popup = await s.page('popup.html');
    await waitFor(() => popup.eval(`document.querySelectorAll('#results li').length > 0`), { message: 'popup render' });
    const popupMs = Date.now() - p0;

    const searchMs = await popup.eval(`(() => { const s = document.getElementById('search'); const t = performance.now(); s.value = 'topic 42'; s.dispatchEvent(new Event('input')); return performance.now() - t; })()`);
    console.log(`    perf: heartbeat work median ${snapshotMs}ms (${timings.join(", ")}; browser alarm delay ${alarmDelays.join(", ")}ms), popup open ${popupMs}ms, search ${searchMs.toFixed(1)}ms`);
    assert.ok(snapshotMs < 300, `heartbeat work took ${snapshotMs}ms`);
    assert.ok(popupMs < 3000, `popup took ${popupMs}ms`);
    assert.ok(searchMs < 150, `search took ${searchMs}ms`);
    await popup.closeTab();
    await tab.close();
  });
});
