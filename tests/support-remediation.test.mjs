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
  const source = read('functions/_lib/resend-inbound.js');
  assert.match(source, /userId:\s*member\.id/);
  assert.match(source, /upsertInboundMessage/);
  assert.match(source, /adminMessageRecipients\)\(sb,\s*alertKind,\s*env\)/);
  // The alert is about a message, so it opens the inbox — not the notification
  // preferences staff used to land on.
  assert.match(source, /admin\.html#support`/);
  assert.doesNotMatch(source, /#support-settings/);
  assert.doesNotMatch(source, /staffRecipients\(env\)/);
});

test('admin support console has durable controls, live refresh, correct selection, and keyboard close', () => {
  // The inbox now lives in the one shared console rather than a second drawer in
  // admin.html; these assert the behaviours, not the old expression syntax.
  const source = read('js/admin-support.js');
  // Lifecycle: resolve, escalate, and escalate toggles back to open.
  assert.match(source, /selected\.status === "escalated"/);
  assert.match(source, /data-status="complete"/);
  assert.match(source, /data-status="\$\{escalated \? "open" : "escalated"\}"/);
  // Read-only staff get a notice instead of a reply box.
  assert.match(source, /const canWrite = staff\?\.role !== "read_only"/);
  assert.match(source, /read-only access/);
  assert.match(source, /setInterval\([\s\S]{0,200}loadThreads/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /aria-pressed/);
  // Settings are a view of this console, not a page it links out to: the gear is
  // a toggle, and nothing here navigates staff away from the drawer.
  assert.match(source, /data-support-settings-toggle/);
  assert.doesNotMatch(source, /admin\.html#support/);
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
  assert.match(support, /link\.textContent = "Customer support"/);
  assert.match(read('js/main/chrome.js'), /site-support__launcher, \.customer-chat__toggle/);
  // The staff menu opens this console in place; its href is only the fallback
  // for routes where the console suppresses itself.
  assert.match(read('js/account-nav.js'), /'Customer support', 'admin\.html#support', 'data-support-open'/);
  assert.match(support, /\[data-support-open\]/);
  // Notification prefs are a view of the drawer. On a phone the drawer covered
  // the page they used to live on, so leaving the console to reach them was the
  // bug; the settings pane and its back affordance are the fix.
  assert.match(support, /site-support__settings/);
  assert.match(support, /data-support-pref/);
  assert.match(support, /data-support-back/);
  assert.match(support, /drawer\.dataset\.view/);
  assert.match(styles, /\.site-support__drawer\[data-view="settings"\] \.site-support__list-pane \{ display: none; \}/);
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
  assert.match(support, /routeSuppressesSupport/);
  assert.match(support, /masest:support-route/);
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
