/* MASEST user dashboard controller. Loaded as a module by dashboard.html.
 * Reuses the auth helper (session token + /api wrapper) and the cart for reorders. */
import { me, logout, orders as fetchOrders, api, updatePassword } from './auth.js?v=20260711w';
import {
  add as cartAdd,
  clear as cartClear,
  items as cartItems,
  replaceWithQuote,
} from './cart.js';
import { esc, safeUrl, money, fmtDate, fmtDT, wireTablist, rovingTabindex, linkTabsToPanels, confirmDialog, toast, openReservedTab, sendReservedTab, closeReservedTab } from './util.js';
import { initBusinessHub } from './business.js?v=20260725f';

const $ = (id) => document.getElementById(id);

let ACCOUNT = null;            // /api/account/me snapshot
const loaded = {};             // which tabs have been populated
const pages = {                // offset-pagination state per list (#29)
  orders: { items: [], offset: 0, total: null, hasMore: false },
  notifs: { items: [], offset: 0, total: null, hasMore: false },
  quotes: { items: [], offset: 0, total: null, hasMore: false },
};
let lastMsgCount = -1;         // messages currently rendered in the thread (for live-poll diffing)
let lastMsgId = null;
let messageHistory = [];
let messageCursor = null;
let messageHasMore = false;
let pollTimer = null;          // live-refresh interval handle
const POLL_MS = 30000;         // poll cadence while the tab is visible
let activeDashboardTab = '';

/* ---------- tabs / routing ---------- */
const DASH_TABS = ['overview', 'orders', 'messages', 'notifications', 'business', 'addresses', 'profile'];
const DASH_TAB_ALIASES = {
  // Former standalone tabs, kept routable for old links/notifications (#security, #payment).
  payment: 'addresses',
  security: 'profile',
  programs: 'business',
  bizProfile: 'business',
  bizSetup: 'business',
  bizCompanySetup: 'business',
  bizInvoicing: 'business',
  bizPrograms: 'business',
  bizBulk: 'business',
  bizTeam: 'business',
  bizPaymentSetup: 'business',
  bizAccountTeam: 'business',
};

function dashboardTabFromHash(hash) {
  const tab = String(hash || '').replace(/^#/, '');
  return DASH_TABS.includes(tab) ? tab : (DASH_TAB_ALIASES[tab] || '');
}

function currentDashboardTab() {
  return dashboardTabFromHash(location.hash) || 'overview';
}

function reserveDashboardHeight() {
  const main = document.querySelector('.dash-main');
  if (!main) return;
  const current = Number.parseFloat(main.style.minHeight) || 0;
  const visibleHeight = Math.ceil(main.getBoundingClientRect().height);
  if (visibleHeight > current) main.style.minHeight = `${visibleHeight}px`;
}

function selectTab(name) {
  activeDashboardTab = name;
  const tabs = [...document.querySelectorAll('.dash-tab')];
  tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  rovingTabindex(tabs, (t) => t.dataset.tab === name);
  const activeTab = tabs.find((tab) => tab.dataset.tab === name);
  const rail = activeTab?.closest('.dash-tabs');
  if (activeTab && rail && rail.scrollWidth > rail.clientWidth) {
    const left = activeTab.offsetLeft - ((rail.clientWidth - activeTab.offsetWidth) / 2);
    rail.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }
  reserveDashboardHeight();
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
  if (name === 'overview' && !loaded.overview) { loaded.overview = true; renderOverview(); }
  if (name === 'orders' && !loaded.orders) { renderOrders(); renderQuoteRequests(); }
  if (name === 'messages' && !loaded.messages) renderMessages();
  if (name === 'notifications' && !loaded.notifications) renderNotifications();
  if (name === 'business' && !loaded.business) {
    loaded.business = true;
    initBusinessHub(ACCOUNT)
      .then(() => wirePanelLinks(document.querySelector('[data-panel="business"]')))
      .catch(() => {
        loaded.business = false;
        showLoadError($('bizProfile'), 'Could not load business tools.', () => loadTab('business'));
      });
  }
  if (name === 'addresses' && !loaded.addresses) { renderAddresses(); renderPayment(); }
  if (name === 'profile' && !loaded.profile) renderProfile();
}

/* ---------- overview ---------- */
function statusBadge(s, label) { return `<span class="badge" data-s="${esc(s)}">${esc(label || orderStatusLabel(s))}</span>`; }
// Raw enum → human label ("net_open" → "NET open"), so badges never show underscores.
function orderStatusLabel(s) {
  return String(s || '').split('_').map((w) => (w === 'net' ? 'NET' : w)).join(' ');
}
const ORDER_LIFECYCLE_LABELS = {
  cart: 'Cart',
  payment_pending: 'Payment pending',
  unfulfilled: 'Unfulfilled',
  fulfilling: 'Fulfilling',
  shipped: 'Shipped',
  fulfilled: 'Fulfilled',
  delivered_payment_due: 'Delivered, payment due',
  complete: 'Complete',
  blocked: 'Fulfillment hold',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
function orderLifecycleFor(order = {}) {
  if (order.lifecycle?.stage) return order.lifecycle;
  const status = String(order.status || '').trim();
  const tracking = String(order.tracking_status || 'processing').trim();
  const settled = ['paid', 'net_paid', 'fulfilled'].includes(status);
  let stage = 'unfulfilled';
  if (status === 'cart' || status === 'cancelled' || status === 'refunded') stage = status;
  else if (status === 'pending_payment') stage = 'payment_pending';
  else if (tracking === 'blocked') stage = 'blocked';
  else if (tracking === 'delivered') stage = settled ? 'complete' : 'delivered_payment_due';
  else if (tracking === 'shipped') stage = 'shipped';
  else if (tracking === 'packing') stage = 'fulfilling';
  else if (status === 'fulfilled') stage = 'fulfilled';
  return {
    stage,
    label: ORDER_LIFECYCLE_LABELS[stage] || orderStatusLabel(status),
    is_active: !['cart', 'cancelled', 'refunded', 'complete'].includes(stage),
  };
}
function orderLifecycleBadge(order) {
  const lifecycle = orderLifecycleFor(order);
  return statusBadge(lifecycle.stage || order.status, lifecycle.label || orderStatusLabel(order.status));
}
function bizStatusLabel(s) { return ({ approved: 'Verified', pending: 'Under review', rejected: 'Needs attention', suspended: 'Suspended' })[s] || s; }
function trackingSteps(order) {
  const status = order.tracking_status || 'processing';
  const steps = [
    ['processing', 'Order received'],
    ['packing', 'Preparing shipment'],
    ['shipped', 'In transit'],
    ['delivered', 'Delivered'],
  ];
  // 'blocked' is a real admin/DB status but not a timeline step — without an explicit
  // notice it would silently render as step 0 ("Order received") and hide the problem.
  const blocked = status === 'blocked';
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
    ${blocked ? '<p class="track-blocked" data-track-step="blocked"><i class="ph ph-warning-circle" aria-hidden="true"></i> Shipment on hold — MASEST is resolving a carrier issue and will follow up.</p>' : ''}
    ${steps.map(([key, label], index) => `<span class="${!blocked && index <= activeIndex ? 'done' : ''}" data-track-step="${key}">${esc(label)}</span>`).join('')}
    ${meta ? `<p class="muted">${meta}</p>` : ''}
    ${history}
    ${order.tracking_url ? `<a class="btn btn-ghost btn-sm" href="${esc(safeUrl(order.tracking_url))}" target="_blank" rel="noopener noreferrer">Track shipment</a>` : ''}
  </div>`;
}

function renderOverviewWorkspace() {
  const box = $('ovWorkspace');
  if (!box) return;
  const c = ACCOUNT?.company;
  const name = c?.name || ACCOUNT?.profile?.full_name || 'Your account';
  const businessState = c ? bizStatusLabel(c.status || 'pending') : 'Not set up';
  const orderingState = ACCOUNT?.can_checkout ? 'Enabled' : (c ? 'Pending' : 'Set up');
  const netState = ACCOUNT?.can_use_net_terms ? `NET-${c?.net_terms_days || 0}` : 'Not enabled';
  const body = c
    ? 'Procurement, order tracking, account-team messages, and business readiness in one workspace.'
    : 'Create a business profile to unlock B2B ordering, NET terms, programs, and account-team support.';
  box.innerHTML = `
    <div>
      <p class="dash-eyebrow">User workspace</p>
      <h2>${esc(name)}</h2>
      <p class="muted">${esc(body)}</p>
    </div>
    <div class="dash-overview-markers" aria-label="Dashboard readiness">
      <span class="dash-overview-marker"><small>Business</small><b>${esc(businessState)}</b></span>
      <span class="dash-overview-marker"><small>Ordering</small><b>${esc(orderingState)}</b></span>
      <span class="dash-overview-marker"><small>NET terms</small><b>${esc(netState)}</b></span>
    </div>`;
}

async function renderOverview() {
  renderOverviewWorkspace();
  const c = ACCOUNT?.company;
  const banner = $('approvalBanner');
  if (!c) {
    // The "Business setup" steps card is the single setup CTA — only banner when it's absent.
    banner.innerHTML = ACCOUNT?.setup?.steps?.length ? '' : `<div class="banner info"><i class="ph ph-rocket-launch" aria-hidden="true"></i><span>Your account is ready. <a href="#business">Set up your business</a> to unlock B2B ordering, NET terms, QuickBooks invoicing, and service programs.</span></div>`;
  } else if (c.status === 'pending') {
    banner.innerHTML = `<div class="banner info"><i class="ph ph-clock-countdown" aria-hidden="true"></i><span>We’re verifying your business — usually 1–2 business days. B2B ordering, NET terms, and programs unlock once it’s approved.</span></div>`;
  } else if (c.status === 'rejected' || c.status === 'suspended') {
    banner.innerHTML = `<div class="banner warn"><i class="ph ph-warning-circle" aria-hidden="true"></i><span>Your business needs attention. <a href="#business">Review your business details</a> to continue.</span></div>`;
  } else { banner.innerHTML = ''; }
  wirePanelLinks(banner);

  $('ovAccount').innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-sm">Account snapshot</h2>
    <div class="dash-row"><span>Signed in as</span><b>${esc(ACCOUNT?.email || 'Not set')}</b></div>
    <div class="dash-row"><span>Business</span><b>${esc(c?.name || 'Not set up')}</b></div>
    <div class="dash-row"><span>Verification</span>${c ? statusBadge(c.status || 'pending', bizStatusLabel(c.status)) : '<span class="badge" data-s="pending">Not set up</span>'}</div>
    <div class="dash-row"><span>Online ordering</span><b>${ACCOUNT?.can_checkout ? 'Enabled' : (c ? 'Under review' : 'Set up business')}</b></div>
    <div class="dash-row"><span>NET terms</span><b>${ACCOUNT?.can_use_net_terms ? 'NET-' + c?.net_terms_days : 'Not enabled'}</b></div>${ACCOUNT?.credit && !ACCOUNT.credit.unlimited ? `
    <div class="dash-row"><span>Balance owed</span><b>${money(ACCOUNT.credit.net_outstanding, 'usd')}</b></div>
    <div class="dash-row"><span>Credit available</span><b>${money(ACCOUNT.credit.credit_available, 'usd')}</b></div>` : ''}`;

  // Quick stats: pull counts in the background.
  const stats = $('ovStats');
  stats.innerHTML = [0, 1, 2].map(() => `<div class="stat"><div class="skeleton skeleton-text w-40 dash-stat-skeleton-main"></div><div class="skeleton skeleton-text w-80"></div></div>`).join('');
  const [ordRes, notif] = await Promise.all([
    fetchOrders({ limit: 5, summary: true }).catch(() => ({ orders: [], total: 0, active_total: 0 })),
    api('/api/account/notifications').catch(() => ({ notifications: [], unread: 0 })),
  ]);
  const ord = ordRes.orders || [];
  // True company-wide total (the endpoint count), not just the size of the fetched page.
  const totalOrders = Number.isFinite(ordRes.total) && ordRes.total > 0 ? ordRes.total : ord.length;
  setBadge('badgeNotifs', notif.unread);
  stats.innerHTML = [
    ['ph-package', totalOrders, 'Total orders'],
    ['ph-truck', ordRes.active_total, 'In progress'],
    ['ph-bell', notif.unread, 'Unread alerts'],
  ].map(([i, n, l]) => `<div class="stat"><div class="big-fig">${n}</div><div class="lbl"><i class="ph ${i}" aria-hidden="true"></i> ${l}</div></div>`).join('');
  renderSetupProgress();
  await renderOverviewActivity(ord, notif, ordRes.active_total);
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
        <a class="setup-step" data-setup-state="${done ? 'done' : 'open'}" href="${esc(safeUrl(dashboardHref(step.action || '#business')))}">
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

function renderBuyerActionRail({ activeTotal = 0, messages = [] } = {}) {
  const box = $('ovActionRail');
  if (!box) return;
  const openSteps = openSetupSteps();
  const actions = [];
  // No-company users already get the full "Business setup" steps card on this screen —
  // don't repeat the same CTA in the rail (three identical CTAs read as noise).
  if (openSteps.length && ACCOUNT?.company) {
    actions.push({
      id: 'setup',
      icon: 'ph-clipboard-text',
      label: 'Review business tools',
      detail: `${openSteps.length} open ${openSteps.length === 1 ? 'step' : 'steps'}`,
      href: '#business',
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
  if (activeTotal) {
    actions.push({
      id: 'orders',
      icon: 'ph-truck',
      label: 'Track orders',
      detail: `${activeTotal} active ${activeTotal === 1 ? 'order' : 'orders'}`,
      href: '#orders',
    });
  }
  actions.push({
    id: 'message',
    icon: 'ph-chat-circle',
    label: 'Message MASEST',
    detail: messages.length ? 'Open conversation' : 'Orders, pricing, NET terms',
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
      ${recent.map((order) => {
        const items = order.order_items || [];
        const n = items.reduce((s, it) => s + (it.qty || 0), 0);
        return `<a class="activity-line" href="#orders">
        <i class="ph ph-package" aria-hidden="true"></i>
        <span><b>${esc(fmtDate(order.created_at))}${n ? ` · ${n} item${n === 1 ? '' : 's'}` : ''}</b><small>${money(order.total, order.currency || 'USD')}</small></span>
        ${orderLifecycleBadge(order)}
      </a>`;
      }).join('')}
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
        <span><b>${message.sender_role === 'staff' ? 'MASEST' : 'You'}</b><small>${esc(message.body || '').slice(0, 86)}${(message.body || '').length > 86 ? '…' : ''}</small></span>
        <time>${fmtDT(message.created_at)}</time>
      </a>`).join('')}
    </div>`;
  wirePanelLinks(box);
}

async function renderOverviewActivity(orders = [], notif = { notifications: [] }, activeTotal = 0) {
  let messages = [];
  try { messages = (await api('/api/account/messages?peek=1')).messages || []; } catch { messages = []; }
  renderBuyerActionRail({ activeTotal, notifications: notif.notifications || [], messages });
  renderRecentOrders(orders);
  renderRecentMessages(messages);
}

function setBadge(id, n) {
  const el = $(id); if (!el) return;
  if (n > 0) { el.textContent = n; el.hidden = false; } else { el.hidden = true; }
}

function dashboardHref(raw = '') {
  const href = String(raw || '');
  if (/^business\.html(?:[?#].*)?$/i.test(href)) return '#business';
  if (/^dashboard\.html#/.test(href)) return href.replace(/^dashboard\.html/, '');
  return href;
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

/* ---------- orders ---------- */
// "Load more" pager footer, shown only while more rows remain (#29).
function pagerHtml(attr, st) {
  if (!st.hasMore) return '';
  const count = st.total != null ? ` <span class="muted">(${st.items.length} of ${st.total})</span>` : '';
  return `<div class="dash-pager"><button class="btn btn-ghost btn-sm" ${attr} type="button">Load more${count}</button></div>`;
}

// A failed first load must stay retryable: render an inline error with a Retry
// button and re-run `retry` on click. Callers also reset their `loaded.X` flag so
// simply switching tabs and back re-attempts — without this a single transient
// fetch failure locked the tab into its error state until a full page reload.
function showLoadError(box, label, retry) {
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<p class="dash-status" data-state="err">${esc(label)} <button class="btn btn-ghost btn-sm" type="button" data-retry>Retry</button></p>`;
  box.querySelector('[data-retry]')?.addEventListener('click', retry);
}

async function renderOrders({ append = false } = {}) {
  loaded.orders = true;
  const box = $('ordersBody');
  const st = pages.orders;
  if (!ACCOUNT?.company) {
    st.items = []; st.offset = 0; st.total = 0; st.hasMore = false;
    box.innerHTML = `<div class="empty-state"><i class="ph ph-briefcase empty-icon" aria-hidden="true"></i><div class="empty-title">Business setup required</div><div class="empty-body">Create a business profile before placing or tracking company orders.</div><a class="btn btn-primary btn-sm" href="#business">Set up business</a></div>`;
    wirePanelLinks(box);
    return;
  }
  if (!append) {
    st.items = []; st.offset = 0;
    box.innerHTML = `<div class="skeleton skeleton-block dash-order-skeleton"></div>`.repeat(3);
  }
  let res;
  try { res = await api(`/api/account/orders?limit=25&offset=${st.offset}`); }
  catch {
    if (!append) { loaded.orders = false; showLoadError(box, 'Could not load orders.', () => renderOrders()); return; }
    toast('Could not load more orders. Try again.', { variant: 'error' });
    const more = box.querySelector('[data-load-more-orders]'); if (more) more.disabled = false;
    return;
  }
  st.items = st.items.concat(res.orders || []);
  st.offset += (res.orders || []).length;
  st.total = res.total; st.hasMore = !!res.has_more;
  const list = st.items;
  const requisitions = res.requisitions || [];
  const requisitionHtml = `<section>
    <div class="dash-card-toolbar"><div><h2 class="headline dash-section-title dash-section-title-tight">Saved requisitions</h2><p class="muted">${requisitions.length} of 25 saved</p></div><a class="btn btn-ghost btn-sm" href="cart.html">Open cart</a></div>
    ${requisitions.length ? requisitions.map((requisition) => {
      const itemCount = (requisition.order_items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
      return `<div class="dash-row"><span><b>${esc(requisition.requisition_name)}</b><small class="muted">${itemCount} item${itemCount === 1 ? '' : 's'} · ${fmtDate(requisition.created_at)}</small></span><span class="dash-action-row dash-action-row--flush"><b>${money(requisition.total, requisition.currency)}</b><button class="btn btn-primary btn-sm" type="button" data-request-requisition-quote="${esc(requisition.id)}">Request quote</button><button class="btn btn-ghost btn-sm" type="button" data-use-requisition="${esc(requisition.id)}">Use</button><button class="btn btn-ghost btn-sm" type="button" data-delete-requisition="${esc(requisition.id)}">Delete</button></span></div>`;
    }).join('') : '<div class="empty-state"><i class="ph ph-clipboard-text empty-icon" aria-hidden="true"></i><div class="empty-title">No saved requisitions</div><div class="empty-body">Build a repeat order in the cart, then save it here for later.</div></div>'}
  </section>`;
  const orderHtml = list.length ? list.map((o, i) => {
    const items = o.order_items || [];
    const n = items.reduce((s, it) => s + (it.qty || 0), 0);
    const lines = items.map((it) => `<div class="dash-row dash-order-line"><span>${esc(it.name)} × ${it.qty}</span><span>${money(it.line_total, o.currency)}</span></div>`).join('');
    return `<details class="dash-order-card">
      <summary class="dash-order-summary">
        <span>${fmtDate(o.created_at)} · ${orderLifecycleBadge(o)} · ${n} item${n === 1 ? '' : 's'}</span>
        <b>${money(o.total, o.currency)}</b>
        <i class="ph ph-caret-down dash-order-caret" aria-hidden="true"></i></summary>
      <div class="dash-order-lines">${lines}
        ${trackingSteps(o)}
        ${o.purchase_order_number ? `<p class="muted">Purchase order: ${esc(o.purchase_order_number)}</p>` : ''}
        ${o.qbo_invoice_id ? `<p class="muted">Invoice: ${esc(o.qbo_invoice_id)}</p>` : ''}
        ${items.length ? `<button class="btn btn-ghost btn-sm dash-reorder" data-reorder="${i}">Reorder</button>` : ''}
        ${o.payment_method === 'stripe' ? `<button class="btn btn-ghost btn-sm" data-receipt="${esc(o.id)}">Receipt</button>` : ''}
      </div></details>`;
  }).join('') + pagerHtml('data-load-more-orders', st)
    : '<div class="empty-state"><i class="ph ph-package empty-icon" aria-hidden="true"></i><div class="empty-title">No orders yet</div><div class="empty-body">Browse the <a href="products.html">catalog</a> to place your first order.</div></div>';
  box.innerHTML = `${requisitionHtml}<section><h2 class="headline dash-section-title">Order history</h2>${orderHtml}</section>`;
  const restoreCart = async (id, button, emptyMessage) => {
    if (cartItems().length && !(await confirmDialog('Replace your current cart with these items?', { confirmText: 'Replace cart', cancelText: 'Keep cart' }))) return;
    button.disabled = true;
    try {
      const { lines: cartLines, issues } = await api('/api/account/order', { method: 'POST', body: { id } });
      if (!cartLines || !cartLines.length) { toast(emptyMessage, { variant: 'error' }); button.disabled = false; return; }
      cartClear();
      cartLines.forEach((line) => cartAdd(line.sku, line.qty));
      if (issues?.length) toast('Some items changed:\n' + issues.map((issue) => `• ${issue.name || issue.sku} — ${issue.reason.replace('_', ' ')}`).join('\n'), { variant: 'warning' });
      location.href = 'cart.html';
    } catch { toast('Could not rebuild this cart. Try again.', { variant: 'error' }); button.disabled = false; }
  };
  box.querySelectorAll('[data-use-requisition]').forEach((button) => button.addEventListener('click', () => {
    restoreCart(button.dataset.useRequisition, button, 'None of these saved items are available.');
  }));
  box.querySelectorAll('[data-request-requisition-quote]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api('/api/account/orders', {
        method: 'POST',
        body: { action: 'request_quote', id: button.dataset.requestRequisitionQuote },
      });
      pages.quotes = { items: [], offset: 0, total: null, hasMore: false };
      await renderQuoteRequests();
      toast(result.existing ? 'This requisition already has an open quote request.' : 'Quote requested.', { variant: 'success' });
    } catch (error) {
      toast(error.data?.error || 'Could not request a quote. Try again.', { variant: 'error' });
      button.disabled = false;
    }
  }));
  box.querySelectorAll('[data-reorder]').forEach((b) => b.addEventListener('click', async () => {
    const o = list[Number(b.dataset.reorder)];
    restoreCart(o.id, b, 'None of these items are available to reorder.');
  }));
  box.querySelectorAll('[data-delete-requisition]').forEach((button) => button.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this saved requisition?', { confirmText: 'Delete', cancelText: 'Keep' }))) return;
    button.disabled = true;
    try {
      await api(`/api/account/orders?id=${encodeURIComponent(button.dataset.deleteRequisition)}`, { method: 'DELETE' });
      await renderOrders();
      toast('Saved requisition deleted.', { variant: 'success' });
    } catch { toast('Could not delete this requisition. Try again.', { variant: 'error' }); button.disabled = false; }
  }));
  box.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const { receipt_url } = await api(`/api/account/order?id=${encodeURIComponent(b.dataset.receipt)}&receipt=1`);
      if (receipt_url) {
        const receiptUrl = safeUrl(receipt_url);
        window.open(receiptUrl, '_blank', 'noopener,noreferrer');
      }
      else toast('No receipt is available for this order yet.');
    } catch { toast('Could not load the receipt. Try again.', { variant: 'error' }); }
    b.disabled = false;
  }));
  box.querySelector('[data-load-more-orders]')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; renderOrders({ append: true }); });
}

/* ---------- quote requests ---------- */
// Buyer-safe mirror of quote requests. Ready offers can be accepted into the cart;
// checkout revalidates the quote and its server-owned order before using prices.
async function renderQuoteRequests({ append = false } = {}) {
  const box = $('quotesBody');
  if (!box) return;
  const st = pages.quotes;
  if (!append) { st.items = []; st.offset = 0; }
  let res;
  try { res = await api(`/api/account/quotes?limit=25&offset=${st.offset}`); } catch { if (!append) box.hidden = true; return; }
  st.items = st.items.concat(res.quotes || []);
  st.offset += (res.quotes || []).length;
  st.total = res.total; st.hasMore = !!res.has_more;
  if (!st.items.length) { box.hidden = true; return; }
  const stateAttr = { Received: 'pending_payment', 'In review': 'net_open', 'Quote ready': 'paid', Accepted: 'paid', 'Payment pending': 'pending_payment', 'Order placed': 'fulfilled', Quoted: 'paid', Closed: 'cancelled' };
  box.innerHTML = `<h2 class="headline dash-section-title">Quote requests</h2>`
    + st.items.map((q) => {
      const lines = (q.offer?.order_items || []).map((item) =>
        `<small class="muted">${esc(item.name || item.sku)} × ${esc(item.qty)} · ${money(item.line_total, q.offer.currency)}</small>`).join('');
      return `<div class="dash-row"><span>${fmtDate(q.created_at)} · ${esc(q.product || q.type || 'Quote')}${lines}</span><span class="dash-action-row dash-action-row--flush"><span class="badge" data-s="${esc(stateAttr[q.state] || '')}">${esc(q.state)}</span>${q.can_accept ? `<button class="btn btn-primary btn-sm" type="button" data-accept-quote="${esc(q.id)}">${q.state === 'Accepted' ? 'Load quote' : 'Accept quote'}</button>` : ''}</span></div>`;
    }).join('')
    + pagerHtml('data-load-more-quotes', st)
    + `<p class="muted">Need to add details? <a href="#messages">Message your account team</a>.</p>`;
  box.querySelectorAll('[data-accept-quote]').forEach((button) => button.addEventListener('click', async () => {
    const quote = st.items.find((item) => item.id === button.dataset.acceptQuote);
    if (!quote) return;
    if (cartItems().length && !(await confirmDialog('Replace your current cart with this accepted quote?', { confirmText: 'Accept and replace', cancelText: 'Keep cart' }))) return;
    button.disabled = true;
    try {
      const result = await api('/api/account/quotes', {
        method: 'POST',
        body: { id: quote.id, action: 'accept_offer' },
      });
      replaceWithQuote({
        quoteId: result.quote_id,
        orderId: result.offer.id,
        items: result.offer.order_items,
      });
      location.href = 'cart.html';
    } catch (error) {
      toast(error.data?.error || 'Could not accept this quote. Try again.', { variant: 'error' });
      button.disabled = false;
    }
  }));
  box.querySelector('[data-load-more-quotes]')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; renderQuoteRequests({ append: true }); });
  box.hidden = false;
}

/* ---------- messages ---------- */
async function renderMessages({ older = false } = {}) {
  loaded.messages = true;
  const thread = $('msgThread');
  const form = $('msgForm');
  const count = $('msgCount');
  const earlier = $('loadEarlierMessages');
  if (!ACCOUNT?.company) {
    thread.innerHTML = `<div class="empty-state"><i class="ph ph-briefcase empty-icon" aria-hidden="true"></i><div class="empty-title">Business setup required</div><div class="empty-body">Create a business profile before starting account-team message threads.</div><a class="btn btn-primary btn-sm" href="#business">Set up business</a></div>`;
    if (count) count.textContent = '';
    if (earlier) earlier.hidden = true;
    if (form) form.hidden = true; // the API rejects sends without a company
    wirePanelLinks(thread);
    return;
  }
  if (form) form.hidden = false;
  const previousHeight = older ? thread.scrollHeight : 0;
  let result;
  try {
    const suffix = older && messageCursor ? `?before=${encodeURIComponent(messageCursor)}` : '';
    result = await api(`/api/account/messages${suffix}`);
  } catch {
    loaded.messages = false;
    if (earlier) earlier.disabled = false;
    showLoadError(thread, 'Could not load messages.', () => renderMessages({ older }));
    return;
  }
  const page = result.messages || [];
  messageHistory = older
    ? [...page, ...messageHistory.filter((message) => !page.some((olderMessage) => olderMessage.id === message.id))]
    : page;
  messageCursor = result.next_before || null;
  messageHasMore = result.has_more === true;
  const msgs = messageHistory;
  lastMsgCount = msgs.length;
  lastMsgId = msgs.at(-1)?.id || null;
  if (earlier) { earlier.hidden = !messageHasMore; earlier.disabled = false; }
  if (count) count.textContent = msgs.length ? `${msgs.length}${messageHasMore ? '+' : ''} message${msgs.length === 1 ? '' : 's'} loaded.` : 'No messages in this conversation yet.';
  if (!msgs.length) { thread.innerHTML = `<div class="empty-state"><i class="ph ph-chat-circle empty-icon" aria-hidden="true"></i><div class="empty-title">No messages yet</div><div class="empty-body">Send us a question about orders, pricing, NET terms, or anything else.</div></div>`; }
  else {
    thread.innerHTML = msgs.map((m) => `<div class="msg ${m.sender_role === 'staff' ? 'staff' : 'buyer'}">${esc(m.body)}<time>${fmtDT(m.created_at)}${m.source === 'email_reply' ? ' · <span class="msg-source">Email reply</span>' : ''}</time></div>`).join('');
    thread.scrollTop = older ? thread.scrollHeight - previousHeight : thread.scrollHeight;
  }
}
function wireMessageForm() {
  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('msgInput'); const status = $('msgStatus');
    const sendBtn = e.target.querySelector('[type="submit"]');
    const body = input.value.trim(); if (!body) return;
    if (sendBtn) sendBtn.disabled = true;
    status.textContent = 'Sending…'; status.dataset.state = '';
    try {
      await api('/api/account/messages', { method: 'POST', body: { body } });
      input.value = ''; status.textContent = '';
      loaded.messages = false; await renderMessages();
    } catch { status.textContent = 'Could not send. Try again.'; status.dataset.state = 'err'; }
    finally { if (sendBtn) sendBtn.disabled = false; }
  });
  $('refreshMessages')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    loaded.messages = false;
    await renderMessages();
    event.currentTarget.disabled = false;
  });
  $('loadEarlierMessages')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    await renderMessages({ older: true });
  });
}

async function wireMessageSettings() {
  const box = $('msgEmailUpdates');
  const status = $('msgEmailStatus');
  if (!box) return;
  try {
    const prefs = await api('/api/account/notification-prefs');
    box.checked = prefs.notify_messages !== false;
  } catch {
    box.disabled = true;
    status.textContent = 'Could not load message email settings. Reload to retry.';
    status.dataset.state = 'err';
    return;
  }
  box.addEventListener('change', async () => {
    box.disabled = true;
    status.textContent = 'Saving…'; status.dataset.state = 'busy';
    try {
      await api('/api/account/notification-prefs', { method: 'PATCH', body: { notify_messages: box.checked } });
      status.textContent = box.checked ? 'Email replies are on.' : 'Email replies are off.';
      status.dataset.state = 'ok';
    } catch {
      box.checked = !box.checked;
      status.textContent = 'Could not save message email settings. Try again.';
      status.dataset.state = 'err';
    } finally { box.disabled = false; }
  });
}

/* ---------- notifications ---------- */
async function renderNotifications({ append = false } = {}) {
  loaded.notifications = true;
  const box = $('notifBody');
  const st = pages.notifs;
  if (!ACCOUNT?.company) {
    st.items = []; st.offset = 0; st.total = 0; st.hasMore = false;
    setBadge('badgeNotifs', 0);
    box.innerHTML = `<div class="empty-state"><i class="ph ph-bell empty-icon" aria-hidden="true"></i><div class="empty-title">No business notifications yet</div><div class="empty-body">Business approvals, order updates, and account-team messages start after you create a business profile.</div><a class="btn btn-primary btn-sm" href="#business">Set up business</a></div>`;
    wirePanelLinks(box);
    return;
  }
  if (!append) { st.items = []; st.offset = 0; }
  let data;
  try { data = await api(`/api/account/notifications?limit=50&offset=${st.offset}`); }
  catch {
    if (!append) { loaded.notifications = false; showLoadError(box, 'Could not load notifications.', () => renderNotifications()); return; }
    toast('Could not load more notifications. Try again.', { variant: 'error' });
    const more = box.querySelector('[data-load-more-notifs]'); if (more) more.disabled = false;
    return;
  }
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
  box.querySelector('[data-load-more-notifs]')?.addEventListener('click', (e) => { e.currentTarget.disabled = true; renderNotifications({ append: true }); });
}

function defaultNotificationTarget(n) {
  if (n.type === 'message') return 'dashboard.html#messages';
  if (n.type === 'order') return 'dashboard.html#orders';
  if (n.type === 'account') return 'dashboard.html#business';
  return '';
}

function dashboardTargetWithoutTab(target) {
  try {
    const url = new URL(target, location.href);
    const norm = (p) => p.replace(/\.html$/, '');
    return norm(url.pathname) === norm(location.pathname) && !dashboardTabFromHash(url.hash);
  } catch {
    return false;
  }
}

function resolveNotificationTarget(n) {
  const fallback = defaultNotificationTarget(n);
  if (!n.link) return fallback;
  const target = safeUrl(n.link);
  return dashboardTargetWithoutTab(target) ? fallback : target;
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
    try { await api('/api/account/notifications', { method: 'POST', body: { all: true } }); }
    catch { toast('Could not mark notifications read. Try again.', { variant: 'error' }); return; }
    loaded.notifications = false; await renderNotifications();
  });
  function openDashboardTarget(target) {
    if (!target) return;
    const url = new URL(target, location.href);
    const norm = (p) => p.replace(/\.html$/, '');
    if (norm(url.pathname) === norm(location.pathname)) {
      const tab = dashboardTabFromHash(url.hash);
      if (tab) selectTab(tab);
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
  } catch {
    // Don't leave live-looking dead checkboxes: disable them and say why.
    boxes.forEach((b) => { b.disabled = true; });
    const wrap = $('notifPrefs');
    if (wrap && !wrap.querySelector('[data-prefs-error]')) {
      const p = document.createElement('p');
      p.className = 'dash-status'; p.dataset.state = 'err'; p.dataset.prefsError = '1';
      p.textContent = 'Could not load email preferences. Reload to try again.';
      wrap.appendChild(p);
    }
    return;
  }
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
  if (!ACCOUNT?.company) {
    box.innerHTML = `<div class="empty-state"><i class="ph ph-briefcase empty-icon" aria-hidden="true"></i><div class="empty-title">No business profile yet</div><div class="empty-body">Create a business profile before adding shipping or billing addresses.</div><a class="btn btn-primary btn-sm" href="#business">Set up business</a></div>`;
    wirePanelLinks(box);
    return;
  }
  let list = [];
  try { list = (await api('/api/account/addresses')).addresses; } catch { loaded.addresses = false; showLoadError(box, 'Could not load addresses.', () => renderAddresses()); return; }
  if (!list.length) { box.innerHTML = `<div class="empty-state"><i class="ph ph-map-pin empty-icon" aria-hidden="true"></i><div class="empty-title">No saved addresses</div><div class="empty-body">Add a billing or shipping address to speed up checkout.</div></div>`; return; }
  box.innerHTML = list.map((a) => `
    <div class="dash-row">
      <span><b>${a.type === 'bill' ? 'Billing' : 'Shipping'}</b>${a.is_default ? ' · <span class="badge" data-s="approved">default</span>' : ''}<br>
        <span class="muted">${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</span></span>
      <span>${a.is_default ? '' : `<button class="btn btn-ghost btn-sm" data-set-default="${esc(a.id)}">Set default</button> `}<button class="btn btn-ghost btn-sm" data-edit="${esc(a.id)}">Edit</button> <button class="btn btn-ghost btn-sm" data-del="${esc(a.id)}">Remove</button></span>
    </div>`).join('');
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const a = list.find((x) => String(x.id) === b.dataset.edit);
    if (a) editAddress(a);
  }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Remove this address?', { confirmText: 'Remove', cancelText: 'Keep', danger: true });
    if (!ok) return;
    b.disabled = true;
    try { await api('/api/account/addresses', { method: 'DELETE', body: { id: b.dataset.del } }); loaded.addresses = false; renderAddresses(); }
    catch { toast('Could not remove the address. Try again.', { variant: 'error' }); b.disabled = false; }
  }));
  box.querySelectorAll('[data-set-default]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/account/addresses', { method: 'PATCH', body: { id: b.dataset.setDefault, is_default: true } }); loaded.addresses = false; renderAddresses(); }
    catch { b.disabled = false; }
  }));
}
// Edit an existing address in a modal, prefilled from the row. PATCHes only the
// mutable fields; default status keeps its own "Set default" control.
function editAddress(a) {
  const dlg = document.createElement('dialog');
  dlg.className = 'detail-dialog';
  const val = (v) => esc(v == null ? '' : String(v));
  dlg.innerHTML = `<h3>Edit address</h3>
    <form id="addrEditForm" class="form-card biz-clean-form" onsubmit="return false">
      <div class="field"><label>Type<select name="type">
        <option value="ship"${a.type !== 'bill' ? ' selected' : ''}>Shipping</option>
        <option value="bill"${a.type === 'bill' ? ' selected' : ''}>Billing</option>
      </select></label></div>
      <div class="field"><label>Address line 1<input name="line1" value="${val(a.line1)}" required></label></div>
      <div class="field"><label>Address line 2<input name="line2" value="${val(a.line2)}"></label></div>
      <div class="field"><label>City<input name="city" value="${val(a.city)}" required></label></div>
      <div class="field"><label>State<input name="state" value="${val(a.state)}" maxlength="2" required></label></div>
      <div class="field"><label>ZIP<input name="zip" value="${val(a.zip)}" required></label></div>
      <span class="dash-status" id="addrEditStatus" role="status" aria-live="polite"></span>
    </form>
    <menu class="dialog-btn-row">
      <button value="cancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
      <button value="ok" class="btn btn-primary btn-sm" type="button">Save changes</button>
    </menu>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('input')?.focus();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', () => { dlg.remove(); }, { once: true });
  dlg.querySelector('[value="cancel"]').addEventListener('click', close);
  dlg.querySelector('[value="ok"]').addEventListener('click', async (e) => {
    const form = dlg.querySelector('#addrEditForm');
    const status = dlg.querySelector('#addrEditStatus');
    const f = Object.fromEntries(new FormData(form));
    const address = {
      id: a.id, type: f.type, line1: String(f.line1 || '').trim(), line2: String(f.line2 || '').trim() || null,
      city: String(f.city || '').trim(), state: String(f.state || '').trim().toUpperCase(), zip: String(f.zip || '').trim(),
    };
    if (!address.line1 || !address.city || !address.state || !address.zip) { status.textContent = 'Fill in all required fields.'; status.dataset.state = 'err'; return; }
    e.target.disabled = true; status.textContent = 'Saving…'; status.dataset.state = '';
    try {
      await api('/api/account/addresses', { method: 'PATCH', body: { address } });
      close(); loaded.addresses = false; renderAddresses();
    } catch (err) {
      status.textContent = err.data?.error === 'address_incomplete' ? 'Fill in all required fields.' : 'Could not save. Try again.';
      status.dataset.state = 'err'; e.target.disabled = false;
    }
  });
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
  // Stripe card payments live in the user context and are NOT gated by business verification.
  // The Stripe customer is company-scoped, so a company must exist — but it need not be approved.
  const hasCompany = Boolean(ACCOUNT?.company);
  box.innerHTML = `
    <h2 class="headline dash-section-title dash-section-title-sm">Payment methods</h2>
    <p class="muted pay-copy">Saved cards are managed securely by Stripe. We never store card details on our servers. NET invoices and credit live under <a href="#business">Business tools</a>.</p>
    ${hasCompany
      ? '<button class="btn btn-primary" id="portalBtn">Manage payment methods</button>'
      : '<p class="muted">Set up your business under <a href="#business">Business</a> to save a card on file.</p>'}
    <span class="dash-status" id="payStatus" role="status" aria-live="polite"></span>`;
  wirePanelLinks(box);
  const btn = $('portalBtn');
  if (btn) btn.addEventListener('click', async () => {
    const portalTab = openReservedTab();
    const status = $('payStatus');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening Stripe…';
    status.textContent = 'Opening Stripe payment portal…';
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
      // Keep the in-memory snapshot and greeting in step with the saved name.
      if (ACCOUNT?.profile) { ACCOUNT.profile.full_name = $('pfName').value.trim(); ACCOUNT.profile.phone = $('pfPhone').value.trim(); }
      const greet = $('dashGreeting');
      if (greet && ACCOUNT?.profile?.full_name) greet.textContent = `Welcome back, ${ACCOUNT.profile.full_name}.`;
    } catch { status.textContent = 'Could not save.'; status.dataset.state = 'err'; }
  });
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

  // Inline password change — the session is already authenticated, so no email
  // round-trip (the old "send reset email" path also died on the CAPTCHA-gated
  // /recover endpoint; signed-out users use "Forgot password?" on account.html).
  const clearPasswordErrorIfResolved = () => {
    const status = $('secStatus');
    const pass = $('secNewPass').value;
    const pass2 = $('secNewPass2').value;
    if (status.dataset.state === 'err' && pass.length >= 8 && pass === pass2) {
      status.textContent = '';
      status.dataset.state = '';
    }
  };
  $('secNewPass').addEventListener('input', clearPasswordErrorIfResolved);
  $('secNewPass2').addEventListener('input', clearPasswordErrorIfResolved);
  $('passwordChangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('secStatus');
    const btn = $('secPassBtn');
    const pass = $('secNewPass').value;
    const pass2 = $('secNewPass2').value;
    if (pass.length < 8) { status.textContent = 'Password must be at least 8 characters.'; status.dataset.state = 'err'; return; }
    if (pass !== pass2) { status.textContent = 'Passwords do not match.'; status.dataset.state = 'err'; return; }
    status.textContent = 'Updating…';
    status.dataset.state = '';
    btn.disabled = true;
    try {
      await updatePassword(pass);
      $('secNewPass').value = ''; $('secNewPass2').value = '';
      status.textContent = 'Password updated.';
      status.dataset.state = 'ok';
    } catch (err) {
      status.textContent = /same.*password/i.test(String(err?.message || '')) ? 'That is already your password.' : 'Could not update the password. Try again.';
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
  if (!ACCOUNT?.company) return; // notifications/messages endpoints reject company-less accounts
  let unread = 0;
  try { unread = (await api('/api/account/notifications')).unread || 0; } catch { return; }
  setBadge('badgeNotifs', unread);
  syncNavDot(unread);
  // With the Notifications tab open, fold in newly arrived items instead of
  // only bumping the badge (the badge would say 3 while the list shows 0 new).
  const notifPanel = document.querySelector('[data-panel="notifications"]');
  if (notifPanel && !notifPanel.hidden) {
    const shownUnread = pages.notifs.items.filter((n) => !n.read).length;
    if (unread > shownUnread) { loaded.notifications = false; await renderNotifications(); }
  }
  // If the Messages tab is open, fold in any new staff replies (only re-render when the
  // thread actually grew, so we don't yank the scroll position while the user is reading).
  const msgPanel = document.querySelector('[data-panel="messages"]');
  if (msgPanel && !msgPanel.hidden) {
    try {
      const msgs = (await api('/api/account/messages?peek=1')).messages || [];
      if ((msgs.at(-1)?.id || null) !== lastMsgId) { loaded.messages = false; await renderMessages(); }
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
  // account.html honors ?return= (a validated .html path) to send the user back
  // after re-auth; the old ?next= param was never read there.
  const ret = encodeURIComponent(`dashboard.html${location.hash}`);
  location.href = `account.html?expired=1&return=${ret}`;
});

// Cheap notification-count fetch for the nav bell on tabs other than overview
// (overview computes it from its own notifications call).
async function syncNotifBadge() {
  try {
    const notif = await api('/api/account/notifications');
    setBadge('badgeNotifs', notif.unread);
    syncNavDot(notif.unread);
  } catch { /* the live poller will retry */ }
}

/* ---------- boot ---------- */
async function boot() {
  try { ACCOUNT = await me(); }
  catch {
    showLoadError($('dashGuest'), 'Could not verify your session.', boot);
    return;
  }
  if (!ACCOUNT) { $('dashGuest').hidden = false; return; }
  $('dashApp').hidden = false;
  $('dashGreeting').textContent = `Welcome back${ACCOUNT.profile?.full_name ? ', ' + ACCOUNT.profile.full_name : ''}.`;
  wireTabs(); wireMessageForm(); wireMessageSettings(); wireNotifications(); wireAddressForm(); wireProfileForm(); wireSecurityForm();
  // Route to the deep-linked tab immediately. Overview now lazy-loads through
  // loadTab like every other tab, so a deep link to #orders/#business no longer
  // fires overview's orders(100)+notifications fetches it never shows.
  const activeTab = currentDashboardTab();
  selectTab(activeTab);
  window.addEventListener('hashchange', syncTabFromHash);
  // The nav bell still needs the unread count on every landing; overview sets it
  // itself, so only fetch separately when we're not already rendering overview.
  if (activeTab !== 'overview') await syncNotifBadge();
  startPolling();
}
boot();
