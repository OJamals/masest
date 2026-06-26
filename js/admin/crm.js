// Admin CRM panel (slice 1): Timeline | Tasks | Notes sub-tabs inside the company
// detail drawer. Polymorphic — mount(container, subjectType, subjectId) drives all
// three from /api/admin/crm/*. Kept out of companies.js so that file stays focused
// (#36 split rule). Skeleton/empty helpers are injected; esc/date/confirmDialog come
// from util.js, matching the other per-tab modules.
import { esc, dateTime as date, confirmDialog } from '../util.js';

const KINDS = [['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting']];

export function createCrmPanel({ $, api, admSkeleton, admEmpty }) {
  const errRow = (msg) => `<p class="adm-status" data-state="err">${esc(msg || 'Could not load. Retry.')}</p>`;

  function panelShell(subjectType, subjectId) {
    return `<div class="crm-panel" data-crm-subject-type="${esc(subjectType)}" data-crm-subject-id="${esc(subjectId)}">
      <div class="crm-tabs" role="group" aria-label="Contact activity">
        <button class="btn btn-ghost btn-sm is-active" type="button" data-crm-tab="timeline" aria-pressed="true">Timeline</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="tasks" aria-pressed="false">Tasks</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="notes" aria-pressed="false">Notes</button>
      </div>
      <div class="crm-body" data-crm-body aria-live="polite">${admSkeleton(3)}</div>
    </div>`;
  }

  function timelineIcon(type) {
    if (type.startsWith('note')) return 'ph-note';
    if (type.startsWith('task')) return 'ph-check-square';
    return ({ order: 'ph-package', message: 'ph-chat-circle', shipment: 'ph-truck', audit: 'ph-shield', quote: 'ph-file-text' })[type] || 'ph-circle';
  }

  function renderTimeline(items) {
    if (!items.length) return admEmpty('ph-clock-counter-clockwise', 'No activity yet', 'Orders, messages, notes and tasks for this contact appear here.');
    return `<ul class="crm-feed">${items.map((i) => `<li class="crm-feed-item">
      <i class="ph ${timelineIcon(i.type)}" aria-hidden="true"></i>
      <div><div class="crm-feed-title">${esc(i.title)}</div>${i.detail ? `<div class="crm-feed-detail">${esc(i.detail)}</div>` : ''}</div>
      <time class="crm-feed-at muted">${esc(date(i.at))}</time></li>`).join('')}</ul>`;
  }

  function renderNotes(notes) {
    const composer = `<form class="crm-note-form" data-crm-note-form>
      <select class="adm-select" data-crm-note-kind aria-label="Note type">${KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <textarea class="adm-input" data-crm-note-body rows="2" placeholder="Log a note, call, email or meeting…" required></textarea>
      <button class="btn btn-primary btn-sm" type="submit">Add note</button>
    </form>`;
    const list = notes.length ? `<ul class="crm-feed">${notes.map((n) => `<li class="crm-feed-item">
      <i class="ph ph-note" aria-hidden="true"></i>
      <div><div class="crm-feed-title">${esc(n.kind)} <span class="muted">· ${esc(n.created_by || '')}</span></div>
      <div class="crm-feed-detail">${esc(n.body)}</div></div>
      <span class="crm-feed-at"><time class="muted">${esc(date(n.created_at))}</time>
      <button class="btn btn-ghost btn-sm" type="button" data-crm-note-del="${esc(n.id)}" aria-label="Delete note">Delete</button></span></li>`).join('')}</ul>`
      : admEmpty('ph-note', 'No notes', 'Log the first call, email or meeting.');
    return composer + list;
  }

  function renderTasks(tasks) {
    const overdue = (t) => t.due_at && new Date(t.due_at) < new Date();
    const composer = `<form class="crm-task-form" data-crm-task-form>
      <input class="adm-input" data-crm-task-title placeholder="Follow-up task…" required>
      <input class="adm-input" data-crm-task-due type="datetime-local" aria-label="Due date">
      <input class="adm-input" data-crm-task-assignee placeholder="Assign to (email)" aria-label="Assignee">
      <button class="btn btn-primary btn-sm" type="submit">Add task</button>
    </form>`;
    const row = (t) => `<li class="crm-task ${t.status === 'done' ? 'is-done' : ''}">
      <button class="btn btn-ghost btn-sm" type="button" data-crm-task-toggle="${esc(t.id)}" data-crm-task-status="${esc(t.status)}" aria-label="${t.status === 'done' ? 'Reopen' : 'Complete'} task">${t.status === 'done' ? '↺' : '✓'}</button>
      <div><div class="crm-feed-title">${esc(t.title)}</div>
      <div class="crm-feed-detail muted">${t.assigned_to ? `→ ${esc(t.assigned_to)}` : 'Unassigned'}${t.due_at ? ` · due ${esc(date(t.due_at))}` : ''}</div></div>
      ${t.status === 'open' && overdue(t) ? '<span class="badge badge-warning">Overdue</span>' : '<span></span>'}</li>`;
    const open = tasks.filter((t) => t.status === 'open');
    const done = tasks.filter((t) => t.status === 'done');
    const list = (open.length || done.length)
      ? `<ul class="crm-task-list">${open.map(row).join('')}${done.map(row).join('')}</ul>`
      : admEmpty('ph-check-square', 'No tasks', 'Add a follow-up so this contact never goes cold.');
    return composer + list;
  }

  async function load(body, subjectType, subjectId, tab) {
    body.innerHTML = admSkeleton(3);
    const sid = encodeURIComponent(subjectId);
    try {
      if (tab === 'timeline') {
        const { timeline } = await api(`/api/admin/crm/timeline?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderTimeline(timeline || []);
      } else if (tab === 'notes') {
        const { notes } = await api(`/api/admin/crm/notes?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderNotes(notes || []);
      } else {
        const { tasks } = await api(`/api/admin/crm/tasks?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderTasks(tasks || []);
      }
    } catch (err) {
      body.innerHTML = errRow(err.data?.error);
    }
  }

  function mount(container, subjectType, subjectId) {
    container.insertAdjacentHTML('beforeend', panelShell(subjectType, subjectId));
    const panel = container.querySelector('.crm-panel');
    const body = panel.querySelector('[data-crm-body]');
    const show = (tab) => {
      panel.querySelectorAll('[data-crm-tab]').forEach((b) => {
        const on = b.dataset.crmTab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      load(body, subjectType, subjectId, tab);
    };

    panel.addEventListener('click', async (event) => {
      const tabBtn = event.target.closest('[data-crm-tab]');
      if (tabBtn) { show(tabBtn.dataset.crmTab); return; }

      const del = event.target.closest('[data-crm-note-del]');
      if (del) {
        if (!(await confirmDialog('Delete this note?', { confirmText: 'Delete', danger: true }))) return;
        del.disabled = true;
        try { await api(`/api/admin/crm/notes?id=${encodeURIComponent(del.dataset.crmNoteDel)}`, { method: 'DELETE' }); load(body, subjectType, subjectId, 'notes'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); del.disabled = false; }
        return;
      }

      const toggle = event.target.closest('[data-crm-task-toggle]');
      if (toggle) {
        toggle.disabled = true;
        const action = toggle.dataset.crmTaskStatus === 'done' ? 'reopen' : 'complete';
        try { await api('/api/admin/crm/tasks', { method: 'PATCH', body: { id: toggle.dataset.crmTaskToggle, action } }); load(body, subjectType, subjectId, 'tasks'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); toggle.disabled = false; }
      }
    });

    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      if (form.matches('[data-crm-note-form]')) {
        const text = form.querySelector('[data-crm-note-body]').value.trim();
        if (!text) return;
        const kind = form.querySelector('[data-crm-note-kind]').value;
        try { await api('/api/admin/crm/notes', { method: 'POST', body: { subject_type: subjectType, subject_id: subjectId, kind, body: text } }); load(body, subjectType, subjectId, 'notes'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
      } else if (form.matches('[data-crm-task-form]')) {
        const title = form.querySelector('[data-crm-task-title]').value.trim();
        if (!title) return;
        const due = form.querySelector('[data-crm-task-due]').value;
        const assignee = form.querySelector('[data-crm-task-assignee]').value.trim();
        try { await api('/api/admin/crm/tasks', { method: 'POST', body: { subject_type: subjectType, subject_id: subjectId, title, due_at: due || null, assigned_to: assignee || null } }); load(body, subjectType, subjectId, 'tasks'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
      }
    });

    show('timeline');
  }

  return { mount };
}
