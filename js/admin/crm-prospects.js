// Pre-account Prospect surface for the integrated CRM workspace. Prospect
// Organizations stay separate from customer Companies until explicitly linked.
import { esc, delegate, confirmDialog } from '../util.js?v=20260913c';
import { createCrmProspectAccount, renderProspectChannels } from './crm-prospect-account.js?v=20260913c';

const STATUSES = [
  ['', 'All stages'], ['new', 'New'], ['researching', 'Researching'],
  ['qualified', 'Qualified'], ['converted', 'Converted'], ['archived', 'Archived'],
];
const PRIORITIES = [
  ['', 'All priorities'], ['unassigned', 'Unassigned'], ['low', 'Low'],
  ['normal', 'Normal'], ['high', 'High'],
];
const OUTREACH_ACTION_LABELS = {
  approve: 'Approve', sent: 'Mark sent', replied: 'Mark replied',
  opted_out: 'Mark opted out', archive: 'Archive',
};
const OUTREACH_NOTICES = {
  approve: 'Approved.', sent: 'Marked sent.', replied: 'Marked replied.',
  opted_out: 'Opt-out saved. Future outreach blocked.', archive: 'Archived.',
};

function outreachMailto(draft) {
  const email = String(draft?.recipient_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(draft.subject || '')}&body=${encodeURIComponent(draft.body_text || '')}`;
}

function starterMessage(prospect, contact) {
  const greeting = String(contact?.name || '').trim().split(/\s+/)[0] || 'team';
  return `Hi ${greeting},

I’m reaching out after reviewing ${prospect.name} because your work appears relevant to safer, lower-downtime industrial cleaning. MASEST supplies the VertKleen line for demanding facility and equipment cleaning applications.

Would a short product-fit conversation or sample evaluation be useful?

Best,
Omar Aljamal
MASEST
1361 Grand Cayman Dr
Merritt Island, FL 32952
https://masest.co

If you'd rather not hear from me, reply “no thanks” and I won’t follow up.`;
}

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

  function outreachActions(draft, prospectId, canWrite) {
    const actions = [];
    const button = (action, tone = 'ghost') => `<button class="btn btn-${tone} btn-sm" type="button" data-outreach-action="${action}" data-outreach-id="${esc(draft.id)}" data-prospect-id="${esc(prospectId)}" data-capability="prospect.write"${canWrite ? '' : ' disabled aria-disabled="true"'}>${OUTREACH_ACTION_LABELS[action]}</button>`;
    if (draft.status === 'draft') actions.push(button('approve', 'primary'));
    if (draft.status === 'approved') {
      const href = outreachMailto(draft);
      if (href) actions.push(`<a class="btn btn-primary btn-sm" href="${esc(href)}" data-outreach-open>Open in email</a>`);
      actions.push(button('sent'));
    }
    if (draft.status === 'sent') actions.push(button('replied', 'primary'));
    if (['draft', 'approved', 'sent', 'replied'].includes(draft.status)) actions.push(button('opted_out'));
    if (draft.status !== 'archived') actions.push(button('archive'));
    return actions.join('');
  }

  function outreachRow(draft, prospectId, canWrite) {
    const source = String(draft.source_url || '');
    const sourceLink = /^https:\/\//i.test(source)
      ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Research source</a>`
      : '<span class="muted">No source saved</span>';
    return `<li class="crm-outreach-card">
      <div class="crm-outreach-card-head">
        <span><b>${esc(draft.subject)}</b><span class="muted">${esc(draft.recipient_email)}</span></span>
        <span class="badge" data-s="${esc(draft.status)}">${esc(String(draft.status).replaceAll('_', ' '))}</span>
      </div>
      <div class="crm-feed-detail">${esc(draft.compliance_basis || 'Approval evidence not yet recorded')} · ${sourceLink}</div>
      <details><summary>Review message</summary><pre>${esc(draft.body_text)}</pre></details>
      <div class="crm-outreach-actions">${outreachActions(draft, prospectId, canWrite)}</div>
    </li>`;
  }

  function outreachPanel(prospect, canWrite, notice = '') {
    const recipients = [];
    for (const contact of prospect.contacts || []) {
      if (contact.email && !contact.needs_verification) recipients.push({ id: contact.id, name: `${contact.name}${contact.title ? ` — ${contact.title}` : ''}`, email: contact.email, contact });
    }
    if (prospect.general_email) recipients.push({ id: 'organization', name: `${prospect.name} — general`, email: prospect.general_email });
    const selected = recipients[0];
    const sourceUrl = /^https:\/\//i.test(String(prospect.website || '')) ? prospect.website : '';
    const composer = selected
      ? `<form class="crm-outreach-form" data-prospect-outreach-form data-prospect-id="${esc(prospect.id)}">
          <label class="crm-field">Recipient<select class="adm-select" name="contact_id" required>${recipients.map((recipient) => `<option value="${esc(recipient.id)}" data-email="${esc(recipient.email)}">${esc(recipient.name)} · ${esc(recipient.email)}</option>`).join('')}</select></label>
          <label class="crm-field">Research source<input class="adm-search" name="source_url" type="url" inputmode="url" required maxlength="1000" pattern="https://.*" placeholder="https://provider-site.example/about" value="${esc(sourceUrl)}"></label>
          <label class="crm-field crm-outreach-wide">Why this contact is relevant<textarea name="compliance_basis" required minlength="12" maxlength="1000" rows="2" placeholder="Public business contact; role and facility need relevant to VertKleen."></textarea></label>
          <label class="crm-field crm-outreach-wide">Subject<input class="adm-search" name="subject" required maxlength="180" value="${esc(`${prospect.name}: a facility cleaning question`)}"></label>
          <label class="crm-field crm-outreach-wide">Personalized message<textarea name="body_text" required maxlength="8000" rows="12">${esc(starterMessage(prospect, selected.contact))}</textarea></label>
          <div class="crm-outreach-submit"><button class="btn btn-primary btn-sm" type="submit" data-capability="prospect.write"${canWrite ? '' : ' disabled aria-disabled="true"'}>Save draft</button><span class="adm-status" data-prospect-outreach-status aria-live="polite"></span></div>
        </form>`
      : admEmpty('ph-envelope-simple', 'No verified email channel', 'Add a business email to the organization or a named contact before drafting outreach.');
    const drafts = prospect.outreach_drafts || [];
    return `<section class="crm-outreach" aria-labelledby="prospectOutreachTitle">
      <div class="crm-section-head"><div><h4 id="prospectOutreachTitle">Personalized outreach</h4><p class="muted">Manual one-to-one outreach. Save research evidence, approve, then open in your email client. Cloudflare does not send this message.</p></div></div>
      ${notice ? `<p class="adm-status" data-state="ok">${esc(notice)}</p>` : ''}
      ${composer}
      <h5 class="crm-dir-heading">Draft history <span class="muted">(${drafts.length})</span></h5>
      ${drafts.length ? `<ul class="crm-outreach-list">${drafts.map((draft) => outreachRow(draft, prospect.id, canWrite)).join('')}</ul>` : '<p class="muted">No outreach drafted yet.</p>'}
      ${(prospect.contacts || []).some((contact) => contact.email && contact.needs_verification) ? '<p class="muted">Contacts marked Verify stay unavailable until their address is confirmed.</p>' : ''}
    </section>`;
  }

  async function renderDetail(body, id, { notice = '', outreachNotice = '' } = {}) {
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
        <p class="adm-status" data-state="warn"><b>No bulk marketing.</b> Each message requires saved research evidence and manual approval.</p>
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
        ${outreachPanel(prospect, canWrite, outreachNotice)}
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
    delegate(box, 'submit', '[data-prospect-outreach-form]', async (event, form) => {
      event.preventDefault();
      if (!state.staff?.capabilities?.includes('prospect.write')) return;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-prospect-outreach-status]');
      const recipient = form.elements.contact_id.selectedOptions[0];
      button.disabled = true;
      status.dataset.state = '';
      status.textContent = 'Saving…';
      try {
        await api('/api/admin/crm/outreach-drafts', {
          method: 'POST',
          body: {
            organization_id: form.dataset.prospectId,
            contact_id: form.elements.contact_id.value === 'organization' ? null : form.elements.contact_id.value,
            recipient_email: recipient?.dataset.email || '',
            source_url: form.elements.source_url.value.trim(),
            compliance_basis: form.elements.compliance_basis.value.trim(),
            subject: form.elements.subject.value.trim(),
            body_text: form.elements.body_text.value.trim(),
          },
        });
        await renderDetail(box.querySelector('[data-crm-ws-body]'), form.dataset.prospectId, { outreachNotice: 'Outreach draft saved.' });
      } catch (err) {
        button.disabled = false;
        status.dataset.state = 'err';
        status.textContent = err.data?.error || 'Could not save draft. Retry.';
      }
    });
    delegate(box, 'click', '[data-outreach-action]', async (event, button) => {
      if (!state.staff?.capabilities?.includes('prospect.write') || button.disabled) return;
      const action = button.dataset.outreachAction;
      if (action === 'opted_out' && !(await confirmDialog(
        'Mark this recipient opted out and block future outreach?',
        { confirmText: 'Mark opted out', danger: true },
      ))) return;
      button.disabled = true;
      try {
        await api('/api/admin/crm/outreach-drafts', {
          method: 'PATCH',
          body: { id: button.dataset.outreachId, action },
        });
        await renderDetail(box.querySelector('[data-crm-ws-body]'), button.dataset.prospectId, { outreachNotice: OUTREACH_NOTICES[action] || 'Outreach updated.' });
      } catch (err) {
        button.disabled = false;
        const status = button.closest('.crm-outreach')?.querySelector('[data-prospect-outreach-status]');
        if (status) {
          status.dataset.state = 'err';
          status.textContent = err.data?.error || 'Could not update outreach. Retry.';
        }
      }
    });
  }

  return { render, wire };
}
