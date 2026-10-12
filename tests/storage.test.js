import { test } from 'node:test';
import assert from 'node:assert/strict';

// In-memory stand-in for browser.storage.local with a real byte quota. Every
// call yields to the event loop like the real async API, so unsynchronized
// operations really interleave.
const data = {};
let quotaBytes = Infinity;
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
const bytesOf = obj => Object.entries(obj).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
const keysOf = keys => (keys === null || keys === undefined ? Object.keys(data) : [].concat(keys));

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        await tick();
        const out = {};
        for (const key of keysOf(keys)) if (key in data) out[key] = structuredClone(data[key]);
        return out;
      },
      async set(items) {
        await tick();
        if (bytesOf({ ...data, ...items }) > quotaBytes) throw new Error('QUOTA_BYTES quota exceeded');
        Object.assign(data, structuredClone(items));
      },
      async remove(keys) {
        await tick();
        for (const key of [].concat(keys)) delete data[key];
      }
    }
  }
};

const {
  bucketOf, clearLinks, enforceCap, enqueue, readAllLinks, readLinks, replaceLinks, saveLinks
} = await import('../storage.js');

const reset = () => { for (const key of Object.keys(data)) delete data[key]; quotaBytes = Infinity; };
const rec = lastSeen => ({ title: null, firstSeen: lastSeen, lastSeen });
const seed = n => {
  for (let i = 0; i < n; i++) {
    const url = `https://s${i}.test/`;
    (data[bucketOf(url)] ??= {})[url] = rec(i);
  }
  data.linktrail_meta = { count: n };
};
const count = async () => Object.keys(await readAllLinks()).length;
const bucketKeys = () => Object.keys(data).filter(k => k.startsWith('links:'));

// A snapshot-shaped task: read, then (after more async work) write back.
const addLink = url => enqueue(async () => {
  await readLinks([url]);
  await tick();
  await saveLinks({ [url]: rec(Date.now()) }, 1, 1000);
});
const clearAll = () => enqueue(() => clearLinks());

test('bucketOf is stable and spreads urls over the buckets', () => {
  assert.equal(bucketOf('https://a.test/'), bucketOf('https://a.test/'));
  assert.match(bucketOf('https://a.test/'), /^links:\d{1,3}$/);
  const used = new Set(Array.from({ length: 5000 }, (_, i) => bucketOf(`https://site${i}.test/page`)));
  assert.ok(used.size > 250, `5000 urls should use nearly all 256 buckets, used ${used.size}`);
});

test('records are stored in buckets and readable individually or all at once', async () => {
  reset();
  await saveLinks({ 'https://a.test/': rec(1), 'https://b.test/': rec(2) }, 2, 1000);
  assert.ok(bucketKeys().length >= 1 && bucketKeys().length <= 2);
  assert.deepEqual(await readLinks(['https://b.test/', 'https://missing.test/']), { 'https://b.test/': rec(2) });
  assert.deepEqual(Object.keys(await readAllLinks()).sort(), ['https://a.test/', 'https://b.test/']);
  assert.deepEqual(data.linktrail_meta, { count: 2 });
});

test('saving one link rewrites only its own bucket', async () => {
  reset();
  seed(2000);
  const before = structuredClone(data);
  await saveLinks({ 'https://new.test/': rec(9999) }, 1, 5000);
  const changed = Object.keys(data).filter(k => k.startsWith('links:') && JSON.stringify(data[k]) !== JSON.stringify(before[k]));
  assert.deepEqual(changed, [bucketOf('https://new.test/')]);
});

test('a delete queued behind an in-flight write is not undone by it (regression)', async () => {
  reset();
  seed(3);
  const write = addLink('https://new.test/'); // reads first
  const clear = clearAll();                   // user clicks Delete meanwhile
  await Promise.all([write, clear]);
  assert.equal(await count(), 0, 'deleted data must stay deleted');
  assert.deepEqual(data.linktrail_meta, { count: 0 });
});

test('clearLinks removes every storage format and keeps settings', async () => {
  reset();
  seed(20);
  Object.assign(data, { tab_journal: [], tab_journal_links: {}, linktrail_links: {}, linktrail_config: { maxLinks: 100 } });
  await clearLinks();
  assert.deepEqual(Object.keys(data).sort(), ['linktrail_config', 'linktrail_meta']);
});

test('concurrent writes never drop each other', async () => {
  reset();
  await Promise.all(Array.from({ length: 10 }, (_, i) => addLink(`https://c${i}.test/`)));
  assert.equal(await count(), 10);
  assert.equal(data.linktrail_meta.count, 10);
});

test('a failing task does not break the queue', async () => {
  reset();
  await assert.rejects(enqueue(() => { throw new Error('boom'); }));
  await addLink('https://after.test/');
  assert.equal(await count(), 1);
});

test('saveLinks evicts the least recently seen links beyond maxLinks', async () => {
  reset();
  seed(10);
  await saveLinks({ 'https://new.test/': rec(100) }, 1, 4);
  assert.deepEqual(Object.keys(await readAllLinks()).sort(), [
    'https://new.test/', 'https://s7.test/', 'https://s8.test/', 'https://s9.test/'
  ]);
  assert.deepEqual(data.linktrail_meta, { count: 4 });
});

test('a missing count is repaired by a full recount', async () => {
  reset();
  seed(5);
  delete data.linktrail_meta;
  await saveLinks({ 'https://new.test/': rec(100) }, 1, 1000);
  assert.deepEqual(data.linktrail_meta, { count: 6 });
  await enforceCap(1000);
  assert.deepEqual(data.linktrail_meta, { count: 6 });
});

test('a full storage quota is recovered by evicting old links until the write fits', async () => {
  reset();
  seed(300);
  quotaBytes = bytesOf(data) + 40; // full: the next record doesn't fit
  await saveLinks({ 'https://fresh.test/': rec(10_000) }, 1, 1000);
  const links = await readAllLinks();
  assert.ok('https://fresh.test/' in links, 'the new link is saved');
  assert.ok(!('https://s0.test/' in links), 'the oldest links made room');
  assert.ok(Object.keys(links).length >= 250, 'only a small fraction was evicted');
  assert.equal(data.linktrail_meta.count, Object.keys(links).length);
});

test('replaceLinks makes storage match exactly, rewriting only changed buckets', async () => {
  reset();
  seed(50);
  const next = await readAllLinks();
  delete next['https://s1.test/'];
  next['https://s2.test/'] = { ...rec(2), title: 'changed' };
  next['https://n.test/'] = rec(99);
  const before = structuredClone(data);
  await replaceLinks(next, 1000);
  assert.deepEqual(await readAllLinks(), next);
  assert.deepEqual(data.linktrail_meta, { count: 50 });
  const changed = bucketKeys().concat(Object.keys(before).filter(k => k.startsWith('links:')))
    .filter((k, i, all) => all.indexOf(k) === i && JSON.stringify(data[k]) !== JSON.stringify(before[k]));
  const expected = new Set(['https://s1.test/', 'https://s2.test/', 'https://n.test/'].map(bucketOf));
  assert.deepEqual(new Set(changed), expected);
});

test('corrupt buckets and records are ignored on read', async () => {
  reset();
  data[bucketOf('https://ok.test/')] = { 'https://ok.test/': rec(1), 'https://bad.test/': 'garbage' };
  data['links:999'] = 'not a bucket';
  const other = bucketOf('https://ok.test/') === 'links:0' ? 'links:1' : 'links:0';
  data[other] = ['an', 'array'];
  assert.deepEqual(Object.keys(await readAllLinks()), ['https://ok.test/']);
  assert.deepEqual(await readLinks(['https://bad.test/']), {});
});
