import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle,
  isWebUrl,
  normalizeDomain,
  normalizeDomains,
  sanitizeUrl,
  shouldCapture
} from '../privacy.js';

test('sanitizeUrl strips query, fragment, and credentials by default', () => {
  assert.equal(
    sanitizeUrl('https://user:pass@example.com/path?token=secret123#frag'),
    'https://example.com/path'
  );
  assert.equal(
    sanitizeUrl('https://accounts.example.com/reset?code=abcd'),
    'https://accounts.example.com/reset'
  );
});

test('sanitizeUrl with storeFullUrl keeps query/fragment but still strips credentials', () => {
  assert.equal(
    sanitizeUrl('https://user:pass@example.com/a?b=1#c', true),
    'https://example.com/a?b=1#c'
  );
});

test('sanitizeUrl falls back to origin+path when a full URL is huge', () => {
  const long = `https://example.com/p?q=${'x'.repeat(5000)}`;
  assert.equal(sanitizeUrl(long, true), 'https://example.com/p');
});

test('sanitizeUrl rejects non-web and unparseable URLs', () => {
  assert.equal(sanitizeUrl('file:///C:/secret.txt'), null);
  assert.equal(sanitizeUrl('chrome://extensions'), null);
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('not a url'), null);
  assert.equal(sanitizeUrl(''), null);
});

test('isWebUrl accepts only http/https', () => {
  assert.equal(isWebUrl('https://example.com'), true);
  assert.equal(isWebUrl('http://localhost:3000'), true);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('data:text/html,hi'), false);
  assert.equal(isWebUrl(undefined), false);
});

test('cleanTitle trims, caps length, and honours storeTitles', () => {
  assert.equal(cleanTitle('  Inbox  '), 'Inbox');
  assert.equal(cleanTitle('x'.repeat(1000)).length, 300);
  assert.equal(cleanTitle('Inbox (3) - me@example.com', false), null);
  assert.equal(cleanTitle('   '), null);
  assert.equal(cleanTitle(undefined), null);
});

test('normalizeDomain accepts what people actually paste', () => {
  for (const entry of [
    'bank.com',
    'https://bank.com',
    'https://bank.com/login?x=1',
    'bank.com/',
    'BANK.COM ',
    'bank.com:443',
    'www.bank.com',
    '*.bank.com',
    'bank.com.'
  ]) {
    assert.equal(normalizeDomain(entry), 'bank.com', `entry: ${JSON.stringify(entry)}`);
  }
  assert.equal(normalizeDomain('mail.google.com'), 'mail.google.com');
  assert.equal(normalizeDomain('localhost'), 'localhost');
});

test('normalizeDomain rejects garbage', () => {
  for (const entry of ['', '   ', 'has space.com', 'http://', '@@@', null, undefined]) {
    assert.equal(normalizeDomain(entry), null, `entry: ${JSON.stringify(entry)}`);
  }
});

test('normalizeDomains de-duplicates and reports invalid entries, ignoring blanks', () => {
  const { valid, invalid } = normalizeDomains(['bank.com', 'https://www.bank.com/', '', 'bad domain', '  ']);
  assert.deepEqual(valid, ['bank.com']);
  assert.deepEqual(invalid, ['bad domain']);
});

test('shouldCapture allows only http/https pages', () => {
  assert.equal(shouldCapture('https://example.com'), true);
  assert.equal(shouldCapture('http://localhost:3000/app'), true);
  assert.equal(shouldCapture('chrome://extensions'), false);
  assert.equal(shouldCapture('file:///C:/secret.txt'), false);
  assert.equal(shouldCapture('about:blank'), false);
  assert.equal(shouldCapture('not a url'), false);
});

test('shouldCapture excludes a domain and its subdomains, but not look-alikes', () => {
  const excluded = ['example.com'];
  assert.equal(shouldCapture('https://example.com/x', excluded), false);
  assert.equal(shouldCapture('https://mail.example.com/x', excluded), false);
  assert.equal(shouldCapture('https://notexample.com/x', excluded), true);
});

test('shouldCapture honours exclusions written as full URLs (regression)', () => {
  const excluded = ['https://www.bank.com/login'];
  assert.equal(shouldCapture('https://bank.com/accounts', excluded), false);
  assert.equal(shouldCapture('https://online.bank.com/', excluded), false);
});

test('shouldCapture ignores empty/whitespace exclude entries', () => {
  assert.equal(shouldCapture('https://example.com', ['', '  ']), true);
});
