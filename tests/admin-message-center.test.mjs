import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { adminMessageAlertKind, adminMessageRecipients, sanitizeAdminMessagePrefs } from '../functions/_lib/admin-message-notifications.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin alert kinds separate first support requests from follow-ups', () => {
  assert.equal(adminMessageAlertKind({ previousMessage: null, threadStatus: 'open' }), 'support_request');
  assert.equal(adminMessageAlertKind({ previousMessage: { sender_role: 'staff' }, threadStatus: 'complete' }), 'support_request');
  assert.equal(adminMessageAlertKind({ previousMessage: { sender_role: 'staff' }, threadStatus: 'open' }), 'message');
  assert.deepEqual(sanitizeAdminMessagePrefs({ notify_admin_support_requests: true, notify_admin_messages: false, is_staff: true }), {
    notify_admin_support_requests: true,
    notify_admin_messages: false,
  });
});

test('admin message recipients exclude active inboxes and revoked staff', async () => {
  const now = Date.parse('2026-07-11T05:00:00.000Z');
  const profiles = [
    { id: 'active', is_staff: true, support_inbox_seen_at: null },
    { id: 'online', is_staff: true, support_inbox_seen_at: '2026-07-11T04:59:40.000Z' },
    { id: 'revoked', is_staff: false, support_inbox_seen_at: null },
    { id: 'root', is_staff: false, support_inbox_seen_at: null },
  ];
  const addresses = Object.fromEntries(profiles.map((profile) => [profile.id, `${profile.id}@example.com`]));
  const sb = {
    from: () => ({ select: () => ({ eq: async () => ({ data: profiles, error: null }) }) }),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: addresses[id] } } }) } },
  };
  assert.deepEqual(await adminMessageRecipients(sb, 'message', { ADMIN_EMAILS: 'root@example.com' }, now), [
    'active@example.com',
    'root@example.com',
  ]);
  assert.deepEqual(await adminMessageRecipients(sb, 'support_request', { ADMIN_EMAILS: 'root@example.com' }, now), [
    'active@example.com',
    'online@example.com',
    'root@example.com',
  ]);
});

test('support API persists thread lifecycle and admin message preferences', () => {
  const account = read('functions/api/account/messages.js');
  const admin = read('functions/api/admin/messages.js');
  const settings = read('functions/api/admin/message-settings.js');
  const notifications = read('functions/_lib/admin-message-notifications.js');
  const sql = read('supabase/schema-phase5.sql');
  assert.match(account, /recordSupportMessage/);
  assert.match(admin, /request\.method === 'PATCH'/);
  assert.match(admin, /support_thread_status/);
  assert.match(settings, /ADMIN_MESSAGE_PREF_COLUMNS/);
  assert.match(notifications, /notify_admin_support_requests/);
  assert.match(notifications, /notify_admin_messages/);
  assert.match(sql, /support_thread_status text not null default 'open'/);
});

test('admin inbox surfaces unanswered threads, lifecycle controls, and notification settings', () => {
  const html = read('admin.html');
  const threads = read('js/admin-support.js');
  // The prefs moved into the console's settings view; admin.html no longer ships
  // a support panel at all.
  assert.match(threads, /"adminNotifySupportRequests", "notify_admin_support_requests"/);
  assert.match(threads, /"adminNotifyMessages", "notify_admin_messages"/);
  assert.match(threads, /<input id="\$\{id\}" type="checkbox" data-support-pref="\$\{key\}">/);
  assert.doesNotMatch(html, /data-panel="support-settings"/);
  assert.match(threads, /unanswered/);
  assert.match(threads, /Mark resolved/);
  assert.match(threads, /Reopen/);
  assert.match(threads, /Escalate/);
  assert.match(threads, /message-settings/);
});

test('admin shell does not mount buyer chat, account navigation, or user notifications', () => {
  const html = read('admin.html');
  const adminFiles = ['js/admin.js', ...readdirSync(new URL('../js/admin/', import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `js/admin/${name}`)];

  assert.doesNotMatch(html, /js\/main\.js(?:\?|\")/, 'public main.js mounts buyer-only chrome and customer chat');
  for (const path of adminFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /\/api\/account\//, `${path} must use staff APIs only`);
    assert.doesNotMatch(source, /customer-chat|account-nav|dashboard\.js/, `${path} must not import buyer UI`);
  }
  const threads = read('js/admin-support.js');
  assert.match(threads, /\/api\/admin\/messages/);
  // Prefs are the console's own view now, so the admin adapter only hands out
  // its entry points and never talks to that endpoint itself.
  assert.match(threads, /\/api\/admin\/message-settings/);
  assert.match(read('js/admin/threads.js'), /openSettings/);
});

test('company message action opens its support thread instead of settings', () => {
  const companies = read('js/admin/companies.js');
  const threads = read('js/admin-support.js');

  assert.doesNotMatch(companies, /data-company-detail-tab="messages"/);
  assert.match(companies, /data-company-support-thread/);
  assert.match(companies, /openSupportThread\?\.\(company\.id\)/);
  // The adapter must hand out both console entry points — one thread (Accounts
  // "message this business") and the whole inbox (Overview unread count, the
  // settings page's way back in) — rather than any caller mounting its own.
  const adapterExports = read('js/admin/threads.js').match(/return \{([^}]*)\}/)?.[1] || '';
  for (const name of ['renderThreads', 'wireThreads', 'openThread', 'openConsole']) {
    assert.ok(adapterExports.includes(name), `threads.js must expose ${name}`);
  }
});
