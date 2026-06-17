/* MASEST — staff admin console. Loaded as a module by admin.html.
 * All authority is server-side (requireStaff via ADMIN_EMAILS). The client just reflects 401/403/200. */
import { login, logout, api } from './auth.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, c) => (c || 'USD').toUpperCase() + ' ' + Number(n || 0).toFixed(2);
const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(); } catch { return ''; } };
const fmtDT = (s) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const ORDER_STATUSES = ['pending_payment', 'paid', 'net_open', 'net_paid', 'fulfilled', 'cancelled'];
const loaded = {};

/* ---------- tabs ---------- */
function selectTab(name) {
  document.querySelectorAll('.adm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.adm-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  history.replaceState(null, '', '#' + name);
  ({ orders: renderOrders, companies: renderCompanies, products: renderProducts, messages: renderThreads, quotes: renderQuotes, offers: renderOffers, traffic: renderTraffic }[name])?.(false);
}
function wireTabs() {
  document.querySelectorAll('.adm-tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
}
function badge(id, n) { const el = $(id); if (!el) return; if (n > 0) { el.textContent = n; el.hidden = false; } else el.hidden = true; }
function statusBadge(s) { return `<span class="badge" data-s="${esc(s)}">${esc(s).replace('_', ' ')}</span>`; }

// Live client-side filter: hide table rows whose text doesn't match the query. Re-queries the
// live table each keystroke, so it keeps working after a list re-renders.
function wireSearch(inputId, boxId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    document.querySelectorAll(`#${boxId} table.adm tbody tr`).forEach((tr) => {
      tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

/* ---------- overview ---------- */
function renderStats(s) {
  badge('aBadgePending', s.companies?.pending || 0);
  badge('aBadgeMsg', s.messages?.unread || 0);
  $('admStats').innerHTML = [
    ['ph-currency-dollar', money(s.revenue, 'usd'), 'Revenue (captured)'],
    ['ph-package', s.orders?.total || 0, 'Orders'],
    ['ph-buildings', s.companies?.pending || 0, 'Pending accounts'],
    ['ph-check-circle', s.companies?.approved || 0, 'Approved accounts'],
    ['ph-chats', s.messages?.unread || 0, 'Unread messages'],
    ['ph-warning', s.inventory?.low_stock || 0, 'Low stock'],
    ['ph-flask', s.catalog?.buy || 0, 'Buy SKUs'],
    ['ph-eye', s.traffic?.views_7d || 0, 'Views (7d)'],
  ].map(([i, n, l]) => `<div class="stat"><div class="big-fig">${typeof n === 'string' ? esc(n) : n}</div><div class="lbl"><i class="ph ${i}"></i> ${l}</div></div>`).join('');
}

/* ---------- orders ---------- */
async function renderOrders() {
  const box = $('admOrders'); const f = $('ordFilter').value;
  box.innerHTML = '<p class="muted">Loading…</p>';
  let orders = [];
  try { orders = (await api('/api/admin/orders' + (f ? '?status=' + f : ''))).orders; } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load.</p>'; return; }
  if (!orders.length) { box.innerHTML = '<p class="muted">No orders.</p>'; return; }
  box.innerHTML = `<table class="adm"><thead><tr><th>Date</th><th>Company</th><th>Items</th><th>Total</th><th>Pay</th><th>Status</th></tr></thead><tbody>${
    orders.map((o) => {
      const items = (o.order_items || []).map((it) => `${esc(it.name)}×${it.qty}`).join(', ');
      return `<tr><td>${fmtDate(o.created_at)}</td><td>${esc(o.companies?.name || '—')}</td>
        <td class="muted">${items}</td><td><b>${money(o.total, o.currency)}</b></td><td>${esc(o.payment_method || '—')}</td>
        <td><select data-order="${esc(o.id)}">${ORDER_STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></td></tr>`;
    }).join('')}</tbody></table>`;
  box.querySelectorAll('select[data-order]').forEach((sel) => sel.addEventListener('change', async () => {
    sel.disabled = true;
    try { await api('/api/admin/orders', { method: 'POST', body: { id: sel.dataset.order, status: sel.value } }); } catch {}
    sel.disabled = false;
  }));
  loaded.orders = true;
}

/* ---------- companies ---------- */
async function renderCompanies() {
  const box = $('admCompanies'); box.innerHTML = '<p class="muted">Loading…</p>';
  let cos = [];
  try { cos = (await api('/api/admin/companies')).companies; } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load.</p>'; return; }
  if (!cos.length) { box.innerHTML = '<p class="muted">No accounts yet.</p>'; return; }
  box.innerHTML = `<table class="adm"><thead><tr><th>Company</th><th>Status</th><th>NET days</th><th>Credit</th><th>Actions</th></tr></thead><tbody>${
    cos.map((c) => {
      const contact = (c.profiles || [])[0];
      return `<tr data-co="${esc(c.id)}">
        <td><button type="button" class="link-name" data-open="${esc(c.id)}">${esc(c.name)}</button>${contact ? `<br><span class="muted">${esc(contact.full_name || '')} ${esc(contact.phone || '')}</span>` : ''}${c.tax_exempt ? '<br><span class="muted">tax-exempt</span>' : ''}</td>
        <td>${statusBadge(c.status)}</td>
        <td><input type="number" min="0" value="${c.net_terms_days || 0}" data-net></td>
        <td><input type="number" min="0" step="100" value="${c.credit_limit || 0}" data-credit></td>
        <td>
          <button class="btn btn-primary btn-sm" data-act="approve">Approve</button>
          <button class="btn btn-ghost btn-sm" data-act="set_terms">Save terms</button>
          <button class="btn btn-ghost btn-sm" data-act="suspend">Suspend</button>
        </td></tr>`;
    }).join('')}</tbody></table><span class="adm-status" id="coStatus" role="status" aria-live="polite"></span>`;
  box.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr'); const id = tr.dataset.co;
    const body = { id, action: b.dataset.act, net_terms_days: Number(tr.querySelector('[data-net]').value), credit_limit: Number(tr.querySelector('[data-credit]').value) };
    b.disabled = true;
    try { await api('/api/admin/companies', { method: 'POST', body }); $('coStatus').textContent = 'Updated.'; $('coStatus').dataset.state = 'ok'; renderCompanies(); refreshStats(); }
    catch { $('coStatus').textContent = 'Failed.'; $('coStatus').dataset.state = 'err'; b.disabled = false; }
  }));
  box.querySelectorAll('button[data-open]').forEach((b) => b.addEventListener('click', () => openCompany(b.dataset.open)));
  loaded.companies = true;
}

// Company detail view (replaces the accounts list; back button returns to it).
async function openCompany(id) {
  const box = $('admCompanies'); box.innerHTML = '<p class="muted">Loading…</p>';
  let d;
  try { d = await api('/api/admin/company?id=' + encodeURIComponent(id)); }
  catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load company.</p>'; return; }
  const c = d.company;
  const members = (d.members || []).map((m) =>
    `<tr><td><b>${esc(m.full_name || '—')}</b></td><td>${esc(m.email || '—')}</td><td>${esc(m.phone || '')}</td><td>${esc(m.role)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No members.</td></tr>';
  const orders = (d.orders || []).map((o) =>
    `<tr><td>${fmtDate(o.created_at)}</td><td>${statusBadge(o.status)}</td><td>${esc(o.payment_method || '—')}</td><td>${money(o.total, o.currency)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No orders.</td></tr>';
  const invites = (d.invites || []).length ? `<p class="muted" style="margin-top:8px">Pending invites: ${d.invites.map((i) => esc(i.email)).join(', ')}</p>` : '';
  box.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="coBack">← Back to accounts</button>
    <h3 style="font-size:1.2rem;margin:14px 0 4px">${esc(c.name)} ${statusBadge(c.status)}</h3>
    <p class="muted">NET-${c.net_terms_days || 0} · credit ${money(c.credit_limit || 0, 'usd')} · ${c.tax_exempt ? 'tax-exempt' : 'taxable'} · ${d.message_count} message(s)${c.resale_cert_url ? ` · <a href="${esc(c.resale_cert_url)}" target="_blank" rel="noopener">resale cert</a>` : ''}</p>
    <h4 style="margin:18px 0 6px;font-size:.95rem">Members</h4>
    <table class="adm"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th></tr></thead><tbody>${members}</tbody></table>
    ${invites}
    <h4 style="margin:18px 0 6px;font-size:.95rem">Orders (${(d.orders || []).length})</h4>
    <table class="adm"><thead><tr><th>Date</th><th>Status</th><th>Pay</th><th>Total</th></tr></thead><tbody>${orders}</tbody></table>`;
  $('coBack').addEventListener('click', () => { loaded.companies = false; renderCompanies(); });
}

/* ---------- products & stock ---------- */
async function renderProducts() {
  const box = $('admProducts'); box.innerHTML = '<p class="muted">Loading…</p>';
  let products = [];
  try { products = (await api('/api/admin/products')).products; } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load.</p>'; return; }
  box.innerHTML = `<table class="adm"><thead><tr><th>SKU</th><th>Name</th><th>Mode</th><th>Price</th><th>Stock</th><th>Active</th><th></th></tr></thead><tbody>${
    products.map((p) => `<tr data-sku="${esc(p.sku)}">
      <td><b>${esc(p.sku)}</b></td><td>${esc(p.name || '')}</td>
      <td><select data-f="mode"><option value="quote"${p.mode === 'quote' ? ' selected' : ''}>quote</option><option value="buy"${p.mode === 'buy' ? ' selected' : ''}>buy</option></select></td>
      <td><input data-f="price" type="number" step="0.01" min="0" value="${p.price ?? ''}" placeholder="—"></td>
      <td><input data-f="stock" type="number" min="0" value="${p.stock ?? ''}" placeholder="∞"></td>
      <td style="text-align:center"><input data-f="active" type="checkbox"${p.active !== false ? ' checked' : ''}></td>
      <td><button class="btn btn-primary btn-sm" data-save>Save</button></td></tr>`).join('')}</tbody></table>
    <span class="adm-status" id="prodRowStatus" role="status" aria-live="polite"></span>`;
  box.querySelectorAll('button[data-save]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    const g = (f) => tr.querySelector(`[data-f="${f}"]`);
    const product = { sku: tr.dataset.sku, mode: g('mode').value, price: g('price').value, active: g('active').checked,
      track_stock: g('stock').value !== '', stock: g('stock').value === '' ? null : Number(g('stock').value) };
    b.disabled = true;
    try { await api('/api/admin/products', { method: 'POST', body: { product } }); $('prodRowStatus').textContent = tr.dataset.sku + ' saved.'; $('prodRowStatus').dataset.state = 'ok'; }
    catch (e) { $('prodRowStatus').textContent = (e.data?.error || 'failed'); $('prodRowStatus').dataset.state = 'err'; }
    finally { b.disabled = false; }
  }));
  loaded.products = true;
}
function wireProductForm() {
  $('prodForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const product = { sku: $('npSku').value.trim(), name: $('npName').value.trim() || undefined, mode: $('npMode').value,
      price: $('npPrice').value || undefined, stock: $('npStock').value === '' ? undefined : Number($('npStock').value),
      track_stock: $('npStock').value !== '' };
    const st = $('prodStatus'); st.textContent = 'Saving…'; st.dataset.state = '';
    try { await api('/api/admin/products', { method: 'POST', body: { product } }); st.textContent = 'Saved.'; st.dataset.state = 'ok'; e.target.reset(); renderProducts(); }
    catch (err) { st.textContent = err.data?.error || 'Failed.'; st.dataset.state = 'err'; }
  });
}

/* ---------- messages ---------- */
async function renderThreads() {
  const box = $('admThreads'); box.innerHTML = '<p class="muted">Loading…</p>';
  let threads = [];
  try { threads = (await api('/api/admin/messages')).threads; } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed.</p>'; return; }
  if (!threads.length) { box.innerHTML = '<p class="muted">No conversations.</p>'; return; }
  box.innerHTML = threads.map((t) => `<button data-co="${esc(t.company_id)}">
    <b>${esc(t.company_name)}</b> ${t.unread ? `<span class="pill" style="background:#b42318;color:#fff;border-radius:999px;padding:0 6px;font-size:.68rem">${t.unread}</span>` : ''}
    <br><span class="muted">${esc((t.last_body || '').slice(0, 60))}</span></button>`).join('');
  box.querySelectorAll('button[data-co]').forEach((b) => b.addEventListener('click', () => openThread(b.dataset.co)));
  loaded.messages = true;
}
async function openThread(companyId) {
  const view = $('admThreadView'); view.innerHTML = '<p class="muted">Loading…</p>';
  let msgs = [];
  try { msgs = (await api('/api/admin/messages?company_id=' + encodeURIComponent(companyId))).messages; } catch { view.innerHTML = '<p class="adm-status" data-state="err">Failed.</p>'; return; }
  view.innerHTML = `<div class="msg-thread">${msgs.map((m) => `<div class="msg ${m.sender_role}">${esc(m.body)}<time style="display:block;font-size:.68rem;opacity:.7;margin-top:3px">${fmtDT(m.created_at)}</time></div>`).join('') || '<p class="muted">No messages.</p>'}</div>
    <form id="replyForm" style="margin-top:12px"><div class="field"><textarea id="replyBody" rows="2" placeholder="Reply…" required></textarea></div>
    <button class="btn btn-primary btn-sm" type="submit" style="margin-top:8px">Reply</button><span class="adm-status" id="replyStatus"></span></form>`;
  view.querySelector('.msg-thread').scrollTop = 1e9;
  $('replyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = $('replyBody').value.trim(); if (!body) return;
    try { await api('/api/admin/messages', { method: 'POST', body: { company_id: companyId, body } }); openThread(companyId); renderThreads(); refreshStats(); }
    catch { $('replyStatus').textContent = 'Failed.'; $('replyStatus').dataset.state = 'err'; }
  });
}

/* ---------- quotes (inbound leads from /api/quote) ---------- */
const QSTATUS = ['new', 'contacted', 'closed', 'spam'];
async function loadQuoteBadge() { try { badge('aBadgeQuotes', (await api('/api/admin/quotes')).new_count || 0); } catch {} }

async function renderQuotes() {
  const box = $('admQuotes'); box.innerHTML = '<p class="muted">Loading…</p>';
  let data;
  try { data = await api('/api/admin/quotes'); } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load.</p>'; return; }
  badge('aBadgeQuotes', data.new_count || 0);
  if (data.needs_migration) {
    box.innerHTML = '<p class="muted">No quotes captured in the database yet. Emails already send on every submission — run <code>supabase/schema-quotes.sql</code> to also store and triage leads here.</p>';
    return;
  }
  const quotes = data.quotes || [];
  if (!quotes.length) { box.innerHTML = '<p class="muted">No quote requests yet.</p>'; return; }
  box.innerHTML = quotes.map(quoteItem).join('');
  box.querySelectorAll('[data-qsave]').forEach((b) => b.addEventListener('click', () => saveQuote(b.dataset.qsave, b)));
  box.querySelectorAll('select[data-qstatus]').forEach((s) => s.addEventListener('change', () => saveQuote(s.dataset.qstatus, s)));
  filterQuotes();
}

function quoteItem(q) {
  const skip = new Set(['name', 'company', 'email', 'phone', 'message', 'type']);
  const extra = Object.entries(q.payload || {})
    .filter(([k, v]) => !skip.has(k) && String(Array.isArray(v) ? v.join('') : (v ?? '')).trim())
    .map(([k, v]) => `<div class="dash-row" style="padding:3px 0"><span class="muted">${esc(k)}</span><span>${esc(Array.isArray(v) ? v.join(', ') : v)}</span></div>`).join('');
  const haystack = [q.name, q.company, q.email, q.product, q.industry, q.location, q.message, JSON.stringify(q.payload || {})].join(' ').toLowerCase();
  const subj = encodeURIComponent('Re: your MASEST ' + (q.type || 'quote') + ' request');
  return `<details class="quote-item" data-status="${esc(q.status)}" data-text="${esc(haystack)}" style="border-bottom:1px solid rgba(0,0,0,.08);padding:10px 0">
    <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;list-style:none">
      <span><b>${esc(q.company || q.name || '—')}</b> <span class="muted">· ${esc(q.type)}${q.product ? ' · ' + esc(q.product) : (q.industry ? ' · ' + esc(q.industry) : '')}</span><br>
        <span class="muted" style="font-size:.8rem">${fmtDT(q.created_at)} · ${esc(q.email || '')}</span></span>
      ${statusBadge(q.status)}</summary>
    <div style="padding:10px 0 4px">
      <div class="dash-row" style="padding:3px 0"><span class="muted">Name</span><span>${esc(q.name || '—')}</span></div>
      <div class="dash-row" style="padding:3px 0"><span class="muted">Email</span><span><a href="mailto:${esc(q.email || '')}">${esc(q.email || '—')}</a></span></div>
      ${q.phone ? `<div class="dash-row" style="padding:3px 0"><span class="muted">Phone</span><span>${esc(q.phone)}</span></div>` : ''}
      ${extra}
      ${q.message ? `<p style="margin:8px 0;white-space:pre-wrap">${esc(q.message)}</p>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
        <label style="font-size:.82rem">Status <select data-qstatus="${esc(q.id)}">${QSTATUS.map((s) => `<option value="${s}"${s === q.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
        <a class="btn btn-ghost btn-sm" href="mailto:${esc(q.email || '')}?subject=${subj}">Reply by email</a>
      </div>
      <div class="field" style="margin-top:8px"><label style="font-size:.82rem">Internal notes</label><textarea data-qnotes rows="2">${esc(q.notes || '')}</textarea></div>
      <button class="btn btn-primary btn-sm" data-qsave="${esc(q.id)}" style="margin-top:6px">Save</button>
      <span class="adm-status" data-qstat role="status" aria-live="polite"></span>
    </div></details>`;
}

async function saveQuote(id, el) {
  const root = el.closest('.quote-item'); if (!root) return;
  const status = root.querySelector('select[data-qstatus]')?.value;
  const notes = root.querySelector('textarea[data-qnotes]')?.value ?? '';
  const stat = root.querySelector('[data-qstat]');
  if (stat) { stat.textContent = 'Saving…'; stat.dataset.state = ''; }
  try {
    await api('/api/admin/quotes', { method: 'POST', body: { id, status, notes } });
    if (stat) { stat.textContent = 'Saved.'; stat.dataset.state = 'ok'; }
    root.dataset.status = status;
    const b = root.querySelector('summary .badge'); if (b) { b.textContent = String(status).replace('_', ' '); b.dataset.s = status; }
    refreshQuoteBadge();
    filterQuotes();
  } catch { if (stat) { stat.textContent = 'Failed.'; stat.dataset.state = 'err'; } }
}

function refreshQuoteBadge() {
  badge('aBadgeQuotes', [...document.querySelectorAll('#admQuotes .quote-item')].filter((it) => it.dataset.status === 'new').length);
}
function filterQuotes() {
  const q = ($('qSearch')?.value || '').trim().toLowerCase();
  const f = $('qFilter')?.value || '';
  document.querySelectorAll('#admQuotes .quote-item').forEach((it) => {
    const ok = (!q || (it.dataset.text || '').includes(q)) && (!f || it.dataset.status === f);
    it.style.display = ok ? '' : 'none';
  });
}

/* ---------- offers ---------- */
function wireOfferForm() {
  $('offerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const st = $('offerStatus'); st.textContent = 'Sending…'; st.dataset.state = '';
    const body = { title: $('ofTitle').value.trim(), body: $('ofBody').value.trim(), cta_url: $('ofCta').value.trim() || null, audience: $('ofAud').value, send_email: $('ofEmail').checked };
    try { const r = await api('/api/admin/offers', { method: 'POST', body }); st.textContent = `Sent to ${r.recipients} account(s)${r.emailed ? ' + email' : ''}.`; st.dataset.state = 'ok'; e.target.reset(); renderOffers(true); }
    catch (err) { st.textContent = err.data?.error || 'Failed.'; st.dataset.state = 'err'; }
  });
}
async function renderOffers(force) {
  if (loaded.offers && !force) return;
  const box = $('admOffers');
  let offers = [];
  try { offers = (await api('/api/admin/offers')).offers; } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed.</p>'; return; }
  box.innerHTML = offers.length
    ? `<table class="adm"><thead><tr><th>Date</th><th>Title</th><th>Audience</th><th>Recipients</th><th>Email</th></tr></thead><tbody>${
      offers.map((o) => `<tr><td>${fmtDate(o.created_at)}</td><td>${esc(o.title)}</td><td>${esc(o.audience)}</td><td>${o.recipients}</td><td>${o.emailed ? '✓' : '—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No offers sent yet.</p>';
  loaded.offers = true;
}

/* ---------- traffic & SEO ---------- */
async function renderTraffic() {
  if (loaded.traffic) return;
  const box = $('admTraffic');
  try {
    const t = await api('/api/admin/traffic?days=14');
    if (!t.available) { box.innerHTML = `<p class="muted">${esc(t.note || 'No traffic data yet.')}</p>`; }
    else {
      const max = Math.max(1, ...t.byDay.map((d) => d.count));
      box.innerHTML = `<p><b>${t.total}</b> views · <b>${t.unique}</b> unique visitors (last ${t.days}d)</p>
        <div style="margin:12px 0">${t.byDay.map((d) => `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span class="muted" style="width:70px;font-size:.78rem">${esc(d.day.slice(5))}</span><div class="bar" style="width:${Math.round(d.count / max * 100)}%"></div><span class="muted" style="font-size:.78rem">${d.count}</span></div>`).join('')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px">
          <div><b>Top pages</b>${t.topPaths.map((p) => `<div class="muted" style="display:flex;justify-content:space-between"><span>${esc(p.key)}</span><b>${p.count}</b></div>`).join('')}</div>
          <div><b>Referrers</b>${t.topReferrers.map((p) => `<div class="muted" style="display:flex;justify-content:space-between"><span>${esc(p.key)}</span><b>${p.count}</b></div>`).join('')}</div>
        </div>`;
    }
  } catch { box.innerHTML = '<p class="adm-status" data-state="err">Failed to load traffic.</p>'; }
  runSeoAudit();
  loaded.traffic = true;
}

const SEO_PAGES = ['index.html', 'products.html', 'programs.html', 'industries.html', 'proof.html', 'resources.html', 'about.html', 'contact.html'];
async function runSeoAudit() {
  const box = $('admSeo');
  const rows = await Promise.all(SEO_PAGES.map(async (page) => {
    try {
      const html = await (await fetch('/' + page, { cache: 'no-store' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = (doc.querySelector('title')?.textContent || '').trim();
      const desc = (doc.querySelector('meta[name="description"]')?.content || '').trim();
      const og = !!doc.querySelector('meta[property="og:title"]') || !!doc.querySelector('meta[property="og:image"]');
      const canonical = !!doc.querySelector('link[rel="canonical"]');
      const noindex = /noindex/i.test(doc.querySelector('meta[name="robots"]')?.content || '');
      return { page, title, titleLen: title.length, desc, descLen: desc.length, og, canonical, noindex };
    } catch { return { page, error: true }; }
  }));
  const mark = (ok, warn) => ok ? '<span class="seo-ok">✓</span>' : (warn ? '<span class="seo-warn">!</span>' : '<span class="seo-bad">✗</span>');
  box.innerHTML = `<table class="adm"><thead><tr><th>Page</th><th>Title (len)</th><th>Description (len)</th><th>OG</th><th>Canonical</th><th>Indexable</th></tr></thead><tbody>${
    rows.map((r) => r.error ? `<tr><td>${esc(r.page)}</td><td colspan="5" class="seo-bad">not reachable</td></tr>`
      : `<tr><td><b>${esc(r.page)}</b></td>
        <td>${mark(r.titleLen >= 15 && r.titleLen <= 65, r.titleLen > 0)} ${r.titleLen}</td>
        <td>${mark(r.descLen >= 50 && r.descLen <= 165, r.descLen > 0)} ${r.descLen}</td>
        <td>${mark(r.og)}</td><td>${mark(r.canonical)}</td>
        <td>${r.noindex ? '<span class="seo-warn">noindex</span>' : '<span class="seo-ok">yes</span>'}</td></tr>`).join('')}</tbody></table>
    <p class="muted" style="margin-top:8px">Targets: title 15–65 chars, description 50–165, OpenGraph + canonical present. <a href="/sitemap.xml" target="_blank">sitemap.xml</a> · <a href="/robots.txt" target="_blank">robots.txt</a></p>`;
}

/* ---------- stats refresh ---------- */
async function refreshStats() { try { renderStats(await api('/api/admin/stats')); } catch {} }

/* ---------- gate / boot ---------- */
function showGate(title, msg, denied) {
  $('admApp').hidden = true; $('admGate').hidden = false;
  $('gateTitle').textContent = title; $('gateMsg').textContent = msg;
  $('gateForm').style.display = denied ? 'none' : '';
}
async function enterApp(stats) {
  $('admGate').hidden = true; $('admApp').hidden = false;
  wireTabs(); wireProductForm(); wireOfferForm();
  wireSearch('ordSearch', 'admOrders'); wireSearch('coSearch', 'admCompanies'); wireSearch('prodSearch', 'admProducts');
  $('qSearch')?.addEventListener('input', filterQuotes); $('qFilter')?.addEventListener('change', filterQuotes);
  renderStats(stats);
  loadQuoteBadge();
  const start = ['orders', 'companies', 'products', 'messages', 'quotes', 'offers', 'traffic'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  selectTab(start);
}
async function boot() {
  try { await enterApp(await api('/api/admin/stats')); }
  catch (err) {
    if (err.status === 403) showGate('Not authorized', 'This account is signed in but is not a MASEST staff account. Ask an admin to add your email to ADMIN_EMAILS.', true);
    else showGate('Staff sign in', 'Sign in with a MASEST staff account.', false);
  }
}
$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('gateStatus'); st.textContent = 'Signing in…'; st.dataset.state = '';
  try { await login({ email: $('gEmail').value.trim(), password: $('gPass').value }); st.textContent = ''; boot(); }
  catch { st.textContent = 'Sign in failed.'; st.dataset.state = 'err'; }
});
boot();
