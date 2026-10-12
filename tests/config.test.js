import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, LIMITS, normalizeConfig } from '../config.js';

test('missing or non-object input yields the defaults', () => {
  for (const raw of [undefined, null, 'nope', 42, []]) {
    assert.deepEqual(normalizeConfig(raw), { ...DEFAULT_CONFIG, excludedDomains: [] });
  }
});

test('blank numeric fields fall back to defaults instead of 0 (regression: wiped journal)', () => {
  const config = normalizeConfig({ maxLinks: '', snapshotMinutes: '', eventDelayMs: '' });
  assert.equal(config.maxLinks, DEFAULT_CONFIG.maxLinks);
  assert.equal(config.snapshotMinutes, DEFAULT_CONFIG.snapshotMinutes);
  assert.equal(config.eventDelayMs, DEFAULT_CONFIG.eventDelayMs);
});

test('numbers are clamped to safe ranges and rounded', () => {
  const low = normalizeConfig({ maxLinks: 0, snapshotMinutes: -5, eventDelayMs: -1 });
  assert.equal(low.maxLinks, LIMITS.maxLinks[0]);
  assert.equal(low.snapshotMinutes, LIMITS.snapshotMinutes[0]);
  assert.equal(low.eventDelayMs, 0);

  const high = normalizeConfig({ maxLinks: 1e9, snapshotMinutes: 1e9, eventDelayMs: 1e9 });
  assert.equal(high.maxLinks, LIMITS.maxLinks[1]);
  assert.equal(high.snapshotMinutes, LIMITS.snapshotMinutes[1]);
  assert.equal(high.eventDelayMs, LIMITS.eventDelayMs[1]); // below the MV3 worker timeout

  assert.equal(normalizeConfig({ snapshotMinutes: '7.6' }).snapshotMinutes, 8);
});

test('non-numeric and boolean values in numeric fields fall back to defaults', () => {
  const config = normalizeConfig({ maxLinks: 'lots', snapshotMinutes: true, eventDelayMs: NaN });
  assert.equal(config.maxLinks, DEFAULT_CONFIG.maxLinks);
  assert.equal(config.snapshotMinutes, DEFAULT_CONFIG.snapshotMinutes);
  assert.equal(config.eventDelayMs, DEFAULT_CONFIG.eventDelayMs);
});

test('booleans must really be booleans', () => {
  const config = normalizeConfig({ captureEnabled: 'false', storeFullUrl: 1, storeTitles: false });
  assert.equal(config.captureEnabled, true);
  assert.equal(config.storeFullUrl, false);
  assert.equal(config.storeTitles, false);
});

test('excluded domains are normalized and invalid ones dropped', () => {
  const config = normalizeConfig({ excludedDomains: ['https://www.Bank.com/x', 'bad entry', 'bank.com'] });
  assert.deepEqual(config.excludedDomains, ['bank.com']);
  assert.deepEqual(normalizeConfig({ excludedDomains: 'bank.com' }).excludedDomains, []);
});

test('unknown keys are dropped', () => {
  assert.equal('evil' in normalizeConfig({ evil: 1 }), false);
});
