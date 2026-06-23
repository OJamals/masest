/* MASEST - shared formatting/escaping helpers for module-loaded scripts.
 * Imported by admin.js, dashboard.js, business.js, account-nav.js to avoid
 * redefining the same esc/money/date helpers in each. (Classic-loaded main.js
 * keeps its own copies since it is not an ES module.) */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Strip dangerous URL schemes before a value reaches an href/src. esc() escapes the
// attribute but does NOT stop `javascript:`/`data:` execution, so admin- or user-editable
// URLs (tracking links, notification links, product image URLs) must pass through here.
// Allows http(s), mailto, and any scheme-less (relative/anchor) URL; anything with a
// disallowed scheme collapses to '#'. Compose as esc(safeUrl(value)).
export const safeUrl = (u) => {
  const s = String(u ?? '').trim();
  if (!s) return '';
  const schemeProbe = s.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  if (/^(https?:|mailto:)/i.test(schemeProbe)) return s;   // explicitly allowed schemes
  if (/^[a-z][a-z0-9+.-]*:/i.test(schemeProbe)) return '#'; // any other scheme (javascript:, data:, vbscript:, …)
  return s;                                        // relative / anchor / path — no scheme
};

export const money = (n, c = 'USD') => `${String(c || 'USD').toUpperCase()} ${Number(n || 0).toFixed(2)}`;

export const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

export const fmtDT = (s) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export const dateTime = (s) => (s ? new Date(s).toLocaleString() : '');

/* ---- WAI-ARIA tablist keyboard pattern (#33) ---- */

// Next focus index for a roving-tabindex tablist. Returns -1 for keys we don't handle.
export const nextTabIndex = (key, current, count) => {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
};

// Roving tabindex: only the selected tab is in the tab order (tabindex 0), the rest -1.
export const rovingTabindex = (tabs, isSelected) => {
  tabs.forEach((t) => t.setAttribute('tabindex', isSelected(t) ? '0' : '-1'));
};

// Connect WAI-ARIA tabs to panels. Pages still own selected/hidden state.
export const linkTabsToPanels = (root = document, prefix = 'tab') => {
  const panels = [...root.querySelectorAll('[role="tabpanel"][data-panel]')];
  root.querySelectorAll('[role="tab"][data-tab]').forEach((tab) => {
    const panel = panels.find((p) => p.dataset.panel === tab.dataset.tab);
    if (!panel) return;
    tab.id ||= `${prefix}-${tab.dataset.tab}-tab`;
    panel.id ||= `${prefix}-${tab.dataset.tab}-panel`;
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', tab.id);
  });
};

// Arrow/Home/End navigation for a [role="tablist"]. `activate(tab)` selects it; focus
// follows. Call once per tablist after the tabs exist.
export const wireTablist = (tablist, activate) => {
  if (!tablist) return;
  tablist.addEventListener('keydown', (e) => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    const next = nextTabIndex(e.key, current, tabs.length);
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    activate?.(tabs[next]);
  });
};

// Event delegation: bind ONE listener on a stable container that dispatches to the
// nearest ancestor matching `selector`. Survives innerHTML re-renders of the rows
// (the listener lives on the container, not the rows), so it is bound once at wire
// time instead of re-bound on every render. handler(event, matchedElement).
export const delegate = (container, type, selector, handler) => {
  if (!container) return;
  container.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && container.contains(target)) handler(event, target);
  });
};

/* ---- Styled confirm dialog (#31) ---- */

// Accessible replacement for window.confirm(): a focus-trapped, Esc-dismissable native
// <dialog>. Returns Promise<boolean>. The message is set via textContent (no HTML
// injection). Falls back to window.confirm() where <dialog> is unsupported.
export const confirmDialog = (message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) =>
  new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
        <p class="confirm-dialog-msg"></p>
        <menu class="confirm-dialog-actions">
          <button value="cancel" class="btn btn-ghost btn-sm" type="submit">${esc(cancelText)}</button>
          <button value="confirm" class="btn btn-sm${danger ? ' btn-danger' : ''}" type="submit">${esc(confirmText)}</button>
        </menu>
      </form>`;
    dlg.querySelector('.confirm-dialog-msg').textContent = message;
    if (typeof dlg.showModal !== 'function') { resolve(window.confirm(message)); return; }
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'confirm'); dlg.remove(); });
    dlg.showModal();
    dlg.querySelector('button[value="confirm"]').focus();
  });

// Read-only detail modal. `html` is trusted markup the caller assembles with esc()'d
// data (admin views only). Native <dialog> — accessible, no framework. No-op on
// browsers without showModal().
export function detailDialog(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'detail-dialog';
  dlg.innerHTML = `<div class="detail-dialog-body">${html}</div>`
    + `<form method="dialog" class="detail-dialog-actions"><button class="btn btn-ghost btn-sm" value="close" type="submit">Close</button></form>`;
  if (typeof dlg.showModal !== 'function') return;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
