/* MASEST commerce — third-party integrations (Phase 4). Load after config.js.
 * Crisp chat loader + newsletter submit helper. Not yet wired into pages. */

// --- Crisp live chat: inject only if a Website ID is configured ---
export function loadCrisp() {
  const id = window.MASEST_CRISP_ID;
  if (!id || window.$crisp) return;
  window.$crisp = [];
  window.CRISP_WEBSITE_ID = id;
  const s = document.createElement('script');
  s.src = 'https://client.crisp.chat/l.js';
  s.async = true;
  document.head.appendChild(s);
}

// --- Newsletter: posts to our function, which subscribes via Klaviyo (private key server-side) ---
export async function subscribeNewsletter(email) {
  const clean = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('invalid_email');
  const r = await fetch('/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: clean }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || 'subscribe_failed');
  return out; // { ok: true }
}

// Expose to classic scripts (main.js footer handler calls window.MASEST.subscribeNewsletter).
if (typeof window !== 'undefined') {
  window.MASEST = Object.assign(window.MASEST || {}, { loadCrisp, subscribeNewsletter });
}

// Auto-load chat when this module is imported on a page.
if (typeof document !== 'undefined') {
  if (document.readyState !== 'loading') loadCrisp();
  else document.addEventListener('DOMContentLoaded', loadCrisp);
}
