import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adminMessageAlertKind, sanitizeAdminMessagePrefs } from '../functions/_lib/admin-message-notifications.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('admin alert kinds separate first support requests from closed-chat follow-ups', () => {
  assert.equal(adminMessageAlertKind({ previousMessage: null, threadStatus: 'open', chatOpen: true }), 'support_request');
  assert.equal(adminMessageAlertKind({ previousMessage: { sender_role: 'staff' }, threadStatus: 'complete', chatOpen: true }), 'support_request');
  assert.equal(adminMessageAlertKind({ previousMessage: { sender_role: 'staff' }, threadStatus: 'open', chatOpen: false }), 'message');
  assert.equal(adminMessageAlertKind({ previousMessage: { sender_role: 'staff' }, threadStatus: 'open', chatOpen: true }), null);
  assert.deepEqual(sanitizeAdminMessagePrefs({ notify_admin_support_requests: true, notify_admin_messages: false, is_staff: true }), {
    notify_admin_support_requests: true,
    notify_admin_messages: false,
  });
});

test('support API persists thread lifecycle and admin message preferences', () => {
  const account = read('functions/api/account/messages.js');
  const admin = read('functions/api/admin/messages.js');
  const settings = read('functions/api/admin/message-settings.js');
  const notifications = read('functions/_lib/admin-message-notifications.js');
  const sql = read('supabase/schema-phase5.sql');
  assert.match(account, /support_thread_status: 'open'/);
  assert.match(admin, /request\.method === 'PATCH'/);
  assert.match(admin, /support_thread_status/);
  assert.match(settings, /ADMIN_MESSAGE_PREF_COLUMNS/);
  assert.match(notifications, /notify_admin_support_requests/);
  assert.match(notifications, /notify_admin_messages/);
  assert.match(sql, /support_thread_status text not null default 'open'/);
});

test('admin inbox surfaces unanswered threads, lifecycle controls, and notification settings', () => {
  const html = read('admin.html');
  const threads = read('js/admin/threads.js');
  assert.match(html, /id="adminNotifySupportRequests"/);
  assert.match(html, /id="adminNotifyMessages"/);
  assert.match(threads, /unanswered/);
  assert.match(threads, /Mark complete/);
  assert.match(threads, /Reopen thread/);
  assert.match(threads, /message-settings/);
});
