import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  messagePage,
  presenceIsFresh,
} from '../functions/_lib/support-messages.js';
import {
  decodeSupportCursor,
} from '../functions/_lib/support-tickets.js';
import { createSupportPoller } from '../js/admin-support.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('message pages retain the newest rows and expose an older-page cursor', () => {
  const rows = [
    { id: '33333333-3333-4333-8333-333333333333', created_at: '2026-07-11T03:00:00.000000+00:00' },
    { id: '22222222-2222-4222-8222-222222222222', created_at: '2026-07-11T02:00:00.000000+00:00' },
    { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-07-11T01:00:00.000000+00:00' },
  ];
  assert.deepEqual(messagePage(rows, 2), {
    messages: [rows[1], rows[0]],
    has_more: true,
    next_message_cursor: messagePage(rows, 2).next_message_cursor,
  });
  assert.deepEqual(decodeSupportCursor(messagePage(rows, 2).next_message_cursor, { kind: 'message' }), {
    timestamp: rows[1].created_at,
    id: rows[1].id,
  });
});

test('presence expires when a close/unload signal is lost', () => {
  const now = Date.parse('2026-07-11T05:00:00.000Z');
  assert.equal(presenceIsFresh('2026-07-11T04:59:40.000Z', now), true);
  assert.equal(presenceIsFresh('2026-07-11T04:58:00.000Z', now), false);
  assert.equal(presenceIsFresh(null, now), false);
});

test('support polling is lightweight while closed, bounded while open, hidden-safe, and backs off', async () => {
  let hidden = false;
  let open = false;
  let summaryCalls = 0;
  let threadCalls = 0;
  let failSummary = false;
  let nextTimerId = 0;
  const timers = new Map();
  const delays = [];
  const poller = createSupportPoller({
    isHidden: () => hidden,
    isOpen: () => open,
    loadSummary: async () => {
      summaryCalls += 1;
      if (failSummary) throw new Error('offline');
    },
    loadTickets: async () => { threadCalls += 1; },
    setTimer: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    baseDelay: 10,
    maxDelay: 40,
  });

  await poller.refresh();
  assert.equal(summaryCalls, 1);
  assert.equal(threadCalls, 0);
  assert.equal(delays.at(-1), 10);

  open = true;
  await poller.refresh();
  assert.equal(threadCalls, 1);
  assert.equal(delays.at(-1), 10);

  hidden = true;
  poller.visibilityChanged();
  assert.equal(timers.size, 0);
  await poller.refresh();
  assert.equal(threadCalls, 1);

  hidden = false;
  open = false;
  failSummary = true;
  await poller.visibilityChanged();
  assert.equal(summaryCalls, 2);
  assert.equal(delays.at(-1), 20);

  failSummary = false;
  const [timerId, callback] = [...timers.entries()][0];
  timers.delete(timerId);
  await callback();
  assert.equal(summaryCalls, 3);
  assert.equal(delays.at(-1), 10);
  poller.stop();
  assert.equal(timers.size, 0);
});

test('inbound replies preserve participant identity and re-enter the shared delivery path', () => {
  const source = read('functions/_lib/support-email.js');
  const delivery = read('functions/_lib/support-delivery.js');
  const outbound = read('functions/_lib/support-email-delivery.js');
  assert.match(source, /sender_not_participant/);
  assert.match(source, /upsertInboundMessage/);
  assert.match(source, /attemptSupportMessageDelivery/);
  assert.match(delivery, /processClaimedIntegrationEffect/);
  assert.match(outbound, /admin\.html#support/);
  assert.doesNotMatch(source, /#support-settings/);
  assert.doesNotMatch(source, /staffRecipients\(env\)/);
});

test('admin support console has durable controls, live refresh, correct selection, and keyboard close', () => {
  const source = read('js/admin-support.js');
  assert.match(source, /\["open", "waiting_on_customer", "resolved"\]/);
  assert.match(source, /\["normal", "high", "urgent"\]/);
  assert.match(source, /ticket_id:\s*id/);
  assert.match(source, /version/);
  assert.match(source, /const canWrite = staff\?\.role !== "read_only"/);
  assert.match(source, /read-only access/);
  assert.match(source, /createSupportPoller/);
  assert.match(source, /summary=1/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /aria-pressed/);
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
  assert.match(support, /Needs reply/);
  assert.match(support, /aria-label="Open support tickets"/);
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
  assert.match(styles, /\.site-support__drawer\[data-view="settings"\] \.site-support__list-pane/);
  assert.match(styles, /height:\s*min\(720px, calc\(100dvh - 88px\)\)/);
  assert.match(styles, /\.site-support__drawer \{[\s\S]*padding:\s*0;/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /grid-template-columns:\s*minmax\(250px, 310px\) minmax\(0, 1fr\)/);
  assert.match(support, /site-support__empty/);
  assert.match(support, /aria-label="Support settings"/);
  assert.match(support, /site-support__conversation-toolbar/);
  assert.match(support, /site-support__conversation-body/);
  assert.match(support, /site-support__skeleton/);
  assert.match(support, /routeSuppressesSupport/);
  assert.match(support, /masest:support-route/);
  assert.match(styles, /\.site-support__conversation-toolbar/);
  assert.match(styles, /\.site-support__empty/);
  assert.match(styles, /\.site-support__skeleton/);
  assert.doesNotMatch(support, /is-empty/);
  assert.doesNotMatch(styles, /\.site-support__drawer\.is-empty/);
});

test('phone support uses a list-to-conversation drill-down without redundant open badges', () => {
  const support = read('js/admin-support.js');
  const styles = read('css/admin-support.css');

  assert.match(support, /drawer\.dataset\.ticketSelected/);
  assert.match(support, /clearSelection/);
  assert.match(support, /selected \? "Ticket detail" : "Support tickets"/);
  assert.doesNotMatch(support, /thread\.status/);
  assert.match(styles, /\.site-support__drawer\[data-view="queue"\]\[data-ticket-selected="false"\]/);
  assert.match(styles, /\.site-support__drawer\[data-view="detail"\]\[data-ticket-selected="true"\]/);
});

test('support ticket cards give identity and customer copy the full list width', () => {
  const styles = read('css/admin-support.css');

  assert.match(styles, /\.site-support__ticket \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.site-support__ticket-title strong \{[^}]*text-overflow:\s*ellipsis;/);
  assert.match(styles, /\.site-support__ticket-meta \{[^}]*display:\s*grid;[^}]*justify-items:\s*end;/);
});

test('staff replies require exact ticket identity and version while creation starts a distinct ticket', () => {
  const adminMessages = read('functions/api/admin/messages.js');
  const users = read('functions/api/admin/users.js');

  assert.match(adminMessages, /action === 'reply'/);
  assert.match(adminMessages, /expectedTicketVersion/);
  assert.match(adminMessages, /action === 'start_ticket'/);
  assert.match(adminMessages, /recipient_user_id/);
  assert.doesNotMatch(adminMessages, /legacyStartThread/);
  assert.match(users, /select\('id,order_number,status,payment_method,total,currency,created_at,tracking_status'\)/);
});

test('writable staff can start a user chat linked to any current or past order', () => {
  const support = read('js/admin-support.js');
  const styles = read('css/admin-support.css');

  assert.match(support, /data-support-new-ticket/);
  assert.match(support, /\/api\/admin\/customers\?limit=12&q=/);
  assert.match(support, /\/api\/admin\/users\?detail=/);
  assert.match(support, /action:\s*"start_ticket"/);
  assert.match(support, /recipient_user_id:/);
  assert.match(support, /order_id:/);
  assert.match(support, /site-support__recipient/);
  assert.match(styles, /\.site-support__composer/);
  assert.match(styles, /\.site-support__recipient-search/);
  assert.match(styles, /data-view="compose"/);
  assert.doesNotMatch(support, /\/api\/admin\/(?:new-chat|support-threads)/);
});

test('phone new-ticket composer preserves customer and order context', () => {
  const support = read('js/admin-support.js');

  assert.match(support, /openNewChat:\s*async/);
  assert.match(support, /loadRecipient\(userId, requestedOrderId\)/);
  assert.match(support, /selectedOrder/);
  assert.match(support, /data-support-recipient-search/);
});

test('phone new-chat composer uses the full drawer instead of an empty split row', () => {
  const styles = read('css/admin-support.css');

  assert.match(styles, /\.site-support__drawer\[data-view="compose"\] \{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/);
  assert.match(styles, /\.site-support__drawer\[data-view="compose"\] \.site-support__detail,[\s\S]*display:\s*flex;\s*grid-row:\s*1;/);
});

test('buyer and staff inboxes page backward from the newest message', () => {
  const account = read('functions/api/account/messages.js');
  const admin = read('functions/api/admin/messages.js');
  const dashboard = read('js/dashboard.js');
  for (const source of [account, admin]) {
    assert.match(source, /order\('created_at', \{ ascending: false \}\)/);
    assert.match(source, /messageCursorFilter/);
    assert.match(source, /order\('id', \{ ascending: false \}\)/);
    assert.match(source, /messagePage/);
  }
  assert.match(dashboard, /loadEarlierMessages/);
  assert.match(dashboard, /params\.set\('message_cursor', messageCursor\)/);
});
