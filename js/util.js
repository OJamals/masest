/* MASEST — shared formatting/escaping helpers for module-loaded scripts.
 * Imported by admin.js, dashboard.js, business.js, account-nav.js to avoid
 * redefining the same esc/money/date helpers in each. (Classic-loaded main.js
 * keeps its own copies since it is not an ES module.) */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (n, c = 'USD') => `${String(c || 'USD').toUpperCase()} ${Number(n || 0).toFixed(2)}`;

export const fmtDate = (s) => { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

export const fmtDT = (s) => { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export const dateTime = (s) => (s ? new Date(s).toLocaleString() : '');
