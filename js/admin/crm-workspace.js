// Admin CRM workspace tab — a home for cross-account CRM surfaces. Hosts
// sub-views (Tasks inbox, Contact directory) under one tab. Shell only in this
// slice; sub-views are filled by later plans. Mirrors the createQuotesTab shape
// (#36 per-tab split). Shared primitives ($, api, state, admSkeleton, admEmpty)
// are injected; esc/delegate come from util.js.
import { esc, delegate, dateTime as date } from '../util.js?v=20260711o';
import { taskAssigneeFacets, filterTasksByAssignee } from './crm-task-filter.js?v=20260711o';

const DIR_ROLES = [
  ['', 'All roles'],
  ['procurement', 'Procurement'],
  ['plant_manager', 'Plant Manager'],
  ['maintenance', 'Maintenance'],
  ['engineering', 'Engineering'],
  ['operations', 'Operations'],
  ['accounts_payable', 'Accounts Payable'],
  ['executive', 'Executive'],
  ['other', 'Other'],
];

export function createCrmWorkspace({ $, api, state, admSkeleton, admEmpty, crm, openSubject, admListPager, refreshStats }) {
  const SUBTABS = [['tasks', 'Follow-ups'], ['contacts', 'People']];

  function shell() {
    const view = state.crmView || 'tasks';
    return `<div class="crm-ws">
      <div class="crm-ws-head">
        <div>
          <p class="adm-eyebrow">CRM</p>
          <h2>Relationship workspace</h2>
          <p class="muted">Follow up on open work, then jump straight into the account, quote, or contact that needs attention.</p>
        </div>
      </div>
      <div class="crm-tabs" role="group" aria-label="CRM sections">
        ${SUBTABS.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === view ? ' is-active' : ''}" type="button" data-crm-ws-tab="${v}" aria-pressed="${v === view}">${l}</button>`).join('')}
      </div>
      <div class="crm-ws-body" data-crm-ws-body aria-live="polite"></div>
    </div>`;
  }

  const TASK_SCOPES = [['open', 'All open'], ['mine', 'Assigned to me'], ['overdue', 'Overdue']];
  // The currently loaded inbox tasks for the active scope. The assignee filter
  // narrows this in-memory (no refetch), so it persists across assignee changes.
  let inboxTasks = [];

  function taskRow(t) {
    const overdue = t.due_at && new Date(t.due_at) < new Date();
    const subj = t.subject_label ? `${esc(t.subject_label)}` : esc(t.subject_type);
    const canOpen = t.subject_type === 'company' || t.subject_type === 'quote' || t.subject_type === 'contact';
    const openBtn = canOpen
      ? `<button class="btn btn-ghost btn-sm" type="button" data-inbox-open data-subj-type="${esc(t.subject_type)}" data-subj-id="${esc(t.subject_id)}" data-subj-label="${esc(t.subject_label || '')}">Open</button>`
      : '';
    return `<li class="crm-task">
      <button class="btn btn-ghost btn-sm" type="button" data-inbox-toggle="${esc(t.id)}" data-inbox-status="${esc(t.status)}" data-capability="admin.write" aria-label="${t.status === 'done' ? 'Reopen' : 'Complete'} task">${t.status === 'done' ? '↺' : '✓'}</button>
      <div><div class="crm-feed-title">${esc(t.title)}</div>
      <div class="crm-feed-detail muted">${subj} · ${t.assigned_to ? `→ ${esc(t.assigned_to)}` : 'Unassigned'}${t.due_at ? ` · due ${esc(date(t.due_at))}` : ''}</div></div>
      ${overdue ? '<span class="badge badge-warning">Overdue</span>' : '<span></span>'}
      ${openBtn}</li>`;
  }

  function scopeButtons(scope) {
    return `<div class="crm-tabs" role="group" aria-label="Task scope">${TASK_SCOPES.map(([v, l]) => `<button class="btn btn-ghost btn-sm${v === scope ? ' is-active' : ''}" type="button" data-inbox-scope="${v}" aria-pressed="${v === scope}">${l}</button>`).join('')}</div>`;
  }

  function taskStats(tasks, visible) {
    const overdue = tasks.filter((t) => t.status !== 'done' && t.due_at && new Date(t.due_at) < new Date()).length;
    const unassigned = tasks.filter((t) => !t.assigned_to).length;
    return `<div class="crm-quick-stats" aria-label="Follow-up summary">
      <span><b>${visible.length}</b> showing</span>
      <span><b>${overdue}</b> overdue</span>
      <span><b>${unassigned}</b> unassigned</span>
    </div>`;
  }

  // Assignee facet <select>, derived from the loaded inbox. Suppressed when there
  // is only one bucket (facets = just the "All" head) since there's nothing to narrow.
  function assigneeSelect() {
    const facets = taskAssigneeFacets(inboxTasks);
    if (facets.length <= 2) return '';
    const current = state.crmTaskAssignee || '';
    const opts = facets.map((f) => `<option value="${esc(f.value)}"${f.value === current ? ' selected' : ''}>${esc(f.label)} (${f.count})</option>`).join('');
    return `<select class="adm-select adm-select-sm" data-inbox-assignee aria-label="Filter tasks by assignee">${opts}</select>`;
  }

  // Render the toolbar + the assignee-filtered list from the already-loaded inboxTasks.
  function paintInbox(body) {
    const scope = state.crmTaskScope || 'open';
    const toolbar = `<div class="crm-inbox-tools">${scopeButtons(scope)}${assigneeSelect()}</div>`;
    const visible = filterTasksByAssignee(inboxTasks, state.crmTaskAssignee || '');
    const head = `<div class="crm-section-head">
      <div>
        <h3>Today’s follow-ups</h3>
        <p class="muted">Complete quick tasks here, or open the linked record when more context is needed.</p>
      </div>
      ${taskStats(inboxTasks, visible)}
    </div>`;
    let list;
    if (visible.length) list = `<ul class="crm-task-list">${visible.map(taskRow).join('')}</ul>`;
    else if (inboxTasks.length) list = admEmpty('ph-funnel', 'No tasks', 'No open follow-ups for this assignee.');
    else list = admEmpty('ph-check-square', 'No tasks', scope === 'overdue' ? 'Nothing overdue — you are caught up.' : 'No open follow-ups.');
    body.innerHTML = head + toolbar + list;
  }

  // Tasks inbox — replaces plan 001 placeholder.
  async function renderTasks(body) {
    const scope = state.crmTaskScope || 'open';
    body.innerHTML = admSkeleton(4);
    try {
      const { tasks, needs_migration } = await api(`/api/admin/crm/tasks?scope=${scope}`);
      // View or scope changed while this request was in flight — drop it (X8 race).
      if ((state.crmView || 'tasks') !== 'tasks' || (state.crmTaskScope || 'open') !== scope) return;
      if (needs_migration) { inboxTasks = []; body.innerHTML = scopeButtons(scope) + admEmpty('ph-database', 'No CRM database yet', 'Apply supabase/schema-crm.sql to enable follow-ups.'); return; }
      inboxTasks = tasks || [];
      // Drop a stale assignee selection that no longer appears in the new scope.
      const facetValues = new Set(taskAssigneeFacets(inboxTasks).map((f) => f.value));
      if (state.crmTaskAssignee && !facetValues.has(state.crmTaskAssignee)) state.crmTaskAssignee = '';
      paintInbox(body);
    } catch (err) {
      inboxTasks = [];
      body.innerHTML = scopeButtons(scope) + `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Could not load tasks. Retry.')}</p>`;
    }
  }
  // ---- Portal users (the old top-level Customers tab, folded in here) ----
  // Sign-in accounts fetched once and searched client-side; CRM contacts stay a
  // server-side search. One directory for every person tied to an account.
  async function loadPortalUsers() {
    if (state.customers) return state.customers;
    try { state.customers = (await api('/api/admin/customers')).customers || []; } catch { return null; }
    return state.customers;
  }

  function filterPortalUsers(users, q) {
    if (!q) return users;
    const needle = q.toLowerCase();
    const text = (c) => [c.full_name, c.email, c.phone, c.company_name, c.role].filter(Boolean).join(' ').toLowerCase();
    return users.filter((c) => text(c).includes(needle));
  }

  function portalRow(c) {
    const company = c.company_name ? `<span class="muted">${esc(c.company_name)}</span>` : '';
    const meta = [
      c.email, c.phone,
      c.price_tier && c.price_tier !== 'retail' ? `${c.price_tier} tier` : '',
      c.company_status && c.company_status !== 'approved' ? `account ${String(c.company_status).replace(/_/g, ' ')}` : '',
    ].filter(Boolean).map(esc).join(' · ') || '—';
    const accountBtn = c.company_id
      ? `<button class="btn btn-ghost btn-sm" type="button" data-dir-open-company="${esc(c.company_id)}" data-company-label="${esc(c.company_name || '')}">Account</button>`
      : '';
    const emailBtn = c.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(c.email)}">Email</a>` : '';
    return `<li class="crm-contact">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${esc(c.full_name || c.email || 'User')} <span class="crm-contact-role">${esc(c.role || 'portal user')}</span> ${company}</div>
        <div class="crm-feed-detail muted">${meta}</div>
      </div>
      <span class="crm-contact-actions">${accountBtn}${emailBtn}</span></li>`;
  }

  async function renderPortalUsers(body) {
    const boxEl = body.querySelector('[data-dir-users]');
    if (!boxEl) return;
    // The role facet is contact-specific — a role search shows contacts only.
    if (state.crmContactRole) { boxEl.innerHTML = ''; return; }
    boxEl.innerHTML = admSkeleton(2);
    const users = await loadPortalUsers();
    if (!boxEl.isConnected) return; // view switched while loading
    if (users === null) { boxEl.innerHTML = '<p class="adm-status" data-state="err">Could not load portal users. Retry.</p>'; return; }
    const q = state.crmContactQ || '';
    const visible = filterPortalUsers(users, q);
    const heading = `<h4 class="crm-dir-heading">Portal sign-ins <span class="muted">(${visible.length}${q ? ` of ${users.length}` : ''})</span></h4>`;
    boxEl.innerHTML = heading + (visible.length
      ? `<ul class="crm-contact-list">${visible.map(portalRow).join('')}</ul>`
      : `<p class="muted">${q ? 'No portal users match that search.' : 'No portal users yet.'}</p>`);
  }

  function contactRow(c) {
    const role = c.role ? `<span class="crm-contact-role">${esc(String(c.role).replace(/_/g, ' '))}</span>` : '';
    const meta = [c.title, c.email, c.phone].filter(Boolean).map(esc).join(' · ') || '—';
    const company = c.company_name ? `<span class="muted">${esc(c.company_name)}</span>` : '';
    const accountBtn = c.company_id
      ? `<button class="btn btn-ghost btn-sm" type="button" data-dir-open-company="${esc(c.company_id)}" data-company-label="${esc(c.company_name || '')}">Account</button>`
      : '';
    return `<li class="crm-contact">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${esc(c.name)} ${role} ${company}</div>
        <div class="crm-feed-detail muted">${meta}</div>
      </div>
      <span class="crm-contact-actions">
        ${accountBtn}
        <button class="btn btn-ghost btn-sm" type="button" data-dir-open="${esc(c.id)}">History</button>
      </span></li>`;
  }

  async function runContactSearch(body, { append = false } = {}) {
    const q = state.crmContactQ || '';
    const role = state.crmContactRole || '';
    const results = body.querySelector('[data-dir-results]');
    if (!results) return;
    const seq = (results._seq = (results._seq || 0) + 1); // drop stale overlapping searches (X8)
    const heading = `<h4 class="crm-dir-heading">Account contacts</h4>`;
    if (q.length < 2 && !role) {
      results.innerHTML = heading + '<p class="muted">Type at least two characters — or pick a role — to search contacts logged on accounts.</p>';
      results._contacts = [];
      return;
    }
    if (!append) results.innerHTML = heading + admSkeleton(3);
    try {
      const offset = append ? (results._contacts?.length || 0) : 0;
      const params = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (q.length >= 2) params.set('q', q);
      if (role) params.set('role', role);
      const { contacts, needs_migration, total, has_more } = await api(`/api/admin/crm/contacts?${params}`);
      if (!results.isConnected || seq !== results._seq) return; // view switched or a newer search landed
      if (needs_migration) { results.innerHTML = heading + admEmpty('ph-database', 'No CRM database yet', 'Apply supabase/schema-crm-contacts.sql to enable the contact directory.'); return; }
      const next = append ? [...(results._contacts || []), ...(contacts || [])] : (contacts || []);
      results._contacts = next;
      results.innerHTML = heading + (next.length
        ? `<ul class="crm-contact-list">${next.map(contactRow).join('')}</ul>${admListPager('data-dir-more', next.length, total, has_more)}`
        : admEmpty('ph-address-book', 'No matches', 'No contacts match that search.'));
    } catch (err) {
      if (!results.isConnected || seq !== results._seq) return;
      results.innerHTML = heading + `<p class="adm-status" data-state="err">${esc(err.data?.error || 'Search failed. Retry.')}</p>`;
    }
  }

  async function renderContacts(body) {
    const term = state.crmContactQ || '';
    const currentRole = state.crmContactRole || '';
    const roleOpts = DIR_ROLES.map(([v, l]) => `<option value="${esc(v)}"${v === currentRole ? ' selected' : ''}>${esc(l)}</option>`).join('');
    body.innerHTML = `<div class="crm-section-head">
        <div>
          <h3>Everyone in one place</h3>
          <p class="muted">Portal sign-ins and account contacts share this directory — search once, then open the account or the person's history.</p>
        </div>
      </div>
      <form class="adm-tools crm-contact-search" data-dir-form>
        <input class="adm-search" type="search" data-dir-q placeholder="Search people by name, email, phone or company" aria-label="Search people" value="${esc(term)}">
        <select class="adm-select" data-dir-role aria-label="Filter by contact role">${roleOpts}</select>
        <button class="btn btn-primary btn-sm" type="submit">Search</button>
      </form>
      <div data-dir-users></div>
      <div data-dir-results></div>`;
    renderPortalUsers(body);
    await runContactSearch(body);
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
    delegate(box, 'change', '[data-inbox-assignee]', (event, sel) => {
      // Re-filter the loaded inbox in place — no refetch.
      state.crmTaskAssignee = sel.value;
      paintInbox(box.querySelector('[data-crm-ws-body]'));
    });
    delegate(box, 'click', '[data-inbox-toggle]', async (event, btn) => {
      btn.disabled = true;
      const action = btn.dataset.inboxStatus === 'done' ? 'reopen' : 'complete';
      try {
        await api('/api/admin/crm/tasks', { method: 'PATCH', body: { id: btn.dataset.inboxToggle, action } });
        renderTasks(box.querySelector('[data-crm-ws-body]'));
        refreshStats?.(); // completing/reopening a task changes the overdue count → refresh the nav badge
      } catch (err) {
        btn.disabled = false;
        const body = box.querySelector('[data-crm-ws-body]');
        let note = body.querySelector('[data-inbox-error]');
        if (!note) { note = document.createElement('p'); note.className = 'adm-status'; note.dataset.inboxError = ''; body.appendChild(note); }
        note.dataset.state = 'err';
        note.textContent = err.data?.error || `Could not ${action} the task. Retry.`;
      }
    });
    delegate(box, 'submit', '[data-dir-form]', (event, form) => {
      event.preventDefault();
      state.crmContactQ = form.querySelector('[data-dir-q]').value.trim();
      const body = box.querySelector('[data-crm-ws-body]');
      renderPortalUsers(body);
      runContactSearch(body, { append: false });
    });
    delegate(box, 'change', '[data-dir-role]', (event, sel) => {
      state.crmContactRole = sel.value;
      const body = box.querySelector('[data-crm-ws-body]');
      renderPortalUsers(body);
      runContactSearch(body, { append: false });
    });
    delegate(box, 'click', '[data-dir-more]', () => {
      runContactSearch(box.querySelector('[data-crm-ws-body]'), { append: true });
    });
    delegate(box, 'click', '[data-dir-open-company]', (event, btn) => {
      if (openSubject) openSubject('company', btn.dataset.dirOpenCompany, btn.dataset.companyLabel);
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
