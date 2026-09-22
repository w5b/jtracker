import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCookies } from '../src/cookies.js';

test('cookie browser policy, host/domain/path, expiry and SameSite', () => {
  const jar = new BrowserCookies();
  const url = 'https://a.example.com/narrow/path';
  for (const value of ['strict=1; SameSite=Strict; Secure; Path=/', 'lax=1; Path=/', 'none=1; SameSite=None; Secure; Path=/', 'path=1; Path=/narrow', 'host=1; Path=/', 'domain=1; Domain=example.com; Path=/']) assert.ok(jar.set(value, url));
  assert.equal(jar.set('bad=1; SameSite=None', url), false);
  assert.equal(jar.set('__Host-bad=1; Secure; Domain=example.com; Path=/', url), false);
  assert.equal(jar.set('psl=1; Domain=com', url), false);
  assert.equal(jar.set('partition=1; Secure; Partitioned', url), false);
  assert.equal(jar.get(url, { initiator: 'https://elsewhere.test' }), 'none=1');
  assert.match(jar.get(url, { initiator: 'https://elsewhere.test', navigation: true }), /lax=1/);
  assert.doesNotMatch(jar.get(url, { initiator: 'https://elsewhere.test', navigation: true }), /strict=1/);
  assert.doesNotMatch(jar.get('https://b.example.com/'), /host=1/);
  assert.match(jar.get('https://b.example.com/'), /domain=1/);
  assert.doesNotMatch(jar.get('http://a.example.com/'), /none=1/);
  jar.set('host=gone; Max-Age=0; Path=/', url);
  assert.doesNotMatch(jar.get(url), /host=/);
});
