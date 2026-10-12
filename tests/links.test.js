import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../config.js';
import {
  capture, mergeLinks, migrateSnapshots, oldestBeyond, planSnapshot, recordPages,
  remapSuppressed, scrubLinks, suppressAll, toSortedList
} from '../links.js';

const config = (overrides = {}) => normalizeConfig(overrides);
const tab = (url, title = 'Title', extra = {}) => ({ id: 1, url, title, incognito: false, ...extra });
const record = (tabs, existing = {}, now = 100, cfg = config()) => recordPages(existing, capture(tabs, cfg), now, cfg);

// --- capture and record ---------------------------------------------

test('capture never records private/incognito tabs (regression)', () => {
  assert.equal(capture([tab('https://secret.example.com/', 'Private', { incognito: true })], config()).size, 0);
});

test('capture skips non-web pages and excluded domains', () => {
  const pages = capture([
    tab('chrome://extensions'),
    tab('file:///C:/x.txt'),
    tab('https://online.bank.com/acct'),
    tab('https://example.com/ok')
  ], config({ excludedDomains: ['bank.com'] }));
  assert.deepEqual([...pages.keys()], ['https://example.com/ok']);
});

test('capture redacts addresses and collapses tabs that share one', () => {
  const pages = capture([
    tab('https://example.com/a?token=s3cret#x', 'A'),
    tab('https://example.com/a?other=1', '')
  ], config());
  assert.deepEqual([...pages], [['https://example.com/a', 'A']]);
});

test('recordPages creates new records and counts them', () => {
  const { records, added, changed } = record([tab('https://example.com/a', 'A')]);
  assert.equal(added, 1);
  assert.equal(changed, true);
  assert.deepEqual(records, { 'https://example.com/a': { title: 'A', firstSeen: 100, lastSeen: 100 } });
});

test('recordPages: an unchanged page refreshes lastSeen without counting as a change', () => {
  const existing = { 'https://example.com/a': { title: 'A', firstSeen: 100, lastSeen: 100 } };
  const { records, added, changed } = record([tab('https://example.com/a', 'A')], existing, 200);
  assert.equal(added, 0);
  assert.equal(changed, false);
  assert.deepEqual(records['https://example.com/a'], { title: 'A', firstSeen: 100, lastSeen: 200 });
});

test('recordPages: a new title counts as a change; a missing one keeps the old', () => {
  const existing = { 'https://example.com/a': { title: 'Loading…', firstSeen: 1, lastSeen: 1 } };
  assert.equal(record([tab('https://example.com/a', 'Real title')], existing).changed, true);
  assert.equal(record([tab('https://example.com/a', '')], existing).records['https://example.com/a'].title, 'Loading…');
});

test('recordPages never moves lastSeen backwards (clock changes)', () => {
  const existing = { 'https://example.com/a': { title: 'A', firstSeen: 1, lastSeen: 500 } };
  assert.equal(record([tab('https://example.com/a', 'A')], existing, 200).records['https://example.com/a'].lastSeen, 500);
});

test('recordPages with storeTitles off stores no titles, even for known links', () => {
  const cfg = config({ storeTitles: false });
  const existing = { 'https://mail.example.com/': { title: 'Inbox - me@example.com', firstSeen: 1, lastSeen: 1 } };
  assert.equal(record([tab('https://mail.example.com/', 'Inbox - me@example.com')], existing, 100, cfg).records['https://mail.example.com/'].title, null);
  assert.equal(record([tab('https://new.example.com/', 'New')], {}, 100, cfg).records['https://new.example.com/'].title, null);
});

test('oldestBeyond picks the least recently seen links over the cap', () => {
  const links = {
    'https://a.com/': { title: 'a', firstSeen: 1, lastSeen: 10 },
    'https://b.com/': { title: 'b', firstSeen: 1, lastSeen: 30 },
    'https://c.com/': { title: 'c', firstSeen: 1, lastSeen: 20 }
  };
  assert.deepEqual(oldestBeyond(links, 2), ['https://a.com/']);
  assert.deepEqual(oldestBeyond(links, 5), []);
  assert.equal(oldestBeyond(links, 0).length, 3);
});

test('one record per link keeps storage small (regression: 10 MB quota)', () => {
  let links = {};
  const open = Array.from({ length: 100 }, (_, i) => tab(`https://site${i}.example.com/page/path`, 'A fairly typical page title'));
  for (let beat = 0; beat < 1500; beat++) links = { ...links, ...record(open, links, beat * 300000).records };
  const bytes = JSON.stringify(links).length;
  assert.ok(bytes < 50_000, `100 open tabs over 1500 heartbeats should stay tiny, got ${bytes} bytes`);
});

// --- delete / pause semantics -----------------------------------------

const open = [
  { id: 1, url: 'https://a.test/' },
  { id: 2, url: 'https://b.test/' }
];

test('planSnapshot: while paused nothing is recorded', () => {
  const plan = planSnapshot(open, {}, false);
  assert.deepEqual(plan.tabs, []);
  assert.equal(plan.state.wasEnabled, false);
});

test('planSnapshot: the first pass after resuming records nothing and suppresses open tabs (regression)', () => {
  const plan = planSnapshot(open, { wasEnabled: false, suppressed: {} }, true);
  assert.deepEqual(plan.tabs, []);
  assert.deepEqual(plan.state, { wasEnabled: true, suppressed: { 1: 'https://a.test/', 2: 'https://b.test/' } });
});

test('planSnapshot: suppressed tabs stay skipped until they navigate (regression: delete all)', () => {
  const state = { wasEnabled: true, suppressed: suppressAll(open) };
  assert.deepEqual(planSnapshot(open, state, true).tabs, []);

  const navigated = [{ id: 1, url: 'https://a.test/next' }, open[1]];
  const plan = planSnapshot(navigated, state, true);
  assert.deepEqual(plan.tabs, [{ id: 1, url: 'https://a.test/next' }]);
  assert.deepEqual(plan.state.suppressed, { 2: 'https://b.test/' }, 'the navigated tab is no longer suppressed');
});

test('planSnapshot: suppressions for closed tabs are forgotten; new tabs are recorded', () => {
  const state = { wasEnabled: true, suppressed: suppressAll(open) };
  const plan = planSnapshot([open[0], { id: 3, url: 'https://c.test/' }], state, true);
  assert.deepEqual(plan.tabs, [{ id: 3, url: 'https://c.test/' }]);
  assert.deepEqual(plan.state.suppressed, { 1: 'https://a.test/' });
});

test('planSnapshot: no saved state (fresh install) records everything', () => {
  assert.deepEqual(planSnapshot(open, {}, true).tabs, open);
  assert.deepEqual(planSnapshot(open, { suppressed: 'junk' }, true).tabs, open);
  assert.deepEqual(planSnapshot(open, undefined, true).tabs, open);
});

test('remapSuppressed carries suppressions to restored tabs with new ids', () => {
  const state = { wasEnabled: true, suppressed: { 1: 'https://a.test/', 2: 'https://b.test/' } };
  const restored = [{ id: 41, url: 'https://a.test/' }, { id: 42, url: 'https://other.test/' }];
  assert.deepEqual(remapSuppressed(state, restored), { wasEnabled: true, suppressed: { 41: 'https://a.test/' } });
});

// --- privacy scrubs and migration -------------------------------------

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
