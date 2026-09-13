import { esc, delegate } from '../util.js?v=20260913a';

const clean = (value) => String(value || '').trim();

export function prospectEmailHref(value) {
  const email = clean(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return `mailto:${encodeURIComponent(email)}`;
}

export function prospectPhoneHref(value) {
  const phone = clean(value);
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  const normalized = phone.startsWith('+')
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits.length === 11 && digits.startsWith('1')
        ? `+${digits}`
        : digits;
  return `tel:${normalized}`;
}

export function prospectWebsiteHref(value) {
  const website = clean(value);
  if (!website) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(website) ? website : `https://${website}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function channelItem(type, label, value, href, { external = false } = {}) {
  if (!value) return '';
  const destination = href
    ? `<a href="${esc(href)}" data-prospect-channel="${type}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(value)}</a>`
    : `<span>${esc(value)}</span>`;
  return `<li><span class="muted">${label}</span>${destination}</li>`;
}

export function renderProspectChannels(prospect = {}) {
  const email = clean(prospect.general_email);
  const phone = clean(prospect.phone);
  const website = clean(prospect.website);
  const items = [
    channelItem('email', 'Email', email, prospectEmailHref(email)),
    channelItem('phone', 'Phone', phone, prospectPhoneHref(phone)),
    channelItem('website', 'Website', website, prospectWebsiteHref(website), { external: true }),
  ].filter(Boolean);
  return items.length
    ? `<ul class="crm-prospect-channels">${items.join('')}</ul>`
    : '<span class="muted">No direct channel</span>';
}

export function createCrmProspectAccount({ api, state, renderDetail }) {
  const can = (capability) => state.staff?.capabilities?.includes(capability);

  function header(prospect) {
    if (prospect.linked_company) {
      return `<button class="btn btn-ghost btn-sm" type="button" data-prospect-open-company="${esc(prospect.linked_company.id)}" data-company-label="${esc(prospect.linked_company.name)}">Open customer account</button>`;
    }
    const canLink = can('prospect.write');
    return `<div class="crm-prospect-account-actions">
      <span class="muted">Not linked to a customer account</span>
      <button class="btn btn-ghost btn-sm" type="button" data-prospect-link-toggle aria-controls="prospectAccountLink" aria-expanded="false"${canLink ? '' : ' disabled aria-disabled="true" title="Your staff role cannot link prospects."'}>Link customer account</button>
    </div>`;
  }

  function panel(prospect) {
    if (prospect.linked_company) return '';
    const canLink = can('prospect.write');
    const canCreate = canLink && can('company.credit');
    const disabled = canLink ? '' : ' disabled aria-disabled="true"';
    const create = canCreate
      ? `<form class="crm-prospect-company-create" data-prospect-company-create data-prospect-id="${esc(prospect.id)}">
          <label class="crm-field">New account name<input class="adm-search" name="name" required maxlength="160" autocomplete="organization" value="${esc(prospect.name)}"></label>
          <button class="btn btn-primary btn-sm" type="submit">Create pending account</button>
          <span class="adm-status" data-prospect-company-create-status aria-live="polite"></span>
        </form>`
      : '<p class="muted">Owner or finance access is required to create a customer account.</p>';
    return `<section class="crm-prospect-link-panel" id="prospectAccountLink" data-prospect-link-panel hidden aria-labelledby="prospectAccountLinkTitle">
      <div>
        <h4 id="prospectAccountLinkTitle">Link customer account</h4>
        <p class="muted">Search first to avoid duplicates. Linking preserves Prospect history. No user is invited and no email is sent.</p>
      </div>
      <form class="crm-prospect-link-search" data-prospect-company-search data-prospect-id="${esc(prospect.id)}">
        <label class="crm-field">Find existing account<input class="adm-search" name="query" type="search" required minlength="2" maxlength="160" autocomplete="off" value="${esc(prospect.name)}"></label>
        <button class="btn btn-ghost btn-sm" type="submit"${disabled}>Search accounts</button>
      </form>
      <div class="crm-prospect-company-results" data-prospect-company-results aria-live="polite">
        <p class="muted">Search by company name, then choose the matching account.</p>
      </div>
      ${create}
    </section>`;
  }

  function companyRow(company, prospectId) {
    return `<li>
      <span><b>${esc(company.name)}</b><span class="muted">${esc(String(company.status || 'pending').replaceAll('_', ' '))}</span></span>
      <button class="btn btn-ghost btn-sm" type="button" data-prospect-link-company data-prospect-id="${esc(prospectId)}" data-company-id="${esc(company.id)}" data-company-label="${esc(company.name)}">Link</button>
    </li>`;
  }

  async function linkAccount(body, prospectId, companyId, notice) {
    await api('/api/admin/crm/prospects', {
      method: 'PATCH',
      body: { id: prospectId, linked_company_id: companyId },
    });
    const currentId = body?.querySelector('[data-prospect-update]')?.dataset.prospectId;
    if (!body?.isConnected || state.crmView !== 'prospects' || currentId !== prospectId) return;
    await renderDetail(body, prospectId, { notice });
  }

  function wire(box) {
    delegate(box, 'click', '[data-prospect-link-toggle]', (event, button) => {
      const panelBox = box.querySelector('[data-prospect-link-panel]');
      if (!panelBox || button.disabled) return;
      panelBox.hidden = !panelBox.hidden;
      button.setAttribute('aria-expanded', String(!panelBox.hidden));
      if (!panelBox.hidden) panelBox.querySelector('input[name="query"]')?.focus();
    });

    delegate(box, 'submit', '[data-prospect-company-search]', async (event, form) => {
      event.preventDefault();
      if (!can('prospect.write')) return;
      const button = form.querySelector('button[type="submit"]');
      const results = box.querySelector('[data-prospect-company-results]');
      const query = clean(form.elements.query.value);
      if (!results || query.length < 2) return;
      button.disabled = true;
      results.innerHTML = '<p class="muted">Searching accounts…</p>';
      try {
        const params = new URLSearchParams({ search: query, limit: '20', offset: '0' });
        const response = await api(`/api/admin/companies?${params}`);
        const companies = response.companies || [];
        results.innerHTML = companies.length
          ? `<ul class="crm-prospect-company-list">${companies.map((company) => companyRow(company, form.dataset.prospectId)).join('')}</ul>`
          : '<p class="muted">No matching customer accounts. Confirm the name, then create a pending account below.</p>';
      } catch {
        results.innerHTML = '<p class="adm-status" data-state="err">Could not search accounts. Retry.</p>';
      } finally {
        button.disabled = false;
      }
    });

    delegate(box, 'click', '[data-prospect-link-company]', async (event, button) => {
      if (!can('prospect.write')) return;
      const body = box.querySelector('[data-crm-ws-body]');
      const results = box.querySelector('[data-prospect-company-results]');
      button.disabled = true;
      if (results) results.innerHTML = '<p class="muted">Linking customer account…</p>';
      try {
        await linkAccount(body, button.dataset.prospectId, button.dataset.companyId, 'Customer account linked.');
      } catch {
        button.disabled = false;
        if (results) results.innerHTML = '<p class="adm-status" data-state="err">Could not link account. Search again to retry.</p>';
      }
    });

    delegate(box, 'submit', '[data-prospect-company-create]', async (event, form) => {
      event.preventDefault();
      if (!can('company.credit') || !can('prospect.write')) return;
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-prospect-company-create-status]');
      const body = box.querySelector('[data-crm-ws-body]');
      const name = clean(form.elements.name.value);
      let created = null;
      button.disabled = true;
      status.dataset.state = '';
      status.textContent = 'Creating pending account…';
      try {
        const response = await api('/api/admin/companies', {
          method: 'POST',
          body: { action: 'create_company', name, status: 'pending' },
        });
        created = response.company;
        if (!created?.id) throw new Error('company_create_failed');
        status.textContent = 'Linking customer account…';
        await linkAccount(body, form.dataset.prospectId, created.id, 'Pending customer account created and linked.');
      } catch {
        if (!created?.id) button.disabled = false;
        else button.textContent = 'Account created';
        status.dataset.state = 'err';
        status.textContent = created?.id
          ? `Account created, but linking failed. Search for ${created.name || name} and retry.`
          : 'Could not create account. Retry.';
      }
    });
  }

  return { header, panel, wire };
}
