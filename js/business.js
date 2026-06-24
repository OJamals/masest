/* MASEST - Business hub controller. Gated to signed-in B2B accounts.
 * Program-enrollment and bulk-order requests are posted through the company support thread
 * (/api/account/messages), so staff see them in the admin Messages tab - no extra tables. */
import { me, api } from './auth.js';
import { esc, safeUrl } from './util.js';

const $ = (id) => document.getElementById(id);

const TIERS = [
  { key: 'Bronze', tag: 'Entry', desc: 'Quarterly treatment + SDS/compliance pack. Good for a single system or seasonal use.' },
  { key: 'Silver', tag: 'Standard', desc: 'Monthly treatment, priority dispatch, and usage tracking across multiple systems.' },
  { key: 'Gold', tag: 'Preferred', desc: 'Scheduled service visits, NET terms, and account-manager support for multi-site operations.' },
  { key: 'Platinum', tag: 'Enterprise', desc: 'Custom program, dedicated manager, on-site reviews, and consolidated billing.' },
];

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

function closeReservedTab(tab) {
  try { tab?.close(); } catch {}
}

function renderProfile(data) {
  const c = data.company;
  const status = c?.status || 'not set up';
  const badge = `<span class="badge" data-s="${esc(c?.status || 'pending')}">${esc(status)}</span>`;
  $('bizProfile').innerHTML = `
    <h2>Your business</h2>
    <div class="biz-row"><span>Company</span><b>${esc(c?.name || 'Not set up')}</b></div>
    <div class="biz-row"><span>Status</span>${badge}</div>
    <div class="biz-row"><span>NET terms</span><b>${data.can_use_net_terms ? 'NET-' + c.net_terms_days : 'Not enabled'}</b></div>
    <div class="biz-row"><span>Tax-exempt</span><b>${c?.tax_exempt ? 'Yes' : 'No'}</b></div>
    <div class="actions">
      <a class="btn btn-primary btn-sm" href="dashboard.html">Account dashboard</a>
      <a class="btn btn-ghost btn-sm" href="dashboard.html#profile">Edit profile</a>
      ${c ? '<a class="btn btn-ghost btn-sm" href="dashboard.html#addresses">Manage addresses</a>' : ''}
      ${data.can_checkout ? '<a class="btn btn-ghost btn-sm" href="products.html">Browse catalog</a>' : ''}
    </div>
    ${!c ? '<p class="muted" style="margin-top:12px">Your user account is active. Create a business profile below when you need checkout, programs, or NET terms.</p>' : ''}
    ${c && c.status !== 'approved' ? '<p class="muted" style="margin-top:12px">Business checkout, payment setup, programs, and NET terms unlock once MASEST approves this business.</p>' : ''}`;
}

function renderSetupChecklist(data) {
  const box = $('bizSetup');
  const setup = data.setup;
  if (!box) return;
  if (!setup?.steps?.length) { $('bizSetup').hidden = true; return; }
  $('bizSetup').hidden = false;
  box.innerHTML = `
    <h2>Business setup</h2>
    <p class="lead">${setup.done || 0} of ${setup.total || setup.steps.length} account steps complete. Finish these before relying on automated checkout, programs, or NET terms.</p>
    <div class="setup-list">
      ${setup.steps.map((step) => `
        <a class="setup-step" data-setup-state="${step.done ? 'done' : 'open'}" href="${esc(safeUrl(step.action || 'dashboard.html'))}">
          <i class="ph ${step.done ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>
          <span><b>${esc(step.label)}</b><small>${esc(step.detail)}</small></span>
          <small>${step.done ? 'Done' : 'Open'}</small>
        </a>`).join('')}
    </div>`;
}

function renderCompanySetupForm(data) {
  const box = $('bizCompanySetup');
  const c = data.company;
  if (!box) return;
  if (!c) {
    box.innerHTML = `
      <h2>Create business profile</h2>
      <p class="lead">Your user account is ready. Add a company when you want MASEST to review the business for checkout, programs, and NET terms.</p>
      <form id="companySetupForm" class="biz-form biz-form-create">
        <label><span>Company name</span><input id="companyName" type="text" placeholder="Gulf Coast Mechanical" required></label>
        <label class="biz-check-label"><input id="taxExempt" type="checkbox"> <span>Tax-exempt</span></label>
        <label><span>Resale certificate URL</span><input id="resaleCertUrl" type="url" placeholder="https://"></label>
        <button class="btn btn-primary btn-sm" type="submit">Submit for approval</button>
        <p id="companySetupStatus" class="status" aria-live="polite"></p>
      </form>`;
    return;
  }
  box.innerHTML = `
    <h2>Tax setup</h2>
    <p class="lead">These business details stay editable while approval is pending.</p>
    <form id="companySetupForm" class="biz-form">
      <label class="biz-check-label"><input id="taxExempt" type="checkbox" ${c.tax_exempt ? 'checked' : ''}> <span>Tax-exempt</span></label>
      <label><span>Resale certificate URL</span><input id="resaleCertUrl" type="url" value="${esc(c.resale_cert_url || '')}" placeholder="https://"></label>
      <button class="btn btn-primary btn-sm" type="submit">Save setup</button>
      <p id="companySetupStatus" class="status" aria-live="polite"></p>
    </form>`;
}

function wireCompanySetup() {
  const form = $('companySetupForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('companySetupStatus');
    const button = form.querySelector('button');
    if (status) { status.textContent = 'Saving setup...'; status.dataset.state = ''; }
    if (button) button.disabled = true;
    try {
      const body = {
        tax_exempt: $('taxExempt').checked,
        resale_cert_url: $('resaleCertUrl').value.trim(),
      };
      const companyName = $('companyName')?.value.trim();
      if ($('companyName')) {
        if (!companyName) { if (status) { status.textContent = 'Enter your company name.'; status.dataset.state = 'err'; } return; }
        body.name = companyName;
      }
      await api('/api/account/company', { method: 'POST', body });
      const fresh = await me();
      renderProfile(fresh);
      renderSetupChecklist(fresh);
      renderCompanySetupForm(fresh);
      wireCompanySetup();
      const freshStatus = $('companySetupStatus');
      if (freshStatus) { freshStatus.textContent = companyName ? 'Business profile submitted for approval.' : 'Setup saved.'; freshStatus.dataset.state = 'ok'; }
    } catch (err) {
      if (status) {
        const copy = err.data?.error === 'company_name_required' ? 'Enter your company name.'
          : err.data?.error === 'invalid_resale_cert_url' ? 'Enter a valid resale certificate URL.'
            : err.status === 401 ? 'Please sign in again.' : 'Could not save setup.';
        status.textContent = copy; status.dataset.state = 'err';
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function renderPaymentSetup(data) {
  const box = $('bizPaymentSetup');
  if (!box) return;
  const hasPayment = Boolean(data.company?.stripe_customer_id);
  const canOpenPortal = data.can_checkout === true;
  const paymentState = hasPayment ? 'ready' : canOpenPortal ? 'needs_setup' : 'locked';
  box.innerHTML = `
    <h2 id="payment">Payment setup</h2>
    <p class="lead" data-payment-state="${paymentState}">${hasPayment ? 'Saved payment access is ready for this account.' : canOpenPortal ? 'Open the secure Stripe portal to add or update saved payment methods.' : 'Payment setup unlocks after business approval.'}</p>
    ${canOpenPortal ? '<button id="paymentSetupPortal" class="btn btn-primary btn-sm" type="button">Open payment portal</button>' : ''}
    <p id="paymentSetupStatus" class="status" aria-live="polite"></p>`;
}

function wirePaymentSetup() {
  const button = $('paymentSetupPortal');
  if (!button) return;
  button.addEventListener('click', async () => {
    const portalTab = openReservedTab();
    const status = $('paymentSetupStatus');
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Opening Stripe...';
    if (status) {
      status.textContent = 'Opening Stripe payment portal...';
      status.dataset.state = 'busy';
    }
    try {
      const out = await api('/api/account/billing-portal', { method: 'POST' });
      if (status) {
        status.textContent = 'Payment portal opened in a new tab.';
        status.dataset.state = 'ok';
      }
      sendReservedTab(portalTab, out.url);
      button.textContent = originalText;
      button.disabled = false;
    } catch (err) {
      closeReservedTab(portalTab);
      if (status) {
        status.textContent = err.data?.error === 'stripe_not_configured' ? 'Stripe is not configured for this workspace yet.' : 'Could not open the payment portal. Try again.';
        status.dataset.state = 'err';
      }
      button.textContent = originalText;
      button.disabled = false;
    }
  });
}

function renderTiers(canRequest = false) {
  $('tierGrid').innerHTML = TIERS.map((t) => `
    <div class="tier">
      <div class="tier-tag">${esc(t.tag)}</div>
      <h3>${esc(t.key)}</h3>
      <p>${esc(t.desc)}</p>
      <button type="button" class="btn btn-primary btn-sm" data-tier="${esc(t.key)}" ${canRequest ? '' : 'disabled'}>${canRequest ? 'Request enrollment' : 'Approval required'}</button>
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
      // No online price configured yet → fall back to a request-enrollment message.
      try {
        await api('/api/account/messages', { method: 'POST', body: {
          body: `Program enrollment request - ${tier} tier. Please scope a plan and pricing for our operation.`,
        } });
        status.textContent = `${tier} request sent - your account team will follow up in your dashboard messages.`;
        status.dataset.state = 'ok';
      } catch { status.textContent = 'Could not send the request. Try again.'; status.dataset.state = 'err'; }
    } else if (e.status === 403 && e.data?.error === 'not_approved') {
      status.textContent = 'Your account must be approved before starting a program.'; status.dataset.state = 'err';
    } else if (e.status === 401) {
      status.textContent = 'Please sign in again.'; status.dataset.state = 'err';
    } else {
      status.textContent = 'Could not start the program. Try again.'; status.dataset.state = 'err';
    }
  } finally { btn.disabled = false; }
}

async function renderProgramStatus(data) {
  if (!data?.company) {
    $('programStatus').textContent = 'Create a business profile before requesting a program.';
    $('programStatus').dataset.state = '';
    return;
  }
  if (!data.can_checkout) {
    $('programStatus').textContent = 'Programs unlock after business approval.';
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

// Self-serve "manage / cancel program" button → Stripe Customer Portal cancel flow
// (proration/pause configured in the portal configuration). Idempotent: replaces any prior button.
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

async function boot() {
  let data = null;
  try { data = await me(); } catch { data = null; }
  if (!data) { $('bizGuest').hidden = false; return; }
  if (data.needs_profile) {
    $('bizGuest').hidden = false;
    $('bizGuest').querySelector('p').textContent = 'Your email is confirmed - finish setting up your business account to access programs and bulk ordering.';
    $('bizGuest').querySelector('a').textContent = 'Finish setting up';
    return;
  }
  $('bizApp').hidden = false;
  renderProfile(data);
  renderSetupChecklist(data);
  renderCompanySetupForm(data);
  renderPaymentSetup(data);
  renderTiers(data.can_checkout === true);
  renderProgramStatus(data);
  wireCompanySetup();
  wirePaymentSetup();
  wireBulk();
  if (data.company && data.profile?.role === 'admin') initTeam();
}
boot();
