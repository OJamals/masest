/* MASEST staff admin console. */
import { login, logout, api, getToken } from './auth.js?v=20260711h';
import { esc, safeUrl, money, wireTablist, rovingTabindex, linkTabsToPanels } from './util.js?v=20260711h';
import { connectQbo, disconnectQbo, renderQboStatus, runQboSync } from './admin/qbo.js?v=20260711h';
import { editKey, captureDirty, restoreDirty } from './admin/edits.js?v=20260711h';
import { createTrafficRenderer } from './admin/traffic.js?v=20260711h';
import { createSeoAudit } from './admin/seo.js?v=20260711h';
import { createThreadsTab } from './admin/threads.js?v=20260711h';
import { createOffersTab } from './admin/offers.js?v=20260711h';
import { createProductsTab } from './admin/products.js?v=20260711h';
import { createPricingTab } from './admin/pricing.js?v=20260711h';
import { createContentTab } from './admin/content.js?v=20260711h';
import { createCompaniesTab } from './admin/companies.js?v=20260711h';
import { createCrmPanel } from './admin/crm.js?v=20260711h';
import { ORDER_STATUSES, createOrdersTab } from './admin/orders.js?v=20260711h';
import { createQuotesTab } from './admin/quotes.js?v=20260711h';
import { createCrmWorkspace } from './admin/crm-workspace.js?v=20260711h';
import { createReviewsTab } from './admin/reviews.js?v=20260711h';
import { createNewsletterTab } from './admin/newsletter.js?v=20260711h';
import { createInventoryCard } from './admin/inventory.js?v=20260711h';
import { createCouponsCard } from './admin/coupons.js?v=20260711h';
import { applyCapabilityUi, normalizeStaffContext, staffRoleLabel } from './admin/permissions.js?v=20260711h';

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
const admSkeleton = (rows = 5) => `<div class="adm-skeletons" aria-hidden="true">${'<div class="skeleton skeleton-block adm-skeleton-row"></div>'.repeat(rows)}</div>`;
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
  reviews: [],
  staff: null,
  loaded: new Set(),
};

function applyStaffContext(value) {
  state.staff = normalizeStaffContext(value);
  if ($('admGreeting')) $('admGreeting').textContent = state.staff.email ? `Signed in as ${state.staff.email}.` : 'Signed in as staff.';
  if ($('admRoleBadge')) {
    $('admRoleBadge').textContent = `${staffRoleLabel(state.staff.role)} access`;
    $('admRoleBadge').dataset.s = state.staff.role === 'read_only' ? 'changes_requested' : 'published';
  }
  if ($('admRoleHint')) {
    $('admRoleHint').textContent = state.staff.role === 'read_only'
      ? 'Viewing only. Mutation controls are disabled.'
      : 'Unavailable controls are disabled for this role.';
  }
  ['qboConnect', 'qboSyncNow', 'qboDisconnect'].forEach((id) => $(id)?.setAttribute('data-capability', 'admin.write'));
  applyCapabilityUi(document.body, state.staff);
}

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
  if (message?.source === 'customer_chat') return '<span class="pill">Customer chat</span>';
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
    applyStaffContext(stats.staff_context);
    $('admGate').hidden = true;
    $('admApp').hidden = false;
    renderStats(stats);
    void renderQboStatus().finally(() => applyCapabilityUi(document.body, state.staff));
    refreshReviewsBadge();
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

function reserveAdminHeight() {
  const main = document.querySelector('.adm-main');
  if (!main) return;
  const current = Number.parseFloat(main.style.minHeight) || 0;
  const visibleHeight = Math.ceil(main.getBoundingClientRect().height);
  if (visibleHeight > current) main.style.minHeight = `${visibleHeight}px`;
}

function setTab(tab) {
  // The old top-level Customers tab folded into the CRM People directory —
  // keep #customers deep links working by landing on that sub-view. Historical
  // Pricing and Emails hashes still land on their current host workspaces.
  if (tab === 'customers') { state.crmView = 'contacts'; tab = 'crm'; }
  const focusQuickBooks = tab === 'quickbooks' || tab === 'qbo';
  if (focusQuickBooks) tab = 'integrations';
  if (tab === 'pricing') tab = 'products';
  if (tab === 'offers') tab = 'crm';
  if (tab === 'traffic' || tab === 'seo') tab = 'analytics';
  if (tab === 'reports' || tab === 'exports') tab = 'finance';
  state.tab = document.querySelector(`[data-panel="${tab}"]`) ? tab : 'overview';
  // replaceState, NOT location.hash: assigning location.hash fires hashchange →
  // syncTabFromHash → setTab again, double-rendering every tab (concat-based lists
  // like quotes painted every row twice). Back/forward still works via hashchange.
  if (location.hash.slice(1) !== state.tab) history.replaceState(null, '', '#' + state.tab);
  reserveAdminHeight();
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.dataset.active = String(panel.dataset.panel === state.tab);
  });
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === state.tab)));
  rovingTabindex(tabs, (t) => t.dataset.tab === state.tab);
  const activeTab = tabs.find((button) => button.dataset.tab === state.tab);
  if ($('admNavCurrent') && activeTab) {
    const label = activeTab.cloneNode(true);
    label.querySelectorAll('i, .pill').forEach((node) => node.remove());
    $('admNavCurrent').textContent = label.textContent.trim();
  }
  if (matchMedia('(max-width: 980px)').matches) {
    document.querySelector('.adm-sidebar')?.classList.remove('is-open');
    $('admNavToggle')?.setAttribute('aria-expanded', 'false');
  }

  // #28 cache: a tab already loaded re-renders from memory (refetch:false) instead of
  // refetching; first visit (or post-mutation re-render) fetches. offers/traffic self-cache.
  const cached = state.loaded.has(state.tab);
  const render = {
    overview: () => renderStats(state.stats),
    analytics: () => { runSeoAudit(); renderTraffic(); },
    finance: wireReports,
    integrations: () => { void renderQboStatus().finally(() => applyCapabilityUi(document.body, state.staff)); },
    orders: renderOrders,
    companies: renderCompanies,
    products: (o) => {
      renderProducts(o); wireInventory();
      renderPricing({ refetch: !state.loaded.has('pricing') }); wireCoupons();
    },
    content: renderContent,
    blog: renderBlog,
    messages: renderThreads,
    quotes: renderQuotePipeline,
    reviews: renderReviews,
    newsletter: renderNewsletter,
    crm: () => { renderCrm(); renderOffers(); },
  }[state.tab];
  render?.({ refetch: !cached });
  if (focusQuickBooks) {
    requestAnimationFrame(() => document.getElementById('admQbo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
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

const opsGroupIcons = {
 Commerce: 'ph-currency-dollar',
 CRM: 'ph-address-book',
 Accounts: 'ph-buildings',
 'Catalog + analytics': 'ph-chart-line-up',
};

function actionIcon(item = {}) {
 const label = String(item.label || '').toLowerCase();
 const href = String(item.href || '').toLowerCase();
 if (href.includes('orders') || label.includes('order') || label.includes('fulfillment')) return 'ph-package';
 if (href.includes('companies') || label.includes('account') || label.includes('approval')) return 'ph-buildings';
 if (href.includes('quotes') || label.includes('quote')) return 'ph-clipboard-text';
 if (href.includes('messages') || label.includes('message')) return 'ph-chats';
 if (href.includes('products') || label.includes('stock') || label.includes('catalog')) return 'ph-flask';
 if (href.includes('crm') || label.includes('follow')) return 'ph-address-book';
 return 'ph-warning-circle';
}

function actionPriority(priority = '') {
 const value = String(priority || 'normal').trim().toLowerCase();
 return value || 'normal';
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
 ['Orders (7d)', fmtInt(stats.commerce?.orders_7d ?? stats.orders?.total)],
 ['AOV', money(commerce.average_order_value || 0, 'usd')],
 ['Fulfillment queue', fmtInt(commerce.fulfillment_queue)],
 ['NET exposure', money(commerce.net_exposure || 0, 'usd')],
 ]],
 ['CRM', [
 ['Unread messages', fmtInt(crm.unread_messages)],
 ['New quotes', fmtInt(crm.quotes_new)],
 ['Urgent quotes', fmtInt(crm.quotes_urgent)],
 ['Quote follow-ups due', fmtInt(stats.quotes_due?.overdue ?? crm.quotes_overdue)],
 ]],
 ['Accounts', [
 ['Pending', fmtInt(accounts.pending)],
 ['Approved', fmtInt(accounts.approved)],
 ['Suspended', fmtInt(accounts.suspended)],
 ['Setup follow-ups', fmtInt(stats.setup_followups?.companies ?? crm.setup_followups)],
 ]],
 ['Catalog + analytics', [
 ['Buy SKUs', fmtInt(catalog.buy)],
 ['Low stock', fmtInt(catalog.low_stock)],
 ['Views (7d)', fmtInt(stats.traffic?.views_7d)],
 ['7d quote submits', fmtInt(analytics.quote_submits_7d)],
 ['Quote rate', pct(analytics.quote_conversion_rate)],
 ]],
 ];
 return `<div class="adm-report-grid">${groups.map(([title, rows]) => `
 <div class="adm-card adm-report-card"><h2><i class="ph ${opsGroupIcons[title] || 'ph-chart-bar'}" aria-hidden="true"></i>${esc(title)}</h2>${rows.map(([label, value]) => `
 <div class="dash-row"><span>${esc(label)}</span><b data-numeric>${esc(value)}</b></div>
 `).join('')}</div>`).join('')}${renderSetupFollowups(stats)}</div>`;
}

function renderActionRail(actions = []) {
 if (!actions.length) return '<div class="adm-card adm-action-card"><h2>Priority actions</h2><div class="empty-state"><i class="ph ph-check-circle empty-icon" aria-hidden="true"></i><div class="empty-title">No urgent admin actions.</div><div class="empty-body">New orders, approvals, quote follow-ups, and message queues will appear here.</div></div></div>';
 return `<div class="adm-card adm-action-card"><h2>Priority actions</h2><div class="adm-action-list">${actions.map((item) => `
 <a class="adm-action-item" data-priority="${esc(actionPriority(item.priority))}" href="${esc(safeUrl(item.href || '#overview'))}"><span class="adm-action-icon"><i class="ph ${actionIcon(item)}" aria-hidden="true"></i></span><span><b>${esc(item.label)}</b><small class="muted">Priority ${esc(item.priority || 'normal')}</small></span><strong data-numeric>${esc(item.value || 0)}</strong></a>
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

function renderStats(stats = {}) {
 badge('aBadgePending', stats.companies?.pending || 0);
 badge('aBadgeMsg', stats.messages?.unread || 0);
 badge('aBadgeQuotes', stats.quotes?.new || stats.quotes?.new_count || 0);
 badge('aBadgeCrm', stats.crm_tasks?.overdue || stats.crm?.tasks_overdue || 0);
 // One number, one place: the grouped ops summary is the single metrics surface.
 // (The old 10-tile grid repeated revenue/pending/messages/low-stock a second time.)
 if ($('admStats')) $('admStats').innerHTML = '';
 if ($('admOpsSummary')) $('admOpsSummary').innerHTML = renderOpsSummary(stats);
 if ($('admActionRail')) $('admActionRail').innerHTML = renderActionRail(stats.actions || []);
}

// Re-pull the stats snapshot and repaint the nav badges + ops summary. Tab modules
// call this after a mutation that changes a badge count (approving an account,
// reading a thread, completing a CRM task) so the sidebar pills never go stale
// mid-session — the boot-time snapshot alone left Accounts/Messages/CRM frozen.
async function refreshStats() {
  try { const stats = await api('/api/admin/stats'); state.stats = stats; applyStaffContext(stats.staff_context); renderStats(stats); }
  catch { /* keep the last known counts rather than blanking the badges */ }
}

// "Load more" footer for the admin orders table — appends the next server page (#29).
// Generic "Load more" footer for an accumulated admin list (#29).
function admListPager(attr, loaded, total, hasMore) {
  if (!hasMore) return '';
  const count = total != null ? ` (${loaded} of ${total})` : '';
  return `<div class="adm-list-pager"><button class="btn btn-ghost btn-sm" ${attr} type="button">Load more${count}</button></div>`;
}

// Companies tab extracted to ./admin/companies.js (#36 split). statusBadge + admListPager + primitives injected.
// CRM contact panel (timeline/tasks/notes) injected into the company drawer.
const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
const { renderCompanies, wireCompanies, openCompanyDetail } = createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager, crm, setTab, refreshStats });
// Orders tab extracted to ./admin/orders.js (#36 split). statusBadge + admListPager + primitives injected.
const { renderOrders, wireOrders } = createOrdersTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, admListPager, refreshStats });
// Quotes pipeline tab extracted to ./admin/quotes.js (#36 split). statusBadge + badge + admListPager + primitives injected.
const { renderQuotePipeline, wireQuotes, openQuoteById } = createQuotesTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge, admListPager });
// Deep-link dispatcher: jumps from a CRM inbox task row to the owning surface.
// Declared as a hoisted function so it is in scope when passed to createCrmWorkspace;
// references openCompanyDetail, openQuoteById and crm (all initialized above this line).
function openSubject(type, id, label) {
  if (type === 'company') { setTab('companies'); openCompanyDetail(id); }
  else if (type === 'quote') { setTab('quotes'); openQuoteById(id); }
  else if (type === 'contact') { crm.openContactDrawer({ id, name: label || ('Contact ' + id) }); }
  else { setTab('crm'); }
}

// CRM workspace tab: top-level home for cross-account CRM surfaces (Tasks inbox, Contact directory).
const { renderCrm, wireCrm } = createCrmWorkspace({ $, api, state, admSkeleton, admEmpty, crm, openSubject, admListPager, refreshStats });

// Products tab extracted to ./admin/products.js (#36 split). Shared primitives injected.
const { renderProducts, wireProductForm, wireVariantForm, wireProducts } = createProductsTab({ $, api, state, message, admSkeleton, admEmpty });

// Pricing tab extracted to ./admin/pricing.js (#36 split). Shared primitives injected.
const { renderPricing, wirePricing } = createPricingTab({ $, api, state, message, admSkeleton, admEmpty });

// Content tab: staff-managed CMS entries for non-commerce public content.
const { renderContent, renderBlog, wireContent, wireBlog } = createContentTab({ $, api, state, admSkeleton, admEmpty });

// Messages/threads tab extracted to ./admin/threads.js (#36 split). Shared primitives + sourceLabel injected.
const { renderThreads, wireThreads } = createThreadsTab({ $, api, state, message, admSkeleton, admEmpty, sourceLabel, refreshStats });

// Reviews moderation tab (plan Task 13). Shared primitives + statusBadge/badge injected.
const { renderReviews, wireReviews, wireManualReviewForm, refreshReviewsBadge } = createReviewsTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge });
const { renderNewsletter, wireNewsletter } = createNewsletterTab({ $, api, state, message, admSkeleton, admEmpty, badge });

// Offers tab extracted to ./admin/offers.js (#36 split). Shared primitives injected.
const { renderOffers, wireOfferForm } = createOffersTab({ $, api, state, message, admSkeleton, admEmpty });

// Inventory + promo-codes cards inside the Products tab (extracted from the main
// controller to keep the per-tab #36 split consistent).
const { wireInventory } = createInventoryCard({ $, api, message, admSkeleton, admEmpty, downloadCsv });
const { wireCoupons } = createCouponsCard({ $, api, message, admSkeleton, admEmpty });

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
  $('admNavToggle')?.addEventListener('click', () => {
    const sidebar = document.querySelector('.adm-sidebar');
    const open = sidebar?.classList.toggle('is-open') || false;
    $('admNavToggle').setAttribute('aria-expanded', String(open));
  });
  wireTablist(document.querySelector('.adm-tabs[role="tablist"]'), (tab) => setTab(tab.dataset.tab));
  window.addEventListener('hashchange', syncTabFromHash);
  new MutationObserver(() => applyCapabilityUi(document.body, state.staff)).observe(document.body, { childList: true, subtree: true });
  // Status filter and the search boxes hit server query params → refetch (search
  // used to be client-side over cached rows, which silently missed anything past
  // the loaded page). Quote facet filters stay client-side over cached data (#28).
  $('ordFilter').addEventListener('change', () => renderOrders());
  $('ordSearch').addEventListener('input', debounce(() => renderOrders({ refetch: true })));
  $('coSearch').addEventListener('input', debounce(() => renderCompanies({ refetch: true })));
  $('prodSearch').addEventListener('input', debounce(() => renderProducts({ refetch: false })));
  $('priceSearch').addEventListener('input', debounce(() => renderPricing({ refetch: false })));
  $('qFilter').addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qPriority')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qDue')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
  $('qOwner')?.addEventListener('input', debounce(() => renderQuotePipeline({ refetch: false })));
  $('qSearch').addEventListener('input', debounce(() => renderQuotePipeline({ refetch: true })));
  $('rvFilter')?.addEventListener('change', () => renderReviews({ refetch: true }));
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
  wireBlog();
  wireQuotes();
  wireCrm();
  wireThreads();
  wireReviews();
  wireManualReviewForm();
  wireNewsletter();
}

wire();
boot();
