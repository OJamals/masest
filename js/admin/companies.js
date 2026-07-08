// Admin companies/accounts tab (#36 per-tab split). B2B account approval list plus
// the company-detail drawer (members, invites, setup progress, role + invite
// actions). Shared primitives ($, api, state, admSkeleton, admEmpty) and the
// admin-local statusBadge / admListPager helpers are injected; esc + confirmDialog
// come from util.js and the dirty-edit helpers from edits.js.
import { esc, confirmDialog, delegate, detailDialog, money, safeUrl, dateTime as date } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';
import { ORDER_STATUSES } from './orders.js';

// Roles an admin can assign to a company member or a standalone user (must match
// the server ROLES set in functions/api/admin/users.js).
const MEMBER_ROLES = [['buyer', 'Buyer'], ['admin', 'Admin'], ['moderator', 'Moderator']];
function memberRoleOptions(current) {
  return MEMBER_ROLES.map(([v, l]) => `<option value="${v}"${(current || 'buyer') === v ? ' selected' : ''}>${l}</option>`).join('');
}

// Small reusable prompt dialog (native <dialog>, styled via .detail-dialog) for the
// short forms in this tab: new user, edit a companyless user, add/edit an address.
// Resolves the submitted FormData as a plain object, or null on cancel/Esc.
async function promptDialog({ title, bodyHtml, submitLabel = 'Save' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'detail-dialog';
  dlg.innerHTML = `<h3 style="margin:0 0 14px">${esc(title)}</h3>
    <form id="admPromptForm" class="adm-form-grid" onsubmit="return false">${bodyHtml}</form>
    <menu style="display:flex;gap:10px;justify-content:flex-end;margin:16px 0 0;padding:0;list-style:none">
      <button value="cancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
      <button value="ok" class="btn btn-primary btn-sm" type="button">${esc(submitLabel)}</button>
    </menu>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('input,select,textarea')?.focus();
  const result = await new Promise((resolve) => {
    dlg.querySelector('menu').addEventListener('click', (event) => {
      const value = event.target.closest('button')?.value;
      if (!value) return;
      resolve(value === 'ok' ? Object.fromEntries(new FormData(dlg.querySelector('#admPromptForm'))) : null);
      dlg.close();
    });
    dlg.addEventListener('cancel', () => resolve(null), { once: true });
  });
  dlg.remove();
  return result;
}

// Read-only "view as customer" snapshot (#100) — what the account sees, for support.
function viewAsHtml(s) {
  const c = s.company || {};
  const members = (s.members || []).map((m) =>
    `<li>${esc(m.full_name || m.email || m.id)}${m.email ? ` · ${esc(m.email)}` : ''} <span class="muted">(${esc(m.role || 'member')})</span></li>`).join('') || '<li class="muted">No members</li>';
  const orders = (s.orders || []).map((o) =>
    `<tr><td>${esc(date(o.created_at))}</td><td>${esc(o.status)}</td><td>${esc(o.tracking_status || '')}</td><td style="text-align:right">${esc(money(o.total, o.currency))}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">No orders</td></tr>';
  const subs = (s.subscriptions || []).map((x) => `${esc(x.tier || 'program')} (${esc(x.status)})`).join(', ') || 'None';
  const credit = s.credit
    ? (s.credit.unlimited ? 'Unlimited NET' : `${esc(money(s.credit.credit_available))} available of ${esc(money(s.credit.credit_limit))}`)
    : '—';
  return `<p class="badge badge-warning">Read-only support view — no changes are made as the customer.</p>
    <h3 style="margin:8px 0 4px">${esc(c.name || 'Company')}</h3>
    <p class="muted" style="margin:0 0 12px">${esc(c.status || '')} · ${esc(c.price_tier || 'retail')} tier · ${(c.net_terms_days || 0)}d NET${c.tax_exempt ? ' · tax-exempt' : ''}</p>
    <p><b>Credit:</b> ${credit} &nbsp; <b>Programs:</b> ${subs} &nbsp; <b>Messages:</b> ${esc(s.message_count || 0)} &nbsp; <b>Addresses:</b> ${(s.addresses || []).length}</p>
    <h4 style="margin:16px 0 4px">Members</h4><ul style="margin:0;padding-left:18px">${members}</ul>
    <h4 style="margin:16px 0 4px">Recent orders</h4>
    <table class="adm" style="width:100%"><thead><tr><th>Date</th><th>Status</th><th>Shipment</th><th>Total</th></tr></thead><tbody>${orders}</tbody></table>`;
}

export function createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager, crm, setTab }) {
  function setupProgress(company) {
    const setup = company.setup;
    if (!setup?.steps?.length) return '<span class="muted">-</span>';
    const open = setup.steps.filter((step) => !step.done);
    const firstOpen = open[0]?.label || 'Complete';
    return `<span data-setup-state="${open.length ? 'open' : 'done'}"><b>${setup.percent || 0}%</b> <small class="muted">${esc(firstOpen)}</small></span>`;
  }

  // Business verification dossier (schema-business-profile.sql) — what staff review to approve.
  function bizDossier(c) {
    const L_ENTITY = { llc: 'LLC', c_corp: 'C-Corporation', s_corp: 'S-Corporation', partnership: 'Partnership', sole_prop: 'Sole proprietor', nonprofit: 'Non-profit', government: 'Government', other: 'Other' };
    const L_IND = { hvac: 'HVAC / mechanical', facilities: 'Facilities', marine: 'Marine', food_bev: 'Food & beverage', manufacturing: 'Manufacturing', municipal: 'Municipal', distributor: 'Distributor', other: 'Other' };
    const L_VOL = { under_10k: 'Under $10k/yr', '10k_50k': '$10k–$50k/yr', '50k_250k': '$50k–$250k/yr', '250k_plus': '$250k+/yr' };
    const rows = [
      ['Legal name', c.legal_name],
      ['DBA', c.dba],
      ['Entity type', L_ENTITY[c.entity_type] || c.entity_type],
      ['Tax ID / EIN', c.tax_id],
      ['Industry', L_IND[c.industry] || c.industry],
      ['Est. annual volume', L_VOL[c.est_annual_volume] || c.est_annual_volume],
      ['Requested terms', c.requested_net_terms != null ? (c.requested_net_terms > 0 ? 'NET-' + c.requested_net_terms : 'Pay as you go') : null],
      ['Business phone', c.business_phone],
      ['Business email', c.business_email],
      ['Contact', [c.contact_name, c.contact_title].filter(Boolean).join(' · ')],
      ['Tax-exempt', c.tax_exempt ? 'Yes' : null],
      ['Submitted', c.submitted_at ? date(c.submitted_at) : null],
    ].filter(([, v]) => v);
    const link = (label, url) => url ? `<div class="dash-row"><span>${esc(label)}</span><a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">View →</a></div>` : '';
    const body = rows.map(([k, v]) => `<div class="dash-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') + link('Website', c.website) + link('Resale certificate', c.resale_cert_url);
    return `<div class="company-dossier"><h3>Business details</h3>${body || '<p class="muted">No verification details submitted yet.</p>'}</div>`;
  }

  function renderCompanyMembers(company, members = []) {
    const rows = members.length ? members.map((member) => `
      <div class="dash-row">
        <span>${esc(member.email || member.full_name || member.id)} <small class="muted">${esc(member.full_name || '')}</small></span>
        <span>
          <select class="adm-select adm-select-sm" data-member-role="${esc(member.id)}" data-company-id="${esc(company.id)}">
            ${memberRoleOptions(member.role)}
          </select>
          <button class="btn btn-ghost btn-sm" type="button" data-member-save="${esc(member.id)}" data-company-id="${esc(company.id)}">Save role</button>
          <button class="btn btn-ghost btn-sm" type="button" data-member-remove="${esc(member.id)}" data-member-email="${esc(member.email || '')}"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </span>
      </div>`).join('') : '<p class="muted">No members yet.</p>';
    return `<div class="company-members"><h3>Members</h3>${rows}
      <div class="company-add-user" style="margin-top:12px">
        <h4 style="margin:0 0 6px">Add a user to this company</h4>
        <div class="adm-inline-actions">
          <input class="adm-input" id="cuEmail" type="email" placeholder="email@company.com" aria-label="New user email">
          <input class="adm-input" id="cuPassword" type="text" placeholder="temp password (min 8)" aria-label="Temporary password">
          <input class="adm-input" id="cuName" type="text" placeholder="Full name (optional)" aria-label="Full name">
          <select class="adm-select adm-select-sm" id="cuRole" aria-label="Role">${memberRoleOptions('buyer')}</select>
          <button class="btn btn-secondary btn-sm" type="button" data-member-add data-company-id="${esc(company.id)}"><i class="ph ph-user-plus" aria-hidden="true"></i> Create user</button>
        </div>
        <p class="muted" style="margin-top:4px;font-size:.82rem">Creates a Supabase login attached to this company. Share the temp password or have them reset it.</p>
      </div></div>`;
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

  const ADDR_TYPES = [['ship', 'Shipping'], ['bill', 'Billing']];
  function addressFormFields(a = {}) {
    return `
      <label>Type <select class="adm-select" name="type">${ADDR_TYPES.map(([v, l]) => `<option value="${v}"${(a.type || 'ship') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="wide">Line 1 <input class="adm-input" name="line1" required value="${esc(a.line1 || '')}"></label>
      <label class="wide">Line 2 <input class="adm-input" name="line2" value="${esc(a.line2 || '')}"></label>
      <label>City <input class="adm-input" name="city" required value="${esc(a.city || '')}"></label>
      <label>State <input class="adm-input" name="state" maxlength="2" required placeholder="TX" value="${esc(a.state || '')}"></label>
      <label>Zip <input class="adm-input" name="zip" required value="${esc(a.zip || '')}"></label>
      <label class="full" style="display:flex;align-items:center;gap:8px;flex-direction:row">
        <input type="checkbox" name="is_default" value="1" style="width:auto"${a.is_default ? ' checked' : ''}> <span>Set as default</span>
      </label>`;
  }

  function renderCompanyAddresses(company, addresses = []) {
    const rows = addresses.length ? addresses.map((a) => `
      <div class="dash-row">
        <span><b>${esc(a.type === 'bill' ? 'Billing' : 'Shipping')}</b> ${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}${a.is_default ? ' <span class="badge badge-warning">default</span>' : ''}</span>
        <span>
          <button class="btn btn-ghost btn-sm" type="button" data-addr-edit="${esc(a.id)}">Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" data-addr-delete="${esc(a.id)}"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </span>
      </div>`).join('') : '<p class="muted">No addresses on file.</p>';
    return `<div class="company-addresses"><h3>Addresses</h3>${rows}
      <div class="adm-inline-actions" style="margin-top:10px">
        <button class="btn btn-secondary btn-sm" type="button" data-addr-add><i class="ph ph-map-pin-plus" aria-hidden="true"></i> Add address</button>
      </div></div>`;
  }

  function renderCompanyPayments(company, methods = []) {
    if (!company.stripe_customer_id) return '<div class="company-payments"><h3>Payment methods</h3><p class="muted">No Stripe customer yet.</p></div>';
    const rows = methods.length ? methods.map((m) => `
      <div class="dash-row">
        <span>${esc(m.brand)} &bull;&bull;&bull;&bull; ${esc(m.last4)} <small class="muted">exp ${esc(m.exp)}</small></span>
        <button class="btn btn-ghost btn-sm" type="button" data-pm-detach="${esc(m.id)}">Detach</button>
      </div>`).join('') : '<p class="muted">No saved cards.</p>';
    return `<div class="company-payments"><h3>Payment methods</h3>${rows}</div>`;
  }

  function renderCompanyOrdersMini(company, orders = []) {
    if (!orders.length) return '<div class="company-orders-mini"><h3>Orders</h3><p class="muted">No orders yet.</p></div>';
    const rows = orders.slice(0, 20).map((o) => `
      <div class="dash-row">
        <span>${esc(String(o.id).slice(0, 8))} &middot; ${esc(date(o.created_at))} &middot; ${esc(money(o.total, o.currency))}</span>
        <span>
          <select class="adm-select adm-select-sm" data-mo-status="${esc(o.id)}">
            ${ORDER_STATUSES.filter((s) => s !== 'refunded' || o.status === 'refunded')
              .map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" type="button" data-mo-save="${esc(o.id)}">Save</button>
          <button class="btn btn-ghost btn-sm" type="button" data-mo-open="${esc(o.id)}">Open in Orders</button>
        </span>
      </div>`).join('');
    return `<div class="company-orders-mini"><h3>Orders</h3>${rows}</div>`;
  }

  function wireCompanyDetailActions(company) {
    const box = $('companyDetail');
    if (!box || !company?.id) return;
    box.querySelectorAll('[data-company-detail-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.companyDetailAction;
        const body = { id: company.id, action };
        if (action === 'reject') {
          body.reason = box.querySelector('#rejectReason')?.value.trim() || '';
          if (!(await confirmDialog('Reject this business? The customer is notified with your reason.', { confirmText: 'Reject', danger: true }))) return;
        }
        if (action === 'suspend' && !(await confirmDialog('Suspend this account? The customer loses ordering access immediately.', { confirmText: 'Suspend', danger: true }))) return;
        button.disabled = true;
        try {
          await api('/api/admin/companies', { method: 'POST', body });
          await refreshCompany(company.id);
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not apply the change. Retry.')}</p>`);
          button.disabled = false;
        }
      });
    });
    const viewAs = box.querySelector('[data-company-view-as]');
    if (viewAs) viewAs.addEventListener('click', async () => {
      viewAs.disabled = true;
      try {
        const snap = await api(`/api/admin/impersonate?company_id=${encodeURIComponent(company.id)}`);
        detailDialog(viewAsHtml(snap));
      } catch (err) {
        box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load the customer view.')}</p>`);
      } finally {
        viewAs.disabled = false;
      }
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
    box.querySelectorAll('[data-member-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        const email = button.dataset.memberEmail || 'this user';
        if (!(await confirmDialog(`Delete ${email}? This permanently removes their login and profile.`, { confirmText: 'Delete', danger: true }))) return;
        button.disabled = true;
        try {
          await api('/api/admin/users', { method: 'POST', body: { action: 'delete_user', user_id: button.dataset.memberRemove } });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.message || err.data?.error || 'Could not delete the user. Retry.')}</p>`);
          button.disabled = false;
        }
      });
    });
    box.querySelectorAll('[data-member-add]').forEach((button) => {
      button.addEventListener('click', async () => {
        const email = box.querySelector('#cuEmail')?.value.trim();
        const password = box.querySelector('#cuPassword')?.value || '';
        const full_name = box.querySelector('#cuName')?.value.trim();
        const role = box.querySelector('#cuRole')?.value || 'buyer';
        if (!email || password.length < 8) {
          box.insertAdjacentHTML('beforeend', '<p class="adm-status" data-state="err">Enter an email and a temp password of at least 8 characters.</p>');
          return;
        }
        button.disabled = true;
        try {
          await api('/api/admin/users', { method: 'POST', body: { action: 'create', email, password, full_name, role, company_id: company.id } });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.message || err.data?.error || 'Could not create the user. Retry.')}</p>`);
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

  function wireCompanyAddressActions(company) {
    const box = $('companyDetail');
    if (!box || !company?.id) return;
    box.querySelectorAll('[data-addr-add]').forEach((button) => {
      button.addEventListener('click', async () => {
        const result = await promptDialog({ title: 'Add address', bodyHtml: addressFormFields(), submitLabel: 'Add address' });
        if (!result) return;
        if (!result.line1 || !result.city || !result.state || !result.zip) {
          box.insertAdjacentHTML('beforeend', '<p class="adm-status" data-state="err">Fill in line 1, city, state and zip.</p>');
          return;
        }
        try {
          await api('/api/admin/users', {
            method: 'POST',
            body: { action: 'add_address', company_id: company.id, address: { type: result.type, line1: result.line1, line2: result.line2, city: result.city, state: result.state, zip: result.zip, is_default: !!result.is_default } },
          });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not add the address. Retry.')}</p>`);
        }
      });
    });
    box.querySelectorAll('[data-addr-edit]').forEach((button) => {
      button.addEventListener('click', async () => {
        const addressId = button.dataset.addrEdit;
        const existing = (company.addresses || []).find((a) => String(a.id) === String(addressId)) || {};
        const result = await promptDialog({ title: 'Edit address', bodyHtml: addressFormFields(existing), submitLabel: 'Save address' });
        if (!result) return;
        if (!result.line1 || !result.city || !result.state || !result.zip) {
          box.insertAdjacentHTML('beforeend', '<p class="adm-status" data-state="err">Fill in line 1, city, state and zip.</p>');
          return;
        }
        try {
          await api('/api/admin/users', {
            method: 'POST',
            body: { action: 'update_address', company_id: company.id, address_id: addressId, address: { type: result.type, line1: result.line1, line2: result.line2, city: result.city, state: result.state, zip: result.zip, is_default: !!result.is_default } },
          });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not save the address. Retry.')}</p>`);
        }
      });
    });
    box.querySelectorAll('[data-addr-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this address?', { confirmText: 'Delete', danger: true }))) return;
        button.disabled = true;
        try {
          await api('/api/admin/users', { method: 'POST', body: { action: 'delete_address', company_id: company.id, address_id: button.dataset.addrDelete } });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not delete the address. Retry.')}</p>`);
          button.disabled = false;
        }
      });
    });
  }

  function wireCompanyPaymentActions(company) {
    const box = $('companyDetail');
    if (!box || !company?.id) return;
    box.querySelectorAll('[data-pm-detach]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!(await confirmDialog('Detach this card from the customer? They will need to re-add it at checkout.', { confirmText: 'Detach', danger: true }))) return;
        button.disabled = true;
        try {
          await api('/api/admin/users', { method: 'POST', body: { action: 'detach_payment', company_id: company.id, payment_method_id: button.dataset.pmDetach } });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not detach the card. Retry.')}</p>`);
          button.disabled = false;
        }
      });
    });
  }

  function wireCompanyOrderActions(company) {
    const box = $('companyDetail');
    if (!box || !company?.id) return;
    box.querySelectorAll('[data-mo-save]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.moSave;
        const status = box.querySelector(`[data-mo-status="${CSS.escape(id)}"]`)?.value;
        button.disabled = true;
        try {
          await api('/api/admin/orders', { method: 'POST', body: { id, status } });
          await openCompanyDetail(company.id);
        } catch (err) {
          box.insertAdjacentHTML('beforeend', `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not save the order status. Retry.')}</p>`);
          button.disabled = false;
        }
      });
    });
    box.querySelectorAll('[data-mo-open]').forEach((button) => {
      button.addEventListener('click', () => {
        if ($('ordSearch')) $('ordSearch').value = button.dataset.moOpen;
        setTab('orders');
      });
    });
  }

  async function openCompanyDetail(id) {
    const box = $('companyDetail');
    if (!box) return;
    box.hidden = false;
    box.textContent = 'Loading company...';
    // Deep links (CRM inbox → Accounts) land mid-list with the detail off-screen:
    // bring it into view and move focus so the open is perceivable.
    box.scrollIntoView({ block: 'start', behavior: 'auto' });
    try {
      const [detail, console_] = await Promise.all([
        api(`/api/admin/company?id=${encodeURIComponent(id)}`),
        // Best-effort: the console call adds addresses/orders/payment_methods on top
        // of the members/invites/dossier the company endpoint already returns.
        api(`/api/admin/users?company=${encodeURIComponent(id)}`).catch(() => ({ addresses: [], orders: [], payment_methods: [] })),
      ]);
      const company = detail.company || {};
      // Stash the console's address list on the company object so the edit handler
      // (which only receives an address id) can look up the current values.
      company.addresses = console_.addresses || [];
      const openSteps = company.setup?.steps?.filter((step) => !step.done) || [];
      box.innerHTML = `
        <div class="adm-panel-header"><h2 tabindex="-1" data-company-detail-title>${esc(company.name || 'Company')}</h2>
          <button class="btn btn-ghost btn-sm" type="button" data-company-detail-close aria-label="Close company detail">Close</button></div>
        <div class="dash-row"><span>Status</span>${statusBadge(company.status)}</div>
        <div class="dash-row"><span>Setup</span>${setupProgress(detail.company)}</div>
        <div class="dash-row"><span>Members</span><b>${(detail.members || []).length}</b></div>
        <div class="dash-row"><span>Orders</span><b>${(detail.orders || []).length}</b></div>
        <div class="dash-row"><span>Messages</span><b>${detail.message_count || 0}</b></div>
        <div class="company-detail-actions" data-company-id="${esc(company.id || id)}">
          <button class="btn btn-primary btn-sm" type="button" data-company-detail-action="approve">Approve</button>
          <button class="btn btn-ghost btn-sm" type="button" data-company-detail-action="reject">Reject</button>
          <button class="btn btn-ghost btn-sm" type="button" data-company-detail-action="suspend">Suspend</button>
          <button class="btn btn-ghost btn-sm" type="button" data-company-detail-tab="messages">Messages</button>
          <button class="btn btn-ghost btn-sm" type="button" data-company-detail-tab="orders">Orders</button>
          <button class="btn btn-ghost btn-sm" type="button" data-company-view-as="${esc(company.id || id)}">View as customer</button>
        </div>
        <input class="adm-input" id="rejectReason" type="text" placeholder="Rejection reason (shown to the customer)" style="width:100%;margin:8px 0 4px">
        ${bizDossier(company)}
        ${renderCompanyMembers(company, detail.members || [])}
        ${renderCompanyInvites(company, detail.invites || [])}
        ${renderCompanyAddresses(company, console_.addresses || [])}
        ${renderCompanyPayments(company, console_.payment_methods || [])}
        ${renderCompanyOrdersMini(company, console_.orders || [])}
        <p class="muted" style="margin-top:12px">${openSteps.length ? `Open: ${openSteps.map((step) => esc(step.label)).join(', ')}` : 'Setup complete.'}</p>`;
      wireCompanyDetailActions(company);
      wireCompanyUserActions(company);
      wireCompanyAddressActions(company);
      wireCompanyPaymentActions(company);
      wireCompanyOrderActions(company);
      box.querySelector('[data-company-detail-close]')?.addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
      box.querySelector('[data-company-detail-title]')?.focus();
      if (crm) crm.mount(box, 'company', company.id || id);
    } catch (err) {
      box.innerHTML = `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load this company. Reload to retry.')}</p>`;
    }
  }

  // Refresh one company in place after a mutation and re-render without a full
  // refetch — a bare renderCompanies() resets the list to page 1 (same pattern
  // as orders.js refreshOrder).
  async function refreshCompany(id) {
    try {
      const detail = await api(`/api/admin/company?id=${encodeURIComponent(id)}`);
      const idx = (state.companies || []).findIndex((c) => String(c.id) === String(id));
      if (idx >= 0 && detail.company) state.companies[idx] = { ...state.companies[idx], ...detail.company };
    } catch { /* render from current state; the next full refetch reconciles */ }
    await renderCompanies({ refetch: false });
  }

  async function renderCompanies({ append = false, refetch = true } = {}) {
    const box = $('admCompanies');
    const snap = captureDirty(box);
    if (refetch) {
      if (!append) { state.companies = []; state.companiesOffset = 0; box.innerHTML = admSkeleton(); }
      try {
        const params = new URLSearchParams({ limit: '100', offset: String(state.companiesOffset || 0) });
        const searchTerm = $('coSearch')?.value.trim();
        if (searchTerm) params.set('search', searchTerm);
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
    const q = $('coSearch').value.trim().toLowerCase();
    const coText = (c) => [c.name, c.status, c.price_tier, c.contact_email, c.contact_name, c.phone, c.industry].filter(Boolean).join(' ').toLowerCase();
    const companies = state.companies.filter((company) => !q || coText(company).includes(q));
    if (!companies.length) {
      box.innerHTML = admEmpty('ph-buildings', q ? 'No matching accounts' : 'No accounts', q ? 'No accounts match your search.' : 'New B2B account signups appear here for approval.') + pager;
      return;
    }
    box.innerHTML = `<div class="adm-tools adm-tools-flush">
      <label class="admin-select-all"><input type="checkbox" id="coAll" aria-label="Select all"> Select all</label>
      <button class="btn btn-ghost btn-sm" id="bulkApprove" type="button">Approve selected</button>
    </div>
    <div class="company-admin-list">${companies.map((company) => {
      const id = esc(company.id);
      const members = (company.profiles || []).map((p) => p.full_name || p.role).join(', ');
      return `<article class="company-admin-card">
        <div class="company-admin-head">
          <label class="company-admin-check"><input type="checkbox" class="co-check" value="${id}"><span>Select</span></label>
          <button class="link-name" data-open-company="${id}" type="button">${esc(company.name)}</button>
          ${statusBadge(company.status)}
        </div>
        <div class="company-admin-fields">
          <div><span>Setup</span>${setupProgress(company)}</div>
          <label><span>NET days</span><input class="adm-input" type="number" min="0" value="${esc(company.net_terms_days || 0)}" data-net="${id}"></label>
          <label><span>Credit</span><input class="adm-input" type="number" min="0" value="${esc(company.credit_limit || 0)}" data-credit="${id}"></label>
          <label><span>Tier</span><select class="adm-select" data-tier="${id}">${['retail', 'hvac', 'wholesale'].map((tier) => `<option value="${tier}"${(company.price_tier || 'retail') === tier ? ' selected' : ''}>${tier}</option>`).join('')}</select></label>
          <div><span>Members</span><b>${esc(members || '-')}</b></div>
        </div>
        <div class="company-admin-actions">
          <button class="btn btn-ghost btn-sm" data-approve="${id}" type="button">Approve</button>
        </div>
      </article>`;
    }).join('')}</div>` + pager;
    restoreDirty(box, snap);
  }

  // List actions delegated once on the stable #admCompanies container (#36).
  function wireCompanies() {
    wireAllUsers();
    const toggle = $('acctToggle');
    if (toggle) delegate(toggle, 'click', '[data-acct-view]', (event, button) => showAcctView(button.dataset.acctView));
    const box = $('admCompanies');
    if (!box) return;
    delegate(box, 'click', '[data-open-company]', (event, button) => openCompanyDetail(button.dataset.openCompany));
    delegate(box, 'click', '[data-load-more-companies]', () => renderCompanies({ append: true }));
    delegate(box, 'click', '[data-approve]', async (event, button) => {
      const id = button.dataset.approve;
      button.disabled = true;
      try {
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
        refreshCompany(id);
      } catch (err) {
        // A silent failure here reads as "approved" — surface it.
        button.disabled = false;
        button.insertAdjacentHTML('afterend', `<p class="adm-status" data-state="err">${(err.data && err.data.error) || 'Could not approve. Retry.'}</p>`);
      }
    });
    delegate(box, 'change', '#coAll', (event, coAll) => box.querySelectorAll('.co-check').forEach((c) => { c.checked = coAll.checked; }));
    delegate(box, 'click', '#bulkApprove', async (event, bulk) => {
      const ids = [...box.querySelectorAll('.co-check:checked')].map((c) => c.value);
      if (!ids.length) return;
      if (!(await confirmDialog(`Approve ${ids.length} account(s)?`, { confirmText: 'Approve' }))) return;
      bulk.disabled = true;
      try {
        // Per-id approve so each row's visible NET days / credit / tier inputs are
        // honored — the bulk endpoint would silently apply server defaults instead.
        const results = await Promise.allSettled(ids.map((id) => api('/api/admin/companies', {
          method: 'POST',
          body: {
            id,
            action: 'approve',
            net_terms_days: Number(box.querySelector(`[data-net="${CSS.escape(id)}"]`)?.value || 0),
            credit_limit: Number(box.querySelector(`[data-credit="${CSS.escape(id)}"]`)?.value || 0),
            price_tier: box.querySelector(`[data-tier="${CSS.escape(id)}"]`)?.value || 'retail',
          },
        })));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed) bulk.insertAdjacentHTML('afterend', `<p class="adm-status" data-state="err">${failed} of ${ids.length} approvals failed. Reload and retry those accounts.</p>`);
        ids.forEach((id, i) => {
          if (results[i].status !== 'fulfilled') return;
          const row = (state.companies || []).find((c) => String(c.id) === String(id));
          if (row) row.status = 'approved';
        });
        await renderCompanies({ refetch: false });
      } catch (err) {
        bulk.insertAdjacentHTML('afterend', `<p class="adm-status" data-state="err">${(err.data && err.data.error) || 'Bulk approve failed. Retry.'}</p>`);
      } finally { bulk.disabled = false; }
    });
  }

  // ---- "All users" section (consolidates the former top-level Users tab into
  // Accounts) — a searchable directory of every Supabase-auth user, company or not.
  function acctUserRow(u) {
    return `<tr data-au-row="${esc(u.id)}">
      <td>${esc(u.email || '—')}</td>
      <td>${esc(u.full_name || '—')}</td>
      <td>
        <select class="adm-select adm-select-sm" data-au-role="${esc(u.id)}">${memberRoleOptions(u.role)}</select>
        ${u.staff_role ? ` <span class="pill">${esc(u.staff_role)}</span>` : ''}
        <button class="btn btn-ghost btn-sm" type="button" data-au-save="${esc(u.id)}">Save role</button>
      </td>
      <td>${u.company_id ? `<button class="link-name" type="button" data-au-open-company="${esc(u.company_id)}">${esc(u.company_name || 'Account')}</button>` : '<span class="muted">—</span>'}</td>
      <td>${u.last_sign_in_at ? esc(date(u.last_sign_in_at)) : 'never'}</td>
      <td class="adm-inline-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-au-manage="${esc(u.id)}">Manage</button>
        <button class="btn btn-ghost btn-sm" type="button" data-au-delete="${esc(u.id)}" data-au-email="${esc(u.email || '')}"><i class="ph ph-trash" aria-hidden="true"></i></button>
      </td>
    </tr>`;
  }

  function paintAcctUsers() {
    const box = $('admAcctUsers');
    const list = box?.querySelector('[data-au-list]');
    if (!list) return;
    const q = (box.querySelector('#auSearch')?.value || '').trim().toLowerCase();
    const users = (state.acctUsers || []).filter((u) => !q
      || [u.email, u.full_name, u.company_name].filter(Boolean).join(' ').toLowerCase().includes(q));
    if (!users.length) {
      list.innerHTML = admEmpty('ph-users', 'No users', q ? 'No users match that search.' : 'Create the first user.');
      return;
    }
    list.innerHTML = `<div class="adm-table-wrap"><table class="adm"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Company</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users.map(acctUserRow).join('')}</tbody></table></div>`;
  }

  async function renderAllUsers({ refetch = true } = {}) {
    const box = $('admAcctUsers');
    if (!box) return;
    if (!box.dataset.mounted) {
      box.innerHTML = `<div class="adm-tools">
        <input id="auSearch" class="adm-search" type="search" placeholder="Search email or name" aria-label="Search users">
        <button class="btn btn-primary btn-sm" type="button" data-au-new><i class="ph ph-user-plus" aria-hidden="true"></i> New user</button>
        <span class="adm-status" id="auStatus" role="status" aria-live="polite"></span>
      </div>
      <div data-au-list>${admSkeleton()}</div>`;
      box.dataset.mounted = '1';
    }
    if (refetch) {
      box.querySelector('[data-au-list]').innerHTML = admSkeleton();
      try {
        state.acctUsers = (await api('/api/admin/users')).users || [];
        state.loaded.add('acctUsers');
      } catch {
        box.querySelector('[data-au-list]').innerHTML = '<p class="adm-status" data-state="err">Could not load users. Reload to retry.</p>';
        return;
      }
    }
    paintAcctUsers();
  }

  function auStatus(text, kind) {
    const el = $('auStatus');
    if (el) { el.textContent = text || ''; el.dataset.state = kind || ''; }
  }

  function userFormFields(u = {}) {
    return `
      <label class="wide">Email <input class="adm-input" name="email" type="email" required value="${esc(u.email || '')}"></label>
      ${u.id ? '' : '<label>Password <input class="adm-input" name="password" type="text" minlength="8" required placeholder="min 8 chars"></label>'}
      <label>Full name <input class="adm-input" name="full_name" type="text" value="${esc(u.full_name || '')}"></label>
      <label>Phone <input class="adm-input" name="phone" type="text" value="${esc(u.phone || '')}"></label>
      <label>Role <select class="adm-select" name="role">${memberRoleOptions(u.role)}</select></label>
      <label>Company ID <input class="adm-input" name="company_id" type="text" value="${esc(u.company_id || '')}" placeholder="optional — paste from Accounts"></label>`;
  }

  // Shared by the "New user" button and the "Manage" action on a companyless row.
  async function openUserDialog(u = {}) {
    const result = await promptDialog({ title: u.id ? 'Edit user' : 'New user', bodyHtml: userFormFields(u), submitLabel: u.id ? 'Save' : 'Create' });
    if (!result) return;
    auStatus(u.id ? 'Saving…' : 'Creating…');
    try {
      if (u.id) await api('/api/admin/users', { method: 'POST', body: { action: 'update_user', user_id: u.id, ...result } });
      else await api('/api/admin/users', { method: 'POST', body: { action: 'create', ...result } });
      auStatus(u.id ? 'User saved.' : 'User created.', 'ok');
      await renderAllUsers({ refetch: true });
    } catch (err) {
      auStatus(err.data?.message || err.data?.error || 'Failed. Retry.', 'err');
    }
  }

  function wireAllUsers() {
    const box = $('admAcctUsers');
    if (!box) return;
    delegate(box, 'input', '#auSearch', () => paintAcctUsers());
    delegate(box, 'click', '[data-au-new]', () => openUserDialog({}));
    delegate(box, 'click', '[data-au-manage]', (event, button) => {
      const u = (state.acctUsers || []).find((x) => String(x.id) === String(button.dataset.auManage));
      if (!u) return;
      if (u.company_id) { showAcctView('companies'); openCompanyDetail(u.company_id); }
      else openUserDialog(u);
    });
    delegate(box, 'click', '[data-au-open-company]', (event, button) => {
      showAcctView('companies');
      openCompanyDetail(button.dataset.auOpenCompany);
    });
    delegate(box, 'click', '[data-au-save]', async (event, button) => {
      const id = button.dataset.auSave;
      const role = box.querySelector(`[data-au-role="${CSS.escape(id)}"]`)?.value;
      const u = (state.acctUsers || []).find((x) => String(x.id) === String(id));
      button.disabled = true;
      try {
        if (u?.company_id) await api('/api/admin/users', { method: 'POST', body: { action: 'set_role', company_id: u.company_id, profile_id: id, role } });
        else await api('/api/admin/users', { method: 'POST', body: { action: 'update_user', user_id: id, role } });
        if (u) u.role = role;
        auStatus('Role saved.', 'ok');
      } catch (err) {
        auStatus(err.data?.message || err.data?.error || 'Could not save the role. Retry.', 'err');
      } finally {
        button.disabled = false;
      }
    });
    delegate(box, 'click', '[data-au-delete]', async (event, button) => {
      const email = button.dataset.auEmail || 'this user';
      if (!(await confirmDialog(`Delete ${email}? This removes their login and profile permanently.`, { confirmText: 'Delete', danger: true }))) return;
      button.disabled = true;
      try {
        await api('/api/admin/users', { method: 'POST', body: { action: 'delete_user', user_id: button.dataset.auDelete } });
        await renderAllUsers({ refetch: true });
      } catch (err) {
        button.disabled = false;
        auStatus(err.data?.message || err.data?.error || 'Delete failed.', 'err');
      }
    });
  }

  // Companies / All users sub-view toggle within the Accounts panel.
  function showAcctView(view) {
    state.acctView = view;
    $('acctToggle')?.querySelectorAll('[data-acct-view]').forEach((b) => {
      const on = b.dataset.acctView === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-acct-panel]').forEach((panel) => { panel.hidden = panel.dataset.acctPanel !== view; });
    if (view === 'users') renderAllUsers({ refetch: !state.loaded.has('acctUsers') });
  }

  return { renderCompanies, wireCompanies, openCompanyDetail };
}
