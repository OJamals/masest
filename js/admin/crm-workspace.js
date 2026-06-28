// Admin CRM workspace tab — a home for cross-account CRM surfaces. Hosts
// sub-views (Tasks inbox, Contact directory) under one tab. Shell only in this
// slice; sub-views are filled by later plans. Mirrors the createQuotesTab shape
// (#36 per-tab split). Shared primitives ($, api, state, admSkeleton, admEmpty)
// are injected; esc/delegate come from util.js.
import { esc, delegate, dateTime as date } from '../util.js';

export function createCrmWorkspace({ $, api, state, admSkeleton, admEmpty, crm, openSubject }) {
  const SUBTABS = [['tasks', 'Tasks'], ['contacts', 'Contacts']];

  function shell() {
    const view = state.crmView || 'tasks';
    return `<div class="crm-ws">
      <div class="crm-tabs" role="group" aria-label="CRM sections">
        ${SUBTABS.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === view ? ' is-active' : ''}" type="button" data-crm-ws-tab="${v}" aria-pressed="${v === view}">${l}</button>`).join('')}
      </div>
      <div class="crm-ws-body" data-crm-ws-body aria-live="polite"></div>
    </div>`;
  }

  const TASK_SCOPES = [['open', 'All open'], ['mine', 'Assigned to me'], ['overdue', 'Overdue']];

  function taskRow(t) {
    const overdue = t.due_at && new Date(t.due_at) < new Date();
    const subj = t.subject_label ? `${esc(t.subject_label)}` : esc(t.subject_type);
    const canOpen = t.subject_type === 'company' || t.subject_type === 'quote' || t.subject_type === 'contact';
    const openBtn = canOpen
      ? `<button class="btn btn-ghost btn-sm" type="button" data-inbox-open data-subj-type="${esc(t.subject_type)}" data-subj-id="${esc(t.subject_id)}" data-subj-label="${esc(t.subject_label || '')}">Open</button>`
      : '';
    return `<li class="crm-task">
      <button class="btn btn-ghost btn-sm" type="button" data-inbox-toggle="${esc(t.id)}" data-inbox-status="${esc(t.status)}" aria-label="${t.status === 'done' ? 'Reopen' : 'Complete'} task">${t.status === 'done' ? '↺' : '✓'}</button>
      <div><div class="crm-feed-title">${esc(t.title)}</div>
      <div class="crm-feed-detail muted">${subj} · ${t.assigned_to ? `→ ${esc(t.assigned_to)}` : 'Unassigned'}${t.due_at ? ` · due ${esc(date(t.due_at))}` : ''}</div></div>
      ${overdue ? '<span class="badge badge-warning">Overdue</span>' : '<span></span>'}
      ${openBtn}</li>`;
  }

  // Tasks inbox — replaces plan 001 placeholder.
  async function renderTasks(body) {
    const scope = state.crmTaskScope || 'open';
    body.innerHTML = admSkeleton(4);
    const toggle = `<div class="crm-tabs" role="group" aria-label="Task scope">${TASK_SCOPES.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === scope ? ' is-active' : ''}" type="button" data-inbox-scope="${v}" aria-pressed="${v === scope}">${l}</button>`).join('')}</div>`;
    try {
      const { tasks, needs_migration } = await api(`/api/admin/crm/tasks?scope=${scope}`);
      if (needs_migration) { body.innerHTML = toggle + '<p class="muted">No CRM database yet. Apply supabase/schema-crm.sql.</p>'; return; }
      const list = (tasks || []).length
        ? `<ul class="crm-task-list">${tasks.map(taskRow).join('')}</ul>`
        : admEmpty('ph-check-square', 'No tasks', scope === 'overdue' ? 'Nothing overdue — you are caught up.' : 'No open follow-ups.');
      body.innerHTML = toggle + list;
    } catch (err) {
      body.innerHTML = toggle + `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load tasks. Retry.')}</p>`;
    }
  }
  function contactRow(c) {
    const role = c.role ? `<span class="crm-contact-role">${esc(c.role)}</span>` : '';
    const meta = [c.title, c.email, c.phone].filter(Boolean).map(esc).join(' · ') || '—';
    const company = c.company_name ? `<span class="muted">${esc(c.company_name)}</span>` : '';
    return `<li class="crm-contact">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${esc(c.name)} ${role} ${company}</div>
        <div class="crm-feed-detail muted">${meta}</div>
      </div>
      <span class="crm-contact-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-dir-open="${esc(c.id)}">Open</button>
      </span></li>`;
  }

  async function runContactSearch(body, term) {
    const results = body.querySelector('[data-dir-results]');
    results.innerHTML = admSkeleton(3);
    try {
      const { contacts, needs_migration } = await api(`/api/admin/crm/contacts?q=${encodeURIComponent(term)}`);
      if (needs_migration) { results.innerHTML = '<p class="muted">No CRM database yet. Apply supabase/schema-crm-contacts.sql.</p>'; return; }
      results.innerHTML = (contacts || []).length
        ? `<ul class="crm-contact-list">${contacts.map(contactRow).join('')}</ul>`
        : admEmpty('ph-address-book', 'No matches', 'No contacts match that search.');
      results._contacts = contacts || [];
    } catch (err) {
      results.innerHTML = `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Search failed. Retry.')}</p>`;
    }
  }

  async function renderContacts(body) {
    const term = state.crmContactQ || '';
    body.innerHTML = `<form class="adm-tools" data-dir-form>
        <input class="adm-search" type="search" data-dir-q placeholder="Search contacts by name, email or phone" aria-label="Search contacts" value="${esc(term)}">
        <button class="btn btn-primary btn-sm" type="submit">Search</button>
      </form>
      <div data-dir-results></div>`;
    if (term.length >= 2) await runContactSearch(body, term);
  }

  function showView(view) {
    state.crmView = view;
    const box = $('admCrm');
    box.querySelectorAll('[data-crm-ws-tab]').forEach((b) => {
      const on = b.dataset.crmWsTab === view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const body = box.querySelector('[data-crm-ws-body]');
    if (view === 'contacts') renderContacts(body);
    else renderTasks(body);
  }

  function renderCrm() {
    const box = $('admCrm');
    if (!box) return;
    box.innerHTML = shell();
    state.loaded.add('crm');
    showView(state.crmView || 'tasks');
  }

  function wireCrm() {
    const box = $('admCrm');
    if (!box) return;
    delegate(box, 'click', '[data-crm-ws-tab]', (event, btn) => showView(btn.dataset.crmWsTab));
    delegate(box, 'click', '[data-inbox-scope]', (event, btn) => {
      state.crmTaskScope = btn.dataset.inboxScope;
      renderTasks(box.querySelector('[data-crm-ws-body]'));
    });
    delegate(box, 'click', '[data-inbox-toggle]', async (event, btn) => {
      btn.disabled = true;
      const action = btn.dataset.inboxStatus === 'done' ? 'reopen' : 'complete';
      try {
        await api('/api/admin/crm/tasks', { method: 'PATCH', body: { id: btn.dataset.inboxToggle, action } });
        renderTasks(box.querySelector('[data-crm-ws-body]'));
      } catch (err) {
        btn.disabled = false;
      }
    });
    delegate(box, 'submit', '[data-dir-form]', (event, form) => {
      event.preventDefault();
      const term = form.querySelector('[data-dir-q]').value.trim();
      state.crmContactQ = term;
      const body = box.querySelector('[data-crm-ws-body]');
      if (term.length >= 2) runContactSearch(body, term);
    });
    delegate(box, 'click', '[data-dir-open]', (event, btn) => {
      const results = box.querySelector('[data-dir-results]');
      const c = (results?._contacts || []).find((x) => String(x.id) === String(btn.dataset.dirOpen));
      if (c && crm?.openContactDrawer) crm.openContactDrawer(c);
    });
    delegate(box, 'click', '[data-inbox-open]', (event, btn) => {
      if (openSubject) openSubject(btn.dataset.subjType, btn.dataset.subjId, btn.dataset.subjLabel);
    });
  }

  return { renderCrm, wireCrm };
}
