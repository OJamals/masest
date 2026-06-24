/* MASEST user dashboard controller. Loaded as a module by dashboard.html.
 * Reuses the auth helper (session token + /api wrapper) and the cart for reorders. */
import { me, logout, orders as fetchOrders, api, resetPasswordForEmail } from './auth.js';
import { add as cartAdd, clear as cartClear } from './cart.js';
import { esc, safeUrl, money, fmtDate, fmtDT, wireTablist, rovingTabindex, linkTabsToPanels, confirmDialog } from './util.js';

const $ = (id) => document.getElementById(id);

let ACCOUNT = null;            // /api/account/me snapshot
const loaded = {};             // which tabs have been populated
const pages = {                // offset-pagination state per list (#29)
  orders: { items: [], offset: 0, total: null, hasMore: false },
  notifs: { items: [], offset: 0, total: null, hasMore: false },
};
let lastMsgCount = -1;         // messages currently rendered in the thread (for live-poll diffing)
let pollTimer = null;          // live-refresh interval handle
const POLL_MS = 30000;         // poll cadence while the tab is visible

/* ---------- tabs / routing ---------- */
const DASH_TABS = ['orders', 'messages', 'notifications', 'addresses', 'payment', 'profile', 'security'];

function currentDashboardTab() {
  const tab = location.hash.slice(1);
  return DASH_TABS.includes(tab) ? tab : 'overview';
}

function selectTab(name) {
  const tabs = [...document.querySelectorAll('.dash-tab')];
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  rovingTabindex(tabs, (t) => t.dataset.tab === name);
  document.querySelectorAll('.dash-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  loadTab(name);
}

function syncTabFromHash() {
  selectTab(currentDashboardTab());
}

function wireTabs() {
  linkTabsToPanels(document, 'dash');
  document.querySelectorAll('.dash-tab').forEach((b) =>
    b.addEventListener('click', () => selectTab(b.dataset.tab)));
  wireTablist(document.querySelector('.dash-tabs[role="tablist"]'), (tab) => selectTab(tab.dataset.tab));
}
function loadTab(name) {
  if (name === 'orders' && !loaded.orders) renderOrders();
  if (name === 'messages' && !loaded.messages) renderMessages();
  if (name === 'notifications' && !loaded.notifications) renderNotifications();
  if (name === 'addresses' && !loaded.addresses) renderAddresses();
  if (name === 'payment' && !loaded.payment) renderPayment();
  if (name === 'profile' && !loaded.profile) renderProfile();
}

/* ---------- overview ---------- */
function statusBadge(s) { return `<span class="badge" data-s="${esc(s)}">${esc(s)}</span>`; }
function trackingSteps(order) {
  const status = order.tracking_status || 'processing';
  const steps = [
    ['processing', 'Order received'],
    ['packing', 'Preparing shipment'],
    ['shipped', 'In transit'],
    ['delivered', 'Delivered'],
  ];
  const activeIndex = Math.max(0, steps.findIndex(([key]) => key === status));
  const meta = [
    order.carrier && `Carrier: ${esc(order.carrier)}`,
    order.tracking_number && `Tracking: ${esc(order.tracking_number)}`,
    order.estimated_delivery_at && `ETA: ${esc(fmtDT(order.estimated_delivery_at))}`,
  ].filter(Boolean).join(' · ');
  const events = (order.shipment_events || [])
    .slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const history = events.length ? `<ul class="ship-history">${events.map((e) =>
    `<li><b>${esc(e.status)}</b> · ${esc(fmtDT(e.created_at))}${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ul>` : '';
  return `<div class="trackline" aria-label="Order tracking timeline">
    ${steps.map(([key, label], index) => `<span class="${index <= activeIndex ? 'done' : ''}" data-track-step="${key}">${esc(label)}</span>`).join('')}
    ${meta ? `<p class="muted">${meta}</p>` : ''}
    ${history}
    ${order.tracking_url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(order.tracking_url))}" target="_blank" rel="noopener noreferrer">Track shipment</a>` : ''}
  </div>`;
}

async function renderOverview() {
  const c = ACCOUNT?.company;
  const banner = $('approvalBanner');
  if (c && c.status !== 'approved') {
    banner.innerHTML = `<div class="banner warn"><i class="ph ph-clock" aria-hidden="true"></i> Your account is <b>${esc(c.status)}</b>. Online ordering and NET terms unlock once MASEST approves it. We'll notify you here.</div>`;
  } else { banner.innerHTML = ''; }

  $('ovAccount').innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-sm">Account</h2>
    <div class="dash-row"><span>Signed in as</span><b>${esc(ACCOUNT?.email || 'Not set')}</b></div>
    <div class="dash-row"><span>Company</span><b>${esc(c?.name || 'Not set')}</b></div>
    <div class="dash-row"><span>Status</span>${statusBadge(c?.status || 'pending')}</div>
    <div class="dash-row"><span>Online ordering</span><b>${ACCOUNT?.can_checkout ? 'Enabled' : 'Pending approval'}</b></div>
    <div class="dash-row"><span>NET terms</span><b>${ACCOUNT?.can_use_net_terms ? 'NET-' + c?.net_terms_days : 'Not enabled'}</b></div>${ACCOUNT?.credit && !ACCOUNT.credit.unlimited ? `
    <div class="dash-row"><span>Balance owed</span><b>${money(ACCOUNT.credit.net_outstanding, 'usd')}</b></div>
    <div class="dash-row"><span>Credit available</span><b>${money(ACCOUNT.credit.credit_available, 'usd')}</b></div>` : ''}`;

  // Quick stats: pull counts in the background.
  const stats = $('ovStats');
  stats.innerHTML = [0, 1, 2].map(() => `<div class="stat"><div class="skeleton skeleton-text w-40" style="height:1.8em;margin:.15em 0 .55em"></div><div class="skeleton skeleton-text w-80"></div></div>`).join('');
  const [ord, notif] = await Promise.all([
    fetchOrders().catch(() => []),
    api('/api/account/notifications').catch(() => ({ notifications: [], unread: 0 })),
  ]);
  setBadge('badgeNotifs', notif.unread);
  const openOrders = ord.filter((o) => !['fulfilled', 'cancelled', 'net_paid'].includes(o.status)).length;
  stats.innerHTML = [
    ['ph-package', ord.length, 'Total orders'],
    ['ph-truck', openOrders, 'In progress'],
    ['ph-bell', notif.unread, 'Unread alerts'],
  ].map(([i, n, l]) => `<div class="stat"><div class="big-fig">${n}</div><div class="lbl"><i class="ph ${i}" aria-hidden="true"></i> ${l}</div></div>`).join('');
  renderSetupProgress();
  await renderOverviewActivity(ord, notif);
}

function renderSetupProgress() {
  const box = $('setupBody');
  const setup = ACCOUNT?.setup;
  if (!box) return;
  if (!setup?.steps?.length) { box.hidden = true; return; }
  box.hidden = false;
  const doneCount = setup.done ?? setup.steps.filter((step) => step.done || step.state === 'done').length;
  const totalCount = setup.total || setup.steps.length;
  const percent = setup.percent ?? Math.round((doneCount / Math.max(totalCount, 1)) * 100);
  box.innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-xs">Business setup</h2>
    <p class="muted">${doneCount} of ${totalCount} steps complete (${percent}%).</p>
    <div class="setup-list">
      ${setup.steps.map((step) => {
        const done = step.done || step.state === 'done';
        const detail = step.detail || step.description || '';
        return `
        <a class="setup-step" data-setup-state="${done ? 'done' : 'open'}" href="${esc(safeUrl(step.action || 'business.html'))}">
          <i class="ph ${done ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>
          <span><b>${esc(step.label)}</b><small>${esc(detail)}</small></span>
          <small>${done ? 'Done' : 'Open'}</small>
        </a>`;
      }).join('')}
  </div>`;
}

function openSetupSteps() {
  const steps = ACCOUNT?.setup?.steps || [];
  return steps.filter((step) => !(step.done || step.state === 'done'));
}

function renderBuyerActionRail({ orders = [], messages = [] } = {}) {
  const box = $('ovActionRail');
  if (!box) return;
  const openOrders = orders.filter((o) => !['fulfilled', 'cancelled', 'net_paid'].includes(o.status));
  const openSteps = openSetupSteps();
  const actions = [];
  if (openSteps.length) {
    actions.push({
      id: 'setup',
      icon: 'ph-clipboard-text',
      label: 'Open business setup',
      detail: `${openSteps.length} open ${openSteps.length === 1 ? 'step' : 'steps'}`,
      href: 'business.html',
    });
  }
  if (ACCOUNT?.can_checkout) {
    actions.push({
      id: 'cart',
      icon: 'ph-shopping-cart',
      label: 'Review cart',
      detail: 'Checkout and quote review',
      href: 'cart.html',
    });
  }
  if (openOrders.length) {
    actions.push({
      id: 'orders',
      icon: 'ph-truck',
      label: 'Track orders',
      detail: `${openOrders.length} active ${openOrders.length === 1 ? 'order' : 'orders'}`,
      href: '#orders',
    });
  }
  actions.push({
    id: 'message',
    icon: 'ph-chat-circle',
    label: 'Message MASEST',
    detail: messages.length ? `${messages.length} thread ${messages.length === 1 ? 'message' : 'messages'}` : 'Orders, pricing, NET terms',
    href: '#messages',
  });
  box.innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-xs">Next actions</h2>
    <div class="buyer-action-grid">
      ${actions.map((action) => `<a class="buyer-action" data-buyer-action="${esc(action.id)}" href="${esc(safeUrl(action.href))}">
        <i class="ph ${esc(action.icon)}" aria-hidden="true"></i>
        <span><b>${esc(action.label)}</b><small>${esc(action.detail)}</small></span>
        <i class="ph ph-caret-right" aria-hidden="true"></i>
      </a>`).join('')}
    </div>`;
  wirePanelLinks(box);
}

function newestByCreatedAt(list = []) {
  return [...list].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

function renderRecentOrders(orders = []) {
  const box = $('ovRecentOrders');
  if (!box) return;
  const recent = newestByCreatedAt(orders).slice(0, 3);
  if (!recent.length) {
    box.innerHTML = `
      <h2 class="headline dash-section-title dash-section-title-xs">Recent orders</h2>
      <div class="empty-state"><i class="ph ph-package empty-icon" aria-hidden="true"></i><div class="empty-title">No orders yet</div><div class="empty-body">Browse <a href="products.html">catalog</a> to place first order.</div></div>`;
    wirePanelLinks(box);
    return;
  }
  box.innerHTML = `
    <div class="dash-card-toolbar">
      <h2 class="headline dash-section-title dash-section-title-tight">Recent orders</h2>
      <a class="btn btn-ghost btn-sm" href="#orders">View all</a>
    </div>
    <div class="activity-list">
      ${recent.map((order) => `<a class="activity-line" href="#orders">
        <i class="ph ph-package" aria-hidden="true"></i>
        <span><b>${esc(order.id || 'Order')}</b><small>${esc(fmtDate(order.created_at))} · ${money(order.total, order.currency || 'USD')}</small></span>
        ${statusBadge(order.status || 'processing')}
      </a>`).join('')}
    </div>`;
  wirePanelLinks(box);
}

function renderRecentMessages(messages = []) {
  const box = $('ovRecentMessages');
  if (!box) return;
  const recent = newestByCreatedAt(messages).slice(0, 3);
  if (!recent.length) {
    box.innerHTML = `
      <h2 class="headline dash-section-title dash-section-title-xs">Recent messages</h2>
      <div class="empty-state"><i class="ph ph-chat-circle empty-icon" aria-hidden="true"></i><div class="empty-title">No messages yet</div><div class="empty-body"><a href="#messages">Message MASEST</a> about pricing, orders, or NET terms.</div></div>`;
    wirePanelLinks(box);
    return;
  }
  box.innerHTML = `
    <div class="dash-card-toolbar">
      <h2 class="headline dash-section-title dash-section-title-tight">Recent messages</h2>
      <a class="btn btn-ghost btn-sm" href="#messages">Open</a>
    </div>
    <div class="activity-list">
      ${recent.map((message) => `<a class="activity-line" href="#messages">
        <i class="ph ${message.sender_role === 'staff' ? 'ph-headset' : 'ph-user'}" aria-hidden="true"></i>
        <span><b>${message.sender_role === 'staff' ? 'MASEST' : 'You'}</b><small>${esc(message.body || '').slice(0, 86)}${(message.body || '').length > 86 ? '...' : ''}</small></span>
        <time>${fmtDT(message.created_at)}</time>
      </a>`).join('')}
    </div>`;
  wirePanelLinks(box);
}

async function renderOverviewActivity(orders = [], notif = { notifications: [] }) {
  let messages = [];
  try { messages = (await api('/api/account/messages?peek=1')).messages || []; } catch { messages = []; }
  renderBuyerActionRail({ orders, notifications: notif.notifications || [], messages });
  renderRecentOrders(orders);
  renderRecentMessages(messages);
}

function setBadge(id, n) {
  const el = $(id); if (!el) return;
  if (n > 0) { el.textContent = n; el.hidden = false; } else { el.hidden = true; }
}

function wirePanelLinks(scope) {
  if (!scope) return;
  scope.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
    const tab = link.getAttribute('href').slice(1);
    const panel = [...document.querySelectorAll('.dash-panel')].find((node) => node.dataset.panel === tab);
    if (!panel) return;
    event.preventDefault();
    selectTab(tab);
  }));
}

function openReservedTab() {
  const tab = window.open('about:blank', '_blank');
  try { if (tab) tab.opener = null; } catch {}
  return tab;
}

function sendReservedTab(tab, url) {
  const target = safeUrl(url);
  if (tab) tab.location.href = target;
  else location.href = target;
}

function closeReservedTab(tab) {
  try { tab?.close(); } catch {}
}

/* ---------- orders ---------- */
// "Load more" pager footer, shown only while more rows remain (#29).
function pagerHtml(attr, st) {
  if (!st.hasMore) return '';
  const count = st.total != null ? ` <span class="muted">(${st.items.length} of ${st.total})</span>` : '';
  return `<div class="dash-pager" style="text-align:center;margin-top:12px"><button class="btn btn-ghost btn-sm" ${attr} type="button">Load more${count}</button></div>`;
}

async function renderOrders({ append = false } = {}) {
  loaded.orders = true;
  const box = $('ordersBody');
  const st = pages.orders;
  if (!append) {
    st.items = []; st.offset = 0;
    box.innerHTML = `<div class="skeleton skeleton-block" style="height:60px;margin-bottom:10px"></div>`.repeat(3);
  }
  let res;
  try { res = await api(`/api/account/orders?limit=25&offset=${st.offset}`); }
  catch { if (!append) box.innerHTML = '<p class="dash-status" data-state="err">Could not load orders.</p>'; return; }
  st.items = st.items.concat(res.orders || []);
  st.offset += (res.orders || []).length;
  st.total = res.total; st.hasMore = !!res.has_more;
  if (!st.items.length) { box.innerHTML = `<div class="empty-state"><i class="ph ph-package empty-icon" aria-hidden="true"></i><div class="empty-title">No orders yet</div><div class="empty-body">Browse the <a href="products.html">catalog</a> to place your first order.</div></div>`; return; }
  const list = st.items;
  box.innerHTML = list.map((o, i) => {
    const items = o.order_items || [];
    const n = items.reduce((s, it) => s + (it.qty || 0), 0);
    const lines = items.map((it) => `<div class="dash-row dash-order-line"><span>${esc(it.name)} × ${it.qty}</span><span>${money(it.line_total, o.currency)}</span></div>`).join('');
    return `<details class="dash-order-card">
      <summary class="dash-order-summary">
        <span>${fmtDate(o.created_at)} · ${statusBadge(o.status)} · ${n} item${n === 1 ? '' : 's'}</span>
        <b>${money(o.total, o.currency)}</b></summary>
      <div class="dash-order-lines">${lines}
        ${trackingSteps(o)}
        ${o.qbo_invoice_id ? `<p class="muted">Invoice: ${esc(o.qbo_invoice_id)}</p>` : ''}
        ${items.length ? `<button class="btn btn-ghost btn-sm dash-reorder" data-reorder="${i}">Reorder</button>` : ''}
        ${o.payment_method === 'stripe' ? `<button class="btn btn-ghost btn-sm" data-receipt="${esc(o.id)}">Receipt</button>` : ''}
      </div></details>`;
  }).join('') + pagerHtml('data-load-more-orders', st);
  box.querySelectorAll('[data-reorder]').forEach((b) => b.addEventListener('click', async () => {
    const o = list[Number(b.dataset.reorder)];
    b.disabled = true;
    try {
      const { lines: cartLines, issues } = await api('/api/account/order', { method: 'POST', body: { id: o.id } });
      if (!cartLines || !cartLines.length) { alert('None of these items are available to reorder.'); b.disabled = false; return; }
      cartClear();
      cartLines.forEach((l) => cartAdd(l.sku, l.qty));
      if (issues && issues.length) alert('Some items changed since your last order:\n' + issues.map((x) => `• ${x.name || x.sku} — ${x.reason.replace('_', ' ')}`).join('\n'));
      location.href = 'cart.html';
    } catch { b.disabled = false; }
  }));
  box.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const { receipt_url } = await api(`/api/account/order?id=${encodeURIComponent(b.dataset.receipt)}&receipt=1`);
      if (receipt_url) {
        const receiptUrl = safeUrl(receipt_url);
        window.open(receiptUrl, '_blank', 'noopener,noreferrer');
      }
      else alert('No receipt is available for this order yet.');
    } catch { /* ignore */ }
    b.disabled = false;
  }));
  box.querySelector('[data-load-more-orders]')?.addEventListener('click', () => renderOrders({ append: true }));
}

/* ---------- messages ---------- */
async function renderMessages() {
  loaded.messages = true;
  const thread = $('msgThread');
  let msgs = [];
  try { msgs = (await api('/api/account/messages')).messages; } catch { thread.innerHTML = '<p class="dash-status" data-state="err">Could not load messages.</p>'; return; }
  lastMsgCount = msgs.length;
  setBadge('badgeMessages', 0); // opening the tab marks staff msgs read server-side
  if (!msgs.length) { thread.innerHTML = `<div class="empty-state"><i class="ph ph-chat-circle empty-icon" aria-hidden="true"></i><div class="empty-title">No messages yet</div><div class="empty-body">Send us a question about orders, pricing, NET terms, or anything else.</div></div>`; }
  else {
    thread.innerHTML = msgs.map((m) => `<div class="msg ${m.sender_role === 'staff' ? 'staff' : 'buyer'}">${esc(m.body)}<time>${fmtDT(m.created_at)}</time></div>`).join('');
    thread.scrollTop = thread.scrollHeight;
  }
}
function wireMessageForm() {
  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('msgInput'); const status = $('msgStatus');
    const body = input.value.trim(); if (!body) return;
    status.textContent = 'Sending…'; status.dataset.state = '';
    try {
      await api('/api/account/messages', { method: 'POST', body: { body } });
      input.value = ''; status.textContent = '';
      loaded.messages = false; await renderMessages();
    } catch { status.textContent = 'Could not send. Try again.'; status.dataset.state = 'err'; }
  });
}

/* ---------- notifications ---------- */
async function renderNotifications({ append = false } = {}) {
  loaded.notifications = true;
  const box = $('notifBody');
  const st = pages.notifs;
  if (!append) { st.items = []; st.offset = 0; }
  let data;
  try { data = await api(`/api/account/notifications?limit=50&offset=${st.offset}`); } catch { if (!append) box.innerHTML = '<p class="dash-status" data-state="err">Could not load notifications.</p>'; return; }
  setBadge('badgeNotifs', data.unread);
  st.items = st.items.concat(data.notifications || []);
  st.offset += (data.notifications || []).length;
  st.total = data.total; st.hasMore = !!data.has_more;
  if (!st.items.length) { box.innerHTML = `<div class="empty-state"><i class="ph ph-bell empty-icon" aria-hidden="true"></i><div class="empty-title">No notifications</div><div class="empty-body">Order updates, messages, and offers show up here.</div></div>`; return; }
  const icon = { order: 'ph-package', message: 'ph-chat-circle', offer: 'ph-tag', account: 'ph-user-check', system: 'ph-info' };
  box.innerHTML = st.items.map((n) => {
    const target = resolveNotificationTarget(n);
    return `
    <div class="notif ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}" data-notif-link="${esc(target)}" ${target ? 'role="button" tabindex="0"' : ''}>
      <i class="ph ${icon[n.type] || 'ph-info'}" aria-hidden="true"></i>
        <div class="notif-body">
          <div><b>${esc(n.title)}</b> <span class="muted notif-time">· ${fmtDT(n.created_at)}</span></div>
        ${n.body ? `<div class="muted">${esc(n.body)}</div>` : ''}
          ${target ? `<span class="muted notif-link">View →</span>` : ''}
      </div></div>`;
  }).join('') + pagerHtml('data-load-more-notifs', st);
  box.querySelector('[data-load-more-notifs]')?.addEventListener('click', () => renderNotifications({ append: true }));
}

function resolveNotificationTarget(n) {
  if (n.link) return safeUrl(n.link);
  if (n.type === 'message') return 'dashboard.html#messages';
  if (n.type === 'order') return 'dashboard.html#orders';
  if (n.type === 'account') return 'dashboard.html#profile';
  return '';
}
// Clear one unread notification from every on-screen badge without a reload.
// Guarded on the row's `unread` class so re-clicking a read item never over-decrements.
function markNotifReadUI(row) {
  if (!row || !row.classList.contains('unread')) return;
  row.classList.remove('unread');
  const dec = (n) => Math.max(0, (parseInt(n, 10) || 0) - 1);
  const b = $('badgeNotifs'); if (b) setBadge('badgeNotifs', dec(b.textContent));
  document.querySelectorAll('.acct-notif-dot').forEach((d) => {
    const n = dec(d.textContent); if (n <= 0) d.remove(); else d.textContent = n > 9 ? '9+' : String(n);
  });
  const navLink = document.querySelector('[data-account-nav-notifications]');
  const cnt = navLink?.querySelector('.acct-menu-count');
  if (cnt) { const n = dec(cnt.textContent); cnt.textContent = n > 9 ? '9+' : String(n); cnt.hidden = n <= 0; navLink.classList.toggle('has-unread', n > 0); }
}
function wireNotifications() {
  $('markAllRead').addEventListener('click', async () => {
    try { await api('/api/account/notifications', { method: 'POST', body: { all: true } }); } catch {}
    loaded.notifications = false; await renderNotifications();
  });
  function openDashboardTarget(target) {
    if (!target) return;
    const url = new URL(target, location.href);
    const norm = (p) => p.replace(/\.html$/, '');
    if (norm(url.pathname) === norm(location.pathname)) {
      const hash = url.hash.slice(1);
      selectTab(DASH_TABS.includes(hash) ? hash : 'overview');
      return;
    }
    location.href = url.href;
  }
  // Opening a notification: mark it read and route dashboard targets in-page.
  function openNotification(row) {
    if (!row) return;
    const id = row.dataset.id;
    if (id) {
      markNotifReadUI(row);
      api('/api/account/notifications', { method: 'POST', body: { id } }).catch(() => {});
    }
    openDashboardTarget(row.dataset.notifLink || '');
  }
  $('notifBody').addEventListener('click', (e) => {
    const row = e.target.closest('.notif'); if (!row) return;
    openNotification(row);
  });
  $('notifBody').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.notif'); if (!row) return;
    e.preventDefault();
    openNotification(row);
  });
  wireNotificationPrefs();
}

// Email notification preference toggles (#19). Load current state, persist on change.
async function wireNotificationPrefs() {
  const boxes = [...document.querySelectorAll('#notifPrefs [data-pref]')];
  if (!boxes.length) return;
  try {
    const prefs = await api('/api/account/notification-prefs');
    boxes.forEach((b) => { b.checked = prefs[b.dataset.pref] !== false; });
  } catch { return; }
  boxes.forEach((b) => b.addEventListener('change', async () => {
    b.disabled = true;
    try { await api('/api/account/notification-prefs', { method: 'PATCH', body: { [b.dataset.pref]: b.checked } }); }
    catch { b.checked = !b.checked; }
    b.disabled = false;
  }));
}

/* ---------- addresses ---------- */
async function renderAddresses() {
  loaded.addresses = true;
  const box = $('addrList');
  let list = [];
  try { list = (await api('/api/account/addresses')).addresses; } catch { box.innerHTML = '<p class="dash-status" data-state="err">Could not load addresses.</p>'; return; }
  if (!list.length) { box.innerHTML = `<div class="empty-state"><i class="ph ph-map-pin empty-icon" aria-hidden="true"></i><div class="empty-title">No saved addresses</div><div class="empty-body">Add a billing or shipping address to speed up checkout.</div></div>`; return; }
  box.innerHTML = list.map((a) => `
    <div class="dash-row">
      <span><b>${a.type === 'bill' ? 'Billing' : 'Shipping'}</b>${a.is_default ? ' · <span class="badge" data-s="approved">default</span>' : ''}<br>
        <span class="muted">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</span></span>
      <span>${a.is_default ? '' : `<button class="btn btn-ghost btn-sm" data-set-default="${esc(a.id)}">Set default</button> `}<button class="btn btn-ghost btn-sm" data-del="${esc(a.id)}">Remove</button></span>
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/account/addresses', { method: 'DELETE', body: { id: b.dataset.del } }); loaded.addresses = false; renderAddresses(); }
    catch { b.disabled = false; }
  }));
  box.querySelectorAll('[data-set-default]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/account/addresses', { method: 'PATCH', body: { id: b.dataset.setDefault, is_default: true } }); loaded.addresses = false; renderAddresses(); }
    catch { b.disabled = false; }
  }));
}
function wireAddressForm() {
  $('addrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('addrStatus');
    const address = {
      type: $('aType').value, line1: $('aLine1').value.trim(), line2: $('aLine2').value.trim() || null,
      city: $('aCity').value.trim(), state: $('aState').value.trim().toUpperCase(),
      zip: $('aZip').value.trim(), is_default: $('aDefault').checked,
    };
    status.textContent = 'Saving…'; status.dataset.state = '';
    try {
      await api('/api/account/addresses', { method: 'POST', body: { address } });
      e.target.reset(); status.textContent = 'Saved.'; status.dataset.state = 'ok';
      loaded.addresses = false; renderAddresses();
    } catch (err) { status.textContent = err.data?.error === 'address_incomplete' ? 'Fill in all required fields.' : 'Could not save.'; status.dataset.state = 'err'; }
  });
}

/* ---------- payment ---------- */
async function renderPayment() {
  loaded.payment = true;
  const box = $('payBody');
  const approved = ACCOUNT?.can_checkout;
  box.innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-sm">Payment methods</h2>
    <p class="muted pay-copy">Saved cards and bank accounts are managed securely by Stripe. We never store card details on our servers.</p>
    ${approved
      ? '<button class="btn btn-primary" id="portalBtn">Manage payment methods</button>'
      : '<p class="muted">Available once your account is approved for online ordering.</p>'}
    <span class="dash-status" id="payStatus" role="status" aria-live="polite"></span>`;
  const btn = $('portalBtn');
  if (btn) btn.addEventListener('click', async () => {
    const portalTab = openReservedTab();
    const status = $('payStatus');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening Stripe...';
    status.textContent = 'Opening Stripe payment portal...';
    status.dataset.state = 'busy';
    try {
      const { url } = await api('/api/account/billing-portal', { method: 'POST' });
      status.textContent = 'Payment portal opened in a new tab.';
      status.dataset.state = 'ok';
      sendReservedTab(portalTab, url);
      btn.textContent = originalText;
      btn.disabled = false;
    } catch (err) {
      closeReservedTab(portalTab);
      status.textContent = err.data?.error === 'stripe_not_configured' ? 'Stripe is not configured for this workspace yet.' : 'Could not open the payment portal. Try again.';
      status.dataset.state = 'err';
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

/* ---------- profile ---------- */
function renderProfile() {
  loaded.profile = true;
  $('pfEmail').value = ACCOUNT?.email || '';
  $('pfCompany').value = ACCOUNT?.company?.name || '';
  $('pfName').value = ACCOUNT?.profile?.full_name || '';
  $('pfPhone').value = ACCOUNT?.profile?.phone || '';
}
function wireProfileForm() {
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('pfStatus'); status.textContent = 'Saving…'; status.dataset.state = '';
    try {
      await api('/api/account/profile', { method: 'POST', body: { full_name: $('pfName').value.trim(), phone: $('pfPhone').value.trim() } });
      status.textContent = 'Saved.'; status.dataset.state = 'ok';
    } catch { status.textContent = 'Could not save.'; status.dataset.state = 'err'; }
  });
  $('pfLogout').addEventListener('click', async () => { await logout(); location.href = 'account.html'; });
}

/* ---------- live refresh ----------
 * While the dashboard is open and visible, poll for new notifications/messages so staff
 * replies surface without a manual reload. Cheap: one GET per cycle, paused when hidden. */
function wireSecurityForm() {
  $('secEmail').textContent = ACCOUNT?.email || 'Not set';
  $('secLogout').addEventListener('click', async () => { try { await logout(); } catch {} location.href = 'account.html'; });

  // Email change — Supabase sends a confirmation link; the email only switches once verified.
  $('emailChangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('secEmailStatus'); const input = $('secNewEmail');
    status.textContent = 'Sending…'; status.dataset.state = '';
    try {
      const r = await api('/api/account/me', { method: 'POST', body: { email: input.value.trim() } });
      status.textContent = r.unchanged ? 'That is already your email.' : 'Check your inbox to confirm the change.';
      status.dataset.state = 'ok';
      if (!r.unchanged) input.value = '';
    } catch (err) {
      status.textContent = err.data?.error === 'invalid_email' ? 'Enter a valid email address.' : 'Could not update email. Try again.';
      status.dataset.state = 'err';
    }
  });

  // GDPR data export — stream the JSON document to a file download.
  $('dataExportBtn').addEventListener('click', async () => {
    const status = $('privacyStatus');
    status.textContent = 'Preparing export…'; status.dataset.state = '';
    try {
      const data = await api('/api/account/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'masest-data-export.json'; a.click();
      URL.revokeObjectURL(url);
      status.textContent = 'Download started.'; status.dataset.state = 'ok';
    } catch { status.textContent = 'Could not export your data. Try again.'; status.dataset.state = 'err'; }
  });

  // GDPR account deletion — irreversible; double-confirm via the shared dialog (no native confirm()).
  $('acctDeleteBtn').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Permanently delete your account? Your sign-in and personal details are erased. Order history is kept (anonymized) for tax and accounting records. This cannot be undone.',
      { confirmText: 'Delete account', cancelText: 'Keep account', danger: true },
    );
    if (!ok) return;
    const status = $('privacyStatus');
    status.textContent = 'Deleting…'; status.dataset.state = '';
    try {
      await api('/api/account/delete', { method: 'POST', body: { confirm: 'DELETE' } });
      try { await logout(); } catch {}
      location.href = 'index.html';
    } catch { status.textContent = 'Could not delete your account. Contact support.'; status.dataset.state = 'err'; }
  });

  $('secReset').addEventListener('click', async () => {
    const status = $('secStatus');
    const btn = $('secReset');
    status.textContent = 'Sending…';
    status.dataset.state = '';
    btn.disabled = true;
    try {
      await resetPasswordForEmail(ACCOUNT?.email || '');
      status.textContent = 'Sent. Check your email.';
      status.dataset.state = 'ok';
    } catch {
      status.textContent = 'Could not send reset email.';
      status.dataset.state = 'err';
    } finally {
      btn.disabled = false;
    }
  });
}

function syncNavDot(unread) {
  // Keep the nav-avatar badge (rendered by account-nav.js) in step with the live count.
  const av = document.querySelector('.acct-avatar'); if (!av) return;
  let dot = av.querySelector('.acct-notif-dot');
  if (unread > 0) {
    if (!dot) { dot = document.createElement('span'); dot.className = 'acct-notif-dot'; av.appendChild(dot); }
    dot.textContent = unread > 9 ? '9+' : String(unread);
  } else if (dot) { dot.remove(); }
}

async function pollLive() {
  if (document.hidden) return;
  let unread = 0;
  try { unread = (await api('/api/account/notifications')).unread || 0; } catch { return; }
  setBadge('badgeNotifs', unread);
  syncNavDot(unread);
  // If the Messages tab is open, fold in any new staff replies (only re-render when the
  // thread actually grew, so we don't yank the scroll position while the user is reading).
  const msgPanel = document.querySelector('[data-panel="messages"]');
  if (msgPanel && !msgPanel.hidden) {
    try {
      const msgs = (await api('/api/account/messages')).messages || [];
      if (msgs.length > lastMsgCount) { loaded.messages = false; await renderMessages(); }
    } catch { /* keep current view */ }
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollLive, POLL_MS);
  // Catch up immediately whenever the user returns to the tab.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
}

// Hard session loss (token refresh failed): stop the live poller and steer to sign-in
// instead of letting pollLive() hammer a dead session forever.
let sessionExpiredHandled = false;
document.addEventListener('masest:session-expired', () => {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const next = encodeURIComponent(location.pathname + location.hash);
  location.href = `account.html?expired=1&next=${next}`;
});

/* ---------- boot ---------- */
async function boot() {
  try { ACCOUNT = await me(); } catch { ACCOUNT = null; }
  if (!ACCOUNT) { $('dashGuest').hidden = false; return; }
  $('dashApp').hidden = false;
  $('dashGreeting').textContent = `Welcome back${ACCOUNT.profile?.full_name ? ', ' + ACCOUNT.profile.full_name : ''}.`;
    wireTabs(); wireMessageForm(); wireNotifications(); wireAddressForm(); wireProfileForm(); wireSecurityForm();
  await renderOverview();
  selectTab(currentDashboardTab());
  window.addEventListener('hashchange', syncTabFromHash);
  startPolling();
}
boot();
