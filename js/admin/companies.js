// Admin companies/accounts tab (#36 per-tab split). B2B account approval list plus
// the company-detail drawer (members, invites, setup progress, role + invite
// actions). Shared primitives ($, api, state, admSkeleton, admEmpty) and the
// admin-local statusBadge / admListPager helpers are injected; esc + confirmDialog
// come from util.js and the dirty-edit helpers from edits.js.
import { esc, confirmDialog, delegate, detailDialog, money, dateTime as date } from '../util.js';
import { captureDirty, restoreDirty } from './edits.js';

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

export function createCompaniesTab({ $, api, state, admSkeleton, admEmpty, statusBadge, admListPager }) {
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
          <button class="btn btn-ghost btn-sm" type="button" data-company-view-as="${esc(company.id || id)}">View as customer</button>
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
    const q = $('coSearch').value.trim().toLowerCase();
    const companies = state.companies.filter((company) => JSON.stringify(company).toLowerCase().includes(q));
    if (!companies.length) {
      box.innerHTML = admEmpty('ph-buildings', q ? 'No matching accounts' : 'No accounts', q ? 'No accounts match your search.' : 'New B2B account signups appear here for approval.') + pager;
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
  }

  // List actions delegated once on the stable #admCompanies container (#36).
  function wireCompanies() {
    const box = $('admCompanies');
    if (!box) return;
    delegate(box, 'click', '[data-open-company]', (event, button) => openCompanyDetail(button.dataset.openCompany));
    delegate(box, 'click', '[data-load-more-companies]', () => renderCompanies({ append: true }));
    delegate(box, 'click', '[data-approve]', async (event, button) => {
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
    delegate(box, 'change', '#coAll', (event, coAll) => box.querySelectorAll('.co-check').forEach((c) => { c.checked = coAll.checked; }));
    delegate(box, 'click', '#bulkApprove', async (event, bulk) => {
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

  return { renderCompanies, wireCompanies };
}
