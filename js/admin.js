/* MASEST staff admin console. */
import { login, logout, api, getToken } from './auth.js';
import { esc, safeUrl, money, dateTime as date, wireTablist, rovingTabindex, confirmDialog } from './util.js';
import { connectQbo, renderQboStatus, runQboSync } from './admin/qbo.js';
import { editKey, captureDirty, restoreDirty } from './admin/edits.js';

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

const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled', 'refunded'];
const REFUND_BLOCKING_STATUSES = new Set(['cancelled', 'refunded']);
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

function qboReconciliation(order) {
  const parts = [];
  if (order.qbo_doc_id) parts.push(`${order.qbo_doc_type || 'qbo'} ${order.qbo_doc_id}`);
  if (order.qbo_payment_id) parts.push(`payment ${order.qbo_payment_id}`);
  if (!parts.length) return '';
  return `<div class="muted" style="margin:6px 0 0;font-size:.78rem">QBO: ${parts.map(esc).join(' / ')}</div>`;
}

// NET aging badge (#10) — open NET balances show days-outstanding; overdue ones
// (past company net_terms_days) escalate via net-age--over30/60/90 colouring.
function netAgingBadge(order) {
  const a = order.net_aging;
  if (!a) return '';
  const label = a.overdue ? `overdue ${a.daysOverdue}d` : `${a.ageDays}d open`;
  const due = a.terms ? `, due ${a.dueIso.slice(0, 10)}` : '';
  const title = `NET ${a.terms} — open ${a.ageDays} day(s)${a.overdue ? `, ${a.daysOverdue} past due` : due}`;
  return `<br><span class="net-age net-age--${esc(a.bucket)}" title="${esc(title)}">${esc(label)}</span>`;
}

function trackingControls(order) {
  const id = esc(order.id);
  const eta = order.estimated_delivery_at ? new Date(order.estimated_delivery_at).toISOString().slice(0, 16) : '';
  return `${qboReconciliation(order)}<details class="adm-track"><summary>${statusBadge(order.tracking_status || 'processing')}</summary>
    <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
      <select class="adm-select" data-track-status="${id}" style="max-width:150px">
        ${['processing', 'packing', 'shipped', 'delivered', 'blocked'].map((status) => `<option value="${status}" ${status === (order.tracking_status || 'processing') ? 'selected' : ''}>${status.replaceAll('_', ' ')}</option>`).join('')}
      </select>
      <input class="adm-input" data-track-carrier="${id}" value="${esc(order.carrier || '')}" placeholder="Carrier" style="max-width:130px">
      <input class="adm-input" data-track-number="${id}" value="${esc(order.tracking_number || '')}" placeholder="Tracking #" style="max-width:150px">
      <input class="adm-input" data-track-url="${id}" value="${esc(order.tracking_url || '')}" placeholder="Tracking URL" style="max-width:230px">
      <input class="adm-input" data-track-eta="${id}" value="${esc(eta)}" type="datetime-local" aria-label="Estimated delivery" style="max-width:190px">
      <button class="btn btn-ghost btn-sm" data-save-tracking="${id}" type="button">Save tracking</button>
    </div>
  </details>`;
}

function quoteDueInDays(days) {
  return new Date(Date.now() + days * 86400e3).toISOString();
}

function setupProgress(company) {
  const setup = company.setup;
  if (!setup?.steps?.length) return '<span class="muted">-</span>';
  const open = setup.steps.filter((step) => !step.done);
  const firstOpen = open[0]?.label || 'Complete';
  return `<span data-setup-state="${open.length ? 'open' : 'done'}"><b>${setup.percent || 0}%</b> <small class="muted">${esc(firstOpen)}</small></span>`;
}

function renderCompanyMembers(company, members = []) {
  if (!members.length) return '<div class="company-members"><h3>Members</h3><p class="muted">No members.</p></div>';
  return `<div class="company-members"><h3>Members</h3>${members.map((member) => `
    <div class="dash-row">
      <span>${esc(member.email || member.full_name || member.id)} <small class="muted">${esc(member.full_name || '')}</small></span>
      <span>
        <select class="adm-select" data-member-role="${esc(member.id)}" data-company-id="${esc(company.id)}">
          <option value="buyer" ${member.role === 'buyer' ? 'selected' : ''}>Buyer</option>
          <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-member-save="${esc(member.id)}" data-company-id="${esc(company.id)}">Save</button>
      </span>
    </div>`).join('')}</div>`;
}

function renderCompanyInvites(company, invites = []) {
  if (!invites.length) return '<div class="company-invites"><h3>Pending invites</h3><p class="muted">No pending invites.</p></div>';
  return `<div class="company-invites"><h3>Pending invites</h3>${invites.map((invite) => `
    <div class="dash-row">
      <span>${esc(invite.email)} <small class="muted">${esc(invite.role || 'buyer')}</small></span>
      <span>
        <button class="btn btn-ghost btn-sm" type="button" data-invite-resend="${esc(invite.id)}" data-company-id="${esc(company.id)}">Resend</button>
        <button class="btn btn-ghost btn-sm" type="button" data-invite-revoke="${esc(invite.id)}" data-company-id="${esc(company.id)}">Revoke</button>
      </span>
    </div>`).join('')}</div>`;
}

async function openCompanyDetail(id) {
  const box = $('companyDetail');
  if (!box) return;
  box.hidden = false;
  box.textContent = 'Loading company...';
  try {
    const detail = await api(`/api/admin/company?id=${encodeURIComponent(id)}`);
    const company = detail.company || {};
    const openSteps = company.setup?.steps?.filter((step) => !step.done) || [];
    box.innerHTML = `
      <h2>${esc(company.name || 'Company')}</h2>
      <div class="dash-row"><span>Status</span>${statusBadge(company.status)}</div>
      <div class="dash-row"><span>Setup</span>${setupProgress(detail.company)}</div>
      <div class="dash-row"><span>Members</span><b>${(detail.members || []).length}</b></div>
      <div class="dash-row"><span>Orders</span><b>${(detail.orders || []).length}</b></div>
      <div class="dash-row"><span>Messages</span><b>${detail.message_count || 0}</b></div>
      <div class="company-detail-actions" data-company-id="${esc(company.id || id)}">
        <button class="btn btn-primary btn-sm" type="button" data-company-detail-action="approve">Approve</button>
        <button class="btn btn-ghost btn-sm" type="button" data-company-detail-action="suspend">Suspend</button>
        <button class="btn btn-ghost btn-sm" type="button" data-company-detail-tab="messages">Messages</button>
        <button class="btn btn-ghost btn-sm" type="button" data-company-detail-tab="orders">Orders</button>
      </div>
      ${renderCompanyMembers(company, detail.members || [])}
      ${renderCompanyInvites(company, detail.invites || [])}
      <p class="muted" style="margin-top:12px">${openSteps.length ? `Open: ${openSteps.map((step) => esc(step.label)).join(', ')}` : 'Setup complete.'}</p>`;
    wireCompanyDetailActions(company);
    wireCompanyUserActions(company);
  } catch (err) {
    box.innerHTML = `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load this company. Reload to retry.')}</p>`;
  }
}

function wireCompanyDetailActions(company) {
  const box = $('companyDetail');
  if (!box || !company?.id) return;
  box.querySelectorAll('[data-company-detail-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.companyDetailAction;
      button.disabled = true;
      try {
        await api('/api/admin/companies', { method: 'POST', body: { id: company.id, action } });
        await renderCompanies();
        await openCompanyDetail(company.id);
      } catch (err) {
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not apply the change. Retry.')}</p>`);
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-company-detail-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.companyDetailTab;
      const search = tab === 'orders' ? $('ordSearch') : null;
      if (search) search.value = company.id;
      setTab(tab);
    });
  });
}

function wireCompanyUserActions(company) {
  const box = $('companyDetail');
  if (!box || !company?.id) return;
  box.querySelectorAll('[data-member-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const profileId = button.dataset.memberSave;
      const role = box.querySelector(`[data-member-role="${CSS.escape(profileId)}"]`)?.value;
      button.disabled = true;
      try {
        await api('/api/admin/users', { method: 'POST', body: { action: 'set_role', company_id: company.id, profile_id: profileId, role } });
        await openCompanyDetail(company.id);
      } catch (err) {
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not update the role. Retry.')}</p>`);
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-invite-resend],[data-invite-revoke]').forEach((button) => {
    button.addEventListener('click', async () => {
      const inviteId = button.dataset.inviteResend || button.dataset.inviteRevoke;
      const action = button.dataset.inviteResend ? 'resend_invite' : 'revoke_invite';
      button.disabled = true;
      try {
        await api('/api/admin/users', { method: 'POST', body: { action, company_id: company.id, invite_id: inviteId } });
        await openCompanyDetail(company.id);
      } catch (err) {
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not update the invite. Retry.')}</p>`);
        button.disabled = false;
      }
    });
  });
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
function admOrdersPager() {
  if (!state.ordersHasMore) return '';
  const count = state.ordersTotal != null ? ` (${state.orders.length} of ${state.ordersTotal})` : '';
  return `<div style="text-align:center;margin:12px 0"><button class="btn btn-ghost btn-sm" data-load-more-orders type="button">Load more${count}</button></div>`;
}

// Generic "Load more" footer for an accumulated admin list (#29).
function admListPager(attr, loaded, total, hasMore) {
  if (!hasMore) return '';
  const count = total != null ? ` (${loaded} of ${total})` : '';
  return `<div style="text-align:center;margin:12px 0"><button class="btn btn-ghost btn-sm" ${attr} type="button">Load more${count}</button></div>`;
}

async function renderOrders({ append = false, refetch = true } = {}) {
  const box = $('admOrders');
  const snap = captureDirty(box);
  const status = $('ordFilter').value;
  if (refetch) {
    if (!append) { state.orders = []; state.ordersOffset = 0; box.innerHTML = admSkeleton(); }
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', '100');
      params.set('offset', String(state.ordersOffset || 0));
      const res = await api('/api/admin/orders?' + params.toString());
      state.orders = (state.orders || []).concat(res.orders || []);
      state.ordersOffset = (state.ordersOffset || 0) + (res.orders || []).length;
      state.ordersTotal = res.total;
      state.ordersHasMore = !!res.has_more;
      state.loaded.add('orders');
    } catch {
      if (!append) box.innerHTML = '<p class="adm-status" data-state="err">Could not load orders. Reload to retry.</p>';
      return;
    }
  }
  const q = $('ordSearch').value.trim().toLowerCase();
  const orders = state.orders.filter((order) => JSON.stringify(order).toLowerCase().includes(q));
  if (!orders.length) {
    box.innerHTML = admEmpty('ph-package', q ? 'No matching orders' : 'No orders yet', q ? 'No orders match your search.' : 'Orders appear here once customers check out.') + admOrdersPager();
    box.querySelector('[data-load-more-orders]')?.addEventListener('click', () => renderOrders({ append: true }));
    return;
  }
  box.innerHTML = `<table class="adm"><thead><tr><th>Date</th><th>Company</th><th>Items</th><th>Total</th><th>Pay</th><th>Status</th><th></th></tr></thead><tbody>${orders.map((order) => {
    const items = (order.order_items || []).map((item) => `${esc(item.qty)} x ${esc(item.name || item.sku)}`).join('<br>');
    return `<tr>
      <td>${esc(date(order.created_at))}</td>
      <td>${esc(order.companies?.name || order.company_name || order.company_id || 'Guest')}</td>
      <td>${items || '<span class="muted">No items</span>'}</td>
      <td>${esc(money(order.total ?? order.subtotal, order.currency))}</td>
      <td>${esc(order.payment_method || '')}${netAgingBadge(order)}</td>
      <td><select class="adm-select" data-order-status="${esc(order.id)}">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}</select></td>
      <td>${trackingControls(order)}<button class="btn btn-ghost btn-sm" data-save-order="${esc(order.id)}" type="button">Save</button>${order.payment_method === 'net' ? ` <input class="adm-input" data-qbo-invoice-input="${esc(order.id)}" value="${esc(order.qbo_invoice_id || '')}" placeholder="QBO invoice ID" aria-label="QuickBooks invoice ID for order ${esc(order.id)}" style="max-width:150px"><button class="btn btn-ghost btn-sm" data-qbo-order="${esc(order.id)}" type="button">${order.qbo_invoice_id ? 'Update invoice' : 'Add invoice'}</button> <input class="adm-input" data-qbo-payment-input="${esc(order.id)}" value="${esc(order.qbo_payment_id || '')}" placeholder="QBO payment ID" aria-label="QuickBooks payment ID for order ${esc(order.id)}" style="max-width:150px"><button class="btn btn-ghost btn-sm" data-qbo-payment-order="${esc(order.id)}" type="button">${order.qbo_payment_id ? 'Update payment' : 'Add payment'}</button>` : ''}${order.payment_method === 'stripe' && !REFUND_BLOCKING_STATUSES.has(order.status) ? ` <input class="adm-input" data-refund-amount="${esc(order.id)}" type="number" min="0" step="0.01" placeholder="Amount (blank = full)" aria-label="Partial refund amount for order ${esc(order.id)} (leave blank to refund the full balance)" style="max-width:170px"><button class="btn btn-ghost btn-sm" data-refund-order="${esc(order.id)}" type="button">Refund</button>${Number(order.refunded_amount) > 0 ? ` <span class="muted" style="font-size:.85em">refunded ${esc(money(order.refunded_amount, order.currency))}</span>` : ''}` : ''}</td>
    </tr>`;
  }).join('')}</tbody></table>` + admOrdersPager();
  restoreDirty(box, snap);

  box.querySelectorAll('[data-save-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveOrder;
      const status = box.querySelector(`[data-order-status="${CSS.escape(id)}"]`).value;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, status } });
        await renderOrders();
      } finally {
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-save-tracking]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveTracking;
      const pick = (name) => box.querySelector(`[data-track-${name}="${CSS.escape(id)}"]`);
      button.disabled = true;
      try {
        await api('/api/admin/orders', {
          method: 'POST',
          body: {
            id,
            action: 'update_tracking',
            tracking_status: pick('status').value,
            carrier: pick('carrier').value.trim(),
            tracking_number: pick('number').value.trim(),
            tracking_url: pick('url').value.trim(),
            estimated_delivery_at: pick('eta').value,
          },
        });
        message('ordStatus', 'Tracking saved.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update tracking. Retry.', 'err');
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-refund-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.refundOrder;
      const amountInput = box.querySelector(`[data-refund-amount="${CSS.escape(id)}"]`);
      const raw = amountInput?.value.trim();
      const amount = raw ? Number(raw) : undefined;
      if (raw && (!Number.isFinite(amount) || amount <= 0)) {
        message('ordStatus', 'Enter a valid refund amount, or leave it blank to refund the full balance.', 'err');
        return;
      }
      const prompt = amount
        ? `Refund $${amount.toFixed(2)} to this order via Stripe?`
        : 'Refund the full remaining balance via Stripe?';
      if (!(await confirmDialog(prompt, { confirmText: 'Refund', danger: true }))) return;
      button.disabled = true;
      message('ordStatus', 'Refunding...');
      try {
        const res = await api('/api/admin/orders', { method: 'POST', body: { id, action: 'refund', amount } });
        message('ordStatus', res.partial ? `Partial refund of $${Number(res.amount).toFixed(2)} issued.` : 'Refunded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Refund did not go through. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-qbo-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboOrder;
      const invoiceId = box.querySelector(`[data-qbo-invoice-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!invoiceId) { message('ordStatus', 'Enter a QuickBooks invoice ID first.', 'err'); return; }
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'record_qbo_invoice', qbo_invoice_id: invoiceId } });
        message('ordStatus', 'Invoice recorded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update the invoice. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
  });

  box.querySelectorAll('[data-qbo-payment-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboPaymentOrder;
      const paymentId = box.querySelector(`[data-qbo-payment-input="${CSS.escape(id)}"]`)?.value.trim();
      if (!paymentId) { message('ordStatus', 'Enter a QuickBooks payment ID first.', 'err'); return; }
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'record_qbo_payment', qbo_payment_id: paymentId } });
        message('ordStatus', 'Payment recorded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Could not update payment status. Refresh and check before retrying.', 'err');
        button.disabled = false;
      }
    });
  });
  box.querySelector('[data-load-more-orders]')?.addEventListener('click', () => renderOrders({ append: true }));
}

async function renderCustomers({ refetch = true } = {}) {
  const box = $('admCustomers');
  if (refetch) {
    box.innerHTML = admSkeleton();
    try {
      state.customers = (await api('/api/admin/customers')).customers || [];
      state.loaded.add('customers');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load customers. Reload to retry.</p>';
      return;
    }
  }
  const q = $('custSearch').value.trim().toLowerCase();
  state.customers = state.customers || [];
  const rows = state.customers.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
  if (!rows.length) { box.innerHTML = admEmpty('ph-users', 'No customers', 'Approved customers and their companies appear here.'); return; }
  box.innerHTML = `<table class="adm"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Tier</th><th>Role</th></tr></thead><tbody>${rows.map((c) => `
    <tr>
      <td>${esc(c.full_name || '-')}${c.phone ? `<br><span class="muted">${esc(c.phone)}</span>` : ''}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">-</span>'}</td>
      <td>${esc(c.company_name || '-')}</td>
      <td>${statusBadge(c.company_status || '-')}</td>
      <td>${esc(c.price_tier || 'retail')}</td>
      <td>${esc(c.role || '')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function renderCompanies({ append = false, refetch = true } = {}) {
  const box = $('admCompanies');
  const snap = captureDirty(box);
  if (refetch) {
    if (!append) { state.companies = []; state.companiesOffset = 0; box.innerHTML = admSkeleton(); }
    try {
      const params = new URLSearchParams({ limit: '100', offset: String(state.companiesOffset || 0) });
      const res = await api('/api/admin/companies?' + params.toString());
      state.companies = (state.companies || []).concat(res.companies || []);
      state.companiesOffset = (state.companiesOffset || 0) + (res.companies || []).length;
      state.companiesTotal = res.total;
      state.companiesHasMore = !!res.has_more;
      state.loaded.add('companies');
    } catch {
      if (!append) box.innerHTML = '<p class="adm-status" data-state="err">Could not load accounts. Reload to retry.</p>';
      return;
    }
  }
  const pager = admListPager('data-load-more-companies', state.companies.length, state.companiesTotal, state.companiesHasMore);
  const wireMore = () => box.querySelector('[data-load-more-companies]')?.addEventListener('click', () => renderCompanies({ append: true }));
  const q = $('coSearch').value.trim().toLowerCase();
  const companies = state.companies.filter((company) => JSON.stringify(company).toLowerCase().includes(q));
  if (!companies.length) {
    box.innerHTML = admEmpty('ph-buildings', q ? 'No matching accounts' : 'No accounts', q ? 'No accounts match your search.' : 'New B2B account signups appear here for approval.') + pager;
    wireMore();
    return;
  }
  box.innerHTML = `<div class="adm-tools" style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" id="bulkApprove" type="button">Approve selected</button></div><table class="adm"><thead><tr><th><input type="checkbox" id="coAll" aria-label="Select all"></th><th>Company</th><th>Status</th><th>Setup</th><th>NET</th><th>Credit</th><th>Tier</th><th>Members</th><th></th></tr></thead><tbody>${companies.map((company) => `
    <tr>
      <td><input type="checkbox" class="co-check" value="${esc(company.id)}"></td>
      <td><button class="link-name" data-open-company="${esc(company.id)}" type="button">${esc(company.name)}</button></td>
      <td>${statusBadge(company.status)}</td>
      <td>${setupProgress(company)}</td>
      <td><input class="adm-input" type="number" min="0" value="${esc(company.net_terms_days || 0)}" data-net="${esc(company.id)}"></td>
      <td><input class="adm-input" type="number" min="0" value="${esc(company.credit_limit || 0)}" data-credit="${esc(company.id)}"></td>
      <td><select class="adm-select" data-tier="${esc(company.id)}">${['retail', 'hvac', 'wholesale'].map((tier) => `<option value="${tier}"${(company.price_tier || 'retail') === tier ? ' selected' : ''}>${tier}</option>`).join('')}</select></td>
      <td>${esc((company.profiles || []).map((p) => p.full_name || p.role).join(', '))}</td>
      <td><button class="btn btn-ghost btn-sm" data-approve="${esc(company.id)}" type="button">Approve</button></td>
    </tr>
  `).join('')}</tbody></table>` + pager;
  restoreDirty(box, snap);
  box.querySelectorAll('[data-open-company]').forEach((button) => {
    button.addEventListener('click', () => openCompanyDetail(button.dataset.openCompany));
  });
  wireMore();
  box.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.approve;
      await api('/api/admin/companies', {
        method: 'POST',
        body: {
          id,
          action: 'approve',
          net_terms_days: Number(box.querySelector(`[data-net="${CSS.escape(id)}"]`).value || 0),
          credit_limit: Number(box.querySelector(`[data-credit="${CSS.escape(id)}"]`).value || 0),
          price_tier: box.querySelector(`[data-tier="${CSS.escape(id)}"]`).value,
        },
      });
      renderCompanies();
    });
  });
  const coAll = $('coAll');
  if (coAll) coAll.addEventListener('change', () => box.querySelectorAll('.co-check').forEach((c) => { c.checked = coAll.checked; }));
  const bulk = $('bulkApprove');
  if (bulk) bulk.addEventListener('click', async () => {
    const ids = [...box.querySelectorAll('.co-check:checked')].map((c) => c.value);
    if (!ids.length) return;
    if (!(await confirmDialog(`Approve ${ids.length} account(s)?`, { confirmText: 'Approve' }))) return;
    bulk.disabled = true;
    try {
      await api('/api/admin/companies', { method: 'POST', body: { ids, action: 'approve' } });
      await renderCompanies();
    } finally { bulk.disabled = false; }
  });
}

async function renderProducts({ refetch = true } = {}) {
  const box = $('admProducts');
  const snap = captureDirty(box);
  if (refetch) {
    box.innerHTML = admSkeleton();
    try {
      const response = await api('/api/admin/products');
      state.products = response.products || [];
      state.loaded.add('products');
      if (response.media_ready === false) {
        message('prodStatus', 'Apply site/supabase/schema-phase5.sql to enable product photos.', 'err');
      }
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load products. Reload to retry.</p>';
      return;
    }
  }
  state.products = state.products || [];
  const q = $('prodSearch').value.trim().toLowerCase();
  const products = state.products.filter((product) => JSON.stringify(product).toLowerCase().includes(q));
  if (!products.length) {
    box.innerHTML = admEmpty('ph-cube', 'No products', 'Add catalog products to manage them here.');
    return;
  }
  box.innerHTML = `<table class="adm"><thead><tr><th>Photo</th><th>SKU</th><th>Name</th><th>Mode</th><th>Price</th><th>Stock</th><th>Photo URL</th><th>Alt</th><th>Variants</th><th>Active</th><th></th></tr></thead><tbody>${products.map((p) => `
    <tr data-product="${esc(p.sku)}">
      <td>${p.image_url ? `<img class="product-photo" src="${esc(safeUrl(p.image_url))}" alt="${esc(p.photo_alt || p.name || '')}">` : '<span class="muted">No photo</span>'}${Array.isArray(p.gallery) && p.gallery.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${p.gallery.map((u, i) => `<span style="display:inline-flex;flex-direction:column;align-items:center"><img src="${esc(safeUrl(u))}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid var(--line)"><span><button type="button" class="gbtn" data-gact="primary" data-gurl="${esc(u)}" title="Make primary">★</button><button type="button" class="gbtn" data-gact="up" data-gidx="${i}" title="Move up">↑</button><button type="button" class="gbtn" data-gact="down" data-gidx="${i}" title="Move down">↓</button><button type="button" class="gbtn" data-gact="del" data-gurl="${esc(u)}" title="Remove">×</button></span></span>`).join('')}</div>` : ''}<br><label class="muted" style="font-size:.7rem;display:block;margin-top:4px">Upload<input type="file" accept="image/*" data-imgfile style="display:block;max-width:120px;font-size:.7rem"></label><label class="muted" style="font-size:.7rem;display:block">+ gallery<input type="file" accept="image/*" data-galfile style="display:block;max-width:120px;font-size:.7rem"></label></td>
      <td><b>${esc(p.sku)}</b></td>
      <td><input class="adm-input" value="${esc(p.name)}" data-field="name"></td>
      <td><select class="adm-select" data-field="mode"><option value="buy" ${p.mode === 'buy' ? 'selected' : ''}>Buy</option><option value="quote" ${p.mode === 'quote' ? 'selected' : ''}>Quote</option></select></td>
      <td><input class="adm-input" type="number" min="0" step="0.01" value="${esc(p.price ?? '')}" data-field="price"></td>
      <td><input class="adm-input" type="number" min="0" step="1" value="${esc(p.stock ?? '')}" data-field="stock"></td>
      <td><input class="adm-input" value="${esc(p.image_url || '')}" data-field="image_url"></td>
      <td><input class="adm-input" value="${esc(p.photo_alt || '')}" data-field="photo_alt"></td>
      <td>${variantRows(p)}</td>
      <td><input type="checkbox" ${p.active !== false ? 'checked' : ''} data-field="active"></td>
      <td>
        <button class="btn btn-primary btn-sm" data-save-product="${esc(p.sku)}" type="button">Save</button>
        <button class="btn btn-ghost btn-sm" data-remove-product="${esc(p.sku)}" type="button">Remove</button>
      </td>
    </tr>
  `).join('')}</tbody></table>`;
  restoreDirty(box, snap);

  box.querySelectorAll('[data-save-product]').forEach((button) => {
    button.addEventListener('click', () => saveProductRow(button.dataset.saveProduct));
  });
  box.querySelectorAll('[data-remove-product]').forEach((button) => {
    button.addEventListener('click', () => removeProduct(button.dataset.removeProduct));
  });
  box.querySelectorAll('[data-save-variant]').forEach((button) => {
    button.addEventListener('click', () => saveVariantRow(button.dataset.saveVariant));
  });
  box.querySelectorAll('[data-remove-variant]').forEach((button) => {
    button.addEventListener('click', () => removeVariant(button.dataset.removeVariant));
  });
  box.querySelectorAll('[data-imgfile]').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.files?.[0]) uploadProductImage(inp.closest('[data-product]').dataset.product, inp.files[0], 'primary');
  }));
  box.querySelectorAll('[data-galfile]').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.files?.[0]) uploadProductImage(inp.closest('[data-product]').dataset.product, inp.files[0], 'gallery');
  }));
  box.querySelectorAll('[data-gact]').forEach((btn) => btn.addEventListener('click', async () => {
    const sku = btn.closest('[data-product]')?.dataset.product;
    if (!sku) return;
    const prod = (state.products || []).find((x) => x.sku === sku);
    const gallery = Array.isArray(prod?.gallery) ? [...prod.gallery] : [];
    const act = btn.dataset.gact;
    btn.disabled = true;
    try {
      if (act === 'del') {
        await api('/api/admin/product-image', { method: 'DELETE', body: { sku, url: btn.dataset.gurl } });
      } else if (act === 'primary') {
        await api('/api/admin/product-image', { method: 'PATCH', body: { sku, action: 'set_primary', url: btn.dataset.gurl } });
      } else if (act === 'up' || act === 'down') {
        const i = Number(btn.dataset.gidx); const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= gallery.length) { btn.disabled = false; return; }
        [gallery[i], gallery[j]] = [gallery[j], gallery[i]];
        await api('/api/admin/product-image', { method: 'PATCH', body: { sku, action: 'reorder', gallery } });
      }
      message('prodStatus', 'Gallery updated.', 'ok');
      await renderProducts();
    } catch (err) { message('prodStatus', err.data?.error || 'Could not update the gallery. Retry.', 'err'); btn.disabled = false; }
  }));
}

async function uploadProductImage(sku, file, slot) {
  message('prodStatus', 'Uploading image...');
  try {
    const fd = new FormData();
    fd.append('sku', sku); fd.append('slot', slot); fd.append('file', file);
    const token = await getToken();
    const r = await fetch('/api/admin/product-image', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'upload_failed');
    message('prodStatus', `${sku} image uploaded.`, 'ok');
    await renderProducts();
  } catch (err) {
    message('prodStatus', err.message || 'Could not upload the image. Check the file and retry.', 'err');
  }
}

function variantRows(product) {
  const variants = (product.product_variants || []).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!variants.length) return '<span class="muted">No variants</span>';
  return `<div class="variant-stack">${variants.map((v) => `
    <div class="variant-row" data-variant="${esc(v.vsku)}">
      <input class="adm-input" value="${esc(v.label || '')}" data-vfield="label" aria-label="Variant label">
      <input class="adm-input" type="number" min="0" step="0.01" value="${esc(v.gallons ?? '')}" data-vfield="gallons" aria-label="Gallons">
      <input class="adm-input" type="number" min="0" step="0.01" value="${esc(v.price ?? '')}" data-vfield="price" aria-label="Variant price">
      <input class="adm-input" type="number" min="0" step="1" value="${esc(v.stock ?? '')}" data-vfield="stock" aria-label="Variant stock">
      <label class="muted"><input type="checkbox" ${v.active !== false ? 'checked' : ''} data-vfield="active"> active</label>
      <button class="btn btn-primary btn-sm" data-save-variant="${esc(v.vsku)}" type="button">Save</button>
      <button class="btn btn-ghost btn-sm" data-remove-variant="${esc(v.vsku)}" type="button">Remove</button>
      <input type="hidden" value="${esc(v.product_sku || product.sku)}" data-vfield="product_sku">
      <input type="hidden" value="${esc(v.vsku)}" data-vfield="vsku">
    </div>
  `).join('')}</div>`;
}

function rowProduct(sku) {
  const row = document.querySelector(`[data-product="${CSS.escape(sku)}"]`);
  const product = { sku };
  row.querySelectorAll('[data-field]').forEach((field) => {
    const key = field.dataset.field;
    product[key] = field.type === 'checkbox' ? field.checked : field.value;
  });
  product.track_stock = product.stock !== '';
  return product;
}

async function saveProductRow(sku) {
  message('prodStatus', 'Saving...');
  try {
    const response = await api('/api/admin/products', { method: 'POST', body: { product: rowProduct(sku) } });
    message('prodStatus', response.warning || 'Saved.', response.warning ? 'err' : 'ok');
    await renderProducts();
  } catch (err) {
    message('prodStatus', err.data?.error || 'Could not save the product. Retry.', 'err');
  }
}

async function removeProduct(sku) {
  if (!(await confirmDialog(`Deactivate ${sku}? Existing order history stays intact.`, { confirmText: 'Deactivate', danger: true }))) return;
  try {
    await api('/api/admin/products', { method: 'DELETE', body: { sku } });
    message('prodStatus', 'Product deactivated.', 'ok');
    await renderProducts();
  } catch (err) {
    message('prodStatus', err.data?.hint || err.data?.error || 'Could not deactivate the product. Retry.', 'err');
  }
}

function rowVariant(vsku) {
  const row = document.querySelector(`[data-variant="${CSS.escape(vsku)}"]`);
  const variant = { vsku };
  row.querySelectorAll('[data-vfield]').forEach((field) => {
    const key = field.dataset.vfield;
    variant[key] = field.type === 'checkbox' ? field.checked : field.value;
  });
  variant.track_stock = variant.stock !== '';
  return variant;
}

async function saveVariantRow(vsku) {
  message('variantStatus', 'Saving...');
  try {
    await api('/api/admin/products', { method: 'POST', body: { variant: rowVariant(vsku) } });
    message('variantStatus', 'Variant saved.', 'ok');
    await renderProducts();
  } catch (err) {
    message('variantStatus', err.data?.error || 'Could not save the variant. Retry.', 'err');
  }
}

async function removeVariant(vsku) {
  if (!(await confirmDialog(`Deactivate ${vsku}? Existing order history stays intact.`, { confirmText: 'Deactivate', danger: true }))) return;
  try {
    await api('/api/admin/products', { method: 'DELETE', body: { vsku } });
    message('variantStatus', 'Variant deactivated.', 'ok');
    await renderProducts();
  } catch (err) {
    message('variantStatus', err.data?.error || 'Could not deactivate the variant. Retry.', 'err');
  }
}

function wireProductForm() {
  $('prodForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const product = {
      sku: $('npSku').value.trim(),
      name: $('npName').value.trim() || undefined,
      mode: $('npMode').value,
      price: $('npPrice').value,
      stock: $('npStock').value,
      track_stock: $('npStock').value !== '',
      image_url: $('npImageUrl').value.trim(),
      photo_alt: $('npPhotoAlt').value.trim(),
      active: true,
    };
    message('prodStatus', 'Saving...');
    try {
      const response = await api('/api/admin/products', { method: 'POST', body: { product } });
      message('prodStatus', response.warning || 'Saved.', response.warning ? 'err' : 'ok');
      event.target.reset();
      await renderProducts();
    } catch (err) {
      message('prodStatus', err.data?.error || 'Could not add the product. Check the fields and retry.', 'err');
    }
  });
}

function wireVariantForm() {
  $('variantForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const variant = {
      product_sku: $('nvProductSku').value.trim(),
      vsku: $('nvSku').value.trim(),
      label: $('nvLabel').value.trim(),
      gallons: $('nvGallons').value,
      price: $('nvPrice').value,
      stock: $('nvStock').value,
      track_stock: $('nvStock').value !== '',
      active: true,
    };
    message('variantStatus', 'Saving...');
    try {
      await api('/api/admin/products', { method: 'POST', body: { variant } });
      message('variantStatus', 'Variant saved.', 'ok');
      event.target.reset();
      await renderProducts();
    } catch (err) {
      message('variantStatus', err.data?.error || 'Could not add the variant. Check the fields and retry.', 'err');
    }
  });
}

async function renderPricing({ refetch = true } = {}) {
  const box = $('admPricing');
  const snap = captureDirty(box);
  if (refetch) {
    box.innerHTML = admSkeleton();
    try {
      state.pricing = await api('/api/admin/variant-pricing');
      state.loaded.add('pricing');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load pricing. Reload to retry.</p>';
      return;
    }
  }
  const data = state.pricing || { tiers: ['retail', 'hvac', 'wholesale'], rows: [] };
  const q = $('priceSearch').value.trim().toLowerCase();
  const tiers = data.tiers || ['retail', 'hvac', 'wholesale'];
  const rows = (data.rows || []).filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  const fmt = (value) => value == null ? '' : Number(value).toFixed(2);
  if (!rows.length) {
    box.innerHTML = '<p class="muted" style="padding:14px">No variants.</p>';
    return;
  }
  box.innerHTML = `<table class="adm"><thead><tr><th>Variant</th><th>VSKU</th><th>Base</th>${tiers.map((tier) => `<th>${esc(tier)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `
    <tr data-vsku="${esc(row.vsku)}">
      <td>${esc(row.product_name)} - ${esc(row.label)}${row.mode === 'quote' ? ' <span class="badge" data-s="quote">quote</span>' : ''}</td>
      <td><code>${esc(row.vsku)}</code></td>
      <td class="muted">${row.base_price == null ? '-' : fmt(row.base_price)}</td>
      ${tiers.map((tier) => `<td><input class="adm-input" data-price-tier="${esc(tier)}" type="number" step="0.01" min="0" value="${esc(row.tiers?.[tier] ?? '')}" placeholder="${row.base_price == null ? '-' : fmt(row.base_price)}"></td>`).join('')}
    </tr>
  `).join('')}</tbody></table><p id="priceRowStatus" class="adm-status" role="status"></p>`;
  restoreDirty(box, snap);
  box.querySelectorAll('[data-price-tier]').forEach((input) => {
    input.addEventListener('change', async () => {
      const row = input.closest('[data-vsku]');
      input.disabled = true;
      try {
        await api('/api/admin/variant-pricing', {
          method: 'POST',
          body: { vsku: row.dataset.vsku, tier: input.dataset.priceTier, price: input.value },
        });
        message('priceRowStatus', `${row.dataset.vsku} ${input.dataset.priceTier} saved.`, 'ok');
      } catch (err) {
        message('priceRowStatus', err.data?.error || 'Could not save the price. Retry.', 'err');
      } finally {
        input.disabled = false;
      }
    });
  });
}

async function renderThreads({ refetch = true } = {}) {
  const box = $('admThreads');
  if (refetch) {
    box.innerHTML = admSkeleton();
    try {
      state.threads = (await api('/api/admin/messages')).threads || [];
      state.loaded.add('messages');
    } catch {
      box.innerHTML = '<p class="adm-status" data-state="err">Could not load messages. Reload to retry.</p>';
      return;
    }
  }
  state.threads = state.threads || [];
  if (!state.threads.length) {
    box.innerHTML = '<p class="muted">No conversations.</p>';
    return;
  }
  box.innerHTML = state.threads.map((thread) => `
    <button type="button" data-company-thread="${esc(thread.company_id)}">
      <b>${esc(thread.company_name || thread.company_id)}</b>
      ${thread.unread ? `<span class="pill">${esc(thread.unread)}</span>` : ''}
      <br><span class="muted">${esc((thread.last_body || '').slice(0, 80))}</span>
    </button>
  `).join('');
  box.querySelectorAll('[data-company-thread]').forEach((button) => {
    button.addEventListener('click', () => openThread(button.dataset.companyThread));
  });
}

async function openThread(companyId) {
  const view = $('admThreadView');
  view.textContent = 'Loading...';
  try {
    const messages = (await api(`/api/admin/messages?company_id=${encodeURIComponent(companyId)}`)).messages || [];
    view.innerHTML = `<div class="msg-thread">${messages.map((m) => `
      <div class="msg" data-role="${esc(m.sender_role)}"><p>${esc(m.body)}</p><span class="muted">${sourceLabel(m)} ${esc(date(m.created_at))}</span></div>
    `).join('')}</div>
    <form id="replyForm" class="adm-form-grid" style="margin-top:12px">
      <label class="full">Reply <textarea id="replyBody" class="adm-textarea" required></textarea></label>
      <button class="btn btn-primary" type="submit">Send reply</button>
      <p id="replyStatus" class="adm-status"></p>
    </form>`;
    $('replyForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      message('replyStatus', 'Sending...');
      try {
        await api('/api/admin/messages', { method: 'POST', body: { company_id: companyId, body: $('replyBody').value } });
        await openThread(companyId);
        await renderThreads();
      } catch (err) {
        message('replyStatus', err.data?.error || 'Could not send the reply. Retry.', 'err');
      }
    });
  } catch {
    view.innerHTML = '<p class="adm-status" data-state="err">Could not load this thread. Reload to retry.</p>';
  }
}

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

function wireOfferForm() {
  $('offerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    message('offerStatus', 'Sending...');
    try {
      const response = await api('/api/admin/offers', {
        method: 'POST',
        body: {
          title: $('ofTitle').value.trim(),
          body: $('ofBody').value.trim(),
          cta_url: $('ofCta').value.trim() || '/products.html',
          audience: $('ofAud').value,
          send_email: $('ofEmail').checked,
        },
      });
      message('offerStatus', `Sent to ${response.recipients || 0} account(s)${response.emailed ? ' + email' : ''}.`, 'ok');
      renderOffers(true);
    } catch (err) {
      message('offerStatus', err.data?.error || 'Could not send the offer. Retry.', 'err');
    }
  });
}

async function renderOffers(force = false) {
  if (state.loaded.has('offers') && !force) return;
  const box = $('admOffers');
  box.innerHTML = admSkeleton();
  try {
    const offers = (await api('/api/admin/offers')).offers || [];
    box.innerHTML = offers.length ? offers.map((offer) => `
      <div class="quote-item"><b>${esc(offer.title)}</b><p class="muted">${esc(offer.audience)} | ${esc(offer.recipients || 0)} recipients | ${esc(date(offer.created_at))}</p></div>
    `).join('') : '<p class="muted">No sends yet.</p>';
    state.loaded.add('offers');
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Could not load sends. Reload to retry.</p>';
  }
}

function renderTrafficFunnel(funnel = []) {
 if (!funnel.length) return '<div class="adm-card"><h2>Funnel</h2><p class="muted">No funnel events yet.</p></div>';
 return `<div class="adm-card"><h2>Funnel</h2><table class="adm-mini-table"><tbody>${funnel.map((row) => `
 <tr><td>${esc(row.label || row.event)}</td><td class="num">${esc(row.count || 0)}</td><td class="num">${esc(pct(row.rate))}</td></tr>
 `).join('')}</tbody></table></div>`;
}

function renderTrafficCampaigns(topCampaigns = []) {
 if (!topCampaigns.length) return '<div class="adm-card"><h2>Campaigns</h2><p class="muted">No UTM campaigns recorded.</p></div>';
 return `<div class="adm-card"><h2>Campaigns</h2><table class="adm-mini-table"><tbody>${topCampaigns.map((row) => `
 <tr><td>${esc(row.key)}</td><td class="num">${esc(row.count)}</td></tr>
 `).join('')}</tbody></table></div>`;
}

function renderTrafficDays(byDay = []) {
 if (!byDay.length) return '<div class="adm-card"><h2>Daily trend</h2><p class="muted">No daily rows.</p></div>';
 return `<div class="adm-card"><h2>Daily trend</h2><table class="adm-mini-table"><thead><tr><th>Day</th><th>Views</th><th>Unique</th><th>Conversion events</th></tr></thead><tbody>${byDay.map((row) => `
 <tr><td>${esc(row.day)}</td><td class="num">${esc(row.pageviews ?? row.count ?? 0)}</td><td class="num">${esc(row.unique || 0)}</td><td class="num">${esc(row.conversion_events || 0)}</td></tr>
 `).join('')}</tbody></table></div>`;
}

function renderTrafficList(title, rows = []) {
 if (!rows.length) return `<div class="adm-card"><h2>${esc(title)}</h2><p class="muted">No rows.</p></div>`;
 return `<div class="adm-card"><h2>${esc(title)}</h2>${rows.map((row) => `<div class="dash-row"><span>${esc(row.key)}</span><b>${esc(row.count)}</b></div>`).join('')}</div>`;
}

async function renderTraffic() {
 const box = $('admTraffic');
 box.innerHTML = admSkeleton();
 try {
 const data = await api('/api/admin/traffic?days=14');
 if (!data.available) {
 box.innerHTML = `<p class="muted">${esc(data.note || 'Traffic table not migrated yet.')}</p>`;
 return;
 }
 box.innerHTML = `<div class="adm-traffic-report">
 <div class="adm-grid">
 <div class="adm-card adm-stat"><i class="ph ph-eye"></i><b>${esc(data.total)}</b><span class="muted">Tracked events</span></div>
 <div class="adm-card adm-stat"><i class="ph ph-users-three"></i><b>${esc(data.unique)}</b><span class="muted">Known visitors</span></div>
 <div class="adm-card adm-stat"><i class="ph ph-arrow-square-out"></i><b>${esc((data.events || []).find((row) => row.key === 'quote_submit')?.count || 0)}</b><span class="muted">Quote submits</span></div>
 <div class="adm-card adm-stat"><i class="ph ph-shopping-cart"></i><b>${esc((data.events || []).find((row) => row.key === 'checkout_start')?.count || 0)}</b><span class="muted">Checkout starts</span></div>
 </div>
 <div class="adm-report-grid">
 ${renderTrafficFunnel(data.funnel || [])}
 ${renderTrafficCampaigns(data.topCampaigns || [])}
 ${renderTrafficList('Top paths', data.topPaths || [])}
 ${renderTrafficList('Referrers', data.topReferrers || [])}
 ${renderTrafficList('Browsers', data.byBrowser || [])}
 ${renderTrafficDays(data.byDay || [])}
 </div>
 </div>`;
 } catch {
 box.innerHTML = '<p class="adm-status" data-state="err">Could not load traffic. Reload to retry.</p>';
 }
}

async function runSeoAudit() {
  if (state.loaded.has('seo')) return;
  const box = $('admSeo');
  const pages = ['index.html', 'products.html', 'programs.html', 'industries.html', 'about.html', 'contact.html'];
  const rows = await Promise.all(pages.map(async (page) => {
    try {
      const html = await (await fetch('/' + page, { cache: 'no-store' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = (doc.querySelector('title')?.textContent || '').trim();
      const desc = (doc.querySelector('meta[name="description"]')?.content || '').trim();
      return { page, title: title.length, desc: desc.length, ok: title && desc };
    } catch {
      return { page, ok: false };
    }
  }));
  box.innerHTML = `<h2>SEO audit</h2><div class="adm-table-wrap"><table class="adm"><tbody>${rows.map((row) => `
      <tr><td>${esc(row.page)}</td><td class="${row.ok ? 'seo-ok' : 'seo-bad'}">${row.ok ? 'OK' : 'Check'}</td><td class="muted">title ${esc(row.title || 0)} / desc ${esc(row.desc || 0)}</td></tr>
    `).join('')}</tbody></table></div>`;
  state.loaded.add('seo');
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
