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

export function openReservedTab() {
  const tab = window.open('about:blank', '_blank');
  try { if (tab) tab.opener = null; } catch {}
  return tab;
}

export function sendReservedTab(tab, url) {
  if (tab) tab.location.href = safeUrl(url);
  else location.href = safeUrl(url);
}

export function closeReservedTab(tab) {
  try { tab?.close(); } catch {}
}

export const money = (n, c = 'USD') => `${String(c || 'USD').toUpperCase()} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Full-row substring search, memoized by object identity. Admin search inputs
// already lowercase q; API refreshes replace row objects and naturally expire cache entries.
const rowSearchCache = new WeakMap();
export const rowMatchesQuery = (row, q) => {
  if (!q) return true;
  if (row === null || typeof row !== 'object') return String(row ?? '').toLowerCase().includes(q);
  let text = rowSearchCache.get(row);
  if (text === undefined) {
    text = JSON.stringify(row).toLowerCase();
    rowSearchCache.set(row, text);
  }
  return text.includes(q);
};

export const fmtDate = (s) => {
  const date = new Date(s);
  const time = date.getTime();
  if (!Number.isFinite(time) || time <= 86400000) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const fmtDT = (s) => {
  const date = new Date(s);
  const time = date.getTime();
  if (!Number.isFinite(time) || time <= 86400000) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const dateTime = (s) => {
  if (!s) return '';
  const date = new Date(s);
  const time = date.getTime();
  return Number.isFinite(time) && time > 86400000 ? date.toLocaleString() : '';
};

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

// Native dialogs usually return focus to the invoking control, but that behavior becomes
// unreliable when the dialog is removed inside its close handler. Register this before
// showModal() so every close path (button, Esc, or programmatic close) restores the exact
// trigger after the dialog has left the DOM.
export const restoreFocusOnClose = (dialog, trigger = document.activeElement) => {
  if (!dialog) return;
  const target = trigger instanceof HTMLElement ? trigger : null;
  dialog.addEventListener('close', () => {
    requestAnimationFrame(() => {
      if (target?.isConnected && !target.matches(':disabled, [hidden], [aria-hidden="true"]')) {
        target.focus({ preventScroll: true });
      }
    });
  }, { once: true });
};

let confirmDialogId = 0;

// Accessible replacement for window.confirm(): a focus-trapped, Esc-dismissable native
// <dialog>. Returns Promise<boolean>. The message is set via textContent (no HTML
// injection). Falls back to window.confirm() where <dialog> is unsupported.
export const confirmDialog = (message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) =>
  new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    const dialogId = `confirm-dialog-${++confirmDialogId}`;
    dlg.className = 'confirm-dialog';
    dlg.setAttribute('aria-labelledby', `${dialogId}-title`);
    dlg.setAttribute('aria-describedby', `${dialogId}-message`);
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
        <h2 class="sr-only" id="${dialogId}-title">Confirm action</h2>
        <p class="confirm-dialog-msg" id="${dialogId}-message"></p>
        <menu class="confirm-dialog-actions">
          <button value="cancel" class="btn btn-ghost btn-sm" type="submit">${esc(cancelText)}</button>
          <button value="confirm" class="btn btn-sm${danger ? ' btn-danger' : ''}" type="submit">${esc(confirmText)}</button>
        </menu>
      </form>`;
    dlg.querySelector('.confirm-dialog-msg').textContent = message;
    if (typeof dlg.showModal !== 'function') { resolve(window.confirm(message)); return; }
    document.body.appendChild(dlg);
    restoreFocusOnClose(dlg);
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
  restoreFocusOnClose(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ---- Toast notifications (non-blocking alert replacement) ---- */

// Non-blocking replacement for window.alert(): drops a transient message into a
// shared aria-live region (created on first use) and auto-dismisses it. The
// message is set via textContent — never innerHTML — so it is injection-safe;
// embedded "\n" render as line breaks via `white-space: pre-line` on .toast-msg.
// `variant` ('error' | 'warning' | 'success' | 'info') drives colour and announce
// priority: 'error' is assertive (role=alert), the rest are polite (role=status).
// Returns a dismiss() that removes the toast early (also fired by the × button,
// auto-timeout, and paused while the pointer hovers the toast).
let toastRegion = null;
export const toast = (message, { variant = 'info', duration = 6000 } = {}) => {
  if (!toastRegion) {
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRegion);
  }

  const node = document.createElement('div');
  node.className = `toast toast-${variant}`;
  node.setAttribute('role', variant === 'error' ? 'alert' : 'status');

  const msg = document.createElement('p');
  msg.className = 'toast-msg';
  msg.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';

  node.append(msg, close);
  toastRegion.appendChild(node);

  let timer = null;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    node.classList.add('is-leaving');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 320); // fallback when no transition runs (reduced motion)
  };
  const arm = () => { if (duration) timer = setTimeout(dismiss, duration); };

  close.addEventListener('click', dismiss);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', arm);
  requestAnimationFrame(() => node.classList.add('is-shown'));
  arm();
  return dismiss;
};
