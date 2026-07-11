import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('full dashboard message inbox exposes controls and email settings', () => {
  const html = read('dashboard.html');
  const js = read('js/dashboard.js');
  const nav = read('js/account-nav.js');
  assert.match(html, /id="msgThread"/);
  assert.match(html, /id="refreshMessages"/);
  assert.match(html, /data-customer-chat-open/);
  assert.match(html, /id="msgEmailUpdates"/);
  assert.match(js, /function wireMessageSettings/);
  assert.match(js, /notify_messages/);
  assert.match(js, /source === 'email_reply'/);
  assert.match(nav, /dashboard\.html#messages/);
});
