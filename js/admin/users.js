// Admin Users tab — full Supabase-auth user directory with create/edit/delete,
// wired to /api/admin/users (owner-gated writes). Mirrors the other tab modules
// (createReviewsTab pattern): shared primitives injected; esc/confirmDialog/delegate
// from util.js.
import { esc, confirmDialog, delegate, dateTime as date } from '../util.js';

export function createUsersTab({ $, api, state, message, admSkeleton, admEmpty }) {
  function setStatus(text, kind) {
    const el = $('umStatus');
    if (el) { el.textContent = text || ''; el.dataset.state = kind || ''; }
  }

  function shellTemplate() {
    return `
      <div class="adm-tools">
        <input id="umSearch" class="adm-search" type="search" placeholder="Search email or name" aria-label="Search users">
        <button class="btn btn-primary btn-sm" type="button" data-um-action="new"><i class="ph ph-user-plus" aria-hidden="true"></i> New user</button>
        <span class="adm-status" id="umStatus" role="status" aria-live="polite"></span>
      </div>
      <div id="umList">${admSkeleton()}</div>`;
  }

  function row(u) {
    return `
      <tr data-um-row="${esc(u.id)}">
        <td>${esc(u.email || '')}</td>
        <td>${esc(u.full_name || '')}</td>
        <td>${esc(u.role || '—')}${u.staff_role ? ` <span class="pill">${esc(u.staff_role)}</span>` : ''}</td>
        <td>${esc(u.company_name || '—')}</td>
        <td>${u.last_sign_in_at ? esc(date(u.last_sign_in_at)) : 'never'}</td>
        <td>
          <button class="btn btn-ghost btn-sm" type="button" data-um-edit="${esc(u.id)}"><i class="ph ph-pencil-simple" aria-hidden="true"></i> Edit</button>
          <button class="btn btn-ghost btn-sm" type="button" data-um-delete="${esc(u.id)}" data-um-email="${esc(u.email || '')}"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </td>
      </tr>`;
  }

  function paint() {
    const list = $('umList');
    if (!list) return;
    const q = ($('umSearch')?.value || '').trim().toLowerCase();
    const users = (state.users || []).filter((u) => !q
      || (u.email || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q));
    if (!users.length) { list.innerHTML = admEmpty('ph-users', 'No users', q ? 'No users match that search.' : 'Create the first user.'); return; }
    list.innerHTML = `<table class="adm-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Company</th><th>Last sign-in</th><th></th></tr></thead><tbody>${users.map(row).join('')}</tbody></table>`;
  }

  async function renderUsers({ refetch = true } = {}) {
    const root = $('admUsers');
    if (!root) return;
    if (!root.dataset.mounted) { root.innerHTML = shellTemplate(); root.dataset.mounted = '1'; }
    if (refetch) {
      $('umList').innerHTML = admSkeleton();
      try { state.users = (await api('/api/admin/users')).users || []; state.loaded.add('users'); }
      catch { $('umList').innerHTML = '<p class="adm-status" data-state="err">Could not load users. Reload to retry.</p>'; return; }
    }
    paint();
  }

  function userForm(u = {}) {
    const roleOpt = (v, l) => `<option value="${v}"${(u.role || 'buyer') === v ? ' selected' : ''}>${l}</option>`;
    return `
      <form id="umForm" class="adm-form" data-um-user="${esc(u.id || '')}">
        <label>Email <input class="adm-input" name="email" type="email" value="${esc(u.email || '')}" required></label>
        ${u.id ? '' : '<label>Password <input class="adm-input" name="password" type="text" minlength="8" required placeholder="min 8 chars"></label>'}
        <label>Full name <input class="adm-input" name="full_name" type="text" value="${esc(u.full_name || '')}"></label>
        <label>Phone <input class="adm-input" name="phone" type="text" value="${esc(u.phone || '')}"></label>
        <label>Role <select class="adm-select" name="role">${roleOpt('buyer', 'Buyer')}${roleOpt('admin', 'Company admin')}</select></label>
        <label>Company ID <input class="adm-input" name="company_id" type="text" value="${esc(u.company_id || '')}" placeholder="optional — assign to a company"></label>
      </form>`;
  }

  async function openUserDialog(u = {}) {
    const dlg = document.createElement('dialog');
    dlg.className = 'adm-dialog';
    dlg.innerHTML = `<h3>${u.id ? 'Edit user' : 'New user'}</h3>${userForm(u)}
      <menu><button value="cancel" class="btn btn-ghost btn-sm">Cancel</button>
      <button value="ok" class="btn btn-primary btn-sm">${u.id ? 'Save' : 'Create'}</button></menu>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('input[name="email"]')?.focus();
    const result = await new Promise((res) => {
      dlg.addEventListener('close', () => res(dlg.returnValue === 'ok' ? Object.fromEntries(new FormData(dlg.querySelector('#umForm'))) : null), { once: true });
      dlg.querySelector('menu').addEventListener('click', (e) => { if (e.target.value) { e.preventDefault(); dlg.close(e.target.value); } });
    });
    dlg.remove();
    if (!result) return;
    setStatus(u.id ? 'Saving…' : 'Creating…');
    try {
      if (u.id) {
        await api('/api/admin/users', { method: 'POST', body: { action: 'update_user', user_id: u.id, ...result } });
      } else {
        await api('/api/admin/users', { method: 'POST', body: { action: 'create', ...result } });
      }
      setStatus(u.id ? 'User saved.' : 'User created.', 'ok');
      renderUsers({ refetch: true });
    } catch (err) {
      setStatus(err.data?.message || err.data?.error || 'Failed. Retry.', 'err');
      message?.(err.data?.message || err.data?.error || 'User action failed.', 'err');
    }
  }

  function wireUsers() {
    const root = $('admUsers');
    if (!root) return;
    delegate(root, 'input', '#umSearch', () => paint());
    delegate(root, 'click', '[data-um-action="new"]', () => openUserDialog({}));
    delegate(root, 'click', '[data-um-edit]', (e, btn) => {
      const u = (state.users || []).find((x) => x.id === btn.dataset.umEdit);
      if (u) openUserDialog(u);
    });
    delegate(root, 'click', '[data-um-delete]', async (e, btn) => {
      const email = btn.dataset.umEmail || 'this user';
      if (!(await confirmDialog(`Delete ${email}? This removes their login and profile permanently.`, { confirmText: 'Delete', danger: true }))) return;
      setStatus('Deleting…');
      try { await api('/api/admin/users', { method: 'POST', body: { action: 'delete_user', user_id: btn.dataset.umDelete } }); setStatus('User deleted.', 'ok'); renderUsers({ refetch: true }); }
      catch (err) { setStatus(err.data?.message || err.data?.error || 'Delete failed.', 'err'); }
    });
  }

  return { renderUsers, wireUsers };
}
