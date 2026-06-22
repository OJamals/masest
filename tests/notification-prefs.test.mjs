// Notification preferences (#19 batch 2): per-user email opt-in/out + send-time filtering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sanitizeNotificationPrefs, companyEmails } from '../functions/_lib/supabase.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---- sanitizeNotificationPrefs ----
test('sanitizeNotificationPrefs keeps only known boolean flags', () => {
  assert.deepEqual(
    sanitizeNotificationPrefs({ notify_orders: false, notify_offers: true, notify_messages: true, role: 'admin', notify_x: true }),
    { notify_orders: false, notify_offers: true, notify_messages: true },
  );
});

test('sanitizeNotificationPrefs drops non-boolean / partial input', () => {
  assert.deepEqual(sanitizeNotificationPrefs({ notify_orders: 'yes', notify_offers: 1 }), {});
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

test('companyEmails(category) excludes members who opted out of that category', async () => {
  const sb = fakeSb([{ id: 'a', notify_orders: true }, { id: 'b', notify_orders: false }, { id: 'c' }]);
  const out = await companyEmails(sb, 'co', 'orders');
  assert.deepEqual(out.sort(), ['a@x.com', 'c@x.com'], 'opted-out b excluded; missing pref defaults in');
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
});

test('migration adds the three notify_* columns', () => {
  const sql = read('supabase/schema-notification-prefs.sql');
  for (const col of ['notify_orders', 'notify_offers', 'notify_messages']) {
    assert.match(sql, new RegExp(`add column if not exists ${col} boolean not null default true`, 'i'));
  }
});

test('send sites pass the matching category to honour prefs', () => {
  assert.match(read('functions/api/admin/orders.js'), /companyEmails\(sb, companyId, 'orders'\)/);
  assert.match(read('functions/api/admin/messages.js'), /companyEmails\(sb, companyId, 'messages'\)/);
  assert.match(read('functions/api/admin/offers.js'), /notify_offers/);
});

test('dashboard exposes notification preference toggles', () => {
  assert.match(read('js/dashboard.js'), /notification-prefs/);
});
