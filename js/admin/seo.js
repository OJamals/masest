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
    box.innerHTML = `<h2>SEO audit</h2><div class="adm-table-wrap"><table class="adm"><tbody>${rows.map((row) => `
      <tr><td>${esc(row.page)}</td><td class="${row.ok ? 'seo-ok' : 'seo-bad'}">${row.ok ? 'OK' : 'Check'}</td><td class="muted">title ${esc(row.title || 0)} / desc ${esc(row.desc || 0)}</td></tr>
    `).join('')}</tbody></table></div>`;
    state.loaded.add('seo');
  };
}
