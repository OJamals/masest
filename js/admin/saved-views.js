// Saved filter views (slice 5) — name + recall a bundle of admin filter values,
// persisted per-tab in localStorage. Pure list helpers (upsert/remove/find/sanitize)
// are exported for unit testing; createSavedViews wraps them with localStorage + a
// small injected control, mirroring the quotes view-toggle injection (no admin.html edit).
import { esc } from '../util.js';

// ---- pure list helpers (no I/O) ----
export function sanitizeViews(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v.name === 'string' && v.name.trim())
    .map((v) => ({ name: v.name.trim(), filters: v.filters && typeof v.filters === 'object' ? v.filters : {} }));
}

export function upsertView(views, name, filters) {
  const nm = String(name || '').trim();
  const base = sanitizeViews(views);
  if (!nm) return base;
  const out = base.filter((v) => v.name.toLowerCase() !== nm.toLowerCase());
  out.push({ name: nm.slice(0, 60), filters: filters && typeof filters === 'object' ? filters : {} });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function removeView(views, name) {
  const nm = String(name || '').trim().toLowerCase();
  return sanitizeViews(views).filter((v) => v.name.toLowerCase() !== nm);
}

export function findView(views, name) {
  const nm = String(name || '').trim().toLowerCase();
  return sanitizeViews(views).find((v) => v.name.toLowerCase() === nm) || null;
}

// ---- DOM factory ----
export function createSavedViews({ key, getFilters, applyFilters }) {
  const LS = `masest:adm:views:${key}`;

  function read() {
    try { return sanitizeViews(JSON.parse(localStorage.getItem(LS) || '[]')); }
    catch { return []; }
  }
  function write(views) {
    try { localStorage.setItem(LS, JSON.stringify(views)); } catch { /* quota / private mode — non-fatal */ }
  }

  function options(views, selected) {
    return `<option value="">Saved views…</option>` + views
      .map((v) => `<option value="${esc(v.name)}"${v.name === selected ? ' selected' : ''}>${esc(v.name)}</option>`)
      .join('');
  }

  function refresh(box, selected) {
    const sel = box.querySelector('[data-sv-select]');
    if (sel) sel.innerHTML = options(read(), selected);
  }

  function mount(anchorEl) {
    if (!anchorEl || !anchorEl.parentElement) return;
    if (anchorEl.parentElement.querySelector('.saved-views')) return; // inject once
    const box = document.createElement('div');
    box.className = 'saved-views';
    box.innerHTML = `<select class="adm-select" data-sv-select aria-label="Saved views">${options(read(), '')}</select>
      <input class="adm-input" data-sv-name placeholder="Name this view" aria-label="Saved view name" maxlength="60">
      <button class="btn btn-ghost btn-sm" type="button" data-sv-save>Save</button>
      <button class="btn btn-ghost btn-sm" type="button" data-sv-del>Delete</button>`;
    anchorEl.parentElement.insertBefore(box, anchorEl);

    box.addEventListener('change', (event) => {
      if (!event.target.matches('[data-sv-select]')) return;
      const name = event.target.value;
      box.querySelector('[data-sv-name]').value = name;
      if (!name) return;
      const view = findView(read(), name);
      if (view) applyFilters(view.filters);
    });

    box.addEventListener('click', (event) => {
      const save = event.target.closest('[data-sv-save]');
      if (save) {
        const name = box.querySelector('[data-sv-name]').value.trim();
        if (!name) { box.querySelector('[data-sv-name]').focus(); return; }
        write(upsertView(read(), name, getFilters()));
        refresh(box, name);
        return;
      }
      const del = event.target.closest('[data-sv-del]');
      if (del) {
        const name = (box.querySelector('[data-sv-select]').value || box.querySelector('[data-sv-name]').value).trim();
        if (!name) return;
        write(removeView(read(), name));
        box.querySelector('[data-sv-name]').value = '';
        refresh(box, '');
      }
    });
  }

  return { mount };
}
