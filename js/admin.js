/* MASEST staff admin console. */
import { login, logout, api, getToken } from './auth.js';
import { esc, money, dateTime as date } from './util.js';
import { connectQbo, renderQboStatus, runQboSync } from './admin/qbo.js';

const $ = (id) => document.getElementById(id);

const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled'];
const QUOTE_STATUSES = ['new', 'contacted', 'closed', 'spam'];
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
  if (!setup?.steps?.length) return '<span class="muted">—</span>';
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
    box.innerHTML = `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load company.')}</p>`;
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
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Action failed.')}</p>`);
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
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Role update failed.')}</p>`);
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
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Invite update failed.')}</p>`);
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
  location.hash = state.tab;
  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.dataset.active = String(panel.dataset.panel === state.tab);
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  });

  const render = {
    overview: () => { renderStats(state.stats); runSeoAudit(); },
    orders: renderOrders,
    companies: renderCompanies,
    customers: renderCustomers,
    products: renderProducts,
    pricing: renderPricing,
    messages: renderThreads,
    quotes: renderQuotePipeline,
    offers: renderOffers,
    traffic: renderTraffic,
  }[state.tab];
  render?.();
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

function renderStats(stats = {}) {
  badge('aBadgePending', stats.companies?.pending || 0);
  badge('aBadgeMsg', stats.messages?.unread || 0);
  badge('aBadgeQuotes', stats.quotes?.new || stats.quotes?.new_count || 0);
  const items = [
    ['ph-currency-dollar', money(stats.revenue, 'usd'), 'Revenue'],
    ['ph-package', stats.orders?.total || 0, 'Orders'],
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
  `).join('') + renderSetupFollowups(stats);
}

async function renderOrders() {
  const box = $('admOrders');
  box.textContent = 'Loading...';
  const status = $('ordFilter').value;
  try {
    state.orders = (await api('/api/admin/orders' + (status ? `?status=${encodeURIComponent(status)}` : ''))).orders || [];
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load orders.</p>';
    return;
  }
  const q = $('ordSearch').value.trim().toLowerCase();
  const orders = state.orders.filter((order) => JSON.stringify(order).toLowerCase().includes(q));
  if (!orders.length) {
    box.innerHTML = '<p class="muted" style="padding:14px">No orders.</p>';
    return;
  }
  box.innerHTML = `<table class="adm"><thead><tr><th>Date</th><th>Company</th><th>Items</th><th>Total</th><th>Pay</th><th>Status</th><th></th></tr></thead><tbody>${orders.map((order) => {
    const items = (order.order_items || []).map((item) => `${esc(item.qty)} x ${esc(item.name || item.sku)}`).join('<br>');
    return `<tr>
      <td>${esc(date(order.created_at))}</td>
      <td>${esc(order.companies?.name || order.company_name || order.company_id || 'Guest')}</td>
      <td>${items || '<span class="muted">No items</span>'}</td>
      <td>${esc(money(order.total ?? order.subtotal, order.currency))}</td>
      <td>${esc(order.payment_method || '')}</td>
      <td><select class="adm-select" data-order-status="${esc(order.id)}">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}</select></td>
      <td>${trackingControls(order)}<button class="btn btn-ghost btn-sm" data-save-order="${esc(order.id)}" type="button">Save</button>${order.payment_method === 'net' ? ` <button class="btn btn-ghost btn-sm" data-qbo-order="${esc(order.id)}" type="button">${order.qbo_invoice_id ? `Invoice ${esc(order.qbo_invoice_id)}` : 'Add invoice'}</button>` : ''}${order.payment_method === 'stripe' && order.status !== 'cancelled' ? ` <button class="btn btn-ghost btn-sm" data-refund-order="${esc(order.id)}" type="button">Refund</button>` : ''}</td>
    </tr>`;
  }).join('')}</tbody></table>`;

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
        message('ordStatus', err.data?.error || 'Tracking update failed.', 'err');
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-refund-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.refundOrder;
      if (!confirm('Refund this order via Stripe and mark it cancelled?')) return;
      button.disabled = true;
      message('ordStatus', 'Refunding...');
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'refund' } });
        message('ordStatus', 'Refunded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Refund failed.', 'err');
        button.disabled = false;
      }
    });
  });
  box.querySelectorAll('[data-qbo-order]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.qboOrder;
      const invoiceId = prompt('QuickBooks invoice ID');
      if (!invoiceId) return;
      button.disabled = true;
      try {
        await api('/api/admin/orders', { method: 'POST', body: { id, action: 'record_qbo_invoice', qbo_invoice_id: invoiceId.trim() } });
        message('ordStatus', 'Invoice recorded.', 'ok');
        await renderOrders();
      } catch (err) {
        message('ordStatus', err.data?.error || 'Invoice update failed.', 'err');
        button.disabled = false;
      }
    });
  });
}

async function renderCustomers() {
  const box = $('admCustomers');
  box.textContent = 'Loading...';
  try {
    state.customers = (await api('/api/admin/customers')).customers || [];
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load customers.</p>';
    return;
  }
  const q = $('custSearch').value.trim().toLowerCase();
  const rows = state.customers.filter((c) => JSON.stringify(c).toLowerCase().includes(q));
  if (!rows.length) { box.innerHTML = '<p class="muted" style="padding:14px">No customers.</p>'; return; }
  box.innerHTML = `<table class="adm"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Tier</th><th>Role</th></tr></thead><tbody>${rows.map((c) => `
    <tr>
      <td>${esc(c.full_name || '—')}${c.phone ? `<br><span class="muted">${esc(c.phone)}</span>` : ''}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">—</span>'}</td>
      <td>${esc(c.company_name || '—')}</td>
      <td>${statusBadge(c.company_status || '—')}</td>
      <td>${esc(c.price_tier || 'retail')}</td>
      <td>${esc(c.role || '')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function renderCompanies() {
  const box = $('admCompanies');
  box.textContent = 'Loading...';
  try {
    state.companies = (await api('/api/admin/companies')).companies || [];
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load accounts.</p>';
    return;
  }
  const q = $('coSearch').value.trim().toLowerCase();
  const companies = state.companies.filter((company) => JSON.stringify(company).toLowerCase().includes(q));
  if (!companies.length) {
    box.innerHTML = '<p class="muted" style="padding:14px">No accounts.</p>';
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
  `).join('')}</tbody></table>`;
  box.querySelectorAll('[data-open-company]').forEach((button) => {
    button.addEventListener('click', () => openCompanyDetail(button.dataset.openCompany));
  });
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
    if (!confirm(`Approve ${ids.length} account(s)?`)) return;
    bulk.disabled = true;
    try {
      await api('/api/admin/companies', { method: 'POST', body: { ids, action: 'approve' } });
      await renderCompanies();
    } finally { bulk.disabled = false; }
  });
}

async function renderProducts() {
  const box = $('admProducts');
  box.textContent = 'Loading...';
  try {
    const response = await api('/api/admin/products');
    state.products = response.products || [];
    if (response.media_ready === false) {
      message('prodStatus', 'Apply site/supabase/schema-phase5.sql to enable product photos.', 'err');
    }
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load products.</p>';
    return;
  }
  const q = $('prodSearch').value.trim().toLowerCase();
  const products = state.products.filter((product) => JSON.stringify(product).toLowerCase().includes(q));
  if (!products.length) {
    box.innerHTML = '<p class="muted" style="padding:14px">No products.</p>';
    return;
  }
  box.innerHTML = `<table class="adm"><thead><tr><th>Photo</th><th>SKU</th><th>Name</th><th>Mode</th><th>Price</th><th>Stock</th><th>Photo URL</th><th>Alt</th><th>Variants</th><th>Active</th><th></th></tr></thead><tbody>${products.map((p) => `
    <tr data-product="${esc(p.sku)}">
      <td>${p.image_url ? `<img class="product-photo" src="${esc(p.image_url)}" alt="${esc(p.photo_alt || p.name || '')}">` : '<span class="muted">No photo</span>'}${Array.isArray(p.gallery) && p.gallery.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${p.gallery.map((u, i) => `<span style="display:inline-flex;flex-direction:column;align-items:center"><img src="${esc(u)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:4px;border:1px solid var(--line)"><span><button type="button" class="gbtn" data-gact="primary" data-gurl="${esc(u)}" title="Make primary">★</button><button type="button" class="gbtn" data-gact="up" data-gidx="${i}" title="Move up">↑</button><button type="button" class="gbtn" data-gact="down" data-gidx="${i}" title="Move down">↓</button><button type="button" class="gbtn" data-gact="del" data-gurl="${esc(u)}" title="Remove">×</button></span></span>`).join('')}</div>` : ''}<br><label class="muted" style="font-size:.7rem;display:block;margin-top:4px">Upload<input type="file" accept="image/*" data-imgfile style="display:block;max-width:120px;font-size:.7rem"></label><label class="muted" style="font-size:.7rem;display:block">+ gallery<input type="file" accept="image/*" data-galfile style="display:block;max-width:120px;font-size:.7rem"></label></td>
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
    } catch (err) { message('prodStatus', err.data?.error || 'Gallery update failed.', 'err'); btn.disabled = false; }
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
    message('prodStatus', err.message || 'Upload failed.', 'err');
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
    message('prodStatus', err.data?.error || 'Failed.', 'err');
  }
}

async function removeProduct(sku) {
  if (!confirm(`Deactivate ${sku}? Existing order history stays intact.`)) return;
  try {
    await api('/api/admin/products', { method: 'DELETE', body: { sku } });
    message('prodStatus', 'Product deactivated.', 'ok');
    await renderProducts();
  } catch (err) {
    message('prodStatus', err.data?.hint || err.data?.error || 'Remove failed.', 'err');
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
    message('variantStatus', err.data?.error || 'Failed.', 'err');
  }
}

async function removeVariant(vsku) {
  if (!confirm(`Deactivate ${vsku}? Existing order history stays intact.`)) return;
  try {
    await api('/api/admin/products', { method: 'DELETE', body: { vsku } });
    message('variantStatus', 'Variant deactivated.', 'ok');
    await renderProducts();
  } catch (err) {
    message('variantStatus', err.data?.error || 'Remove failed.', 'err');
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
      message('prodStatus', err.data?.error || 'Failed.', 'err');
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
      message('variantStatus', err.data?.error || 'Failed.', 'err');
    }
  });
}

async function renderPricing() {
  const box = $('admPricing');
  box.textContent = 'Loading...';
  let data;
  try {
    data = await api('/api/admin/variant-pricing');
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load pricing.</p>';
    return;
  }
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
        message('priceRowStatus', err.data?.error || 'Failed.', 'err');
      } finally {
        input.disabled = false;
      }
    });
  });
}

async function renderThreads() {
  const box = $('admThreads');
  box.textContent = 'Loading...';
  try {
    state.threads = (await api('/api/admin/messages')).threads || [];
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load messages.</p>';
    return;
  }
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
        message('replyStatus', err.data?.error || 'Failed.', 'err');
      }
    });
  } catch {
    view.innerHTML = '<p class="adm-status" data-state="err">Failed to load thread.</p>';
  }
}

async function renderQuotes() {
  const box = $('admQuotes');
  box.textContent = 'Loading...';
  let data;
  try {
    data = await api('/api/admin/quotes');
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load quotes.</p>';
    return;
  }
  state.quotes = data.quotes || [];
  badge('aBadgeQuotes', data.new_count || 0);
  if (data.needs_migration) {
    box.innerHTML = '<p class="muted">No quote database yet. Apply site/supabase/schema-quotes.sql to store and triage leads here.</p>';
    return;
  }
  if (!state.companies?.length) { try { state.companies = (await api('/api/admin/companies')).companies || []; } catch { state.companies = []; } }
  const coOpts = (state.companies || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.status || '')})</option>`).join('');
  const q = $('qSearch').value.trim().toLowerCase();
  const filter = $('qFilter').value;
  const priorityFilter = $('qPriority').value;
  const ownerFilter = $('qOwner')?.value.trim().toLowerCase() || '';
  const quotes = state.quotes.filter((quote) => {
    const text = JSON.stringify(quote).toLowerCase();
    const ownerMatch = !ownerFilter || String(quote.assigned_to || '').toLowerCase().includes(ownerFilter);
    return (!q || text.includes(q)) && (!filter || quote.status === filter) && (!priorityFilter || quote.priority === priorityFilter) && ownerMatch;
  });
  if (!quotes.length) {
    box.innerHTML = '<p class="muted">No quotes.</p>';
    return;
  }
  box.innerHTML = quotes.map((quote) => `
    <details class="quote-item">
      <summary><b>${esc(quote.company || quote.name || quote.email)}</b> ${statusBadge(quote.status || 'new')}</summary>
      <p>${esc(quote.message || '')}</p>
      <p class="muted">${esc([quote.email, quote.phone, quote.product, quote.industry, quote.location].filter(Boolean).join(' | '))}</p>
      <div class="adm-tools">
        <select class="adm-select" data-quote-priority="${esc(quote.id)}">
          ${['urgent', 'high', 'normal', 'low'].map((p) => `<option value="${p}" ${p === (quote.priority || 'normal') ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input class="adm-input" data-quote-next-step="${esc(quote.id)}" value="${esc(quote.next_step || '')}" placeholder="Next step">
        <input class="adm-input" data-quote-owner="${esc(quote.id)}" value="${esc(quote.assigned_to || '')}" placeholder="Owner">
        <input class="adm-input" data-quote-due-at="${esc(quote.id)}" value="${esc(quote.due_at ? String(quote.due_at).slice(0, 10) : '')}" type="date">
        <span class="muted">${Number.isFinite(Number(quote.lead_score)) ? `Score ${Number(quote.lead_score)}` : ''}</span>
      </div>
      <div class="adm-tools">
        <select class="adm-select" data-quote-status="${esc(quote.id)}">${QUOTE_STATUSES.map((s) => `<option value="${s}" ${s === quote.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" data-save-quote="${esc(quote.id)}" type="button">Save</button>
        <a class="btn btn-primary btn-sm" href="mailto:${esc(quote.email || '')}?subject=${encodeURIComponent('Re: your MASEST request')}">Email</a>
      </div>
      <div class="adm-tools" style="margin-top:8px;align-items:end;flex-wrap:wrap">
        <select class="adm-select" data-conv-co="${esc(quote.id)}" style="max-width:200px"><option value="">Convert to order for…</option>${coOpts}</select>
        <input class="adm-input" data-conv-sku="${esc(quote.id)}" placeholder="SKU" style="max-width:120px">
        <input class="adm-input" data-conv-name="${esc(quote.id)}" placeholder="Item name" style="max-width:150px">
        <input class="adm-input" type="number" min="1" value="1" data-conv-qty="${esc(quote.id)}" style="max-width:64px" aria-label="Qty">
        <input class="adm-input" type="number" min="0" step="0.01" data-conv-price="${esc(quote.id)}" placeholder="Unit $" style="max-width:90px">
        <button class="btn btn-ghost btn-sm" data-convert="${esc(quote.id)}" type="button">Convert → order</button>
      </div>
    </details>
  `).join('');
  box.querySelectorAll('[data-save-quote]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveQuote;
      const status = box.querySelector(`[data-quote-status="${CSS.escape(id)}"]`).value;
      const priority = box.querySelector(`[data-quote-priority="${CSS.escape(id)}"]`).value;
      const next_step = box.querySelector(`[data-quote-next-step="${CSS.escape(id)}"]`).value.trim();
      const assigned_to = box.querySelector(`[data-quote-owner="${CSS.escape(id)}"]`).value.trim();
      const due_at = box.querySelector(`[data-quote-due-at="${CSS.escape(id)}"]`).value;
      await api('/api/admin/quotes', { method: 'POST', body: { id, status, priority, next_step, assigned_to, due_at } });
      renderQuotes();
    });
  });
  box.querySelectorAll('[data-convert]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.convert;
      const pick = (k) => box.querySelector(`[data-conv-${k}="${CSS.escape(id)}"]`);
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
        await renderQuotes();
      } catch (err) {
        message('qStatus', err.data?.error || 'Convert failed.', 'err');
        button.disabled = false;
      }
    });
  });
}

async function renderQuotePipeline() {
  const box = $('admQuotes');
  box.textContent = 'Loading...';
  let data;
  try {
    data = await api('/api/admin/quotes');
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed to load quotes.</p>';
    return;
  }

  state.quotes = data.quotes || [];
  badge('aBadgeQuotes', data.urgent_count || data.new_count || 0);
  if (data.needs_migration) {
    box.innerHTML = '<p class="muted">No quote database yet. Apply supabase/schema-quotes.sql to store and triage leads here.</p>';
    return;
  }
  if (!state.companies?.length) {
    try { state.companies = (await api('/api/admin/companies')).companies || []; } catch { state.companies = []; }
  }

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
    box.innerHTML = '<p class="muted">No quotes.</p>';
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
  }).join('');

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
        message('qStatus', err.data?.error || 'Save failed.', 'err');
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
        message('qStatus', err.data?.error || 'Convert failed.', 'err');
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
        message('qStatus', err.data?.error || 'Snooze failed.', 'err');
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
        message('qStatus', err.data?.error || 'Follow-up failed.', 'err');
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
      message('offerStatus', err.data?.error || 'Failed.', 'err');
    }
  });
}

async function renderOffers(force = false) {
  if (state.loaded.has('offers') && !force) return;
  const box = $('admOffers');
  box.textContent = 'Loading...';
  try {
    const offers = (await api('/api/admin/offers')).offers || [];
    box.innerHTML = offers.length ? offers.map((offer) => `
      <div class="quote-item"><b>${esc(offer.title)}</b><p class="muted">${esc(offer.audience)} | ${esc(offer.recipients || 0)} recipients | ${esc(date(offer.created_at))}</p></div>
    `).join('') : '<p class="muted">No sends yet.</p>';
    state.loaded.add('offers');
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed.</p>';
  }
}

async function renderTraffic() {
  const box = $('admTraffic');
  box.textContent = 'Loading...';
  try {
    const data = await api('/api/admin/traffic?days=14');
    if (!data.available) {
      box.innerHTML = `<p class="muted">${esc(data.note || 'Traffic table not migrated yet.')}</p>`;
      return;
    }
    box.innerHTML = `<h2>Traffic (14d)</h2><p><b>${esc(data.total)}</b> views, <b>${esc(data.unique)}</b> unique visitors</p>
      <h3>Top paths</h3>${(data.topPaths || []).map((row) => `<p>${esc(row.key)} <span class="muted">${esc(row.count)}</span></p>`).join('')}`;
  } catch {
    box.innerHTML = '<p class="adm-status" data-state="err">Failed.</p>';
  }
}

async function runSeoAudit() {
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
  box.innerHTML = `<h2>SEO audit</h2><table class="adm"><tbody>${rows.map((row) => `
    <tr><td>${esc(row.page)}</td><td class="${row.ok ? 'seo-ok' : 'seo-bad'}">${row.ok ? 'OK' : 'Check'}</td><td class="muted">title ${esc(row.title || 0)} / desc ${esc(row.desc || 0)}</td></tr>
  `).join('')}</tbody></table>`;
}

function wire() {
  ORDER_STATUSES.forEach((status) => {
    $('ordFilter').insertAdjacentHTML('beforeend', `<option value="${status}">${status.replaceAll('_', ' ')}</option>`);
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  $('ordFilter').addEventListener('change', renderOrders);
  $('ordSearch').addEventListener('input', renderOrders);
  $('coSearch').addEventListener('input', renderCompanies);
  $('prodSearch').addEventListener('input', renderProducts);
  $('priceSearch').addEventListener('input', renderPricing);
  $('qFilter').addEventListener('change', renderQuotePipeline);
  $('qPriority')?.addEventListener('change', renderQuotePipeline);
  $('qDue')?.addEventListener('change', renderQuotePipeline);
  $('qSearch').addEventListener('input', renderQuotePipeline);
  $('custSearch').addEventListener('input', renderCustomers);
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
    } catch { message('ordStatus', 'Export failed.', 'err'); }
  });
  $('admLogout').addEventListener('click', async () => { await logout(); location.reload(); });
  $('gateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    message('gateStatus', 'Signing in...');
    try {
      await login({ email: $('gEmail').value.trim(), password: $('gPass').value });
      message('gateStatus', '');
      boot();
    } catch {
      message('gateStatus', 'Sign in failed.', 'err');
    }
  });
  wireProductForm();
  wireVariantForm();
  wireOfferForm();
}

wire();
boot();
