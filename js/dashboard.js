/* MASEST — user dashboard controller. Loaded as a module by dashboard.html.
 * Reuses the auth helper (session token + /api wrapper) and the cart for reorders. */
import { me, logout, orders as fetchOrders, api } from './auth.js';
import { add as cartAdd, clear as cartClear } from './cart.js';
import { esc, money, fmtDate, fmtDT } from './util.js';

const $ = (id) => document.getElementById(id);

let ACCOUNT = null;            // /api/account/me snapshot
const loaded = {};             // which tabs have been populated
let lastMsgCount = -1;         // messages currently rendered in the thread (for live-poll diffing)
let pollTimer = null;          // live-refresh interval handle
const POLL_MS = 30000;         // poll cadence while the tab is visible

/* ---------- tabs / routing ---------- */
function selectTab(name) {
  document.querySelectorAll('.dash-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.dash-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  loadTab(name);
}
function wireTabs() {
  document.querySelectorAll('.dash-tab').forEach((b) =>
    b.addEventListener('click', () => selectTab(b.dataset.tab)));
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

async function renderOverview() {
  const c = ACCOUNT?.company;
  const banner = $('approvalBanner');
  if (c && c.status !== 'approved') {
    banner.innerHTML = `<div class="banner warn"><i class="ph ph-clock" aria-hidden="true"></i> Your account is <b>${esc(c.status)}</b>. Online ordering and NET terms unlock once MASEST approves it — we'll notify you here.</div>`;
  } else { banner.innerHTML = ''; }

  $('ovAccount').innerHTML = `
    <h2 class="headline" style="font-size:1.3rem;margin-bottom:10px">Account</h2>
    <div class="dash-row"><span>Signed in as</span><b>${esc(ACCOUNT?.email || '—')}</b></div>
    <div class="dash-row"><span>Company</span><b>${esc(c?.name || '—')}</b></div>
    <div class="dash-row"><span>Status</span>${statusBadge(c?.status || 'pending')}</div>
    <div class="dash-row"><span>Online ordering</span><b>${ACCOUNT?.can_checkout ? 'Enabled' : 'Pending approval'}</b></div>
    <div class="dash-row"><span>NET terms</span><b>${ACCOUNT?.can_use_net_terms ? 'NET-' + c?.net_terms_days : 'Not enabled'}</b></div>`;

  // Quick stats — pull counts in the background.
  const stats = $('ovStats');
  stats.innerHTML = '<p class="muted">Loading…</p>';
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
}

function setBadge(id, n) {
  const el = $(id); if (!el) return;
  if (n > 0) { el.textContent = n; el.hidden = false; } else { el.hidden = true; }
}

/* ---------- orders ---------- */
async function renderOrders() {
  loaded.orders = true;
  const box = $('ordersBody');
  let list = [];
  try { list = await fetchOrders(); } catch { box.innerHTML = '<p class="dash-status" data-state="err">Could not load orders.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="muted">No orders yet. Browse the <a href="products.html">catalog</a> to place your first order.</p>'; return; }
  box.innerHTML = list.map((o, i) => {
    const items = o.order_items || [];
    const n = items.reduce((s, it) => s + (it.qty || 0), 0);
    const lines = items.map((it) => `<div class="dash-row" style="padding:7px 0"><span>${esc(it.name)} × ${it.qty}</span><span>${money(it.line_total, o.currency)}</span></div>`).join('');
    return `<details style="border-bottom:1px solid rgba(0,0,0,.08);padding:8px 0">
      <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:12px;list-style:none">
        <span>${fmtDate(o.created_at)} · ${statusBadge(o.status)} · ${n} item${n === 1 ? '' : 's'}</span>
        <b>${money(o.total, o.currency)}</b></summary>
      <div style="padding:8px 0 4px">${lines}
        ${o.qbo_invoice_id ? `<p class="muted">Invoice: ${esc(o.qbo_invoice_id)}</p>` : ''}
        ${items.length ? `<button class="btn btn-ghost btn-sm" data-reorder="${i}" style="margin-top:8px">Reorder</button>` : ''}
      </div></details>`;
  }).join('');
  box.querySelectorAll('[data-reorder]').forEach((b) => b.addEventListener('click', () => {
    const o = list[Number(b.dataset.reorder)];
    cartClear();
    (o.order_items || []).forEach((it) => cartAdd(it.sku, it.qty));
    location.href = 'cart.html';
  }));
}

/* ---------- messages ---------- */
async function renderMessages() {
  loaded.messages = true;
  const thread = $('msgThread');
  let msgs = [];
  try { msgs = (await api('/api/account/messages')).messages; } catch { thread.innerHTML = '<p class="dash-status" data-state="err">Could not load messages.</p>'; return; }
  lastMsgCount = msgs.length;
  setBadge('badgeMessages', 0); // opening the tab marks staff msgs read server-side
  if (!msgs.length) { thread.innerHTML = '<p class="muted">No messages yet. Send us a question — orders, pricing, NET terms, anything.</p>'; }
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
async function renderNotifications() {
  loaded.notifications = true;
  const box = $('notifBody');
  let data;
  try { data = await api('/api/account/notifications'); } catch { box.innerHTML = '<p class="dash-status" data-state="err">Could not load notifications.</p>'; return; }
  setBadge('badgeNotifs', data.unread);
  if (!data.notifications.length) { box.innerHTML = '<p class="muted">No notifications.</p>'; return; }
  const icon = { order: 'ph-package', message: 'ph-chat-circle', offer: 'ph-tag', account: 'ph-user-check', system: 'ph-info' };
  box.innerHTML = data.notifications.map((n) => `
    <div class="notif ${n.read ? '' : 'unread'}">
      <i class="ph ${icon[n.type] || 'ph-info'}" aria-hidden="true"></i>
      <div style="flex:1">
        <div><b>${esc(n.title)}</b> <span class="muted" style="font-size:.78rem">· ${fmtDT(n.created_at)}</span></div>
        ${n.body ? `<div class="muted">${esc(n.body)}</div>` : ''}
        ${n.link ? `<a href="${esc(n.link)}" class="muted" style="font-weight:700">View →</a>` : ''}
      </div></div>`).join('');
}
function wireNotifications() {
  $('markAllRead').addEventListener('click', async () => {
    try { await api('/api/account/notifications', { method: 'POST', body: { all: true } }); } catch {}
    loaded.notifications = false; await renderNotifications();
  });
}

/* ---------- addresses ---------- */
async function renderAddresses() {
  loaded.addresses = true;
  const box = $('addrList');
  let list = [];
  try { list = (await api('/api/account/addresses')).addresses; } catch { box.innerHTML = '<p class="dash-status" data-state="err">Could not load addresses.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="muted">No saved addresses yet.</p>'; return; }
  box.innerHTML = list.map((a) => `
    <div class="dash-row">
      <span><b>${a.type === 'bill' ? 'Billing' : 'Shipping'}</b>${a.is_default ? ' · <span class="badge" data-s="approved">default</span>' : ''}<br>
        <span class="muted">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</span></span>
      <button class="btn btn-ghost btn-sm" data-del="${esc(a.id)}">Remove</button>
    </div>`).join('');
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/account/addresses', { method: 'DELETE', body: { id: b.dataset.del } }); loaded.addresses = false; renderAddresses(); }
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
    <h2 class="headline" style="font-size:1.3rem;margin-bottom:10px">Payment methods</h2>
    <p class="muted" style="margin-bottom:16px">Saved cards and bank accounts are managed securely by Stripe. We never store card details on our servers.</p>
    ${approved
      ? '<button class="btn btn-primary" id="portalBtn">Manage payment methods</button>'
      : '<p class="muted">Available once your account is approved for online ordering.</p>'}
    <span class="dash-status" id="payStatus" role="status" aria-live="polite"></span>`;
  const btn = $('portalBtn');
  if (btn) btn.addEventListener('click', async () => {
    const status = $('payStatus'); btn.disabled = true; status.textContent = 'Opening secure portal…';
    try { const { url } = await api('/api/account/billing-portal', { method: 'POST' }); location.href = url; }
    catch (err) { status.textContent = err.data?.error === 'stripe_not_configured' ? 'Payment portal not configured yet.' : 'Could not open the portal.'; status.dataset.state = 'err'; btn.disabled = false; }
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

/* ---------- boot ---------- */
async function boot() {
  try { ACCOUNT = await me(); } catch { ACCOUNT = null; }
  if (!ACCOUNT) { $('dashGuest').hidden = false; return; }
  $('dashApp').hidden = false;
  $('dashGreeting').textContent = `Welcome back${ACCOUNT.profile?.full_name ? ', ' + ACCOUNT.profile.full_name : ''}.`;
  wireTabs(); wireMessageForm(); wireNotifications(); wireAddressForm(); wireProfileForm();
  await renderOverview();
  const start = ['orders', 'messages', 'notifications', 'addresses', 'payment', 'profile'].includes(location.hash.slice(1))
    ? location.hash.slice(1) : 'overview';
  selectTab(start);
  startPolling();
}
boot();
