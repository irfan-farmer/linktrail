import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../config.js';
import { evictOldest, mergeLinks, migrateSnapshots, recordTabs, scrubLinks, toSortedList } from '../links.js';

const config = (overrides = {}) => normalizeConfig(overrides);
const tab = (url, title = 'Title', extra = {}) => ({ url, title, incognito: false, ...extra });

test('recordTabs never records private/incognito tabs (regression)', () => {
  const links = {};
  recordTabs(links, [tab('https://secret.example.com/', 'Private', { incognito: true })], config(), 1);
  assert.deepEqual(links, {});
});

test('recordTabs skips non-web pages and excluded domains', () => {
  const links = {};
  recordTabs(links, [
    tab('chrome://extensions'),
    tab('file:///C:/x.txt'),
    tab('https://online.bank.com/acct'),
    tab('https://example.com/ok')
  ], config({ excludedDomains: ['bank.com'] }), 1);
  assert.deepEqual(Object.keys(links), ['https://example.com/ok']);
});

test('recordTabs stores redacted URLs and reports new links', () => {
  const links = {};
  const changed = recordTabs(links, [tab('https://example.com/a?token=s3cret#x', 'A')], config(), 100);
  assert.equal(changed, true);
  assert.deepEqual(links, { 'https://example.com/a': { title: 'A', firstSeen: 100, lastSeen: 100 } });
});

test('recordTabs: unchanged tabs refresh lastSeen without counting as a change', () => {
  const links = {};
  recordTabs(links, [tab('https://example.com/a', 'A')], config(), 100);
  const changed = recordTabs(links, [tab('https://example.com/a', 'A')], config(), 200);
  assert.equal(changed, false);
  assert.deepEqual(links['https://example.com/a'], { title: 'A', firstSeen: 100, lastSeen: 200 });
});

test('recordTabs: a new title counts as a change', () => {
  const links = {};
  recordTabs(links, [tab('https://example.com/a', 'Loading…')], config(), 100);
  assert.equal(recordTabs(links, [tab('https://example.com/a', 'Real title')], config(), 200), true);
  assert.equal(links['https://example.com/a'].title, 'Real title');
});

test('recordTabs with storeTitles off stores no titles', () => {
  const links = {};
  recordTabs(links, [tab('https://mail.example.com/', 'Inbox - me@example.com')], config({ storeTitles: false }), 1);
  assert.equal(links['https://mail.example.com/'].title, null);
});

test('evictOldest removes the least recently seen links', () => {
  const links = {
    'https://a.com/': { title: 'a', firstSeen: 1, lastSeen: 10 },
    'https://b.com/': { title: 'b', firstSeen: 1, lastSeen: 30 },
    'https://c.com/': { title: 'c', firstSeen: 1, lastSeen: 20 }
  };
  assert.equal(evictOldest(links, 2), 1);
  assert.deepEqual(Object.keys(links).sort(), ['https://b.com/', 'https://c.com/']);
  assert.equal(evictOldest(links, 5), 0);
});

test('scrubLinks deletes already-saved links for newly excluded domains (regression)', () => {
  const links = {
    'https://online.bank.com/': { title: 'Bank', firstSeen: 1, lastSeen: 2 },
    'https://example.com/': { title: 'Ex', firstSeen: 1, lastSeen: 2 }
  };
  const result = scrubLinks(links, config({ excludedDomains: ['bank.com'] }));
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.links), ['https://example.com/']);
});

test('scrubLinks strips query strings when full URLs are switched off, merging duplicates', () => {
  const links = {
    'https://ex.com/p?a=1': { title: 'old', firstSeen: 5, lastSeen: 10 },
    'https://ex.com/p?a=2': { title: 'new', firstSeen: 1, lastSeen: 20 }
  };
  const result = scrubLinks(links, config({ storeFullUrl: false }));
  assert.equal(result.changed, true);
  assert.deepEqual(result.links, { 'https://ex.com/p': { title: 'new', firstSeen: 1, lastSeen: 20 } });
});

test('scrubLinks erases titles when titles are switched off', () => {
  const result = scrubLinks({ 'https://ex.com/': { title: 'T', firstSeen: 1, lastSeen: 2 } }, config({ storeTitles: false }));
  assert.equal(result.changed, true);
  assert.equal(result.links['https://ex.com/'].title, null);
});

test('scrubLinks reports no change when everything already complies', () => {
  const links = { 'https://ex.com/': { title: 'T', firstSeen: 1, lastSeen: 2 } };
  assert.equal(scrubLinks(links, config()).changed, false);
});

test('legacy snapshots migrate into redacted link records', () => {
  const legacy = [
    { ts: '2026-01-01T00:00:00.000Z', reason: 'alarm', windows: { 1: [
      { id: 7, url: 'https://ex.com/p?session=abc', title: 'First', active: true },
      { url: 'chrome://newtab', title: 'New Tab' }
    ] } },
    { ts: '2026-01-02T00:00:00.000Z', reason: 'alarm', windows: { 1: [
      { url: 'https://ex.com/p?session=abc', title: 'Second' }
    ] } },
    { ts: 'garbage', windows: { 1: [{ url: 'https://dropped.com/' }] } },
    null
  ];
  const { links } = scrubLinks(migrateSnapshots(legacy), config());
  assert.deepEqual(links, {
    'https://ex.com/p': {
      title: 'Second',
      firstSeen: Date.parse('2026-01-01T00:00:00.000Z'),
      lastSeen: Date.parse('2026-01-02T00:00:00.000Z')
    }
  });
});

test('mergeLinks folds an old link map in, keeping the widest time range and newest title', () => {
  const links = { 'https://ex.com/': { title: 'Current', firstSeen: 50, lastSeen: 300 } };
  mergeLinks(links, {
    'https://ex.com/': { title: 'Old', firstSeen: 10, lastSeen: 100 },
    'https://other.com/': { title: 'Other', firstSeen: 5, lastSeen: 6 }
  });
  assert.deepEqual(links, {
    'https://ex.com/': { title: 'Current', firstSeen: 10, lastSeen: 300 },
    'https://other.com/': { title: 'Other', firstSeen: 5, lastSeen: 6 }
  });
});

test('mergeLinks skips malformed records and non-map input', () => {
  const links = {};
  mergeLinks(links, {
    'https://bad1.com/': null,
    'https://bad2.com/': { title: 'x', firstSeen: 'yesterday', lastSeen: 2 },
    'https://good.com/': { title: 42, firstSeen: 1, lastSeen: 2 }
  });
  assert.deepEqual(links, { 'https://good.com/': { title: null, firstSeen: 1, lastSeen: 2 } });
  for (const junk of [undefined, null, 'str', ['a']]) assert.deepEqual(mergeLinks({}, junk), {});
});

test('toSortedList orders by most recently seen', () => {
  const list = toSortedList({
    'https://a.com/': { title: 'a', firstSeen: 1, lastSeen: 1 },
    'https://b.com/': { title: 'b', firstSeen: 1, lastSeen: 3 }
  });
  assert.deepEqual(list.map(l => l.url), ['https://b.com/', 'https://a.com/']);
});

test('one record per link keeps storage small (regression: 10 MB quota)', () => {
  const links = {};
  const tabs = Array.from({ length: 100 }, (_, i) => tab(`https://site${i}.example.com/page/path`, 'A fairly typical page title'));
  for (let beat = 0; beat < 1500; beat++) recordTabs(links, tabs, config(), beat * 300000);
  const bytes = JSON.stringify(links).length;
  assert.ok(bytes < 50_000, `100 open tabs over 1500 heartbeats should stay tiny, got ${bytes} bytes`);
});
