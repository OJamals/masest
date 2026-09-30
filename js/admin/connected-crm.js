import { esc } from '../util.js?v=20260929e';
import { createConnectedPersonReview } from './connected-person-review.js?v=20260929e';

const endpoint = '/api/admin/connected-crm';
const message = (error, fallback) => error?.data?.error?.message || fallback;

export function createConnectedCrm({ api }) {
  const review = createConnectedPersonReview({ api });
  // Kept in memory across tab changes. An uncertain import always retries its
  // exact action and payload; no CSV/credentials are persisted in browser storage.
  let draft = { source: '', permitted_use: '', csv_text: '', filename: '' };
  let pending = null;
  let busy = false;
  let fileVersion = 0;
  let currentRoot = null;
  let lastResult = null;

  async function render(body) {
    fileVersion += 1;
    const root = document.createElement('div');
    root.className = 'crm-intake';
    currentRoot = root;
    body.replaceChildren(root);
    root.innerHTML = '<h3>CRM intake</h3><p role="status">Connecting to CRM…</p>';
    let context;
    try { context = await api(`${endpoint}?resource=context`); }
    catch (error) {
      if (root.isConnected) root.innerHTML = `<h3>CRM intake</h3><p class="adm-status" data-state="err" role="status">${esc(message(error, 'CRM is unavailable. Try opening this section again.'))}</p>`;
      return;
    }
    if (!root.isConnected || currentRoot !== root) return;
    root.innerHTML = `<div class="crm-section-head"><div><h3>CRM intake</h3>
      <p class="muted">Import and review prospects for MASEST. Importing does not grant outreach consent or create customer accounts.</p></div></div>
      ${context.can_import ? `<form class="adm-card" data-intake-import>
        <fieldset data-intake-fields>
          <legend>Import prospects</legend>
          <label class="crm-field">Source <input class="adm-input" name="source" maxlength="200" required value="${esc(draft.source)}"></label>
          <label class="crm-field">Permitted use <input class="adm-input" name="permitted_use" maxlength="500" required value="${esc(draft.permitted_use)}"></label>
          <label class="crm-field">CSV file <input name="csv" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-describedby="intakeCsvHelp"></label>
          <p class="muted" id="intakeCsvHelp">UTF-8 CSV, up to 1 MB. Required columns: source_id, company_id, company, name. Optional: email, title.</p>
          <p data-intake-file role="status"></p>
          <button class="btn btn-primary btn-sm" type="submit">Import CSV</button>
        </fieldset>
        <button class="btn btn-primary btn-sm" type="button" data-intake-retry hidden>Retry same import</button>
      </form>` : '<p class="muted">Read-only access. An editor can import prospects.</p>'}
      <div data-intake-result role="status"></div>
      <form class="crm-intake-search" data-intake-search>
        <label class="crm-field">Search CRM intake <input class="adm-search" name="q" type="search" maxlength="200" placeholder="Name, company, or email"></label>
        <button class="btn btn-primary btn-sm" type="submit">Search</button>
      </form>
      <p data-intake-list-status role="status"></p>
      <div data-intake-people></div>
      <button class="btn btn-ghost btn-sm" type="button" data-intake-more hidden>Load more prospects</button>`;
    const form = root.querySelector('[data-intake-import]');
    const result = root.querySelector('[data-intake-result]');
    const fileNote = root.querySelector('[data-intake-file]');
    const more = root.querySelector('[data-intake-more]');
    const listStatus = root.querySelector('[data-intake-list-status]');
    let cursor = null; let query = ''; let sequence = 0; let rows = []; let loading = false;
    const active = () => root.isConnected && currentRoot === root;

    function controls() {
      if (!form || !active()) return;
      form.querySelector('fieldset').disabled = busy || Boolean(pending);
      form.querySelector('[type="submit"]').disabled = !draft.csv_text;
      form.querySelector('[data-intake-retry]').hidden = !pending;
      form.querySelector('[data-intake-retry]').disabled = busy;
      fileNote.textContent = draft.filename ? `${draft.filename} ready` : 'Choose a CSV file.';
    }

    function receipt(value) {
      if (!active()) return;
      const errors = Array.isArray(value.errors) ? value.errors : [];
      result.innerHTML = `<p>${esc(value.accepted)} accepted; ${esc(value.rejected)} rejected.${value.replayed ? ' Previous import confirmed.' : ''}</p>
        ${errors.length ? `<ul>${errors.slice(0, 50).map((row) => `<li>Row ${esc(row.row)}: ${esc(row.message || row.code)}</li>`).join('')}</ul>` : ''}
        ${errors.length > 50 ? `<p>${errors.length - 50} additional row errors. Review the source file before another import.</p>` : ''}`;
    }

    async function load(append = false) {
      const id = ++sequence;
      loading = true; more.disabled = true; listStatus.textContent = 'Loading prospects…';
      const params = new URLSearchParams({ resource: 'people', limit: '50', q: query });
      if (append && cursor) params.set('cursor', cursor);
      try {
        const page = await api(`${endpoint}?${params}`);
        if (!active() || id !== sequence) return;
        rows = append ? [...rows, ...page.items] : page.items;
        cursor = page.next_cursor;
        root.querySelector('[data-intake-people]').innerHTML = rows.length
          ? `<ul class="crm-contact-list">${rows.map((person) => `<li class="crm-contact"><div class="crm-contact-main"><div class="crm-contact-name">${esc(person.name)}</div><div class="muted">${[person.organization_name, person.title, person.email].filter(Boolean).map(esc).join(' · ')}</div><div class="muted">${esc(person.readiness)} · ${esc(person.lifecycle)}</div></div><button class="btn btn-ghost btn-sm" type="button" data-intake-review="${esc(person.id)}" aria-label="Review ${esc(person.name)}">Review</button></li>`).join('')}</ul>`
          : '<p>No prospects match. Import a CSV or change your search.</p>';
        listStatus.textContent = `${rows.length} prospects shown.`;
        more.hidden = !cursor;
      } catch (error) {
        if (active() && id === sequence) listStatus.textContent = message(error, 'Could not load prospects. Retry the search.');
      } finally {
        if (active() && id === sequence) { loading = false; more.disabled = false; }
      }
    }

    async function submit() {
      if (busy || !pending) return;
      busy = true; controls(); result.textContent = 'Importing…';
      try {
        const value = await api(`${endpoint}?resource=imports`, { method: 'POST', body: pending.payload });
        lastResult = value; pending = null;
        draft = { ...draft, csv_text: '', filename: '' };
        if (active()) { form.reset(); form.elements.source.value = draft.source; form.elements.permitted_use.value = draft.permitted_use; receipt(value); await load(); }
      } catch (error) {
        // Validation rejected before execution allows correction. Once any result
        // was uncertain, retain the original action even if a later retry fails.
        if ([413, 415, 422].includes(error.status) && !pending.uncertain) pending = null;
        else pending.uncertain = true;
        if (active()) result.textContent = `${message(error, 'Import response unavailable.')} ${pending ? 'Retry the same import to confirm its result.' : 'Correct the fields or file and try again.'}`;
      } finally {
        busy = false;
        if (active()) controls();
        else if (currentRoot?.isConnected) {
          // Returning to the tab while an import was in flight must refresh its
          // pending state when the original promise settles.
          render(currentRoot.parentElement);
        }
      }
    }

    if (form) {
      form.elements.source.addEventListener('input', () => { draft.source = form.elements.source.value; });
      form.elements.permitted_use.addEventListener('input', () => { draft.permitted_use = form.elements.permitted_use.value; });
      form.elements.csv.addEventListener('change', async () => {
        const version = ++fileVersion;
        const file = form.elements.csv.files?.[0];
        draft.csv_text = ''; draft.filename = ''; controls();
        if (!file) return;
        if (file.size > 1_000_000) { fileNote.textContent = 'File exceeds 1 MB.'; return; }
        fileNote.textContent = 'Reading CSV…';
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
          if (!active() || version !== fileVersion) return;
          if (!text.trim()) throw new Error('empty');
          draft.csv_text = text; draft.filename = file.name; controls();
        } catch {
          if (active() && version === fileVersion) fileNote.textContent = 'Choose a non-empty UTF-8 CSV file.';
        }
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (busy || pending || !draft.csv_text || !form.reportValidity()) return;
        if (!draft.source.trim() || !draft.permitted_use.trim()) {
          result.textContent = 'Enter a source and permitted use before importing.';
          return;
        }
        pending = { uncertain: false, payload: { action_id: crypto.randomUUID(), source: draft.source.trim(), permitted_use: draft.permitted_use.trim(), csv_text: draft.csv_text } };
        submit();
      });
      form.querySelector('[data-intake-retry]').addEventListener('click', submit);
    }
    root.querySelector('[data-intake-search]').addEventListener('submit', (event) => {
      event.preventDefault(); query = event.currentTarget.elements.q.value.trim(); cursor = null; load();
    });
    more.addEventListener('click', () => { if (cursor && !loading) load(true); });
    root.querySelector('[data-intake-people]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-intake-review]');
      if (button && rows.some((person) => person.id === button.dataset.intakeReview)) review.open(button.dataset.intakeReview);
    });
    controls();
    if (lastResult) receipt(lastResult);
    if (pending) result.textContent = busy ? 'Importing…' : 'Previous import needs confirmation. Retry the same import.';
    await load();
  }

  return { render };
}
