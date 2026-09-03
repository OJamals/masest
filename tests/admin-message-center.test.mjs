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

test('staff support email alerts default on while retaining explicit opt-out', () => {
  const settings = read('functions/api/admin/message-settings.js');
  const schema = read('supabase/schema-phase5.sql');
  const migration = read('supabase/migrate-admin-support-email-defaults-2026-09-01.sql');
  assert.match(settings, /ADMIN_MESSAGE_PREF_COLUMNS\.map\(\(column\) => \[column, true\]\)/);
  assert.match(schema, /notify_admin_support_requests boolean not null default true/);
  assert.match(schema, /notify_admin_messages boolean not null default true/);
  assert.match(schema, /alter column notify_admin_support_requests set default true/);
  assert.match(schema, /alter column notify_admin_messages set default true/);
  assert.match(migration, /where is_staff = true/);
  assert.match(migration, /notify_admin_support_requests = true/);
  assert.match(migration, /notify_admin_messages = true/);
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
  const unifiedSql = read('supabase/schema-unified-support-messages.sql');
  assert.match(account, /publishSupportMessage/);
  assert.doesNotMatch(account, /appendSupportMessage/);
  assert.match(admin, /publishSupportMessage/);
  assert.doesNotMatch(admin, /appendSupportMessage/);
  assert.match(admin, /request\.method === 'PATCH'/);
  assert.match(admin, /support_threads/);
  assert.match(admin, /supportThreadPatch/);
  assert.match(settings, /ADMIN_MESSAGE_PREF_COLUMNS/);
  assert.match(notifications, /notify_admin_support_requests/);
  assert.match(notifications, /notify_admin_messages/);
  assert.match(sql, /support_thread_status text not null default 'open'/);
  assert.match(unifiedSql, /append_support_message/);
});

test('admin inbox surfaces unanswered threads, lifecycle controls, and notification settings', () => {
  const html = read('admin.html');
  const threads = read('js/admin-support.js');
  // The prefs moved into the console's settings view; admin.html no longer ships
  // a support panel at all.
  assert.match(threads, /"adminNotifySupportRequests", "notify_admin_support_requests"/);
  assert.match(threads, /"adminNotifyMessages", "notify_admin_messages"/);
  assert.match(threads, /<input id="\$\{id\}"[^>]*type="checkbox"[^>]*data-support-pref="\$\{key\}">/);
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

test('account user detail starts the canonical support composer for that user', () => {
  const admin = read('js/admin.js');
  const companies = read('js/admin/companies.js');
  const threads = read('js/admin/threads.js');
  const support = read('js/admin-support.js');

  assert.match(companies, /data-account-user-message/,
    'user detail should expose a direct Start chat action');
  assert.match(companies, /startSupportChat\?\.\(\{\s*userId:\s*user\.id\s*\}\)/,
    'the action should preserve the selected user identity');
  assert.match(admin, /startSupportChat:\s*\(\{\s*userId\s*\}\)\s*=>\s*showSupportConsole\(\{\s*userId\s*\}\)/,
    'Accounts should enter the shared support composer, not another messaging UI');
  assert.match(companies, /data-account-user-message[^>]*data-capability="admin\.write"/,
    'read-only staff should not receive an inoperative chat action');
  assert.match(admin, /if \(userId\) return supportEntry\.openNewChat\?\.\(\{\s*userId,\s*orderId\s*\}\)/,
    'the shared support entry point should preselect the requested user');
  assert.match(threads, /openNewChat/,
    'the admin adapter should expose the canonical composer entry point');
  assert.match(support, /openNewChat:\s*\(options\s*=\s*\{\}\)\s*=>\s*openNewChat\(options\)/,
    'the shared console should own direct composer opening');
});
