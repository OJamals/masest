import { esc, detailDialog } from '../util.js?v=20260929e';

const SECTIONS = [['contacts', 'Contacts'], ['evidence', 'Source evidence'], ['assertions', 'Assertions']];
const text = (value) => esc(value == null || value === '' ? 'Not recorded' : value);
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const field = (label, value) => `<div><dt>${esc(label)}</dt><dd>${text(value)}</dd></div>`;

function sourceLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">View source (${esc(url.hostname)})</a>`;
    }
  } catch { /* Missing or unsafe URL has no actionable link. */ }
  return '<span class="muted">No usable source URL</span>';
}

function provenance(row) {
  return `<dl class="crm-review-fields">${field('Source', row.source)}${field('Source record', row.source_record_id)}
    ${field('Retrieved', date(row.retrieved_at))}${field('Permitted use', row.permitted_use)}
    ${field('Evidence expires', date(row.effective_expires_at))}</dl>${sourceLink(row.source_url)}`;
}

function record(row, section) {
  let content;
  if (section === 'contacts') {
    content = `<h4>${text(row.address)}</h4><p>${text(row.channel)} · Eligibility: ${text(row.eligibility)}</p>
      <dl class="crm-review-fields">${field('Syntax', row.syntax)}${field('DNS', row.dns)}${field('Mailbox', row.mailbox)}
      ${field('Identity', row.identity)}${field('Checked', date(row.checked_at))}${field('Checks expire', date(row.effective_expires_at))}</dl>`;
  } else if (section === 'evidence') {
    content = `<h4>${text(row.source)}</h4><p>Method: ${text(row.method)}</p>${provenance(row)}
      <details><summary>Content fingerprint</summary><p class="crm-review-value">${text(row.content_hash)}</p></details>`;
  } else {
    const support = row.source_matches === true ? 'Quote matches linked source'
      : row.source_matches === false ? 'Value or quote differs from linked source' : 'Source support not established';
    content = `<h4>${text(row.field)}</h4><p class="crm-review-value">${text(row.value_preview)}</p>
      <p>Method: ${text(row.method)} · Status: ${text(row.status)}</p><p>${esc(support)}</p>
      ${row.value_truncated ? '<p class="muted">Value preview shortened to 4,000 characters.</p>' : ''}
      <details><summary>Source quote and provenance</summary><blockquote class="crm-review-value">${text(row.quote_preview)}</blockquote>
        ${row.quote_truncated ? '<p class="muted">Quote preview shortened to 4,000 characters.</p>' : ''}${provenance(row)}</details>`;
  }
  return `<article class="crm-review-record" data-review-record>${content}
    <p class="muted">Freshness: ${text(row.freshness)}</p>${row.text_truncated ? '<p class="muted">Long metadata has been shortened.</p>' : ''}</article>`;
}

export function createConnectedPersonReview({ api }) {
  let opened = null;

  function open(personId) {
    opened?.close();
    const dialog = detailDialog(`<div class="crm-review-header"><h2 id="connectedPersonTitle">Prospect dossier</h2></div>
      <div data-review-summary role="status">Loading prospect…</div>
      <p class="muted">Evidence review is read-only. Inferences and contact checks do not grant outreach consent.</p>
      <div class="crm-tabs" role="group" aria-label="Dossier sections">
        ${SECTIONS.map(([key, label]) => `<button class="btn btn-ghost btn-sm" type="button" data-review-tab="${key}" aria-pressed="false">${label}</button>`).join('')}
      </div><div data-review-content></div>`);
    if (!dialog) return;
    opened = dialog;
    dialog.classList.add('crm-review-dialog');
    dialog.setAttribute('aria-labelledby', 'connectedPersonTitle');
    dialog.querySelector('.crm-review-header').append(dialog.querySelector('.detail-dialog-actions'));
    const summary = dialog.querySelector('[data-review-summary]');
    const panel = dialog.querySelector('[data-review-content]');
    const states = Object.fromEntries(SECTIONS.map(([key]) => [key, { items: [], cursor: null, loaded: false, loading: false, error: '' }]));
    let section = null;
    let ready = false;
    const active = () => dialog.isConnected && dialog.open && opened === dialog;
    const url = (resource, cursor = null) => {
      const params = new URLSearchParams({ resource, person_id: personId });
      if (resource !== 'person') params.set('limit', '10');
      if (cursor) params.set('cursor', cursor);
      return `/api/admin/connected-crm?${params}`;
    };

    function paint() {
      if (!active() || !section) return;
      const state = states[section];
      const label = SECTIONS.find(([key]) => key === section)[1].toLowerCase();
      panel.setAttribute('aria-busy', String(state.loading));
      panel.innerHTML = `<p role="status">${state.loading ? 'Loading…' : state.loaded ? `${state.items.length} records shown.` : ''}</p>
        ${state.items.map((row) => record(row, section)).join('')}
        ${state.loaded && !state.items.length ? '<p>No records recorded for this section. Missing evidence remains unknown.</p>' : ''}
        ${state.error ? `<p role="alert" class="adm-status" data-state="err">${esc(state.error)}</p><button type="button" class="btn btn-ghost btn-sm" data-review-load>Retry ${label}</button>`
          : state.cursor ? `<button type="button" class="btn btn-ghost btn-sm" data-review-load ${state.loading ? 'disabled' : ''}>Load more ${label}</button>` : ''}`;
    }

    async function load(key) {
      const state = states[key];
      if (!active() || state.loading) return;
      state.loading = true; state.error = '';
      if (section === key) paint();
      try {
        const page = await api(url(key, state.cursor));
        if (!active()) return;
        state.items.push(...page.items);
        state.cursor = page.next_cursor; state.loaded = true;
      } catch (error) {
        if (active()) state.error = error?.data?.error?.message || 'Could not load this section. Retry.';
      } finally {
        state.loading = false;
        if (section === key) paint();
      }
    }

    function show(key) {
      if (!ready || !states[key]) return;
      section = key;
      dialog.querySelectorAll('[data-review-tab]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.reviewTab === key));
        button.classList.toggle('is-active', button.dataset.reviewTab === key);
      });
      paint();
      if (!states[key].loaded) load(key);
    }

    async function loadSummary() {
      summary.textContent = 'Loading prospect…';
      try {
        const person = await api(url('person'));
        if (!active()) return;
        summary.innerHTML = `<h3>${text(person.name)}</h3><p>${text(person.organization?.name)}${person.organization?.title ? ` · ${text(person.organization.title)}` : ''}</p>
          <details><summary>Identity details</summary><dl class="crm-review-fields">
          ${field('Readiness', person.readiness)}${field('Lifecycle', person.lifecycle)}
          ${field('Source', person.source)}${field('Source record', person.source_id)}
          ${field('Owner', person.owner_name)}${field('Captured', date(person.created_at))}</dl></details>
          ${person.organization && !person.organization.is_current ? '<p class="muted">Organization shown is a historical employment record.</p>' : ''}
          ${person.merged_into ? '<p class="muted">This identity was merged. Historical evidence is shown.</p>' : ''}
          ${person.text_truncated ? '<p class="muted">Long identity fields have been shortened.</p>' : ''}`;
        ready = true; show('contacts');
      } catch (error) {
        if (active()) summary.innerHTML = `<p role="alert">${esc(error?.data?.error?.message || 'Could not load prospect.')}</p><button class="btn btn-ghost btn-sm" type="button" data-review-summary-retry>Retry prospect</button>`;
      }
    }

    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.reviewTab) show(button.dataset.reviewTab);
      else if (button.hasAttribute('data-review-load') && section) load(section);
      else if (button.hasAttribute('data-review-summary-retry')) loadSummary();
    });
    loadSummary();
  }

  return { open };
}
