// Admin CRM panel (slice 1): Timeline | Tasks | Notes sub-tabs inside the company
// detail drawer. Polymorphic — mount(container, subjectType, subjectId) drives all
// three from /api/admin/crm/*. Kept out of companies.js so that file stays focused
// (#36 split rule). Skeleton/empty helpers are injected; esc/date/confirmDialog come
// from util.js, matching the other per-tab modules.
import { esc, dateTime as date, confirmDialog } from '../util.js';

const KINDS = [['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting']];
const CONTACT_ROLES = [['procurement', 'Procurement'], ['plant_manager', 'Plant Manager'], ['maintenance', 'Maintenance'], ['engineering', 'Engineering'], ['operations', 'Operations'], ['accounts_payable', 'Accounts Payable'], ['executive', 'Executive'], ['other', 'Other']];
const roleLabel = (r) => (CONTACT_ROLES.find(([v]) => v === r) || ['', r])[1] || r;

export function createCrmPanel({ $, api, admSkeleton, admEmpty }) {
  const errRow = (msg) => `<p class="adm-status" data-state="err">${esc(msg || 'Could not load. Retry.')}</p>`;

  function panelShell(subjectType, subjectId) {
    return `<div class="crm-panel" data-crm-subject-type="${esc(subjectType)}" data-crm-subject-id="${esc(subjectId)}">
      <div class="crm-tabs" role="group" aria-label="Contact activity">
        <button class="btn btn-ghost btn-sm is-active" type="button" data-crm-tab="timeline" aria-pressed="true">Timeline</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="tasks" aria-pressed="false">Tasks</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-tab="notes" aria-pressed="false">Notes</button>
        ${subjectType === 'company' ? '<button class="btn btn-ghost btn-sm" type="button" data-crm-tab="contacts" aria-pressed="false">Contacts</button>' : ''}
      </div>
      <div class="crm-body" data-crm-body aria-live="polite">${admSkeleton(3)}</div>
    </div>`;
  }

  function timelineIcon(type) {
    if (type === 'note:chat') return 'ph-chat-circle';
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

  function renderContacts(contacts) {
    const composer = `<form class="crm-contact-form" data-crm-contact-form>
      <input class="adm-input" data-crm-contact-name placeholder="Contact name" aria-label="Contact name" required>
      <select class="adm-select" data-crm-contact-role aria-label="Role">${CONTACT_ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <input class="adm-input" data-crm-contact-title placeholder="Job title" aria-label="Job title">
      <input class="adm-input" data-crm-contact-email type="email" placeholder="Email" aria-label="Email">
      <input class="adm-input" data-crm-contact-phone placeholder="Phone" aria-label="Phone">
      <label class="crm-contact-primary-toggle"><input type="checkbox" data-crm-contact-primary> Primary</label>
      <button class="btn btn-primary btn-sm" type="submit" data-crm-contact-submit>Add contact</button>
    </form>`;
    const list = contacts.length ? `<ul class="crm-contact-list">${contacts.map((c) => `<li class="crm-contact${c.is_primary ? ' is-primary' : ''}">
      <div class="crm-contact-main">
        <div class="crm-contact-name">${c.is_primary ? '<span class="crm-contact-star" title="Primary contact">★</span> ' : ''}${esc(c.name)}<span class="crm-contact-role">${esc(roleLabel(c.role))}</span></div>
        <div class="crm-feed-detail muted">${[c.title, c.email, c.phone].filter(Boolean).map(esc).join(' · ') || '—'}</div>
      </div>
      <span class="crm-contact-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-crm-contact-history="${esc(c.id)}">History</button>
        ${c.is_primary ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-crm-contact-primary-set="${esc(c.id)}">Make primary</button>`}
        <button class="btn btn-ghost btn-sm" type="button" data-crm-contact-edit="${esc(c.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-contact-merge="${esc(c.id)}">Merge</button>
        <button class="btn btn-ghost btn-sm" type="button" data-crm-contact-del="${esc(c.id)}" aria-label="Delete contact">Delete</button>
      </span></li>`).join('')}</ul>`
      : admEmpty('ph-address-book', 'No contacts', 'Add procurement, plant or maintenance contacts for this account.');
    const importBar = `<div class="crm-contact-import">
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">Import CSV<input type="file" accept=".csv,text/csv" data-crm-contact-import hidden></label>
      <span class="muted" style="font-size:.78rem">columns: name, role, title, email, phone</span></div>`;
    return composer + importBar + list;
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
      } else if (tab === 'contacts') {
        const { contacts } = await api(`/api/admin/crm/contacts?company_id=${sid}`);
        body._contacts = contacts || [];
        body.innerHTML = renderContacts(contacts || []);
      } else {
        const { tasks } = await api(`/api/admin/crm/tasks?subject_type=${subjectType}&subject_id=${sid}`);
        body.innerHTML = renderTasks(tasks || []);
      }
    } catch (err) {
      body.innerHTML = errRow(err.data?.error);
    }
  }

  // Pick the survivor when merging a duplicate contact. Resolves to the chosen id, or null.
  function pickMergeTarget(others) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'confirm-dialog';
      dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
        <p class="confirm-dialog-msg">Merge into which contact? The duplicate is removed; its deals, notes and tasks move to the survivor.</p>
        <label>Survivor <select class="adm-select" data-merge-into>${others.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.title ? ` · ${esc(c.title)}` : ''}</option>`).join('')}</select></label>
        <menu class="confirm-dialog-actions">
          <button value="cancel" class="btn btn-ghost btn-sm" type="submit">Cancel</button>
          <button value="ok" class="btn btn-danger btn-sm" type="submit">Merge</button>
        </menu>
      </form>`;
      if (typeof dlg.showModal !== 'function') { resolve(null); return; }
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        const into = dlg.returnValue === 'ok' ? (dlg.querySelector('[data-merge-into]')?.value || null) : null;
        dlg.remove();
        resolve(into);
      });
      dlg.showModal();
    });
  }

  // A contact's own activity drawer — reuses this same panel mounted as a 'contact'
  // subject (Timeline = its linked deals + notes + tasks; no nested Contacts tab).
  function openContactDrawer(contact) {
    document.querySelector('.adm-drawer[data-contact-drawer]')?.remove();
    const dlg = document.createElement('dialog');
    dlg.className = 'adm-drawer';
    dlg.setAttribute('data-contact-drawer', '');
    dlg.innerHTML = `<div class="adm-drawer-inner">
      <div class="adm-tools" style="justify-content:space-between;align-items:start">
        <div><h2 style="margin:0">${esc(contact.name)}</h2>
        <p class="muted" style="margin:2px 0 0">${esc(roleLabel(contact.role))}${contact.title ? ` · ${esc(contact.title)}` : ''}${contact.email ? ` · ${esc(contact.email)}` : ''}</p></div>
        <button class="btn btn-ghost btn-sm" data-drawer-close type="button" aria-label="Close">✕</button>
      </div>
      <div data-contact-crm></div>
    </div>`;
    if (typeof dlg.showModal !== 'function') return;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (event) => { if (event.target.closest('[data-drawer-close]')) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    mount(dlg.querySelector('[data-contact-crm]'), 'contact', contact.id);
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

      const cHist = event.target.closest('[data-crm-contact-history]');
      if (cHist) {
        const c = (body._contacts || []).find((x) => String(x.id) === String(cHist.dataset.crmContactHistory));
        if (c) openContactDrawer(c);
        return;
      }

      const del = event.target.closest('[data-crm-note-del]');
      if (del) {
        if (!(await confirmDialog('Delete this note?', { confirmText: 'Delete', danger: true }))) return;
        del.disabled = true;
        try { await api(`/api/admin/crm/notes?id=${encodeURIComponent(del.dataset.crmNoteDel)}`, { method: 'DELETE' }); load(body, subjectType, subjectId, 'notes'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); del.disabled = false; }
        return;
      }

      const cMerge = event.target.closest('[data-crm-contact-merge]');
      if (cMerge) {
        const fromId = cMerge.dataset.crmContactMerge;
        const others = (body._contacts || []).filter((x) => String(x.id) !== String(fromId));
        if (!others.length) { body.insertAdjacentHTML('beforeend', errRow('No other contact to merge into.')); return; }
        const intoId = await pickMergeTarget(others);
        if (!intoId) return;
        try { await api('/api/admin/crm/contacts', { method: 'POST', body: { action: 'merge', from_id: fromId, into_id: intoId } }); load(body, subjectType, subjectId, 'contacts'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
        return;
      }

      const cDel = event.target.closest('[data-crm-contact-del]');
      if (cDel) {
        if (!(await confirmDialog('Delete this contact?', { confirmText: 'Delete', danger: true }))) return;
        cDel.disabled = true;
        try { await api(`/api/admin/crm/contacts?id=${encodeURIComponent(cDel.dataset.crmContactDel)}`, { method: 'DELETE' }); load(body, subjectType, subjectId, 'contacts'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); cDel.disabled = false; }
        return;
      }

      const cPrim = event.target.closest('[data-crm-contact-primary-set]');
      if (cPrim) {
        cPrim.disabled = true;
        try { await api('/api/admin/crm/contacts', { method: 'POST', body: { id: cPrim.dataset.crmContactPrimarySet, is_primary: true } }); load(body, subjectType, subjectId, 'contacts'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); cPrim.disabled = false; }
        return;
      }

      const cEdit = event.target.closest('[data-crm-contact-edit]');
      if (cEdit) {
        const c = (body._contacts || []).find((x) => String(x.id) === String(cEdit.dataset.crmContactEdit));
        const form = panel.querySelector('[data-crm-contact-form]');
        if (!c || !form) return;
        form.querySelector('[data-crm-contact-name]').value = c.name || '';
        form.querySelector('[data-crm-contact-role]').value = c.role || 'other';
        form.querySelector('[data-crm-contact-title]').value = c.title || '';
        form.querySelector('[data-crm-contact-email]').value = c.email || '';
        form.querySelector('[data-crm-contact-phone]').value = c.phone || '';
        form.querySelector('[data-crm-contact-primary]').checked = !!c.is_primary;
        form.dataset.editId = c.id;
        form.querySelector('[data-crm-contact-submit]').textContent = 'Save contact';
        form.scrollIntoView({ block: 'nearest' });
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

    panel.addEventListener('change', async (event) => {
      const imp = event.target.closest('[data-crm-contact-import]');
      if (!imp || !imp.files || !imp.files[0]) return;
      const file = imp.files[0];
      imp.disabled = true;
      try {
        const csv = await file.text();
        const res = await api('/api/admin/crm/contacts', { method: 'POST', body: { action: 'import', company_id: subjectId, csv } });
        await load(body, subjectType, subjectId, 'contacts');
        body.insertAdjacentHTML('afterbegin', `<p class="adm-status" data-state="ok">Imported ${res.inserted}, skipped ${res.skipped}.</p>`);
      } catch (err) {
        body.insertAdjacentHTML('beforeend', errRow(err.data?.error));
      }
      imp.value = '';
      imp.disabled = false;
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
      } else if (form.matches('[data-crm-contact-form]')) {
        const name = form.querySelector('[data-crm-contact-name]').value.trim();
        if (!name) return;
        const payload = {
          company_id: subjectId,
          name,
          role: form.querySelector('[data-crm-contact-role]').value,
          title: form.querySelector('[data-crm-contact-title]').value.trim() || null,
          email: form.querySelector('[data-crm-contact-email]').value.trim() || null,
          phone: form.querySelector('[data-crm-contact-phone]').value.trim() || null,
          is_primary: form.querySelector('[data-crm-contact-primary]').checked,
        };
        if (form.dataset.editId) payload.id = form.dataset.editId;
        try { await api('/api/admin/crm/contacts', { method: 'POST', body: payload }); load(body, subjectType, subjectId, 'contacts'); }
        catch (err) { body.insertAdjacentHTML('beforeend', errRow(err.data?.error)); }
      }
    });

    show('timeline');
  }

  return { mount };
}
