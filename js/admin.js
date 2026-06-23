/* MASEST staff admin console. */
import { login, logout, api, getToken } from './auth.js';
import { esc, safeUrl, money, dateTime as date, wireTablist, rovingTabindex, confirmDialog } from './util.js';
import { connectQbo, renderQboStatus, runQboSync } from './admin/qbo.js';
import { editKey, captureDirty, restoreDirty } from './admin/edits.js';
import { createTrafficRenderer } from './admin/traffic.js';
import { createSeoAudit } from './admin/seo.js';
import { createThreadsTab } from './admin/threads.js';
import { createOffersTab } from './admin/offers.js';
import { createProductsTab } from './admin/products.js';
import { createPricingTab } from './admin/pricing.js';
import { createCustomersTab } from './admin/customers.js';
import { createCompaniesTab } from './admin/companies.js';
import { createOrdersTab } from './admin/orders.js';

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

const QUOTE_STATUSES = ['new', 'contacted', 'closed', 'spam'];

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
function quoteDueInDays(days) {
  return new Date(Date.now() + days * 86400e3).toISOString();
}

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
    overview: () => { renderStats(state.stats); runSeoAudit(); },
    orders: renderOrders,
    companies: renderCompanies,
    customers: renderCustomers,
    products: renderProducts,
    pricing: renderPricing,
    messages: renderThreads,
    quotes: renderQuotePipeline,
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

function renderStats(stats = {}) {
 badge('aBadgePending', stats.companies?.pending || 0);
 badge('aBadgeMsg', stats.messages?.unread || 0);
 badge('aBadgeQuotes', stats.quotes?.new || stats.quotes?.new_count || 0);
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
const { renderCompanies } = createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager });
// Orders tab extracted to ./admin/orders.js (#36 split). statusBadge + admListPager + primitives injected.
const { renderOrders } = createOrdersTab({ $, api, state, message, admSkeleton, admEmpty, statusBadge, admListPager });

// Products tab extracted to ./admin/products.js (#36 split). Shared primitives injected.
const { renderProducts, wireProductForm, wireVariantForm } = createProductsTab({ $, api, state, message, admSkeleton, admEmpty });

// Pricing tab extracted to ./admin/pricing.js (#36 split). Shared primitives injected.
const { renderPricing } = createPricingTab({ $, api, state, message, admSkeleton });

// Messages/threads tab extracted to ./admin/threads.js (#36 split). Shared primitives + sourceLabel injected.
const renderThreads = createThreadsTab({ $, api, state, message, admSkeleton, sourceLabel });

async function renderQuotePipeline({ append = false, refetch = true } = {}) {
  const box = $('admQuotes');
  const snap = captureDirty(box);
  if (refetch) {
    if (!append) { state.quotes = []; state.quotesOffset = 0; box.innerHTML = admSkeleton(); }
    let data;
    try {
      const params = new URLSearchParams({ limit: '100', offset: String(state.quotesOffset || 0) });
      data = await api('/api/admin/quotes?' + params.toString());
    } catch {
      if (!append) box.innerHTML = '<p class="adm-status" data-state="err">Could not load quotes. Reload to retry.</p>';
      return;
    }
    state.quotes = (state.quotes || []).concat(data.quotes || []);
    state.quotesOffset = (state.quotesOffset || 0) + (data.quotes || []).length;
    state.quotesTotal = data.total;
    state.quotesHasMore = !!data.has_more;
    state.quotesNeedsMigration = !!data.needs_migration;
    badge('aBadgeQuotes', data.urgent_count || data.new_count || 0);
    state.loaded.add('quotes');
  }
  if (state.quotesNeedsMigration) {
    box.innerHTML = '<p class="muted">No quote database yet. Apply supabase/schema-quotes.sql to store and triage leads here.</p>';
    return;
  }
  if (!state.companies?.length) {
    try { state.companies = (await api('/api/admin/companies?limit=500')).companies || []; } catch { state.companies = []; }
  }
  const quotesPager = admListPager('data-load-more-quotes', state.quotes.length, state.quotesTotal, state.quotesHasMore);
  const wireQuotesMore = () => box.querySelector('[data-load-more-quotes]')?.addEventListener('click', () => renderQuotePipeline({ append: true }));

  const coOpts = (state.companies || [])
    .map((company) => `<option value="${esc(company.id)}">${esc(company.name)} (${esc(company.status || '')})</option>`)
    .join('');
  const q = $('qSearch').value.trim().toLowerCase();
  const filter = $('qFilter').value;
  const priority = $('qPriority')?.value || '';
  const ownerFilter = $('qOwner')?.value.trim().toLowerCase() || '';
  const dueFilter = $('qDue')?.value || '';
  const now = Date.now();
  const quotes = state.quotes.filter((quote) => {
    const text = JSON.stringify(quote).toLowerCase();
    const ownerMatch = !ownerFilter || String(quote.assigned_to || '').toLowerCase().includes(ownerFilter);
    const dueAt = quote.due_at ? new Date(quote.due_at).getTime() : null;
    const active = !['closed', 'spam'].includes(quote.status);
    const dueMatch = !dueFilter
      || (dueFilter === 'overdue' && active && dueAt && dueAt <= now)
      || (dueFilter === 'upcoming' && active && dueAt && dueAt > now)
      || (dueFilter === 'unscheduled' && active && !dueAt);
    return (!q || text.includes(q))
      && (!filter || quote.status === filter)
      && (!priority || quote.priority === priority)
      && ownerMatch
      && dueMatch;
  });

  if (!quotes.length) {
    box.innerHTML = admEmpty('ph-chats-circle', 'No quotes', 'Quote requests from the site appear here.') + quotesPager;
    wireQuotesMore();
    return;
  }

  box.innerHTML = quotes.map((quote) => {
    const id = esc(quote.id);
    const dueValue = quote.due_at ? new Date(quote.due_at).toISOString().slice(0, 16) : '';
    const score = Number.isFinite(Number(quote.lead_score)) ? Number(quote.lead_score) : 0;
    return `
      <details class="quote-item">
        <summary>
          <b>${esc(quote.company || quote.name || quote.email)}</b>
          ${statusBadge(quote.status || 'new')}
          ${statusBadge(quote.priority || 'normal')}
          <span class="muted">Score ${esc(score)}</span>
        </summary>
        <p>${esc(quote.message || '')}</p>
        <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
          <select class="adm-select" data-quote-status="${id}">
            ${QUOTE_STATUSES.map((status) => `<option value="${status}" ${status === quote.status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
          <select class="adm-select" data-quote-priority="${id}">
            ${['urgent', 'high', 'normal', 'low'].map((value) => `<option value="${value}" ${value === (quote.priority || 'normal') ? 'selected' : ''}>${value}</option>`).join('')}
          </select>
          <input class="adm-input" data-quote-next-step="${id}" value="${esc(quote.next_step || '')}" placeholder="Next step" style="max-width:220px">
          <input class="adm-input" data-quote-owner="${id}" value="${esc(quote.assigned_to || '')}" placeholder="Owner" style="max-width:160px">
          <input class="adm-input" data-quote-due-at="${id}" type="datetime-local" value="${esc(dueValue)}" aria-label="Follow-up due" style="max-width:190px">
          <button class="btn btn-ghost btn-sm" data-save-quote="${id}" type="button">Save</button>
          <button class="btn btn-ghost btn-sm" data-snooze-quote="${id}" type="button">Snooze 2d</button>
          <button class="btn btn-ghost btn-sm" data-followup="${id}" type="button">Send follow-up</button>
          <a class="btn btn-ghost btn-sm" href="mailto:${esc(quote.email || '')}?subject=${encodeURIComponent('MASEST quote request')}">Email</a>
        </div>
        <textarea class="adm-textarea" data-quote-notes="${id}" placeholder="Internal notes">${esc(quote.notes || '')}</textarea>
        <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
          <select class="adm-select" data-conv-co="${id}" style="max-width:200px"><option value="">Convert to order for...</option>${coOpts}</select>
          <input class="adm-input" data-conv-sku="${id}" placeholder="SKU" style="max-width:120px">
          <input class="adm-input" data-conv-name="${id}" placeholder="Item name" style="max-width:150px">
          <input class="adm-input" type="number" min="1" value="1" data-conv-qty="${id}" style="max-width:64px" aria-label="Qty">
          <input class="adm-input" type="number" min="0" step="0.01" data-conv-price="${id}" placeholder="Unit $" style="max-width:90px">
          <button class="btn btn-ghost btn-sm" data-convert="${id}" type="button">Convert to order</button>
        </div>
      </details>
    `;
  }).join('') + quotesPager;
  restoreDirty(box, snap);
  wireQuotesMore();

  box.querySelectorAll('[data-save-quote]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveQuote;
      button.disabled = true;
      try {
        await api('/api/admin/quotes', {
          method: 'POST',
          body: {
        id,
        status: box.querySelector(`[data-quote-status="${CSS.escape(id)}"]`).value,
        priority: box.querySelector(`[data-quote-priority="${CSS.escape(id)}"]`).value,
        assigned_to: box.querySelector(`[data-quote-owner="${CSS.escape(id)}"]`).value,
        next_step: box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value,
            due_at: box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value,
            notes: box.querySelector(`[data-quote-notes="${CSS.escape(id)}"]`).value,
          },
        });
        message('qStatus', 'Lead saved.', 'ok');
        await renderQuotePipeline();
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not save the lead. Retry.', 'err');
        button.disabled = false;
      }
    });
  });

  box.querySelectorAll('[data-convert]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.convert;
      const pick = (key) => box.querySelector(`[data-conv-${key}="${CSS.escape(id)}"]`);
      const company_id = pick('co').value;
      const sku = pick('sku').value.trim();
      const name = pick('name').value.trim();
      const qty = pick('qty').value;
      const unit_price = pick('price').value;
      if (!company_id) { message('qStatus', 'Pick a company to convert into.', 'err'); return; }
      if (!sku || unit_price === '') { message('qStatus', 'SKU and unit price are required.', 'err'); return; }
      button.disabled = true;
      message('qStatus', 'Creating order...');
      try {
        const res = await api('/api/admin/quotes', { method: 'POST', body: { id, action: 'convert', company_id, items: [{ sku, name, qty, unit_price }] } });
        message('qStatus', `Order ${res.order_id} created.`, 'ok');
        await renderQuotePipeline();
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not convert the lead. Refresh and check for a new order before retrying.', 'err');
        button.disabled = false;
      }
    });
  });

  box.querySelectorAll('[data-snooze-quote]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.snoozeQuote;
      button.disabled = true;
      try {
        await api('/api/admin/quotes', {
          method: 'POST',
          body: {
            id,
            status: 'contacted',
            next_step: 'Snoozed for two days',
            due_at: quoteDueInDays(2),
          },
        });
        message('qStatus', 'Follow-up snoozed.', 'ok');
        await renderQuotePipeline();
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not snooze the follow-up. Retry.', 'err');
        button.disabled = false;
      }
    });
  });

  box.querySelectorAll('[data-followup]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.followup;
      button.disabled = true;
      try {
        await api('/api/admin/quotes', {
          method: 'POST',
          body: {
            id,
            action: 'followup',
            next_step: box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value,
            due_at: box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value,
          },
        });
        message('qStatus', 'Follow-up sent.', 'ok');
        await renderQuotePipeline();
      } catch (err) {
        message('qStatus', err.data?.error || 'Could not send the follow-up. Retry.', 'err');
        button.disabled = false;
      }
    });
  });
}

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
}

wire();
boot();
