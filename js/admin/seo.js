// Admin SEO-audit tab (#36 per-tab split). Fetches each marketing page and reports
// title/description presence. Guards re-run via the shared `state.loaded` set, so
// `state` and the `$` lookup are injected; `esc` comes from the shared util module.
import { esc } from '../util.js';

export function createSeoAudit({ $, state }) {
  return async function runSeoAudit() {
    if (state.loaded.has('seo')) return;
    const box = $('admSeo');
    const pages = ['index.html', 'products.html', 'programs.html', 'industries.html', 'about.html', 'contact.html'];
    const rows = await Promise.all(pages.map(async (page) => {
      try {
        const html = await (await fetch('/' + page, { cache: 'no-store' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const title = (doc.querySelector('title')?.textContent || '').trim();
        const desc = (doc.querySelector('meta[name="description"]')?.content || '').trim();
        return { page, title: title.length, desc: desc.length, ok: title && desc };
      } catch {
        return { page, ok: false };
      }
    }));
    box.innerHTML = `<h2>SEO audit</h2><div class="seo-audit-list">${rows.map((row) => `
      <div class="seo-audit-row">
        <b class="seo-audit-page">${esc(row.page)}</b>
        <span class="seo-audit-status ${row.ok ? 'seo-ok' : 'seo-bad'}">${row.ok ? 'OK' : 'Check'}</span>
        <span class="seo-audit-meta muted">title ${esc(row.title || 0)} / desc ${esc(row.desc || 0)}</span>
      </div>
    `).join('')}</div>`;
    state.loaded.add('seo');
  };
}
