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

test('support API persists ticket lifecycle and admin message preferences', () => {
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
  assert.match(admin, /updateSupportTicket/);
  assert.match(admin, /ticket_version_conflict/);
  assert.doesNotMatch(admin, /supportThreadPatch/);
  assert.doesNotMatch(admin, /from\('support_threads'\)\.update/);
  assert.match(settings, /ADMIN_MESSAGE_PREF_COLUMNS/);
  assert.match(notifications, /notify_admin_support_requests/);
  assert.match(notifications, /notify_admin_messages/);
  assert.match(sql, /support_thread_status text not null default 'open'/);
  assert.match(unifiedSql, /append_support_message/);
});

test('admin inbox surfaces server-owned ticket queues, exact lifecycle controls, and notification settings', () => {
  const html = read('admin.html');
  const threads = read('js/admin-support.js');
  // The prefs moved into the console's settings view; admin.html no longer ships
  // a support panel at all.
  assert.match(threads, /id="adminNotifySupportRequests"[^>]*data-support-pref="notify_admin_support_requests"/);
  assert.match(threads, /id="adminNotifyMessages"[^>]*data-support-pref="notify_admin_messages"/);
  assert.doesNotMatch(html, /data-panel="support-settings"/);
  assert.match(threads, /data-support-queue="needs_reply"/);
  assert.match(threads, /\["open", "waiting_on_customer", "resolved"\]/);
  assert.match(threads, /\["normal", "high", "urgent"\]/);
  assert.match(threads, /\["general", "product", "order", "shipping", "billing", "account", "technical"\]/);
  assert.match(threads, /ticket_id:/);
  assert.match(threads, /version:/);
  assert.match(threads, /message-settings/);
});

test('admin inbox presence follows the drawer lifecycle and serializes late responses', () => {
  const threads = read('js/admin-support.js');

  assert.match(threads, /const PRESENCE_HEARTBEAT_MS = 30_000;/);
  assert.match(threads, /const setPresence = async \(open, \{ force = false, keepalive = false \} = \{\}\) =>/);
  assert.match(threads, /presenceRequest = presenceRequest\.catch\(\(\) => \{\}\)\.then\(\(\) => auth\.api\("\/api\/admin\/message-settings", \{/);
  assert.match(threads, /method: "POST", body: \{ action: "inbox_presence", inbox_open: open \}, keepalive/);
  assert.match(threads, /if \(presenceOpen === open\) presenceOpen = !open;/,
    'a failed request must not undo a newer presence transition');
  assert.match(threads, /if \(open\) \{ void setPresence\(true\); void poller\?\.refresh\(\);/);
  assert.match(threads, /else \{ void setPresence\(false\); setView\("queue"\); hideTicketChrome\(\); launcher\.focus\(\); \}/);
  assert.match(threads, /visibilitychange", \(\) => \{[\s\S]*setPresence\(!document\.hidden, \{ force: true, keepalive: document\.hidden \}\)/);
  assert.match(threads, /pagehide", \(\) => \{[\s\S]*poller\?\.stop\(\);[\s\S]*setPresence\(false, \{ force: true, keepalive: true \}\)/);
  assert.match(threads, /pageshow", \(event\) => \{[\s\S]*event\.persisted[\s\S]*setPresence\(true, \{ force: true \}\)/,
    'a restored visible drawer must reassert presence after pagehide cleanup');
  assert.match(threads, /heartbeat: \(\) => Date\.now\(\) - lastPresencePing > PRESENCE_HEARTBEAT_MS[\s\S]*setPresence\(true, \{ force: true \}\)/,
    'an open visible inbox must refresh before the server TTL elapses');
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
  assert.match(support, /openNewChat:\s*async\s*\(\{\s*userId\s*=\s*null,\s*orderId:\s*requestedOrderId\s*=\s*null\s*\}\s*=\s*\{\}\)/,
    'the shared console should own direct composer opening');
});

test('support density moves secondary filters into an accessible popover without losing queue context', () => {
  const source = read('js/admin-support.js');
  const trigger = source.match(/<button[^>]+data-support-filters-toggle[^>]*>/)?.[0] || '';
  assert.ok(trigger, 'the list pane should expose one Filters trigger');
  assert.match(trigger, /aria-expanded="false"/, 'the Filters trigger must expose expanded state');
  assert.match(trigger, /aria-controls="siteSupportFilters"/, 'the Filters trigger must identify its controlled popover');
  assert.match(source, /id="siteSupportFilters"[^>]*data-support-filters[^>]*role="dialog"/,
    'the controlled filter owner must be a labeled overlay');
  for (const field of ['priority', 'category', 'assignee']) {
    assert.match(source, new RegExp(`<label>${field[0].toUpperCase() + field.slice(1)}<select[^>]+data-support-${field}`),
      `${field} must remain a native labeled select`);
  }
  const clearStart = source.indexOf('[data-support-filters-clear]").addEventListener');
  const clearBlock = clearStart >= 0 ? source.slice(clearStart, clearStart + 420) : '';
  assert.ok(clearStart >= 0, 'the popover needs a Clear filters action');
  assert.match(clearBlock, /priority\.value\s*=\s*["']["']/);
  assert.match(clearBlock, /category\.value\s*=\s*["']["']/);
  assert.match(clearBlock, /assignee\.value\s*=\s*["']["']/);
  assert.doesNotMatch(clearBlock, /queue\s*=\s*["']/,
    'clearing filters must preserve the selected queue');
  assert.doesNotMatch(clearBlock, /search\.value\s*=\s*["']/,
    'clearing filters must preserve the current search');
  assert.doesNotMatch(clearBlock, /orderId\s*=\s*null/,
    'clearing filters must preserve the order-scoped context');
});

test('ticket properties have one accessible overlay owner and readable list markers', () => {
  const source = read('js/admin-support.js');
  const propertyTriggers = source.match(/<button[^>]+data-support-properties-toggle[^>]*>/g) || [];
  assert.equal(propertyTriggers.length, 1, 'the detail pane should have one Properties overlay trigger');
  const trigger = propertyTriggers[0] || '';
  assert.match(trigger, /aria-expanded=/);
  assert.match(trigger, /aria-controls="siteSupportProperties"/);
  assert.match(source, /id="siteSupportProperties"[^>]*data-support-properties[^>]*role="dialog"/,
    'Properties must own a single labeled overlay panel');
  for (const field of ['status', 'priority', 'category', 'assigned_to']) {
    assert.match(source, new RegExp(`["']${field}["']`), `${field} must belong to the canonical property field set`);
  }
  assert.match(source, /select\.dataset\.ticketField = field/);
  assert.doesNotMatch(source, /site-support__ticket-controls/, 'properties must not return as a persistent form row');
  assert.match(source, /data-support-ticket-status/, 'ticket rows need a readable status marker');
  assert.match(source, /data-support-ticket-assignee/, 'ticket rows need a readable assignment marker');
  assert.match(source, /site-support__properties-title/, 'the overlay must show the complete ticket subject');
});

test('support overlays dismiss topmost-first and restore focus without closing the drawer', () => {
  const source = read('js/admin-support.js');
  assert.match(source, /if \(activePopover\) \{ event\.preventDefault\(\); closeSupportPopover\(\{ restoreFocus: true \}\); return; \}/,
    'Escape must dismiss the active overlay before the drawer');
  assert.match(source, /restoreFocus && trigger\.isConnected[\s\S]{0,100}trigger\.focus\(\)/,
    'overlay dismissal must restore its trigger focus');
  assert.match(source, /const invalidateTicketContext = \(\{ hideChrome = false \} = \{\}\) => \{[\s\S]{0,220}propertyContextGeneration \+= 1/,
    'ticket lifecycle invalidation must retire delayed property work');
  assert.match(source, /if \(!open\) invalidateTicketContext\(\{ hideChrome: true \}\)/,
    'drawer close must invalidate delayed property work');
});

test('read-only staff get readable properties but no mutation affordances', () => {
  const source = read('js/admin-support.js');
  const readOnlyStart = source.indexOf('if (!canWrite) {');
  const readOnlyBlock = readOnlyStart >= 0 ? source.slice(readOnlyStart, source.indexOf('return;', readOnlyStart) + 7) : '';
  assert.ok(readOnlyBlock, 'Properties must have a read-only rendering branch');
  assert.match(readOnlyBlock, /site-support__property-values/);
  assert.match(readOnlyBlock, /read-only access/i, 'read-only staff should receive an explicit read-only notice');
  assert.doesNotMatch(readOnlyBlock, /select|patchTicket/, 'read-only Properties must render values without mutation controls');
});

test('rapid property edits use a pending identity or serialized patch lane', () => {
  const source = read('js/admin-support.js');
  const patchSource = source.match(/const patchTicket = async[\s\S]*?\n\s*\};/)?.[0] || '';
  assert.ok(patchSource, 'ticket property updates should have one canonical patch function');
  assert.match(patchSource, /propertyPatchLane\.catch\(\(\) => \{\}\)\.then/,
    'property edits need a serialized lane');
  assert.match(patchSource, /propertyGeneration = propertyContextGeneration/);
  assert.match(patchSource, /propertyGeneration !== propertyContextGeneration/,
    'late property work must be ignored after ticket context changes');
});
