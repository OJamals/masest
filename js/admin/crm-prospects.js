// Pre-account Prospect surface for the integrated CRM workspace. Prospect
// Organizations stay separate from customer Companies until explicitly linked.
import { esc, delegate } from '../util.js?v=20260903a';
import { createCrmProspectAccount, renderProspectChannels } from './crm-prospect-account.js?v=20260903a';

const STATUSES = [
  ['', 'All stages'], ['new', 'New'], ['researching', 'Researching'],
  ['qualified', 'Qualified'], ['converted', 'Converted'], ['archived', 'Archived'],
];
const PRIORITIES = [
  ['', 'All priorities'], ['unassigned', 'Unassigned'], ['low', 'Low'],
  ['normal', 'Normal'], ['high', 'High'],
];

export function createCrmProspects({
  api,
  state,
  admSkeleton,
  admEmpty,
  admListPager,
  openSubject,
  syncWorkspaceUrl,
}) {
  let loadId = 0;
  const prospectAccount = createCrmProspectAccount({ api, state, renderDetail });

  const options = (values, current) => values.map(([value, label]) => (
    `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`
  )).join('');

  function organizationRow(prospect) {
    const location = [prospect.city, prospect.state].filter(Boolean).join(', ');
    const meta = [prospect.segment, location, `${prospect.contact_count || 0} contact${prospect.contact_count === 1 ? '' : 's'}`]
      .filter(Boolean).map(esc).join(' · ');
    return `<li class="crm-contact crm-prospect-card">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${esc(prospect.name)}
          <span class="badge" data-s="${esc(prospect.status)}">${esc(String(prospect.status || 'new').replaceAll('_', ' '))}</span>
          ${prospect.priority === 'high' ? '<span class="badge badge-warning">High priority</span>' : ''}
        </div>
        <div class="crm-feed-detail muted">${meta || 'No location or segment recorded'}</div>
        <div class="crm-prospect-consent"><i class="ph ph-shield-warning" aria-hidden="true"></i> No bulk marketing · outreach ${esc(prospect.outreach_status || 'unreviewed')}</div>
      </div>
      <span class="crm-contact-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-prospect-open="${esc(prospect.id)}">Details</button>
      </span>
    </li>`;
  }

  function listShell() {
    return `<div class="crm-section-head">
        <div>
          <h3>Pre-account prospects</h3>
          <p class="muted">Prospect organizations are not customer accounts. Conversion creates an explicit account link; import never subscribes anyone.</p>
        </div>
      </div>
      <form class="adm-tools crm-prospect-tools" data-prospect-form>
        <input class="adm-search" name="prospect_search" type="search" autocomplete="off" minlength="2" data-prospect-q placeholder="Search organization, segment, or location…" aria-label="Search prospects" value="${esc(state.crmProspectQ || '')}">
        <select class="adm-select" name="prospect_status" data-prospect-status aria-label="Filter prospects by stage">${options(STATUSES, state.crmProspectStatus || '')}</select>
        <select class="adm-select" name="prospect_priority" data-prospect-priority aria-label="Filter prospects by priority">${options(PRIORITIES, state.crmProspectPriority || '')}</select>
        <button class="btn btn-primary btn-sm" type="submit">Filter</button>
      </form>
      <p class="adm-status crm-prospect-policy" data-state="warn"><b>Consent boundary:</b> all imported records start unreviewed with unknown marketing consent. No bulk marketing is authorized.</p>
      <div data-prospect-results></div>`;
  }

  async function render(body, { append = false } = {}) {
    if (!append) body.innerHTML = listShell();
    const results = body.querySelector('[data-prospect-results]');
    if (!results) return;
    const previous = append ? (results._prospects || []) : [];
    if (!append) results.innerHTML = admSkeleton(4);
    const q = state.crmProspectQ || '';
    const status = state.crmProspectStatus || '';
    const priority = state.crmProspectPriority || '';
    const requestId = ++loadId;
    const params = new URLSearchParams({ limit: '25', offset: String(previous.length) });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    try {
      const response = await api(`/api/admin/crm/prospects?${params}`);
      if (!results.isConnected || requestId !== loadId || state.crmView !== 'prospects'
        || state.crmProspectQ !== q || state.crmProspectStatus !== status || state.crmProspectPriority !== priority) return;
      if (response.needs_migration) {
        results.innerHTML = admEmpty('ph-database', 'Prospect database not ready', 'Apply supabase/schema-crm-prospects.sql before importing the roster.');
        return;
      }
      const next = append ? [...previous, ...(response.prospects || [])] : (response.prospects || []);
      results._prospects = next;
      const count = response.total == null ? next.length : response.total;
      results.innerHTML = `<h4 class="crm-dir-heading">Organizations <span class="muted">(${next.length} of ${count})</span></h4>`
        + (next.length
          ? `<ul class="crm-prospect-grid">${next.map(organizationRow).join('')}</ul>${admListPager('data-prospect-more', next.length, response.total, response.has_more)}`
          : admEmpty('ph-buildings', 'No prospects found', 'Adjust the search or filters.'));
    } catch (err) {
      if (!results.isConnected || requestId !== loadId || state.crmView !== 'prospects') return;
      results.innerHTML = `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load prospects. Retry.')}</p>`;
    }
  }

  function contactRow(contact) {
    const details = [contact.title, contact.email, contact.phone].filter(Boolean).map(esc).join(' · ') || 'No direct channel';
    return `<li class="crm-contact">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${esc(contact.name)}${contact.needs_verification ? '<span class="badge badge-warning">Verify</span>' : ''}</div>
        <div class="crm-feed-detail muted">${details}</div>
        <div class="crm-prospect-consent"><i class="ph ph-shield-warning" aria-hidden="true"></i> Marketing ${esc(contact.marketing_consent || 'unknown')} · outreach ${esc(contact.outreach_status || 'unreviewed')}</div>
      </div>
    </li>`;
  }

  async function renderDetail(body, id, { notice = '' } = {}) {
    const requestId = ++loadId;
    body.innerHTML = admSkeleton(4);
    try {
      const { prospect, needs_migration } = await api(`/api/admin/crm/prospects?id=${encodeURIComponent(id)}`);
      if (!body.isConnected || requestId !== loadId || state.crmView !== 'prospects') return;
      if (needs_migration || !prospect) {
        body.innerHTML = admEmpty('ph-database', 'Prospect unavailable', 'Apply the Prospect migration, then retry.');
        return;
      }
      const location = [prospect.address, prospect.city, prospect.state, prospect.postal_code].filter(Boolean).map(esc).join(' · ');
      const channels = renderProspectChannels(prospect);
      const linked = prospectAccount.header(prospect);
      const editStatuses = STATUSES.slice(1).map(([value, label]) => {
        const disabled = value === 'converted' && !prospect.linked_company_id;
        return `<option value="${esc(value)}"${value === prospect.status ? ' selected' : ''}${disabled ? ' disabled' : ''}>${esc(label)}</option>`;
      }).join('');
      const canWrite = state.staff?.capabilities?.includes('prospect.write');
      body.innerHTML = `<section class="crm-prospect-detail" aria-labelledby="prospectDetailTitle">
        <div class="crm-section-head">
          <div>
            <button class="btn btn-ghost btn-sm" type="button" data-prospect-back><i class="ph ph-arrow-left" aria-hidden="true"></i> Prospects</button>
            <h3 id="prospectDetailTitle">${esc(prospect.name)}</h3>
            <p class="muted">${esc(prospect.segment || 'Unsegmented')} · ${prospect.source_record_count || 0} source record${prospect.source_record_count === 1 ? '' : 's'}</p>
          </div>
          ${linked}
        </div>
        <div class="crm-prospect-detail-grid">
          <div><span class="muted">Location</span><b>${location || 'Not recorded'}</b></div>
          <div><span class="muted">Channels</span>${channels}</div>
          <div><span class="muted">Retention review</span><b>${esc(prospect.retention_review_at || 'Not set')}</b></div>
          <div><span class="muted">Consent</span><b>Marketing ${esc(prospect.marketing_consent || 'unknown')} · outreach ${esc(prospect.outreach_status || 'unreviewed')}</b></div>
        </div>
        ${prospectAccount.panel(prospect)}
        <p class="adm-status" data-state="warn"><b>No bulk marketing.</b> Approve outreach only through a future evidence-backed consent workflow.</p>
        <form class="crm-prospect-update" data-prospect-update data-prospect-id="${esc(prospect.id)}">
          <label class="crm-field">Stage<select class="adm-select" name="status">${editStatuses}</select></label>
          <label class="crm-field">Priority<select class="adm-select" name="priority">${options(PRIORITIES.slice(1), prospect.priority)}</select></label>
          <button class="btn btn-primary btn-sm" type="submit" data-capability="prospect.write"${canWrite ? '' : ' disabled aria-disabled="true" title="Your staff role cannot change prospects."'}>Save workflow</button>
          <span class="adm-status" data-state="${notice ? 'ok' : ''}" data-prospect-update-status aria-live="polite">${esc(notice)}</span>
        </form>
        <div>
          <h4 class="crm-dir-heading">Prospect contacts <span class="muted">(${(prospect.contacts || []).length})</span></h4>
          ${(prospect.contacts || []).length
            ? `<ul class="crm-prospect-grid">${prospect.contacts.map(contactRow).join('')}</ul>`
            : admEmpty('ph-user-minus', 'No named contacts', 'This organization record has no named contact yet.')}
        </div>
      </section>`;
    } catch (err) {
      if (!body.isConnected || requestId !== loadId || state.crmView !== 'prospects') return;
      body.innerHTML = `<button class="btn btn-ghost btn-sm" type="button" data-prospect-back>Back</button><p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load prospect. Retry.')}</p>`;
    }
  }

  function wire(box) {
    prospectAccount.wire(box);
    delegate(box, 'submit', '[data-prospect-form]', (event, form) => {
      event.preventDefault();
      state.crmProspectQ = form.querySelector('[data-prospect-q]').value.trim();
      state.crmProspectStatus = form.querySelector('[data-prospect-status]').value;
      state.crmProspectPriority = form.querySelector('[data-prospect-priority]').value;
      syncWorkspaceUrl();
      render(box.querySelector('[data-crm-ws-body]'));
    });
    delegate(box, 'click', '[data-prospect-more]', (event, button) => {
      button.disabled = true;
      render(box.querySelector('[data-crm-ws-body]'), { append: true });
    });
    delegate(box, 'click', '[data-prospect-open]', (event, button) => {
      renderDetail(box.querySelector('[data-crm-ws-body]'), button.dataset.prospectOpen);
    });
    delegate(box, 'click', '[data-prospect-back]', () => render(box.querySelector('[data-crm-ws-body]')));
    delegate(box, 'click', '[data-prospect-open-company]', (event, button) => {
      openSubject?.('company', button.dataset.prospectOpenCompany, button.dataset.companyLabel);
    });
    delegate(box, 'submit', '[data-prospect-update]', async (event, form) => {
      event.preventDefault();
      if (!state.staff?.capabilities?.includes('prospect.write')) return;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-prospect-update-status]');
      button.disabled = true;
      status.dataset.state = '';
      status.textContent = 'Saving…';
      try {
        await api('/api/admin/crm/prospects', {
          method: 'PATCH',
          body: {
            id: form.dataset.prospectId,
            status: form.elements.status.value,
            priority: form.elements.priority.value,
          },
        });
        await renderDetail(box.querySelector('[data-crm-ws-body]'), form.dataset.prospectId, { notice: 'Workflow saved.' });
      } catch (err) {
        button.disabled = false;
        status.dataset.state = 'err';
        status.textContent = err.data?.error || 'Could not save. Retry.';
      }
    });
  }

  return { render, wire };
}
