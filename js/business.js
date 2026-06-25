/* MASEST - Business hub controller. The business context of the dashboard: registration +
 * admin verification, NET account, service programs, bulk orders, account team, and the
 * QuickBooks invoicing portal. Stripe card payments live in the USER context (Payment methods
 * tab); QuickBooks NET invoicing lives here, in the business context.
 * Program-enrollment and bulk-order requests post through the company support thread
 * (/api/account/messages) so staff see them in the admin Messages tab - no extra tables. */
import { me, api } from './auth.js';
import { esc, safeUrl, money, fmtDate } from './util.js';

const $ = (id) => document.getElementById(id);

const TIERS = [
  { key: 'Bronze', tag: 'Entry', desc: 'Quarterly treatment + SDS/compliance pack. Good for a single system or seasonal use.' },
  { key: 'Silver', tag: 'Standard', desc: 'Monthly treatment, priority dispatch, and usage tracking across multiple systems.' },
  { key: 'Gold', tag: 'Preferred', desc: 'Scheduled service visits, NET terms, and account-manager support for multi-site operations.' },
  { key: 'Platinum', tag: 'Enterprise', desc: 'Custom program, dedicated manager, on-site reviews, and consolidated billing.' },
];

// Verification dossier option lists (labels mirror the allowed sets in functions/api/account/company.js).
const ENTITY_TYPES = [['llc', 'LLC'], ['c_corp', 'C-Corporation'], ['s_corp', 'S-Corporation'], ['partnership', 'Partnership'], ['sole_prop', 'Sole proprietor'], ['nonprofit', 'Non-profit'], ['government', 'Government / municipal'], ['other', 'Other']];
const INDUSTRIES = [['hvac', 'HVAC / mechanical'], ['facilities', 'Facilities / property'], ['marine', 'Marine'], ['food_bev', 'Food & beverage'], ['manufacturing', 'Manufacturing'], ['municipal', 'Municipal / utility'], ['distributor', 'Distributor / reseller'], ['other', 'Other']];
const VOLUME_BANDS = [['under_10k', 'Under $10k / year'], ['10k_50k', '$10k–$50k / year'], ['50k_250k', '$50k–$250k / year'], ['250k_plus', '$250k+ / year']];
const NET_TERMS = [['0', 'Pay as you go (no terms)'], ['15', 'NET-15'], ['30', 'NET-30'], ['45', 'NET-45'], ['60', 'NET-60']];

const STATUS_LABEL = { approved: 'Verified', pending: 'Under review', rejected: 'Needs attention', suspended: 'Suspended' };

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
function closeReservedTab(tab) { try { tab?.close(); } catch {} }

function optionList(pairs, selected) {
  const sel = selected == null ? '' : String(selected);
  return pairs.map(([value, label]) =>
    `<option value="${esc(value)}"${sel === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

/* ---------- business profile + verification status ---------- */
function renderProfile(data) {
  const c = data.company;
  const status = c?.status || null;
  const box = $('bizProfile');
  if (!c) {
    box.innerHTML = `
      <h2>Your business</h2>
      <p class="muted">Your user account is active. Register your business below to unlock B2B ordering, NET terms, service programs, and QuickBooks invoicing — MASEST reviews and approves each business before those features turn on.</p>`;
    return;
  }
  const label = STATUS_LABEL[status] || 'Not set up';
  const note = {
    approved: 'Your business is verified. B2B ordering, NET terms, programs, and QuickBooks invoicing are unlocked.',
    pending: 'We’re verifying your business — this usually takes 1–2 business days. You’ll get a dashboard notification when it’s approved.',
    rejected: c.rejection_reason ? `We couldn’t verify this business: ${esc(c.rejection_reason)} Update the details below and resubmit.` : 'We couldn’t verify this business yet. Update the details below and resubmit.',
    suspended: 'This account is suspended. Contact your account team to restore access.',
  }[status] || '';
  const tone = status === 'approved' ? 'ok' : status === 'pending' ? 'info' : 'warn';
  box.innerHTML = `
    <h2>Your business</h2>
    <div class="biz-row"><span>Business</span><b>${esc(c.name || 'Not set up')}</b></div>
    <div class="biz-row"><span>Verification</span><span class="badge" data-s="${esc(status || 'pending')}">${esc(label)}</span></div>
    <div class="biz-row"><span>NET terms</span><b>${data.can_use_net_terms ? 'NET-' + c.net_terms_days : 'Not enabled'}</b></div>
    <div class="biz-row"><span>Tax-exempt</span><b>${c.tax_exempt ? 'Yes' : 'No'}</b></div>
    ${note ? `<p class="biz-banner" data-tone="${tone}">${note}</p>` : ''}
    <div class="actions">
      <a class="btn btn-ghost btn-sm" href="#profile">Edit contact</a>
      <a class="btn btn-ghost btn-sm" href="#addresses">Manage addresses</a>
      ${data.can_checkout ? '<a class="btn btn-primary btn-sm" href="products.html">Browse catalog</a>' : ''}
    </div>`;
}

function renderSetupChecklist(data) {
  const box = $('bizSetup');
  const setup = data.setup;
  if (!box) return;
  if (!setup?.steps?.length) { $('bizSetup').hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `
    <h2>Business setup</h2>
    <p class="lead">${setup.done || 0} of ${setup.total || setup.steps.length} steps complete. Finish these to get the most out of your B2B account.</p>
    <div class="setup-list">
      ${setup.steps.map((step) => `
        <a class="setup-step" data-setup-state="${step.done ? 'done' : 'open'}" href="${esc(safeUrl(step.action || 'dashboard.html'))}">
          <i class="ph ${step.done ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>
          <span><b>${esc(step.label)}</b><small>${esc(step.detail)}</small></span>
          <small>${step.done ? 'Done' : 'Open'}</small>
        </a>`).join('')}
    </div>`;
}

/* ---------- business registration / verification form ---------- */
// Shared field grid for create + edit. `c` prefills when a business already exists.
function bizFields(c = {}) {
  return `
    <div class="biz-reg-grid">
      <label class="biz-reg-full"><span>Legal business name *</span><input id="companyName" type="text" value="${esc(c.name || '')}" placeholder="Gulf Coast Mechanical LLC" required></label>
      <label><span>Doing business as (DBA)</span><input id="dba" type="text" value="${esc(c.dba || '')}" placeholder="Optional trade name"></label>
      <label><span>Business entity type</span><select id="entityType"><option value="">Select…</option>${optionList(ENTITY_TYPES, c.entity_type)}</select></label>
      <label><span>Federal Tax ID / EIN</span><input id="taxId" type="text" value="${esc(c.tax_id || '')}" placeholder="12-3456789"></label>
      <label><span>Industry</span><select id="industry"><option value="">Select…</option>${optionList(INDUSTRIES, c.industry)}</select></label>
      <label><span>Business phone</span><input id="bizPhone" type="tel" value="${esc(c.business_phone || '')}" placeholder="(727) 348-6519"></label>
      <label><span>Business email</span><input id="bizEmail" type="email" value="${esc(c.business_email || '')}" placeholder="ap@gulfcoastmech.com"></label>
      <label><span>Website</span><input id="website" type="url" value="${esc(c.website || '')}" placeholder="https://"></label>
      <label><span>Estimated annual volume</span><select id="estVolume"><option value="">Select…</option>${optionList(VOLUME_BANDS, c.est_annual_volume)}</select></label>
      <label><span>Requested payment terms</span><select id="reqNet">${optionList(NET_TERMS, c.requested_net_terms == null ? '0' : c.requested_net_terms)}</select></label>
      <label><span>Authorized contact</span><input id="contactName" type="text" value="${esc(c.contact_name || '')}" placeholder="Marisol Vega"></label>
      <label><span>Contact title</span><input id="contactTitle" type="text" value="${esc(c.contact_title || '')}" placeholder="Operations Manager"></label>
      <label class="biz-reg-full"><span>Resale / tax-exempt certificate URL</span><input id="resaleCertUrl" type="url" value="${esc(c.resale_cert_url || '')}" placeholder="Link to certificate (optional)"></label>
      <label class="biz-check-label biz-reg-full"><input id="taxExempt" type="checkbox" ${c.tax_exempt ? 'checked' : ''}> <span>We are tax-exempt and will provide a resale/exemption certificate.</span></label>
    </div>`;
}

function renderCompanySetupForm(data) {
  const box = $('bizCompanySetup');
  const c = data.company;
  if (!box) return;
  const status = c?.status || null;
  const isCreate = !c;
  const heading = isCreate ? 'Register your business' : status === 'approved' ? 'Business details' : 'Business verification';
  const submitText = isCreate ? 'Submit for approval' : status === 'rejected' ? 'Update & resubmit' : 'Save business details';
  const intro = isCreate
    ? 'Tell us about your business. After you submit, MASEST verifies it (typically 1–2 business days). Once approved you unlock NET terms, QuickBooks invoicing, service programs, and wholesale pricing.'
    : status === 'approved'
      ? 'Your business is verified. Keep these details current for invoicing and compliance.'
      : 'These details stay editable while we verify your business. Keep them accurate to speed up approval.';
  box.innerHTML = `
    <h2>${esc(heading)}</h2>
    <p class="lead">${esc(intro)}</p>
    <form id="companySetupForm" class="biz-reg-form" novalidate>
      ${bizFields(c || {})}
      ${isCreate ? '<p class="biz-verify-note"><i class="ph ph-shield-check" aria-hidden="true"></i> Submitting starts admin verification. Your user account stays active either way — business features turn on once approved.</p>' : ''}
      <div class="actions">
        <button class="btn btn-primary btn-sm" type="submit">${esc(submitText)}</button>
      </div>
      <p id="companySetupStatus" class="status" aria-live="polite"></p>
    </form>`;
}

function readBizForm() {
  const val = (id) => ($(id)?.value ?? '').trim();
  const intOrNull = (id) => { const v = $(id)?.value; return v === '' || v == null ? undefined : parseInt(v, 10); };
  const body = {
    name: val('companyName'),
    dba: val('dba') || null,
    entity_type: val('entityType') || null,
    tax_id: val('taxId') || null,
    industry: val('industry') || null,
    business_phone: val('bizPhone') || null,
    business_email: val('bizEmail') || null,
    website: val('website') || null,
    est_annual_volume: val('estVolume') || null,
    requested_net_terms: intOrNull('reqNet'),
    contact_name: val('contactName') || null,
    contact_title: val('contactTitle') || null,
    resale_cert_url: val('resaleCertUrl') || null,
    tax_exempt: $('taxExempt')?.checked || false,
  };
  if (body.requested_net_terms === undefined) delete body.requested_net_terms;
  return body;
}

function wireCompanySetup() {
  const form = $('companySetupForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('companySetupStatus');
    const button = form.querySelector('button[type="submit"]');
    const body = readBizForm();
    if (!body.name || body.name.length < 2) { if (status) { status.textContent = 'Enter your legal business name.'; status.dataset.state = 'err'; } return; }
    if (status) { status.textContent = 'Saving…'; status.dataset.state = ''; }
    if (button) button.disabled = true;
    try {
      const res = await api('/api/account/company', { method: 'POST', body });
      const fresh = await loadBusinessData();
      renderProfile(fresh);
      renderSetupChecklist(fresh);
      renderCompanySetupForm(fresh);
      wireCompanySetup();
      renderInvoicing(fresh);
      const freshStatus = $('companySetupStatus');
      if (freshStatus) {
        freshStatus.textContent = res.created ? 'Business submitted for verification. We’ll notify you when it’s approved.' : 'Business details saved.';
        freshStatus.dataset.state = 'ok';
      }
    } catch (err) {
      if (status) {
        const map = {
          company_name_required: 'Enter your legal business name.',
          invalid_resale_cert_url: 'Enter a valid certificate URL (https://…).',
          invalid_website: 'Enter a valid website URL (https://…).',
          invalid_business_email: 'Enter a valid business email.',
          invalid_entity_type: 'Choose a valid entity type.',
          invalid_industry: 'Choose a valid industry.',
          invalid_volume: 'Choose a valid annual volume.',
          invalid_net_terms: 'Choose valid payment terms.',
        };
        status.textContent = map[err.data?.error] || (err.status === 401 ? 'Please sign in again.' : 'Could not save. Try again.');
        status.dataset.state = 'err';
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
}

/* ---------- QuickBooks invoicing portal (business context) ---------- */
async function renderInvoicing(data) {
  const box = $('bizInvoicing');
  if (!box) return;
  box.hidden = false;
  if (!data.company) { box.hidden = true; return; }
  if (data.can_checkout !== true) {
    box.innerHTML = `
      <h2>QuickBooks invoicing</h2>
      <p class="lead">NET invoicing through QuickBooks unlocks once your business is verified. Card payments are always available in <a href="#payment">Payment methods</a>.</p>`;
    return;
  }
  box.innerHTML = `
    <h2>QuickBooks invoicing</h2>
    <p class="lead">Your NET orders are billed through QuickBooks. Track invoices and your credit here; card payments stay in <a href="#payment">Payment methods</a>.</p>
    <div id="invSummary" class="biz-inv-summary"><div class="skeleton skeleton-block" style="height:64px"></div></div>
    <div id="invList"><div class="skeleton skeleton-block" style="height:48px;margin-top:10px"></div></div>`;
  let out;
  try { out = await api('/api/account/invoices'); }
  catch { $('invList').innerHTML = '<p class="biz-status" data-state="err">Could not load invoices. Try again.</p>'; $('invSummary').innerHTML = ''; return; }
  const s = out.summary;
  $('invSummary').innerHTML = s ? `
    <div class="biz-inv-stat"><small>Payment terms</small><b>${s.net_terms_days > 0 ? 'NET-' + s.net_terms_days : 'Pay as you go'}</b></div>
    <div class="biz-inv-stat"><small>Outstanding</small><b>${money(s.net_outstanding || 0, 'usd')}</b></div>
    <div class="biz-inv-stat"><small>Credit available</small><b>${s.unlimited ? 'Unlimited' : money(s.credit_available || 0, 'usd')}</b></div>` : '';
  const invoices = out.invoices || [];
  if (!invoices.length) {
    $('invList').innerHTML = `<div class="empty-state"><i class="ph ph-file-text empty-icon" aria-hidden="true"></i><div class="empty-title">No invoices yet</div><div class="empty-body">NET orders you place will appear here as QuickBooks invoices.</div></div>`;
    return;
  }
  $('invList').innerHTML = `
    <table class="biz-inv-table">
      <thead><tr><th>Date</th><th>Invoice</th><th>Status</th><th class="biz-inv-amt">Amount</th></tr></thead>
      <tbody>${invoices.map((inv) => `
        <tr>
          <td>${esc(fmtDate(inv.created_at))}</td>
          <td>${inv.qbo_invoice_id ? esc('#' + inv.qbo_invoice_id) : '<span class="muted">Syncing…</span>'}</td>
          <td><span class="badge" data-s="${esc(inv.paid ? 'net_paid' : 'net_open')}">${inv.paid ? 'Paid' : 'Open'}</span></td>
          <td class="biz-inv-amt">${money(inv.total, inv.currency)}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="muted biz-inv-foot">Need a copy of an invoice or want to pay by ACH/check? <a href="#messages">Message your account team.</a></p>`;
}

/* ---------- service programs ---------- */
function renderTiers(canRequest = false) {
  $('tierGrid').innerHTML = TIERS.map((t) => `
    <div class="tier">
      <div class="tier-tag">${esc(t.tag)}</div>
      <h3>${esc(t.key)}</h3>
      <p>${esc(t.desc)}</p>
      <button type="button" class="btn btn-primary btn-sm" data-tier="${esc(t.key)}" ${canRequest ? '' : 'disabled'}>${canRequest ? 'Request enrollment' : 'Verify business first'}</button>
    </div>`).join('');
  $('tierGrid').querySelectorAll('[data-tier]').forEach((b) => {
    if (!b.disabled) b.addEventListener('click', () => requestProgram(b.dataset.tier, b));
  });
}

async function requestProgram(tier, btn) {
  const status = $('programStatus');
  btn.disabled = true;
  status.textContent = `Starting ${tier}…`; status.dataset.state = '';
  try {
    const r = await api('/api/programs/subscribe', { method: 'POST', body: { tier } });
    if (r.url) { location.href = r.url; return; } // Stripe subscription checkout
    if (r.swapped) { status.textContent = `Switched to the ${tier} program — your next invoice is prorated.`; status.dataset.state = 'ok'; renderProgramStatus(); return; }
    if (r.unchanged) { status.textContent = `You're already on the ${tier} program.`; status.dataset.state = 'ok'; return; }
  } catch (e) {
    if (e.status === 409 && e.data?.fallback) {
      try {
        await api('/api/account/messages', { method: 'POST', body: {
          body: `Program enrollment request - ${tier} tier. Please scope a plan and pricing for our operation.`,
        } });
        status.textContent = `${tier} request sent - your account team will follow up in your dashboard messages.`;
        status.dataset.state = 'ok';
      } catch { status.textContent = 'Could not send the request. Try again.'; status.dataset.state = 'err'; }
    } else if (e.status === 403 && e.data?.error === 'not_approved') {
      status.textContent = 'Your business must be verified before starting a program.'; status.dataset.state = 'err';
    } else if (e.status === 401) {
      status.textContent = 'Please sign in again.'; status.dataset.state = 'err';
    } else {
      status.textContent = 'Could not start the program. Try again.'; status.dataset.state = 'err';
    }
  } finally { btn.disabled = false; }
}

async function renderProgramStatus(data) {
  if (!data?.company) {
    $('programStatus').textContent = 'Register your business before requesting a program.';
    $('programStatus').dataset.state = '';
    return;
  }
  if (!data.can_checkout) {
    $('programStatus').textContent = 'Programs unlock after your business is verified.';
    $('programStatus').dataset.state = '';
    return;
  }
  try {
    const { subscriptions } = await api('/api/programs/subscribe');
    const active = (subscriptions || []).find((s) => s.status === 'active' || s.status === 'trialing');
    if (active) {
      $('programStatus').textContent = `Active program: ${active.tier}.`; $('programStatus').dataset.state = 'ok';
      renderProgramManage(active);
    }
  } catch { /* none */ }
  if (new URLSearchParams(location.search).get('program') === 'success') {
    $('programStatus').textContent = 'Program started - thank you. It will show as active here shortly.';
    $('programStatus').dataset.state = 'ok';
  }
}

// Self-serve "manage / cancel program" → Stripe Customer Portal cancel flow.
function renderProgramManage(active) {
  const status = $('programStatus');
  let btn = $('programManageBtn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'programManageBtn';
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    status.insertAdjacentElement('afterend', btn);
  }
  btn.textContent = 'Manage or cancel program';
  btn.onclick = async () => {
    const portalTab = openReservedTab();
    btn.disabled = true;
    status.textContent = 'Opening Stripe…'; status.dataset.state = '';
    try {
      const r = await api('/api/account/billing-portal', { method: 'POST', body: { flow: 'cancel', subscription: active.stripe_subscription_id } });
      if (r.url) { sendReservedTab(portalTab, r.url); status.textContent = 'Billing portal opened in a new tab.'; status.dataset.state = 'ok'; btn.disabled = false; return; }
    } catch { closeReservedTab(portalTab); status.textContent = 'Could not open the billing portal. Try again.'; status.dataset.state = 'err'; }
    btn.disabled = false;
  };
}

/* ---------- bulk / standing orders ---------- */
function wireBulk() {
  $('bulkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('bulkStatus');
    const itemsText = $('bulkItems').value.trim();
    if (!itemsText) { status.textContent = 'List what you need first.'; status.dataset.state = 'err'; return; }
    const notes = $('bulkNotes').value.trim();
    status.textContent = 'Sending bulk request…'; status.dataset.state = '';
    try {
      await api('/api/account/messages', { method: 'POST', body: {
        body: `Bulk / standing order request:\n${itemsText}${notes ? `\nNotes: ${notes}` : ''}`,
      } });
      e.target.reset();
      status.textContent = 'Bulk request sent - we’ll reply with a quote in your dashboard messages.';
      status.dataset.state = 'ok';
    } catch (err) {
      status.textContent = err.status === 401 ? 'Please sign in again.' : 'Could not send. Try again.';
      status.dataset.state = 'err';
    }
  });
}

/* ---------- team (company admins) ---------- */
async function loadTeam() {
  let t;
  $('teamMembers').innerHTML = `<div class="skeleton skeleton-block" style="height:40px;margin-bottom:8px"></div>`.repeat(2);
  try { t = await api('/api/account/team'); } catch { $('teamMembers').innerHTML = '<p class="biz-status" data-state="err">Could not load team.</p>'; return; }
  $('teamMembers').innerHTML = (t.members || []).map((m) =>
    `<div class="biz-row"><span>${esc(m.full_name || m.email || 'Member')}${m.email && m.full_name ? ` <span class="muted">· ${esc(m.email)}</span>` : ''}</span><b>${esc(m.role)}</b></div>`).join('') || `<div class="empty-state"><i class="ph ph-users empty-icon" aria-hidden="true"></i><div class="empty-title">No team members yet</div><div class="empty-body">Invite colleagues to manage orders and quotes together.</div></div>`;
  $('teamInvites').innerHTML = (t.invites || []).map((iv) =>
    `<div class="biz-row"><span>${esc(iv.email)} <span class="badge" data-s="pending">invited</span></span><button class="btn btn-ghost btn-sm" data-revoke="${esc(iv.id)}">Revoke</button></div>`).join('');
  $('teamInvites').querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/account/team', { method: 'DELETE', body: { id: b.dataset.revoke } }); loadTeam(); }
    catch { b.disabled = false; }
  }));
}
function initTeam() {
  $('bizTeam').hidden = false;
  loadTeam();
  $('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('inviteEmail').value.trim();
    const role = $('inviteRole').value;
    const st = $('inviteStatus');
    if (!email) return;
    st.textContent = 'Sending invite…'; st.dataset.state = '';
    try {
      await api('/api/account/team', { method: 'POST', body: { email, role } });
      $('inviteEmail').value = '';
      st.textContent = 'Invite sent.'; st.dataset.state = 'ok';
      loadTeam();
    } catch (err) {
      const map = { already_invited: 'That email is already invited.', invalid_email: 'Enter a valid email.', company_admin_required: 'Only company admins can invite.' };
      st.textContent = map[err.data?.error] || 'Could not send the invite.'; st.dataset.state = 'err';
    }
  });
}

function showBusinessGuest(message, label = 'Sign in or create an account') {
  const guest = $('bizGuest');
  if (!guest) return;
  if (!guest.querySelector('p') || !guest.querySelector('a')) {
    guest.className = 'biz-card';
    guest.innerHTML = `
      <h2>Set up your business</h2>
      <p class="muted">${esc(message)}</p>
      <a class="btn btn-primary" href="account.html?return=dashboard.html%23business">${esc(label)}</a>`;
  } else {
    guest.querySelector('p').textContent = message;
    guest.querySelector('a').textContent = label;
  }
  guest.hidden = false;
}

// me() returns the company with base columns only. For the registration form we also want the
// extended verification dossier, so merge in GET /api/account/company (degrades silently).
async function loadBusinessData() {
  let data;
  try { data = await me(); } catch { data = null; }
  if (data?.company) {
    try {
      const detail = await api('/api/account/company');
      if (detail?.company) data.company = { ...data.company, ...detail.company };
    } catch { /* keep base company */ }
  }
  return data;
}

export async function initBusinessHub(initialData = null) {
  let data = initialData;
  if (data?.company || !data) {
    // Always hydrate the full dossier when there is (or might be) a company to prefill.
    data = await loadBusinessData();
  }
  if (!data) {
    showBusinessGuest('Register and verify your business to unlock B2B ordering, programs, NET terms, and QuickBooks invoicing.');
    return;
  }
  if (data.needs_profile) {
    showBusinessGuest('Your email is confirmed — finish your account, then register your business to unlock B2B features.', 'Finish setting up');
    return;
  }
  $('bizApp').hidden = false;
  renderProfile(data);
  renderSetupChecklist(data);
  renderCompanySetupForm(data);
  renderInvoicing(data);
  renderTiers(data.can_checkout === true);
  renderProgramStatus(data);
  wireCompanySetup();
  wireBulk();
  if (data.company && data.profile?.role === 'admin') initTeam();
}

if (document.body?.dataset.businessPage === 'true') {
  initBusinessHub();
}
