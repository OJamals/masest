import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  messagePage,
  presenceIsFresh,
  supportThreadPatch,
} from '../functions/_lib/support-messages.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('message pages retain the newest rows and expose an older-page cursor', () => {
  const rows = [
    { id: '3', created_at: '2026-07-11T03:00:00.000Z' },
    { id: '2', created_at: '2026-07-11T02:00:00.000Z' },
    { id: '1', created_at: '2026-07-11T01:00:00.000Z' },
  ];
  assert.deepEqual(messagePage(rows, 2), {
    messages: [rows[1], rows[0]],
    has_more: true,
    next_before: rows[1].created_at,
  });
});

test('support lifecycle persists escalation and completion metadata', () => {
  assert.deepEqual(supportThreadPatch('escalated', 'staff-1', '2026-07-11T04:00:00.000Z'), {
    support_thread_status: 'escalated',
    support_thread_completed_at: null,
    support_thread_completed_by: null,
  });
  assert.equal(supportThreadPatch('complete', 'staff-1', '2026-07-11T04:00:00.000Z').support_thread_completed_by, 'staff-1');
  assert.equal(supportThreadPatch('bogus', 'staff-1'), null);
});

test('presence expires when a close/unload signal is lost', () => {
  const now = Date.parse('2026-07-11T05:00:00.000Z');
  assert.equal(presenceIsFresh('2026-07-11T04:59:40.000Z', now), true);
  assert.equal(presenceIsFresh('2026-07-11T04:58:00.000Z', now), false);
  assert.equal(presenceIsFresh(null, now), false);
});

test('inbound replies preserve buyer identity, reopen threads, honor staff prefs, and route to current support UI', () => {
  const source = read('functions/api/resend-webhook.js');
  assert.match(source, /user_id:\s*member\.id/);
  assert.match(source, /recordSupportMessage/);
  assert.match(source, /adminMessageRecipients\(sb,\s*alertKind,\s*env\)/);
  assert.match(source, /admin\.html#support-settings/);
  assert.doesNotMatch(source, /staffRecipients\(env\)/);
});

test('admin support drawer has durable controls, live refresh, correct selection, and keyboard close', () => {
  const source = read('js/admin/threads.js');
  assert.match(source, /status === 'escalated'/);
  assert.match(source, /secondaryStatus = status === 'escalated' \? 'open' : 'escalated'/);
  assert.match(source, /data-capability="admin\.write"/);
  assert.match(source, /setInterval\([^)]*renderThreads|setInterval\([\s\S]*renderThreads/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /setDrawer\(false\)[\s\S]*support-settings/);
});

test('customer chat links to full inbox and uses expiring keepalive presence', () => {
  const chat = read('js/customer-chat.js');
  const auth = read('js/auth.js');
  const account = read('functions/api/account/messages.js');
  assert.match(chat, /dashboard\.html#messages/);
  assert.match(chat, /keepalive:\s*true/);
  assert.match(chat, /presenceRequest = presenceRequest/);
  assert.match(chat, /account\?\.can_admin/);
  assert.match(chat, /initAdminSupport/);
  assert.match(auth, /keepalive/);
  assert.match(account, /support_chat_seen_at/);
});

test('public staff accounts receive a full support workspace instead of buyer chat', () => {
  const support = read('js/admin-support.js');
  const styles = read('css/admin-support.css');
  assert.match(support, /\/api\/admin\/messages/);
  assert.match(support, /\/api\/admin\/message-settings/);
  assert.match(support, /presenceRequest = presenceRequest/);
  assert.match(support, /Mark resolved/);
  assert.match(support, /Escalate/);
  assert.match(support, /Needs reply/);
  assert.match(support, /admin\.html#support-settings/);
  assert.match(support, /link\.textContent = "Customer support"/);
  assert.match(read('js/main/chrome.js'), /site-support__launcher, \.customer-chat__toggle/);
  assert.match(read('js/account-nav.js'), /'Customer support', 'admin\.html#support-settings'/);
  assert.match(styles, /height:\s*min\(620px, calc\(100dvh - 104px\)\)/);
  assert.match(styles, /\.site-support__drawer \{[\s\S]*padding:\s*0;/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /grid-template-columns:\s*minmax\(250px, 310px\) minmax\(0, 1fr\)/);
  assert.match(support, /site-support__empty/);
  assert.match(support, /aria-label="Customer support settings"/);
  assert.match(support, /site-support__conversation-toolbar/);
  assert.match(support, /site-support__conversation-body/);
  assert.match(support, /threadsLoaded/);
  assert.match(support, /site-support__skeleton/);
  assert.match(styles, /\.site-support__conversation-toolbar/);
  assert.match(styles, /\.site-support__conversation-empty/);
  assert.match(styles, /\.site-support__skeleton/);
  assert.doesNotMatch(support, /is-empty/);
  assert.doesNotMatch(styles, /\.site-support__drawer\.is-empty/);
});

test('buyer and staff inboxes page backward from the newest message', () => {
  const account = read('functions/api/account/messages.js');
  const admin = read('functions/api/admin/messages.js');
  const dashboard = read('js/dashboard.js');
  for (const source of [account, admin]) {
    assert.match(source, /order\('created_at', \{ ascending: false \}\)/);
    assert.match(source, /query\.lt\('created_at', before\)/);
    assert.match(source, /messagePage/);
  }
  assert.match(dashboard, /loadEarlierMessages/);
  assert.match(dashboard, /before=\$\{encodeURIComponent\(messageCursor\)\}/);
});
