import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appendSupportMessage,
  resolveSupportOrderId,
  resolveSupportRecipient,
} from '../functions/_lib/support-messages.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('companyless customers remain valid support recipients', async () => {
  const filters = [];
  const sb = {
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        async maybeSingle() {
          return {
            data: {
              id: USER_ID,
              full_name: 'Solo Buyer',
              notify_messages: true,
              support_chat_open: false,
              support_chat_seen_at: null,
            },
            error: null,
          };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: USER_ID, email: 'solo@example.com' } } }),
      },
    },
  };

  const recipient = await resolveSupportRecipient(sb, { userId: USER_ID });

  assert.equal(recipient.id, USER_ID);
  assert.equal(recipient.email, 'solo@example.com');
  assert.deepEqual(filters, [['id', USER_ID]]);
});

test('order context accepts exact user ownership without a company', async () => {
  const filters = [];
  const sb = {
    from(table) {
      assert.equal(table, 'orders');
      return {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        async maybeSingle() {
          return {
            data: {
              id: ORDER_ID,
              order_number: 'MST-SOLO',
              status: 'paid',
              company_id: null,
              user_id: USER_ID,
              customer_email: 'solo@example.com',
            },
            error: null,
          };
        },
      };
    },
  };

  const result = await resolveSupportOrderId(sb, { orderId: ORDER_ID, userId: USER_ID });

  assert.equal(result.ok, true);
  assert.equal(result.orderId, ORDER_ID);
  assert.deepEqual(filters, [['id', ORDER_ID]]);
});

test('support append targets one canonical participant thread', async () => {
  let call;
  await appendSupportMessage({
    async rpc(name, args) {
      call = { name, args };
      return { data: { id: 'message-1', thread_id: THREAD_ID }, error: null };
    },
  }, {
    companyId: null,
    recipientUserId: USER_ID,
    threadUserId: USER_ID,
    senderRole: 'staff',
    body: 'Welcome to MASEST support.',
  });

  assert.equal(call.name, 'append_support_message');
  assert.equal(call.args.p_thread_user_id, USER_ID);
  assert.equal(call.args.p_company_id, null);
});

test('support schema owns user and business scopes through one thread table', () => {
  const migration = read('supabase/migrate-support-participant-threads-2026-09-03.sql');
  const baseline = read('supabase/schema-phase5.sql');
  assert.match(migration, /create table if not exists public\.support_threads/i);
  assert.match(migration, /participant_user_id\s+uuid/i);
  assert.match(migration, /support_threads_participant_unique/i);
  assert.match(migration, /support_threads_company_unique/i);
  assert.match(migration, /create policy support_threads_scope/i);
  assert.match(migration, /grant select on public\.support_threads to authenticated/i);
  assert.match(migration, /revoke all on function public\.ensure_support_message_thread\(\)/i);
  assert.match(migration, /revoke all on function public\.project_support_message\(\)/i);
  assert.match(migration, /alter table public\.messages[\s\S]*add column if not exists thread_id uuid/i);
  assert.match(migration, /alter column thread_id set not null/i);
  assert.match(migration, /participant_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /participant_user_id is null[\s\S]*company_id = public\.current_company_id\(\)/i);
  assert.match(migration, /p_thread_user_id uuid default null/i);
  assert.match(migration, /p_thread_id uuid default null/i);
  assert.match(migration, /create or replace function public\.create_order_support_request/i);
  assert.match(migration, /v_order\.user_id = p_requested_by/i);
  assert.match(migration, /'chat_linked', true/i);
  assert.match(baseline, /drop policy if exists messages_company/i);
  assert.match(baseline, /if to_regclass\('public\.support_threads'\) is null then[\s\S]*create policy messages_company/i);
});

test('account, admin, email, and UI use the same participant-thread identity', () => {
  const account = read('functions/api/account/messages.js');
  const admin = read('functions/api/admin/messages.js');
  const email = read('functions/_lib/support-email.js');
  const supportUi = read('js/admin-support.js');

  assert.match(account, /requireCommerceUser/);
  assert.match(account, /participant_user_id/);
  assert.match(account, /thread_id/);
  assert.match(admin, /thread_id/);
  assert.match(admin, /support_threads/);
  assert.match(email, /thread_id/);
  assert.match(email, /threadId/);
  assert.doesNotMatch(supportUi, /customers\.filter\(\(customer\) => customer\.id && customer\.company_id\)/);
  assert.match(supportUi, /data-support-thread-id/);
  assert.match(supportUi, /thread_id:/);
});

test('admin thread lists avoid per-thread auth email lookups', () => {
  const admin = read('functions/api/admin/messages.js');

  assert.match(admin, /hydrateThreads\(sb, rows, \{ includeEmails = false \} = \{\}\)/);
  assert.match(admin, /includeEmails \? await emailsByIds\(sb, userIds\) : \{\}/);
  assert.match(admin, /hydrateThreads\(sb, \[data\], \{ includeEmails: true \}\)/);
  assert.match(admin, /hydrated = await hydrateThreads\(sb, data \|\| \[\]\);/);
});

test('staff replies always target one user and therefore one email recipient', () => {
  const admin = read('functions/api/admin/messages.js');
  const supportUi = read('js/admin-support.js');

  assert.match(admin, /if \(!recipientUserId\) return json\(400, \{ error: 'recipient_user_id_required' \}\);/);
  assert.match(supportUi, /selected\.participant_user_id/);
  assert.match(supportUi, /data-support-start-customer/);
  assert.match(supportUi, /Start a customer chat to reply by chat and email\./);
});

test('legacy business order handoff keeps the order while staff chooses a recipient', () => {
  const supportUi = read('js/admin-support.js');

  assert.match(supportUi, /openNewChat\(\{ orderId: activeOrder\?\.id \|\| activeOrderId \|\| null \}\)/);
  assert.match(supportUi, /loadNewChatUser\(button\.dataset\.supportUserId, \{ orderId: pendingNewChatOrderId \}\)/);
});

test('order dashboard messaging enters the selected user participant thread with order scope', () => {
  const admin = read('js/admin.js');
  const orders = read('js/admin/orders.js');
  const supportUi = read('js/admin-support.js');

  assert.match(orders, /data-message-user=/);
  assert.match(orders, /userId:\s*button\.dataset\.messageUser \|\| null/);
  assert.match(admin, /onMessageCustomer:\s*\(\{ companyId, orderId, userId \}\)/);
  assert.match(admin, /openNewChat\?\.\(\{ userId, orderId \}\)/);
  assert.match(supportUi, /openNewChat = \(\{ userId = null, orderId = null \}/);
  assert.match(supportUi, /selectedOrderId:\s*orderId/);
});
