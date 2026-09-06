// Notification preferences (#19 batch 2): per-user email opt-in/out + send-time filtering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeNotificationPrefs, companyEmails } from '../functions/_lib/supabase.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const supportEmailDelivery = read('functions/_lib/support-email-delivery.js');

// ---- sanitizeNotificationPrefs ----
test('sanitizeNotificationPrefs keeps only optional marketing + support flags', () => {
  assert.deepEqual(
    sanitizeNotificationPrefs({
      transactional_email_enabled: false,
      marketing_email_enabled: false,
      notify_orders: false,
      notify_offers: true,
      notify_messages: true,
      role: 'admin',
    }),
    { marketing_email_enabled: false, notify_messages: true },
  );
});

test('sanitizeNotificationPrefs drops non-boolean / partial input', () => {
  assert.deepEqual(sanitizeNotificationPrefs({ marketing_email_enabled: 'yes', notify_messages: 1 }), {});
  assert.deepEqual(sanitizeNotificationPrefs({ notify_messages: false }), { notify_messages: false });
  assert.deepEqual(sanitizeNotificationPrefs({}), {});
  assert.deepEqual(sanitizeNotificationPrefs(null), {});
});

// ---- companyEmails category filtering ----
function fakeSb(profiles) {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: profiles }) }) }),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, email: `${id}@x.com` } } }) } },
  };
}

test('companyEmails keeps required order recipients despite legacy order opt-out', async () => {
  const sb = fakeSb([{ id: 'a', notify_orders: true }, { id: 'b', notify_orders: false }, { id: 'c' }]);
  const out = await companyEmails(sb, 'co', 'orders');
  assert.deepEqual(out.sort(), ['a@x.com', 'b@x.com', 'c@x.com']);
});

test('companyEmails with no category returns all members (back-compat)', async () => {
  const sb = fakeSb([{ id: 'a' }, { id: 'b' }]);
  const out = await companyEmails(sb, 'co');
  assert.deepEqual(out.sort(), ['a@x.com', 'b@x.com']);
});

// ---- endpoint + migration + wiring ----
test('notification-prefs endpoint exposes GET + PATCH using sanitizeNotificationPrefs', () => {
  const src = read('functions/api/account/notification-prefs.js');
  assert.match(src, /onRequestGet/);
  assert.match(src, /onRequestPatch|method === 'PATCH'/);
  assert.match(src, /sanitizeNotificationPrefs\(/);
  assert.match(src, /await setMarketingPreference\(env/);
  assert.match(src, /userId: user\.id/);
  assert.doesNotMatch(src, /klaviyo/i);
});

test('migration adds default-on marketing preference and preserves support preference', () => {
  const sql = read('supabase/schema-notification-prefs.sql');
  assert.match(sql, /add column if not exists marketing_email_enabled boolean not null default true/i);
  assert.match(sql, /add column if not exists notify_messages boolean not null default true/i);
  assert.match(sql, /set marketing_email_enabled = false[\s\S]+where notify_offers = false/i);
});

test('send sites keep orders mandatory and use marketing preference for offers', () => {
  const orders = read('functions/_lib/staff-order-operations.js');
  assert.match(orders, /companyEmails\(sb, companyId, 'orders'\)/);
  const notifyCompany = orders.match(/async function notifyCompany[\s\S]*?\n}\n\nasync function sendTrackingEmail/)?.[0] || '';
  assert.match(notifyCompany, /category:\s*'order'/);
  assert.match(read('functions/api/admin/messages.js'), /publishSupportMessage/);
  assert.match(read('functions/_lib/support-message-publisher.js'), /attemptSupportMessageDelivery/);
  assert.match(supportEmailDelivery, /shouldEmailSupportRecipient/);
  assert.match(read('functions/_lib/message-notifications.js'), /notify_messages/);
  assert.match(read('functions/api/admin/offers.js'), /marketing_company_emails/);
  assert.match(read('supabase/migrate-ses-marketing-2026-09-03.sql'), /marketing_email_enabled is not false/);
});

test('dashboard exposes immutable transactional + optional marketing settings', () => {
  const html = read('dashboard.html');
  assert.match(html, /transactionalEmailRequired/);
  assert.match(html, /checked disabled/);
  assert.match(html, /data-pref="marketing_email_enabled"/);
  assert.match(read('js/dashboard.js'), /notification-prefs/);
  assert.doesNotMatch(read('js/dashboard.js'), /Provider sync will retry/);
});
