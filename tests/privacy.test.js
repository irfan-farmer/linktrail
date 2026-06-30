import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUrl, hostOf, shouldCapture } from '../privacy.js';

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

test('sanitizeUrl returns null for unparseable input', () => {
  assert.equal(sanitizeUrl('not a url'), null);
  assert.equal(sanitizeUrl(''), null);
});

test('hostOf returns a lowercased hostname or null', () => {
  assert.equal(hostOf('https://Example.COM/x'), 'example.com');
  assert.equal(hostOf('garbage'), null);
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

test('shouldCapture ignores empty/whitespace exclude entries', () => {
  assert.equal(shouldCapture('https://example.com', ['', '  ']), true);
});
