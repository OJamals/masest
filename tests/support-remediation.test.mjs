import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  messagePage,
  presenceIsFresh,
  supportThreadListStatus,
  supportThreadPatch,
} from '../functions/_lib/support-messages.js';
import { createSupportPoller, filterSupportThreads } from '../js/admin-support.js';

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

test('support thread lists fail closed to open or complete lifecycle views', () => {
  assert.equal(supportThreadListStatus(null), 'open');
  assert.equal(supportThreadListStatus('open'), 'open');
  assert.equal(supportThreadListStatus('complete'), 'complete');
  assert.equal(supportThreadListStatus('escalated'), null);
  assert.equal(supportThreadListStatus('complete,open'), null);
});

test('presence expires when a close/unload signal is lost', () => {
  const now = Date.parse('2026-07-11T05:00:00.000Z');
  assert.equal(presenceIsFresh('2026-07-11T04:59:40.000Z', now), true);
  assert.equal(presenceIsFresh('2026-07-11T04:58:00.000Z', now), false);
  assert.equal(presenceIsFresh(null, now), false);
});

test('support inbox search matches customer names and recent message text', () => {
  const threads = [
    { company_id: 'c1', company_name: 'Acme HVAC', last_body: 'Chiller loop is fouling again.' },
    { company_id: 'c2', company_name: 'Northbay Foods', last_body: 'Thanks, received.' },
  ];

  assert.deepEqual(filterSupportThreads(threads, '  ACME '), [threads[0]]);
  assert.deepEqual(filterSupportThreads(threads, 'received'), [threads[1]]);
  assert.deepEqual(filterSupportThreads(threads, ''), threads);
  assert.deepEqual(filterSupportThreads(threads, 'missing'), []);
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
    loadThreads: async () => { threadCalls += 1; },
    heartbeat: async () => {},
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
  assert.match(source, /sender_not_participant/);
  assert.match(source, /upsertInboundMessage/);
  assert.match(source, /deliverSupportMessageEmail/);
  assert.match(source, /admin\.html#support/);
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
  assert.match(source, /createSupportPoller/);
  assert.match(source, /summary=1/);
  assert.doesNotMatch(source, /setInterval\(/);
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

test('phone support uses a list-to-conversation drill-down without redundant open badges', () => {
  const support = read('js/admin-support.js');
  const styles = read('css/admin-support.css');

  assert.match(support, /drawer\.dataset\.threadSelected/);
  assert.match(support, /clearThreadSelection/);
  assert.match(support, /selected \? "Conversation" : "Customer inbox"/);
  assert.doesNotMatch(support, /thread\.status === "escalated" \? "Escalated" : "Open"/);
  assert.match(support, /launcherIcon\.className = open \? "ph ph-x" : "ph ph-lifebuoy"/);
  assert.match(styles, /\.site-support__drawer\[data-view="inbox"\]\[data-thread-selected="false"\] \{ grid-template-rows:\s*minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.site-support__drawer\[data-view="inbox"\]\[data-thread-selected="false"\] \.site-support__conversation \{ display:\s*none; \}/);
  assert.match(styles, /\.site-support__drawer\[data-view="inbox"\]\[data-thread-selected="true"\] \.site-support__list-pane \{ display:\s*none; \}/);
  assert.match(styles, /\.site-support__drawer\[data-view="inbox"\]\[data-thread-selected="true"\] \{ grid-template-rows:\s*minmax\(0, 1fr\); \}/);
});

test('support thread cards give customer and message copy the full list width', () => {
  const styles = read('css/admin-support.css');

  assert.match(styles, /\.site-support__thread \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(styles, /\.site-support__thread strong,\s*\.site-support__thread small \{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.site-support__meta \{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/);
});

test('staff-started messages reopen the canonical thread and expose user/order references', () => {
  const adminMessages = read('functions/api/admin/messages.js');
  const users = read('functions/api/admin/users.js');

  assert.match(adminMessages, /reopen:\s*body\.start_thread === true/);
  assert.match(adminMessages, /recipient_user_id/);
  assert.match(adminMessages, /hydrateSupportParticipants/);
  assert.match(users, /select\('id,order_number,status,payment_method,total,currency,created_at,tracking_status'\)/);
});

test('writable staff can start a user chat linked to any current or past order', () => {
  const support = read('js/admin-support.js');
  const styles = read('css/admin-support.css');

  assert.match(support, /data-support-new-chat/);
  assert.match(support, /\/api\/admin\/customers\?limit=20/);
  assert.match(support, /\/api\/admin\/users\?detail=/);
  assert.match(support, /start_thread:\s*true/);
  assert.match(support, /recipient_user_id:/);
  assert.match(support, /order_id:/);
  assert.match(support, /site-support__conversation-party/);
  assert.match(styles, /\.site-support__new-chat/);
  assert.match(styles, /\.site-support__account-results/);
  assert.match(styles, /data-view="compose"/);
  assert.doesNotMatch(support, /\/api\/admin\/(?:new-chat|support-threads)/);
});

test('phone new-chat composer preserves customer context instead of autofocus-scrolling to the message', () => {
  const support = read('js/admin-support.js');

  assert.match(support, /id="siteSupportNewChatTitle" tabindex="-1"/);
  assert.match(support, /window\.matchMedia\("\(max-width: 720px\)"\)\.matches/);
  assert.match(support, /title\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(support, /else textarea\.focus\(\)/);
});

test('phone new-chat composer uses the full drawer instead of an empty split row', () => {
  const styles = read('css/admin-support.css');

  assert.match(styles, /\.site-support__drawer\[data-view="compose"\] \{[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/);
  assert.match(styles, /\.site-support__drawer\[data-view="compose"\] \.site-support__conversation \{[^}]*grid-row:\s*1;/);
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
  assert.match(dashboard, /params\.set\('before', messageCursor\)/);
});
