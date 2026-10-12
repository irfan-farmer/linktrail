import { test } from 'node:test';
import assert from 'node:assert/strict';

// In-memory stand-in for browser.storage.local. Every call yields to the event
// loop, like the real async API, so unsynchronized operations really interleave.
const data = {};
let failNextSets = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        await tick();
        return key in data ? { [key]: structuredClone(data[key]) } : {};
      },
      async set(items) {
        await tick();
        if (failNextSets > 0) {
          failNextSets--;
          throw new Error('QUOTA_BYTES quota exceeded');
        }
        Object.assign(data, structuredClone(items));
      },
      async remove(keys) {
        await tick();
        for (const key of [].concat(keys)) delete data[key];
      }
    }
  }
};

const { LINKS_KEY, enqueue, readLinks, writeLinks } = await import('../storage.js');

const reset = () => { for (const key of Object.keys(data)) delete data[key]; };
const link = lastSeen => ({ title: null, firstSeen: lastSeen, lastSeen });

// A snapshot-shaped task: read, then (after more async work) write back.
const addLink = url => enqueue(async () => {
  const links = await readLinks();
  await tick();
  links[url] = link(Date.now());
  await writeLinks(links, 1000);
});
const clearAll = () => enqueue(() => chrome.storage.local.remove(LINKS_KEY));

test('a delete queued behind an in-flight write is not undone by it (regression)', async () => {
  reset();
  await writeLinks({ 'https://old.example.com/': link(1) }, 1000);

  const write = addLink('https://new.example.com/'); // reads the old data first
  const clear = clearAll();                          // user clicks Delete meanwhile
  await Promise.all([write, clear]);

  assert.deepEqual(await readLinks(), {}, 'deleted data must stay deleted');
});

test('writes queued after a delete start from an empty journal', async () => {
  reset();
  await writeLinks({ 'https://old.example.com/': link(1) }, 1000);
  await Promise.all([clearAll(), addLink('https://new.example.com/')]);
  assert.deepEqual(Object.keys(await readLinks()), ['https://new.example.com/']);
});

test('concurrent writes never drop each other', async () => {
  reset();
  await Promise.all(Array.from({ length: 10 }, (_, i) => addLink(`https://s${i}.example.com/`)));
  assert.equal(Object.keys(await readLinks()).length, 10);
});

test('a failing task does not break the queue', async () => {
  reset();
  await assert.rejects(enqueue(() => { throw new Error('boom'); }));
  await addLink('https://after.example.com/');
  assert.deepEqual(Object.keys(await readLinks()), ['https://after.example.com/']);
});

test('writeLinks caps the journal at maxLinks, evicting the oldest', async () => {
  reset();
  const links = {};
  for (let i = 0; i < 10; i++) links[`https://s${i}.example.com/`] = link(i);
  await writeLinks(links, 4);
  assert.deepEqual(Object.keys(await readLinks()).sort(), [
    'https://s6.example.com/', 'https://s7.example.com/', 'https://s8.example.com/', 'https://s9.example.com/'
  ]);
});

test('writeLinks recovers from a quota error by evicting the oldest 10%', async () => {
  reset();
  const links = {};
  for (let i = 0; i < 20; i++) links[`https://s${i}.example.com/`] = link(i);
  failNextSets = 1;
  await writeLinks(links, 1000);
  const stored = Object.keys(await readLinks());
  assert.equal(stored.length, 18);
  assert.equal(stored.includes('https://s0.example.com/'), false);
  assert.equal(stored.includes('https://s19.example.com/'), true);
});

test('readLinks tolerates corrupt stored data', async () => {
  reset();
  data[LINKS_KEY] = ['not', 'a', 'map'];
  assert.deepEqual(await readLinks(), {});
});
