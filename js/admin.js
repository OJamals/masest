/* MASEST staff admin console. */
import { login, logout, api, getToken } from './auth.js';
import { esc, safeUrl, money, dateTime as date, wireTablist, rovingTabindex, linkTabsToPanels, confirmDialog } from './util.js';
import { connectQbo, disconnectQbo, renderQboStatus, runQboSync } from './admin/qbo.js';
import { editKey, captureDirty, restoreDirty } from './admin/edits.js';
import { createTrafficRenderer } from './admin/traffic.js';
import { createSeoAudit } from './admin/seo.js';
import { createThreadsTab } from './admin/threads.js';
import { createOffersTab } from './admin/offers.js';
import { createProductsTab } from './admin/products.js';
import { createPricingTab } from './admin/pricing.js';
import { createContentTab } from './admin/content.js';
import { createCustomersTab } from './admin/customers.js';
import { createCompaniesTab } from './admin/companies.js';
import { createCrmPanel } from './admin/crm.js';
import { ORDER_STATUSES, createOrdersTab } from './admin/orders.js';
import { createQuotesTab } from './admin/quotes.js';
import { createCrmWorkspace } from './admin/crm-workspace.js';

const $ = (id) => document.getElementById(id);

// #28 dirty-edit guard: flag an inline control the moment the user edits it, so a
// later sibling save / cache re-render can snapshot and restore it (see admin/edits.js).
function markDirty(event) {
  const el = event.target;
  if (el.matches?.('input:not([type=checkbox]):not([type=file]), select, textarea') && editKey(el)) {
    el.dataset.dirty = '1';
  }
}

// Coalesce rapid input (search keystrokes) into a single trailing call so a query like
// "walmart" triggers one fetch+render instead of one per character.
function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}


// Loading skeleton + rich empty state for admin lists (#31). Reuse the shared
// components.css .skeleton / .empty-state styles.
const admSkeleton = (rows = 5) => `<div class="adm-skeletons" aria-hidden="true">${'<div class="skeleton skeleton-block" style="height:44px;margin-bottom:8px"></div>'.repeat(rows)}</div>`;
const admEmpty = (icon, title, body) => `<div class="empty-state"><i class="ph ${icon} empty-icon" aria-hidden="true"></i><div class="empty-title">${esc(title)}</div><div class="empty-body">${esc(body)}</div></div>`;
const state = {
  tab: 'overview',
  stats: null,
  orders: [],
  companies: [],
  products: [],
  content: [],
  quotes: [],
  threads: [],
  loaded: new Set(),
};

function badge(id, count) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(count || 0);
  el.hidden = !count;
}

function statusBadge(value) {
  return `<span class="badge" data-s="${esc(value)}">${esc(String(value || 'unknown').replaceAll('_', ' '))}</span>`;
}
function sourceLabel(message) {
  if (message?.source === 'crisp') return '<span class="pill">Crisp chat</span>';
  return '';
}

// NET aging badge (#10) — open NET balances show days-outstanding; overdue ones
// (past company net_terms_days) escalate via net-age--over30/60/90 colouring.
function message(id, text, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.dataset.state = kind;
}

// Session lost mid-use: drop back to the sign-in gate instead of failing silently.
document.addEventListener('masest:session-expired', () => {
  $('admGate').hidden = false;
  $('admApp').hidden = true;
  if ($('gateTitle')) $('gateTitle').textContent = 'Session expired';
  if ($('gateMsg')) $('gateMsg').textContent = 'Please sign in again to continue.';
});

async function boot() {
 const hadToken = Boolean(await getToken().catch(() => null));
 try {
 const stats = await api('/api/admin/stats');
    state.stats = stats;
    $('admGate').hidden = true;
    $('admApp').hidden = false;
    $('admGreeting').textContent = 'Signed in as staff.';
    renderStats(stats);
    renderQboStatus();
    setTab(location.hash.slice(1) || 'overview');
  } catch (err) {
    $('admGate').hidden = false;
    $('admApp').hidden = true;
 if (err.status === 403) {
 $('gateTitle').textContent = 'Staff access required';
 $('gateMsg').textContent = 'This account is not marked as staff.';
 } else if (err.status === 401) {
 $('gateTitle').textContent = hadToken ? 'Session expired' : 'Staff sign in';
 $('gateMsg').textContent = hadToken ? 'Please sign in again to continue.' : 'Sign in with an approved staff account.';
 }
 }
}

function setTab(tab) {
  state.tab = document.querySelector(`[data-panel="${tab}"]`) ? tab : 'overview';
  if (location.hash.slice(1) !== state.tab) location.hash = state.tab;
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.dataset.active = String(panel.dataset.panel === state.tab);
  });
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === state.tab)));
  rovingTabindex(tabs, (t) => t.dataset.tab === state.tab);

  // #28 cache: a tab already loaded re-renders from memory (refetch:false) instead of
  // refetching; first visit (or post-mutation re-render) fetches. offers/traffic self-cache.
  const cached = state.loaded.has(state.tab);
  const render = {
    overview: () => { renderStats(state.stats); runSeoAudit(); wireReports(); },
    orders: renderOrders,
    companies: renderCompanies,
    customers: renderCustomers,
    products: () => { renderProducts(); wireInventory(); },
    pricing: () => { renderPricing(); wireCoupons(); },
    content: renderContent,
    messages: renderThreads,
    quotes: renderQuotePipeline,
    crm: () => renderCrm(),
    offers: () => renderOffers(),
    traffic: () => renderTraffic(),
  }[state.tab];
  render?.({ refetch: !cached });
}

function syncTabFromHash() {
  setTab(location.hash.slice(1) || 'overview');
}

function renderSetupFollowups(stats = {}) {
 const rows = stats.setup_followups?.open_steps || [];
 if (!rows.length) {
 return '<div class="adm-card" data-setup-followups><h2>Setup gaps</h2><p class="muted">No setup gaps.</p></div>';
  }
  return `<div class="adm-card" data-setup-followups><h2>Setup gaps</h2>${rows.map((row) => `
    <div class="dash-row"><span>${esc(row.label || row.key)}</span><b>${esc(row.count || 0)}</b></div>
 `).join('')}</div>`;
}

function fmtInt(value) {
 return Number(value || 0).toLocaleString();
}

function pct(value) {
 return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function renderOpsSummary(stats = {}) {
 const commerce = stats.commerce || {};
 const crm = stats.crm || {};
 const accounts = stats.accounts || {};
 const catalog = stats.catalog_health || {};
 const analytics = stats.analytics || {};
 const groups = [
 ['Commerce', [
 ['30d revenue', money(commerce.revenue_30d || 0, 'usd')],
 ['AOV', money(commerce.average_order_value || 0, 'usd')],
 ['Fulfillment queue', fmtInt(commerce.fulfillment_queue)],
 ['NET exposure', money(commerce.net_exposure || 0, 'usd')],
 ]],
 ['CRM', [
 ['Unread messages', fmtInt(crm.unread_messages)],
 ['New quotes', fmtInt(crm.quotes_new)],
 ['Urgent quotes', fmtInt(crm.quotes_urgent)],
 ['Overdue follow-ups', fmtInt(crm.quotes_overdue)],
 ]],
 ['Accounts', [
 ['Pending', fmtInt(accounts.pending)],
 ['Approved', fmtInt(accounts.approved)],
 ['Suspended', fmtInt(accounts.suspended)],
 ['Setup gaps', fmtInt(crm.setup_followups)],
 ]],
 ['Catalog + analytics', [
 ['Buy SKUs', fmtInt(catalog.buy)],
 ['Low stock', fmtInt(catalog.low_stock)],
 ['7d quote submits', fmtInt(analytics.quote_submits_7d)],
 ['Quote rate', pct(analytics.quote_conversion_rate)],
 ]],
 ];
 return `<div class="adm-report-grid">${groups.map(([title, rows]) => `
 <div class="adm-card adm-report-card"><h2>${esc(title)}</h2>${rows.map(([label, value]) => `
 <div class="dash-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>
 `).join('')}</div>`).join('')}${renderSetupFollowups(stats)}</div>`;
}

function renderActionRail(actions = []) {
 if (!actions.length) return '<div class="adm-card"><h2>Priority actions</h2><p class="muted">No urgent admin actions.</p></div>';
 return `<div class="adm-card"><h2>Priority actions</h2><div class="adm-action-list">${actions.map((item) => `
 <a class="adm-action-item" href="${esc(safeUrl(item.href || '#overview'))}"><span><b>${esc(item.label)}</b><small class="muted">Priority ${esc(item.priority || '')}</small></span><strong>${esc(item.value || 0)}</strong></a>
 `).join('')}</div></div>`;
}

// Authenticated CSV download (Bearer) — fetch then blob-save, since a plain link
// can't attach the auth header. Mirrors the orders export above.
async function downloadCsv(url, filename, statusId) {
  message(statusId, 'Preparing export...');
  try {
    const token = await getToken();
    const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!r.ok) throw new Error('export_failed');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    message(statusId, 'Exported.', 'ok');
  } catch { message(statusId, 'Could not export the CSV. Retry.', 'err'); }
}

// Reports & exports card (#96). Bound once — the overview tab re-renders on each visit.
let reportsWired = false;
function wireReports() {
  if (reportsWired || !$('repRun')) return;
  reportsWired = true;
  const range = () => {
    const from = $('repFrom').value, to = $('repTo').value;
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return qs.toString();
  };
  $('repRun').addEventListener('click', async () => {
    message('repResult', 'Running report...');
    try {
      const r = await api('/api/admin/reports' + (range() ? '?' + range() : ''));
      $('repResult').dataset.state = 'ok';
      $('repResult').textContent = `Revenue ${money(r.revenue)} · Tax ${money(r.tax)} · ${r.paid_orders}/${r.orders} paid · AOV ${money(r.average_order_value)}`;
    } catch { message('repResult', 'Could not run the report. Retry.', 'err'); }
  });
  $('repOrdersCsv').addEventListener('click', () =>
    downloadCsv('/api/admin/reports?export=csv' + (range() ? '&' + range() : ''), 'masest-revenue.csv', 'repResult'));
  $('repCustomersCsv').addEventListener('click', () =>
    downloadCsv('/api/admin/customers?export=csv', 'masest-customers.csv', 'repResult'));
  $('repQuotesCsv').addEventListener('click', () =>
    downloadCsv('/api/admin/quotes?export=csv', 'masest-quotes.csv', 'repResult'));
}

// Inventory card (#98): bulk stock import + low-stock reorder list. Bound once;
// the Products tab re-renders on each visit.
let inventoryWired = false;
async function renderLowStock() {
  const box = $('invLow');
  if (!box) return;
  try {
    const r = await api('/api/admin/inventory?view=low');
    const low = r.low_stock || [];
    box.innerHTML = low.length
      ? `<table class="adm"><thead><tr><th>SKU</th><th>Product</th><th>Variant</th><th class="num">Stock</th><th class="num">Reorder</th></tr></thead><tbody>${low.map((v) =>
          `<tr><td>${esc(v.vsku)}</td><td>${esc(v.products?.name || '')}</td><td>${esc(v.label)}</td><td class="num">${esc(v.stock)}</td><td class="num">${esc(v.reorder_point ?? 10)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No variants at or below their reorder point.</p>';
  } catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load low stock.</p>'; }
}
function wireInventory() {
  renderLowStock();
  if (inventoryWired || !$('invApply')) return;
  inventoryWired = true;
  $('invApply').addEventListener('click', async () => {
    const csv = $('invCsv').value.trim();
    if (!csv) { message('invStatus', 'Paste vsku,stock rows first.', 'err'); return; }
    message('invStatus', 'Applying...');
    try {
      const r = await api('/api/admin/inventory', { method: 'POST', body: { csv } });
      message('invStatus', `Updated ${r.updated.length}${r.failed.length ? `, ${r.failed.length} failed` : ''}.`, r.failed.length ? 'err' : 'ok');
      if (r.updated.length) { $('invCsv').value = ''; renderLowStock(); }
    } catch (err) { message('invStatus', err.data?.error || 'Could not apply stock. Retry.', 'err'); }
  });
  $('invReorderCsv').addEventListener('click', () =>
    downloadCsv('/api/admin/inventory?view=low&export=csv', 'masest-low-stock.csv', 'invStatus'));
}

// Promo codes card (#97): Stripe promotion-code management. Bound once.
let couponsWired = false;
function couponDiscount(c) {
  if (c.percent_off != null) return `${esc(c.percent_off)}% off`;
  if (c.amount_off != null) return `${esc(money(c.amount_off, c.currency))} off`;
  return '';
}
async function renderCoupons() {
  const box = $('cpList');
  if (!box) return;
  try {
    const r = await api('/api/admin/coupons');
    const list = r.coupons || [];
    box.innerHTML = list.length
      ? `<table class="adm"><thead><tr><th>Code</th><th>Discount</th><th>Min</th><th class="num">Uses</th><th>Expires</th><th></th></tr></thead><tbody>${list.map((c) =>
          `<tr><td><b>${esc(c.code)}</b>${c.active ? '' : ' <span class="badge">inactive</span>'}</td><td>${couponDiscount(c)}</td><td>${c.minimum_amount != null ? esc(money(c.minimum_amount, c.currency)) : '—'}</td><td class="num">${esc(c.times_redeemed)}${c.max_redemptions ? `/${esc(c.max_redemptions)}` : ''}</td><td>${c.expires_at ? esc(date(c.expires_at * 1000)) : '—'}</td><td>${c.active ? `<button class="btn btn-ghost btn-sm" data-coupon-off="${esc(c.id)}" type="button">Deactivate</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No promo codes yet.</p>';
  } catch { box.innerHTML = '<p class="adm-status" data-state="err">Could not load promo codes.</p>'; }
}
function wireCoupons() {
  renderCoupons();
  if (couponsWired || !$('cpCreate')) return;
  couponsWired = true;
  $('cpCreate').addEventListener('click', async () => {
    const body = {
      code: $('cpCode').value.trim(),
      percent_off: $('cpPercent').value.trim(),
      amount_off: $('cpAmount').value.trim(),
      minimum_amount: $('cpMin').value.trim(),
      max_redemptions: $('cpMax').value.trim(),
      expires_at: $('cpExpires').value,
    };
    if (!body.code) { message('cpStatus', 'Enter a code.', 'err'); return; }
    message('cpStatus', 'Creating...');
    try {
      await api('/api/admin/coupons', { method: 'POST', body });
      message('cpStatus', 'Code created.', 'ok');
      ['cpCode', 'cpPercent', 'cpAmount', 'cpMin', 'cpMax', 'cpExpires'].forEach((id) => { $(id).value = ''; });
      renderCoupons();
    } catch (err) { message('cpStatus', err.data?.error || 'Could not create the code. Retry.', 'err'); }
  });
  $('cpList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-coupon-off]');
    if (!btn) return;
    if (!(await confirmDialog('Deactivate this promo code? It can no longer be redeemed.', { confirmText: 'Deactivate', danger: true }))) return;
    btn.disabled = true;
    try {
      await api('/api/admin/coupons', { method: 'POST', body: { id: btn.dataset.couponOff, action: 'deactivate' } });
      renderCoupons();
    } catch { message('cpStatus', 'Could not deactivate. Retry.', 'err'); btn.disabled = false; }
  });
}

function renderStats(stats = {}) {
 badge('aBadgePending', stats.companies?.pending || 0);
 badge('aBadgeMsg', stats.messages?.unread || 0);
 badge('aBadgeQuotes', stats.quotes?.new || stats.quotes?.new_count || 0);
 badge('aBadgeCrm', stats.crm_tasks?.overdue || stats.crm?.tasks_overdue || 0);
 const items = [
 ['ph-currency-dollar', money(stats.commerce?.revenue_30d ?? stats.revenue, 'usd'), 'Revenue (30d)'],
 ['ph-package', stats.commerce?.orders_7d || stats.orders?.total || 0, 'Orders (7d)'],
 ['ph-buildings', stats.companies?.pending || 0, 'Pending accounts'],
 ['ph-check-circle', stats.companies?.approved || 0, 'Approved accounts'],
 ['ph-clipboard-text', stats.setup_followups?.companies || 0, 'Setup follow-ups'],
 ['ph-chats', stats.messages?.unread || 0, 'Unread messages'],
    ['ph-calendar-check', stats.quotes_due?.overdue || 0, 'Quote follow-ups'],
    ['ph-warning', stats.inventory?.low_stock || 0, 'Low stock'],
    ['ph-flask', stats.catalog?.buy || 0, 'Buy SKUs'],
    ['ph-eye', stats.traffic?.views_7d || 0, 'Views (7d)'],
 ];
 $('admStats').innerHTML = items.map(([icon, value, label]) => `
 <div class="adm-card adm-stat"><i class="ph ${icon}"></i><b>${esc(value)}</b><span class="muted">${esc(label)}</span></div>
 `).join('');
 if ($('admOpsSummary')) $('admOpsSummary').innerHTML = renderOpsSummary(stats);
 if ($('admActionRail')) $('admActionRail').innerHTML = renderActionRail(stats.actions || []);
}

// "Load more" footer for the admin orders table — appends the next server page (#29).
// Generic "Load more" footer for an accumulated admin list (#29).
function admListPager(attr, loaded, total, hasMore) {
  if (!hasMore) return '';
  const count = total != null ? ` (${loaded} of ${total})` : '';
  return `<div style="text-align:center;margin:12px 0"><button class="btn btn-ghost btn-sm" ${attr} type="button">Load more${count}</button></div>`;
}

// Customers tab extracted to ./admin/customers.js (#36 split). statusBadge + primitives injected.
const { renderCustomers } = createCustomersTab({ $, api, state, admSkeleton, admEmpty, statusBadge });
// Companies tab extracted to ./admin/companies.js (#36 split). statusBadge + admListPager + primitives injected.
// CRM contact panel (timeline/tasks/notes) injected into the company drawer.
const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
const { renderCompanies, wireCompanies } = createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager, crm });
// Orders tab extracted to ./admin/orders.js (#36 split). statusBadge + admListPager + primitives injected.
const { renderOrders, wireOrders } = createOrdersTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, admListPager });
// Quotes pipeline tab extracted to ./admin/quotes.js (#36 split). statusBadge + badge + admListPager + primitives injected.
const { renderQuotePipeline, wireQuotes } = createQuotesTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge, admListPager });
// CRM workspace tab: top-level home for cross-account CRM surfaces (Tasks inbox, Contact directory).
const { renderCrm, wireCrm } = createCrmWorkspace({ $, api, state, admSkeleton, admEmpty, crm });

// Products tab extracted to ./admin/products.js (#36 split). Shared primitives injected.
const { renderProducts, wireProductForm, wireVariantForm, wireProducts } = createProductsTab({ $, api, state, message, admSkeleton, admEmpty });

// Pricing tab extracted to ./admin/pricing.js (#36 split). Shared primitives injected.
const { renderPricing, wirePricing } = createPricingTab({ $, api, state, message, admSkeleton });

// Content tab: staff-managed CMS entries for non-commerce public content.
const { renderContent, wireContent } = createContentTab({ $, api, state, admSkeleton, admEmpty });

// Messages/threads tab extracted to ./admin/threads.js (#36 split). Shared primitives + sourceLabel injected.
const { renderThreads, wireThreads } = createThreadsTab({ $, api, state, message, admSkeleton, sourceLabel });

// Offers tab extracted to ./admin/offers.js (#36 split). Shared primitives injected.
const { renderOffers, wireOfferForm } = createOffersTab({ $, api, state, message, admSkeleton });

// Traffic tab extracted to ./admin/traffic.js (#36 split). Shared primitives injected.
const renderTraffic = createTrafficRenderer({ $, api, admSkeleton, pct });

// SEO-audit tab extracted to ./admin/seo.js (#36 split). Shared state/lookup injected.
const runSeoAudit = createSeoAudit({ $, state });

// --- Cloudflare Turnstile on the staff gate (mirrors account.html sign-in) ---
// Supabase Auth CAPTCHA is enabled, so signInWithPassword needs a captchaToken.
// Skipped on local preview (no key) where the prod sitekey can't be solved.
const TS_LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
const TS_SITEKEY = TS_LOCAL ? '' : (window.MASEST_TURNSTILE_SITEKEY || '');
function initGateTurnstile() {
  if (!TS_SITEKEY) return;
  const form = $('gateForm');
  if (!form || form.querySelector('.cf-turnstile')) return;
  const btn = form.querySelector('button[type="submit"]');
  const w = document.createElement('div');
  w.className = 'cf-turnstile';
  w.dataset.sitekey = TS_SITEKEY;
  w.style.margin = '16px 0 0';
  w.style.gridColumn = '1 / -1';
  form.insertBefore(w, btn);
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  s.async = true; s.defer = true;
  document.head.appendChild(s);
}
// Turnstile injects a hidden <input name="cf-turnstile-response"> on solve.
function gateCaptchaToken() {
  if (!TS_SITEKEY) return undefined;
  return $('gateForm')?.querySelector('[name="cf-turnstile-response"]')?.value || '';
}
function resetGateCaptcha() { try { window.turnstile?.reset(); } catch (e) { /* not loaded */ } }

function wire() {
  linkTabsToPanels(document, 'adm');
  ORDER_STATUSES.forEach((status) => {
    $('ordFilter').insertAdjacentHTML('beforeend', `<option value="${status}">${status.replaceAll('_', ' ')}</option>`);
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  wireTablist(document.querySelector('.adm-tabs[role="tablist"]'), (tab) => setTab(tab.dataset.tab));
  window.addEventListener('hashchange', syncTabFromHash);
  // Status filter hits a server query param → must refetch. Search + the quote
  // facet filters are client-side over cached data → re-render in memory (#28).
  $('ordFilter').addEventListener('change', () => renderOrders());
  $('ordSearch').addEventListener('input', debounce(() => renderOrders({ refetch: false })));
  $('coSearch').addEventListener('input', debounce(() => renderCompanies({ refetch: false })));
  $('prodSearch').addEventListener('input', debounce(() => renderProducts({ refetch: false })));
  $('priceSearch').addEventListener('input', debounce(() => renderPricing({ refetch: false })));
  $('qFilter').addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qPriority')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qDue')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qOwner')?.addEventListener('input', debounce(() => renderQuotePipeline({ refetch: false })));
  $('qSearch').addEventListener('input', debounce(() => renderQuotePipeline({ refetch: false })));
  $('custSearch').addEventListener('input', debounce(() => renderCustomers({ refetch: false })));
  // #28 dirty-edit guard: track in-progress inline edits so capture/restoreDirty can
  // preserve sibling edits across a save or cache re-render.
  ['admOrders', 'admCompanies', 'admProducts', 'admPricing', 'admQuotes'].forEach((id) => {
    $(id)?.addEventListener('input', markDirty);
    $(id)?.addEventListener('change', markDirty);
  });
  $('qboConnect')?.addEventListener('click', connectQbo);
  $('qboSyncNow')?.addEventListener('click', runQboSync);
  $('qboDisconnect')?.addEventListener('click', disconnectQbo);
  $('ordExport').addEventListener('click', async () => {
    message('ordStatus', 'Preparing export...');
    try {
      const token = await getToken();
      const status = $('ordFilter').value;
      const url = '/api/admin/orders?export=csv' + (status ? `&status=${encodeURIComponent(status)}` : '');
      const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (!r.ok) throw new Error('export_failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'masest-orders.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      message('ordStatus', 'Exported.', 'ok');
    } catch { message('ordStatus', 'Could not export the CSV. Retry.', 'err'); }
  });
  $('admLogout').addEventListener('click', async () => { await logout(); location.reload(); });
  $('gateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const cap = gateCaptchaToken();
    if (TS_SITEKEY && !cap) { message('gateStatus', 'Complete the verification challenge.', 'err'); return; }
    message('gateStatus', 'Signing in...');
    try {
      await login({ email: $('gEmail').value.trim(), password: $('gPass').value, captchaToken: cap });
      message('gateStatus', '');
      boot();
    } catch (err) {
      const raw = String(err?.message || '');
      message('gateStatus', /captcha/i.test(raw) ? 'Verification failed. Reload and complete the challenge.' : 'Sign in failed. Check your email and password.', 'err');
    } finally {
      resetGateCaptcha();
    }
  });
  initGateTurnstile();
  wireProductForm();
  wireVariantForm();
  wireOfferForm();
  // Delegated row actions, bound once on each tab's table container (#36).
  wireOrders();
  wireCompanies();
  wireProducts();
  wirePricing();
  wireContent();
  wireQuotes();
  wireCrm();
  wireThreads();
}

wire();
boot();
