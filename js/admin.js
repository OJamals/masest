/* MASEST staff admin console. */
import { login, logout, api, apiBlob, getToken } from './auth.js?v=20260807c';
import { esc, safeUrl, money, wireTablist, rovingTabindex, linkTabsToPanels } from './util.js?v=20260807c';
import { editKey } from './admin/edits.js?v=20260807c';
import { createFeatureLoader } from './admin/feature-loader.js?v=20260807c';
import { applyCapabilityUi, normalizeStaffContext, staffRoleLabel } from './admin/permissions.js?v=20260807c';
import { renderAdminChrome, setAdminChromeUser } from './admin/chrome.js?v=20260807c';
import { createAdminSearch } from './admin/search.js?v=20260807c';

const $ = (id) => document.getElementById(id);

// Staff console chrome: one compact bar with staff identity + sign out. No
// storefront nav, cart, or marketing footer (see js/admin/chrome.js for why).
const adminChrome = renderAdminChrome({ onSignOut: () => { void logout(); } });

// Cross-entity search lives in the chrome but only after the staff gate clears.
let searchMounted = false;
function mountGlobalSearch() {
  const slot = adminChrome?.querySelector('.adm-chrome-search');
  if (searchMounted || !slot) return;
  searchMounted = true;
  createAdminSearch({ api, esc, debounce, onSelect: routeSearchResult }).mount(slot);
}

// Show-one-of-N sub-views inside a panel (Newsletter send paths, Products
// workspaces). Generic because three panels now need the same behaviour, and a
// panel that stacks unrelated jobs is harder to read than one that names them.
function wireSubViews(toggleId, key) {
  const toggle = $(toggleId);
  if (!toggle || toggle.dataset.wired) return;
  toggle.dataset.wired = '1';
  const viewAttr = `data-${key}-view`;
  const panelAttr = `data-${key}-panel`;
  toggle.addEventListener('click', (event) => {
    const button = event.target.closest(`[${viewAttr}]`);
    if (!button) return;
    const view = button.getAttribute(viewAttr);
    toggle.querySelectorAll(`[${viewAttr}]`).forEach((tab) => {
      const active = tab.getAttribute(viewAttr) === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll(`[${panelAttr}]`).forEach((panel) => {
      panel.hidden = panel.getAttribute(panelAttr) !== view;
    });
  });
}

// Overview numbers are entry points, not readouts: clicking one lands on the
// workspace that owns that work with the matching filter already applied.
function routeOpsMetric(route) {
  const task = setTab(route.tab, route.acctView ? { acctView: route.acctView } : {});
  // Unread support messages are conversations, not a settings page: land staff in
  // the inbox they already have on every surface.
  if (route.support) return Promise.resolve(task).then(showSupportConsole);
  if (!route.control) return task;
  return Promise.resolve(task).then(() => {
    const control = $(route.control);
    if (!control) return;
    control.value = route.value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Land on the workspace that owns the record: a drawer where the tab has one,
// otherwise the queue's own search box so the row is on screen upon arrival.
function routeSearchResult(item) {
  const context = {};
  if (item.tab === 'quotes' && item.open) context.openQuoteId = item.open;
  if (item.tab === 'companies' && item.open) context.openCompanyId = item.open;
  if (item.tab === 'crm' && item.open) {
    context.openContactId = item.open;
    context.openContactName = item.title;
  }
  const task = setTab(item.tab, context);
  if (!item.search) return task;
  const box = { orders: 'ordSearch', products: 'prodSearch' }[item.tab];
  return Promise.resolve(task).then(() => {
    if (!box || !$(box)) return;
    $(box).value = item.search;
    $(box).dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// #28 dirty-edit guard: flag an inline control the moment the user edits it, so a
// later sibling save / cache re-render can snapshot and restore it (see admin/edits.js).
function markDirty(event) {
  const el = event.target;
  if (el.matches?.('input:not([type=checkbox]):not([type=file]), select, textarea') && editKey(el)) {
    el.dataset.dirty = '1';
  }
}

// Coalesce rapid input (search keystrokes) into a single trailing call so a query like
// "warehouse" triggers one fetch+render instead of one per character.
function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Loading skeleton + rich empty state for admin lists (#31). Reuse the shared
// components.css .skeleton / .empty-state styles.
const admSkeleton = (rows = 5) => `<div class="adm-skeletons" role="status"><span class="sr-only">Loading admin data</span>${'<div class="skeleton skeleton-block adm-skeleton-row"></div>'.repeat(rows)}</div>`;
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
  setAdminChromeUser(state.staff.email);
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
    mountGlobalSearch();
    void mountSupportConsole();
    renderStats(stats);
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

// Hold the OUTGOING panel's height across a tab swap so the viewport doesn't
// lurch (and the scroll position doesn't collapse) while the incoming panel's
// feature module loads. Released as soon as that render settles.
//
// This used to only ever GROW min-height and never reset it, which meant every
// short tab inherited the tallest tab's scroll height for the rest of the
// session — after visiting Orders, Overview (2.5k px of content) carried a
// ~13k px min-height and ~10k px of dead scroll below it.
function reserveAdminHeight() {
  const main = document.querySelector('.adm-main');
  if (!main) return;
  main.style.minHeight = `${Math.ceil(main.getBoundingClientRect().height)}px`;
}

function releaseAdminHeight(tab, token) {
  // A newer navigation already reserved its own height; leave it alone.
  if (!isCurrentRender(tab, token)) return;
  const main = document.querySelector('.adm-main');
  if (main) main.style.minHeight = '';
}

const FEATURE_GROUP_BY_TAB = {
  analytics: 'analytics',
  integrations: 'integrations',
  orders: 'orders',
  companies: 'companies',
  products: 'products',
  content: 'content',
  'support-settings': 'support',
  quotes: 'quotes',
  reviews: 'reviews',
  newsletter: 'newsletter',
  crm: 'crm',
};
const FEATURE_LABEL_BY_TAB = {
  analytics: 'Analytics',
  integrations: 'Integrations',
  orders: 'Orders',
  companies: 'Accounts',
  products: 'Products',
  content: 'Content',
  'support-settings': 'Support',
  quotes: 'Quotes',
  reviews: 'Reviews',
  newsletter: 'Newsletter',
  crm: 'CRM',
};
let renderToken = 0;
let featureRenderTail = Promise.resolve();
let invalidatePendingFeatureLoad = () => {};

function beginFeatureNavigation() {
  invalidatePendingFeatureLoad();
  let invalidate;
  const invalidated = new Promise((resolve) => {
    invalidate = () => resolve({ stale: true });
  });
  invalidatePendingFeatureLoad = invalidate;
  return invalidated;
}

function featurePanel(tab) {
  return document.querySelector(`[data-panel="${tab}"]`);
}

function clearFeatureLoadError(tab) {
  featurePanel(tab)?.querySelector('[data-feature-load-error]')?.remove();
}

function showFeatureLoadError(tab) {
  const panel = featurePanel(tab);
  if (!panel) return;
  clearFeatureLoadError(tab);
  const error = document.createElement('p');
  error.className = 'adm-status';
  error.dataset.state = 'err';
  error.dataset.featureLoadError = '';
  error.append(`Could not load ${FEATURE_LABEL_BY_TAB[tab] || 'workspace'}. `);
  const retry = document.createElement('button');
  retry.className = 'btn btn-ghost btn-sm';
  retry.type = 'button';
  retry.textContent = 'Retry';
  // Browsers retain a failed module record for this document. Reloading preserves
  // the hash while creating a fresh module map; adding a one-off query would break
  // the release-coupled admin module graph.
  retry.addEventListener('click', () => location.reload(), { once: true });
  error.append(retry);
  panel.prepend(error);
}

function isCurrentRender(tab, token) {
  return state.tab === tab && renderToken === token;
}

function renderFeatureTab(tab, token, options, invalidated) {
  const panel = featurePanel(tab);
  if (panel) {
    panel.dataset.featureRenderToken = String(token);
    panel.setAttribute('aria-busy', 'true');
  }
  const loaded = Promise.race([
    featureLoader.load(FEATURE_GROUP_BY_TAB[tab]).then(
      (feature) => ({ feature }),
      (error) => ({ error }),
    ),
    invalidated,
  ]);
  const task = featureRenderTail.then(async () => {
    try {
      const result = await loaded;
      if (result.stale || !isCurrentRender(tab, token)) return;
      if ('error' in result) throw result.error;
      await result.feature.wire();
      if (!isCurrentRender(tab, token)) return;
      await result.feature.render(options);
      if (!isCurrentRender(tab, token)) return;
      clearFeatureLoadError(tab);
      applyCapabilityUi(panel || document.body, state.staff);
    } catch {
      if (isCurrentRender(tab, token)) showFeatureLoadError(tab);
    } finally {
      if (panel?.dataset.featureRenderToken === String(token)) {
        panel.removeAttribute('aria-busy');
        delete panel.dataset.featureRenderToken;
      }
    }
  });
  featureRenderTail = task.catch(() => {});
  return task;
}

function setTab(tab, context = {}) {
  // The old top-level Customers tab folded into the CRM People directory —
  // keep #customers deep links working by landing on that sub-view. Historical
  // Pricing and Emails hashes still land on their current host workspaces.
  if (tab === 'customers') { state.crmView = 'contacts'; tab = 'crm'; }
  if (tab === 'blog') { state.contentView = 'blog'; tab = 'content'; }
  else if (tab === 'content' && !state.contentView) state.contentView = 'pages';
  const focusQuickBooks = tab === 'quickbooks' || tab === 'qbo';
  if (focusQuickBooks) tab = 'integrations';
  if (tab === 'pricing') tab = 'products';
  if (tab === 'messages') tab = 'support-settings';
  if (tab === 'offers') tab = 'newsletter';
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
  const activeTab = tabs.find((button) => button.dataset.tab === state.tab);
  // Support settings is a routable destination with no sidebar tab. Without the
  // fallback every tab would go tabindex="-1" and the sidebar would drop out of
  // the keyboard tab order entirely while that panel is open.
  rovingTabindex(tabs, (t) => t === (activeTab || tabs[0]));
  if ($('admNavCurrent')) {
    let text = '';
    if (activeTab) {
      const label = activeTab.cloneNode(true);
      label.querySelectorAll('i, .pill').forEach((node) => node.remove());
      text = label.textContent.trim();
    } else {
      text = document.querySelector(`[data-panel="${state.tab}"] .adm-panel-title h2`)?.textContent?.trim() || '';
    }
    if (text) $('admNavCurrent').textContent = text;
  }
  if (matchMedia('(max-width: 980px)').matches) {
    document.querySelector('.adm-sidebar')?.classList.remove('is-open');
    $('admNavToggle')?.setAttribute('aria-expanded', 'false');
  }

  const invalidated = beginFeatureNavigation();
  const token = ++renderToken;
  clearFeatureLoadError(state.tab);
  const cached = state.loaded.has(state.tab);
  let task = Promise.resolve();
  if (state.tab === 'overview') renderStats(state.stats);
  else if (state.tab === 'finance') wireReports();
  else if (FEATURE_GROUP_BY_TAB[state.tab]) {
    task = renderFeatureTab(state.tab, token, { ...context, tab: state.tab, refetch: !cached }, invalidated);
  }
  // Drop the swap reservation once this panel's render has settled, so a short
  // tab never keeps a tall tab's scroll height.
  const settledTab = state.tab;
  void Promise.resolve(task)
    .catch(() => {})
    .then(() => requestAnimationFrame(() => releaseAdminHeight(settledTab, token)));
  if (focusQuickBooks) {
    void task.then(() => {
      if (!isCurrentRender('integrations', token)) return;
      requestAnimationFrame(() => document.getElementById('admQbo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  }
  return task;
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
 Publishing: 'ph-note-pencil',
 'Catalog + analytics': 'ph-chart-line-up',
};

function requestIcon(item = {}) {
 const label = String(item.label || '').toLowerCase();
 const href = String(item.href || '').toLowerCase();
 if (label.includes('document')) return 'ph-files';
 if (href.includes('companies') || label.includes('account') || label.includes('approval')) return 'ph-buildings';
 if (href.includes('quotes') || label.includes('quote')) return 'ph-clipboard-text';
 if (href.includes('messages') || label.includes('message')) return 'ph-chats';
 return 'ph-inbox';
}

function requestPriority(priority = '') {
 const value = String(priority || 'normal').trim().toLowerCase();
 return value || 'normal';
}

function renderOpsSummary(stats = {}) {
 const commerce = stats.commerce || {};
 const crm = stats.crm || {};
 const accounts = stats.accounts || {};
 const catalog = stats.catalog_health || {};
 const analytics = stats.analytics || {};
 const content = stats.content || {};
 // Third element routes the number into the workspace that owns the work:
 // { tab, control?, value? } sets that queue's own filter on arrival. A number
 // with no honest filter still routes to its workspace rather than dead-ending.
 const groups = [
 ['Commerce', [
 ['30d revenue', money(commerce.revenue_30d || 0, 'usd'), { tab: 'finance' }],
 ['Orders (7d)', fmtInt(stats.commerce?.orders_7d ?? stats.orders?.total), { tab: 'orders' }],
 ['AOV', money(commerce.average_order_value || 0, 'usd'), { tab: 'finance' }],
 ['Fulfillment queue', fmtInt(commerce.fulfillment_queue), { tab: 'orders', control: 'ordFilter', value: 'needs_fulfillment' }],
 ['NET exposure', money(commerce.net_exposure || 0, 'usd'), { tab: 'orders', control: 'ordFilter', value: 'net_open' }],
 ]],
 ['CRM', [
 ['Unread messages', fmtInt(crm.unread_messages), { tab: 'overview', support: true }],
 ['New quotes', fmtInt(crm.quotes_new), { tab: 'quotes', control: 'qFilter', value: 'new' }],
 ['Urgent quotes', fmtInt(crm.quotes_urgent), { tab: 'quotes', control: 'qPriority', value: 'urgent' }],
 ['Quote follow-ups due', fmtInt(stats.quotes_due?.overdue ?? crm.quotes_overdue), { tab: 'quotes', control: 'qDue', value: 'overdue' }],
 // Drove the sidebar badge but was missing from "work that needs attention",
 // which is the one place staff start their day.
 ['Overdue follow-ups', fmtInt(stats.crm_tasks?.overdue ?? crm.tasks_overdue), { tab: 'crm' }],
 ]],
 ['Publishing', [
 ['Drafts', fmtInt(content.drafts), { tab: 'content' }],
 ['Scheduled', fmtInt(content.scheduled), { tab: 'content' }],
 // Scheduled time passed, still unpublished: the publish sweep is not running.
 ['Scheduled past due', fmtInt(content.schedule_overdue), { tab: 'integrations' }],
 ['Automations needing attention', fmtInt(stats.automation?.attention), { tab: 'integrations' }],
 ]],
 ['Accounts', [
 ['Pending', fmtInt(accounts.pending), { tab: 'companies', acctView: 'companies' }],
 ['Approved', fmtInt(accounts.approved), { tab: 'companies', acctView: 'companies' }],
 ['Suspended', fmtInt(accounts.suspended), { tab: 'companies', acctView: 'companies' }],
 ['Setup follow-ups', fmtInt(stats.setup_followups?.companies ?? crm.setup_followups), { tab: 'companies', acctView: 'companies' }],
 ]],
 ['Catalog + analytics', [
 ['Buy SKUs', fmtInt(catalog.buy), { tab: 'products' }],
 ['Low stock', fmtInt(catalog.low_stock), { tab: 'products' }],
 ['Views (7d)', fmtInt(stats.traffic?.views_7d), { tab: 'analytics' }],
 ['7d quote submits', fmtInt(analytics.quote_submits_7d), { tab: 'analytics' }],
 ['Quote rate', pct(analytics.quote_conversion_rate), { tab: 'analytics' }],
 ]],
 ];
 const row = ([label, value, route]) => {
   const body = `<span>${esc(label)}</span><b data-numeric>${esc(value)}</b>`;
   if (!route) return `<div class="dash-row">${body}</div>`;
   return `<a class="dash-row dash-row-route" href="#${esc(route.tab)}" data-ops-route="${esc(JSON.stringify(route))}">${body}<i class="ph ph-arrow-right" aria-hidden="true"></i></a>`;
 };
 return `<div class="adm-report-grid">${groups.map(([title, rows]) => `
 <div class="adm-card adm-report-card"><h2><i class="ph ${opsGroupIcons[title] || 'ph-chart-bar'}" aria-hidden="true"></i>${esc(title)}</h2>${rows.map(row).join('')}</div>`).join('')}${renderSetupFollowups(stats)}</div>`;
}

function renderRequestQueue(requests = []) {
 if (!requests.length) return '<div class="adm-card adm-action-card"><h2>Requests queue</h2><div class="empty-state"><i class="ph ph-check-circle empty-icon" aria-hidden="true"></i><div class="empty-title">No open requests.</div><div class="empty-body">Account, quote, message, and document requests will appear here.</div></div></div>';
 return `<div class="adm-card adm-action-card"><h2>Requests queue</h2><div class="adm-action-list">${requests.map((item) => `
 <a class="adm-action-item" data-priority="${esc(requestPriority(item.priority))}" href="${esc(safeUrl(item.href || '#overview'))}"><span class="adm-action-icon"><i class="ph ${requestIcon(item)}" aria-hidden="true"></i></span><span><b>${esc(item.label)}</b><small class="muted">Open requests</small></span><strong data-numeric>${esc(item.value || 0)}</strong></a>
 `).join('')}</div></div>`;
}

// Authenticated CSV download (Bearer) — fetch then blob-save, since a plain link
// can't attach the auth header. Mirrors the orders export above.
async function downloadCsv(url, filename, statusId) {
  message(statusId, 'Preparing export…');
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
  void import('./admin/stripe.js?v=20260807c').then(({ wireStripePayouts, renderStripePayouts }) => {
    wireStripePayouts();
    return renderStripePayouts();
  }).catch(() => {
    message('stripePayoutStatus', 'Stripe payout preview unavailable. Retry.', 'err');
  });
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
    message('repResult', 'Running report…');
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
 const unreadMessages = stats.messages?.unread || stats.crm?.unread_messages || 0;
 badge('aBadgeMsg', unreadMessages);
 badge('adminSupportUnread', unreadMessages);
 if ($('adminSupportSummary')) {
   $('adminSupportSummary').textContent = unreadMessages
     ? unreadMessages === 1 ? '1 chat needs a reply' : `${unreadMessages} chats need a reply`
     : 'No chats need a reply';
 }
 badge('aBadgeQuotes', stats.quotes?.new || stats.quotes?.new_count || 0);
 badge('aBadgeCrm', stats.crm_tasks?.overdue || stats.crm?.tasks_overdue || 0);
 // One number, one place: the grouped ops summary is the single metrics surface.
 // (The old 10-tile grid repeated revenue/pending/messages/low-stock a second time.)
 if ($('admStats')) $('admStats').innerHTML = '';
 if ($('admOpsSummary')) $('admOpsSummary').innerHTML = renderOpsSummary(stats);
 if ($('admRequestQueue')) $('admRequestQueue').innerHTML = renderRequestQueue(stats.request_queue || []);
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

function wireDirtyControls(ids) {
  ids.forEach((id) => {
    $(id)?.addEventListener('input', markDirty);
    $(id)?.addEventListener('change', markDirty);
  });
}

// The feature loader hands back only render()/wire(), so the console's open()
// is captured here when the support group is built.
let openSupportConsole = async () => {};
const featureLoader = createFeatureLoader({
  analytics: async () => {
    const [{ createTrafficRenderer }, { createSeoAudit }] = await Promise.all([
      import('./admin/traffic.js?v=20260807c'),
      import('./admin/seo.js?v=20260807c'),
    ]);
    const renderTraffic = createTrafficRenderer({ $, api, admSkeleton, pct });
    const runSeoAudit = createSeoAudit({ $, state });
    return {
      wire() {},
      render: () => Promise.all([runSeoAudit(), renderTraffic()]),
    };
  },
  integrations: async () => {
    const { connectQbo, disconnectQbo, renderQboStatus, runQboSync } = await import('./admin/qbo.js?v=20260807c');
    const { renderShipStationStatus, wireShipStationStatus } = await import('./admin/shipstation.js?v=20260807c');
    const { renderStripeStatus } = await import('./admin/stripe.js?v=20260807c');
    const { renderIntegrationHealth, wireIntegrationHealth } = await import('./admin/integration-health.js?v=20260807c');
    const { createAutomationCard } = await import('./admin/automation.js?v=20260807c');
    const { renderAutomation } = createAutomationCard({ $, api, admSkeleton });
    return {
      wire() {
        $('qboConnect')?.addEventListener('click', connectQbo);
        $('qboSyncNow')?.addEventListener('click', runQboSync);
        $('qboDisconnect')?.addEventListener('click', disconnectQbo);
        $('automationRefresh')?.addEventListener('click', () => renderAutomation());
        wireShipStationStatus();
        wireIntegrationHealth();
      },
      async render() {
        try {
          const qboStatusPromise = renderQboStatus();
          await Promise.all([qboStatusPromise, renderStripeStatus(), renderShipStationStatus(), renderIntegrationHealth(), renderAutomation()]);
        }
        finally { applyCapabilityUi(document.body, state.staff); }
      },
    };
  },
  orders: async () => {
    const { ORDER_STATUSES, NEEDS_FULFILLMENT, createOrdersTab } = await import('./admin/orders.js?v=20260807c');
    const { renderOrders, wireOrders } = createOrdersTab({
      $, api, apiBlob, state, message, admSkeleton, admEmpty, statusBadge, admListPager, refreshStats,
    });
    return {
      wire() {
        // The lifecycle view leads: "what still needs shipping" is the queue staff
        // work from, and it is the one view no single status value could express.
        $('ordFilter').insertAdjacentHTML('beforeend', `<option value="${NEEDS_FULFILLMENT}">Needs fulfillment</option>`);
        ORDER_STATUSES.forEach((status) => {
          $('ordFilter').insertAdjacentHTML('beforeend', `<option value="${status}">${status.replaceAll('_', ' ')}</option>`);
        });
        $('ordFilter').addEventListener('change', () => renderOrders());
        $('ordSearch').addEventListener('input', debounce(() => renderOrders({ refetch: true })));
        $('ordExport').addEventListener('click', () => {
          const status = $('ordFilter').value;
          const url = '/api/admin/orders?export=csv' + (status ? `&status=${encodeURIComponent(status)}` : '');
          downloadCsv(url, 'masest-orders.csv', 'ordStatus');
        });
        wireDirtyControls(['admOrders']);
        wireOrders();
      },
      render: (options) => renderOrders(options),
    };
  },
  companies: async () => {
    const [{ createCompaniesTab }, { createCrmPanel }] = await Promise.all([
      import('./admin/companies.js?v=20260807c'),
      import('./admin/crm.js?v=20260807c'),
    ]);
    const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
    const { renderCompanies, wireCompanies, openCompanyDetail, showAcctView } = createCompaniesTab({
      $,
      api,
      state,
      admSkeleton,
      admEmpty,
      statusBadge,
      admListPager,
      crm,
      setTab,
      openSupportThread: (id) => setTab('support-settings', { openCompanyId: id }),
      refreshStats,
    });
    return {
      wire() {
        $('coSearch').addEventListener('input', debounce(() => renderCompanies({ refetch: true })));
        wireDirtyControls(['admCompanies']);
        wireCompanies();
      },
      async render(options) {
        await renderCompanies(options);
        // Overview account numbers land on the businesses list, not the Users
        // sub-view they would otherwise default to.
        if (options.acctView) showAcctView(options.acctView);
        if (options.openCompanyId) await openCompanyDetail(options.openCompanyId);
      },
    };
  },
  products: async () => {
    const [
      { createProductsTab },
      { createPricingTab },
      { createInventoryCard },
      { createCouponsCard },
    ] = await Promise.all([
      import('./admin/products.js?v=20260807c'),
      import('./admin/pricing.js?v=20260807c'),
      import('./admin/inventory.js?v=20260807c'),
      import('./admin/coupons.js?v=20260807c'),
    ]);
    const { renderProducts, wireProductForm, wireVariantForm, wireProducts } = createProductsTab({
      $, api, state, message, admSkeleton, admEmpty,
    });
    const { renderPricing, wirePricing } = createPricingTab({ $, api, state, message, admSkeleton, admEmpty });
    const { renderLowStock, wireInventory } = createInventoryCard({
      $, api, message, admSkeleton, admEmpty, downloadCsv,
    });
    const { renderCoupons, wireCoupons } = createCouponsCard({ $, api, message, admSkeleton, admEmpty });
    let auxiliaryRenderedByWire = true;
    return {
      wire() {
        $('prodSearch').addEventListener('input', debounce(() => renderProducts({ refetch: false })));
        $('priceSearch').addEventListener('input', debounce(() => renderPricing({ refetch: false })));
        wireDirtyControls(['admProducts', 'admPricing']);
        wireProductForm();
        wireVariantForm();
        wireProducts();
        wirePricing();
        wireInventory();
        wireCoupons();
        // Catalog browsing, stock, and price administration are separate jobs;
        // stacking all six on one screen made none of them findable.
        wireSubViews('prodToggle', 'prod');
      },
      async render(options) {
        const renders = [
          renderProducts(options),
          renderPricing({ refetch: !state.loaded.has('pricing') }),
        ];
        if (auxiliaryRenderedByWire) auxiliaryRenderedByWire = false;
        else renders.push(renderLowStock(), renderCoupons());
        await Promise.all(renders);
      },
    };
  },
  content: async () => {
    const { createContentTab } = await import('./admin/content.js?v=20260807c');
    const { renderContent, renderBlog, wireContent, wireBlog } = createContentTab({
      $, api, state, admSkeleton, admEmpty,
    });
    // Pages and blog posts share one editor module that mounts into exactly one
    // root and clears the other, so switching sub-view has to re-render rather
    // than just unhide a cached panel.
    const showContentView = (requested) => {
      const view = requested === 'blog' ? 'blog' : 'pages';
      state.contentView = view;
      $('contentToggle')?.querySelectorAll('[data-content-view]').forEach((button) => {
        const active = button.getAttribute('data-content-view') === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.querySelectorAll('[data-content-panel]').forEach((panel) => {
        panel.hidden = panel.getAttribute('data-content-panel') !== view;
      });
      return view;
    };
    return {
      wire() {
        wireContent();
        wireBlog();
        const toggle = $('contentToggle');
        if (!toggle || toggle.dataset.wired) return;
        toggle.dataset.wired = '1';
        toggle.addEventListener('click', (event) => {
          const button = event.target.closest('[data-content-view]');
          if (!button) return;
          const requested = button.getAttribute('data-content-view');
          if (requested === (state.contentView || 'pages')) return;
          void (showContentView(requested) === 'blog' ? renderBlog() : renderContent());
        });
      },
      render: (options) => showContentView(options.tab === 'blog' ? 'blog' : state.contentView) === 'blog'
        ? renderBlog(options)
        : renderContent(options),
    };
  },
  support: async () => {
    const { createThreadsTab } = await import('./admin/threads.js?v=20260807c');
    const { renderThreads, wireThreads, openThread, openConsole } = createThreadsTab({
      $, api, state, message, admSkeleton, admEmpty, sourceLabel, refreshStats,
    });
    openSupportConsole = openConsole;
    return {
      wire() {
        wireThreads();
      },
      async render(options) {
        await renderThreads(options);
        if (options.openCompanyId) await openThread(options.openCompanyId);
      },
    };
  },
  quotes: async () => {
    const { createQuotesTab } = await import('./admin/quotes.js?v=20260807c');
    const { renderQuotePipeline, wireQuotes, openQuoteById } = createQuotesTab({
      $, api, state, message, admSkeleton, admEmpty, statusBadge, badge, admListPager,
    });
    return {
      wire() {
        $('qFilter').addEventListener('change', () => renderQuotePipeline({ refetch: false }));
        $('qPriority')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
        $('qDue')?.addEventListener('change', () => renderQuotePipeline({ refetch: false }));
        $('qOwner')?.addEventListener('input', debounce(() => renderQuotePipeline({ refetch: false })));
        $('qSearch').addEventListener('input', debounce(() => renderQuotePipeline({ refetch: true })));
        wireDirtyControls(['admQuotes']);
        wireQuotes();
      },
      async render(options) {
        await renderQuotePipeline(options);
        if (options.openQuoteId) await openQuoteById(options.openQuoteId);
      },
    };
  },
  reviews: async () => {
    const { createReviewsTab } = await import('./admin/reviews.js?v=20260807c');
    const {
      renderReviews,
      wireReviews,
      wireManualReviewForm,
      refreshReviewsBadge,
    } = createReviewsTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, badge });
    return {
      wire() {
        $('rvFilter')?.addEventListener('change', () => renderReviews({ refetch: true }));
        wireReviews();
        wireManualReviewForm();
      },
      async render(options) {
        await Promise.all([renderReviews(options), refreshReviewsBadge()]);
      },
    };
  },
  newsletter: async () => {
    const [{ createNewsletterTab }, { createOffersTab }] = await Promise.all([
      import('./admin/newsletter.js?v=20260807c'),
      import('./admin/offers.js?v=20260807c'),
    ]);
    const { renderNewsletter, wireNewsletter } = createNewsletterTab({
      $, api, state, message, admSkeleton, admEmpty, badge,
    });
    const { renderOffers, wireOfferForm } = createOffersTab({
      $, api, state, message, admSkeleton, admEmpty,
    });
    return {
      wire() {
        wireNewsletter();
        wireOfferForm();
        // Only one send surface visible at a time: the campaign editor reaches
        // subscribers and leads, the announcement form reaches customer accounts,
        // and both send irreversibly.
        wireSubViews('nlToggle', 'nl');
      },
      render: (options) => Promise.all([renderNewsletter(options), renderOffers(options)]),
    };
  },
  crm: async () => {
    const [{ createCrmWorkspace }, { createCrmPanel }] = await Promise.all([
      import('./admin/crm-workspace.js?v=20260807c'),
      import('./admin/crm.js?v=20260807c'),
    ]);
    const crm = createCrmPanel({ $, api, admSkeleton, admEmpty });
    const openSubject = (type, id, label) => {
      if (type === 'company') return setTab('companies', { openCompanyId: id });
      if (type === 'quote') return setTab('quotes', { openQuoteId: id });
      if (type === 'contact') return crm.openContactDrawer({ id, name: label || ('Contact ' + id) });
      return setTab('crm');
    };
    const { renderCrm, wireCrm } = createCrmWorkspace({
      $, api, state, admSkeleton, admEmpty, crm, openSubject, admListPager, refreshStats,
    });
    return {
      wire: wireCrm,
      render: async (options) => {
        const rendered = await renderCrm(options);
        // Global-search deep link into a person's drawer.
        if (options?.openContactId) {
          openSubject('contact', options.openContactId, options.openContactName);
        }
        return rendered;
      },
    };
  },
});

// The shared customer-support console (js/admin-support.js) renders its own
// launcher and mounts once the staff gate clears, so it is available from every
// tab rather than only after the Customer support tab has been opened.
let supportMount = null;
function mountSupportConsole() {
  // One shared promise, so a caller that needs the console OPEN can await the
  // same mount an early boot call started instead of racing past a "pending" flag.
  supportMount ||= featureLoader.load('support')
    .then((support) => support.wire())
    .catch(() => { /* settings page still loads prefs; console stays unavailable */ });
  return supportMount;
}

async function showSupportConsole() {
  await mountSupportConsole();
  await openSupportConsole();
}

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

function wireAdminSidebarScrollRelease() {
  document.querySelectorAll('.adm-sidebar.adm-tabs-wrap').forEach((rail) => {
    rail.addEventListener('wheel', (event) => {
      if (event.defaultPrevented || event.ctrlKey || !event.deltaY) return;
      const maxScrollTop = rail.scrollHeight - rail.clientHeight;
      if (maxScrollTop <= 0) return;
      const atTop = rail.scrollTop <= 1;
      const atBottom = rail.scrollTop >= maxScrollTop - 1;
      if (!(event.deltaY < 0 && atTop) && !(event.deltaY > 0 && atBottom)) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? parseFloat(getComputedStyle(rail).lineHeight) || 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
      event.preventDefault();
      window.scrollBy({ top: event.deltaY * unit, behavior: 'instant' });
    }, { passive: false });
  });
}

function wire() {
  wireAdminSidebarScrollRelease();
  linkTabsToPanels(document, 'adm');
  // Delegated: the Overview repaints its rows on every visit and after each
  // refreshStats(), so per-element listeners would be rebound or lost.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-ops-route]');
    if (!link) return;
    event.preventDefault();
    try { void routeOpsMetric(JSON.parse(link.dataset.opsRoute)); } catch { /* keep the href fallback */ }
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
  $('gateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const cap = gateCaptchaToken();
    if (TS_SITEKEY && !cap) { message('gateStatus', 'Complete the verification challenge.', 'err'); return; }
    message('gateStatus', 'Signing in…');
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
}

wire();
boot();
