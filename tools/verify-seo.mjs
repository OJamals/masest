#!/usr/bin/env node
/**
 * verify-seo.mjs — live SEO smoke test against a deployed site.
 *
 * Asserts, over the network, that public pages carry canonical + Open Graph
 * + Twitter Card + parseable JSON-LD, that og:image resolves (not 404), that
 * sitemap/robots serve, and that private/transactional pages are noindex.
 *
 * Usage:  node tools/verify-seo.mjs [baseUrl]   (default https://masest.co)
 * CI/preview:  node tools/verify-seo.mjs https://<branch>.masest-commerce.pages.dev
 *
 * Note: Cloudflare Pages strips `.html` to clean URLs via 308 — fetch follows
 * redirects so both `/about.html` and `/about` resolve.
 */
const BASE = (process.argv[2] || 'https://masest.co').replace(/\/$/, '');

const PUBLIC = [
  '/', '/about.html', '/contact.html', '/products.html', '/programs.html',
  '/proof.html', '/resources.html', '/industries.html',
  '/industries/oil-gas.html', '/industries/hvac-water.html',
];
const PRIVATE = ['/account.html', '/admin.html', '/dashboard.html', '/cart.html', '/order-confirmed.html'];

const get = async (p) => {
  const r = await fetch(BASE + p, { redirect: 'follow' });
  const body = r.status < 400 ? await r.text() : '';
  return { status: r.status, body };
};
const tag = (h, re) => (h.match(re) || [])[1];
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

console.log(`\n== SEO verify @ ${BASE} ==\n`);

const ogImages = new Set();
for (const p of PUBLIC) {
  const { status, body: h } = await get(p);
  if (status !== 200) { fails.push(`${p} -> HTTP ${status}`); console.log(`✗ ${p} HTTP ${status}`); continue; }
  ok(/rel="canonical"/.test(h), `${p} no canonical`);
  ok(/property="og:title"/.test(h), `${p} no og:title`);
  ok(/property="og:description"/.test(h), `${p} no og:description`);
  ok(/property="og:url"/.test(h), `${p} no og:url`);
  const img = tag(h, /property="og:image"\s+content="([^"]+)"/);
  ok(!!img, `${p} no og:image`);
  ok(img && /og-card\.png/.test(img), `${p} og:image not og-card (${img})`);
  if (img) ogImages.add(img);
  ok(/name="twitter:card"\s+content="summary_large_image"/.test(h), `${p} no twitter:card`);
  const ld = tag(h, /application\/ld\+json">([\s\S]*?)<\/script>/);
  ok(!!ld, `${p} no JSON-LD`);
  if (ld) { try { JSON.parse(ld); } catch (e) { fails.push(`${p} JSON-LD invalid: ${e.message}`); } }
  console.log(`✓ ${p}  og:image=${img ? img.split('/').pop() : '—'}`);
}

{
  const { body: h } = await get('/');
  const ld = tag(h, /application\/ld\+json">([\s\S]*?)<\/script>/);
  try {
    const types = JSON.stringify(JSON.parse(ld));
    ok(/"Organization"/.test(types), 'home JSON-LD missing Organization');
    ok(/"WebSite"/.test(types), 'home JSON-LD missing WebSite');
    console.log(`\nhome JSON-LD: Organization=${/"Organization"/.test(types)} WebSite=${/"WebSite"/.test(types)}`);
  } catch { fails.push('home JSON-LD unparseable'); }
}

for (const img of ogImages) {
  const path = new URL(img.startsWith('http') ? img : BASE + img).pathname;
  const r = await fetch(BASE + path, { method: 'HEAD', redirect: 'follow' });
  ok(r.status === 200, `og:image 404 at ${BASE + path} (${r.status})`);
  console.log(`og:image ${path} -> HTTP ${r.status}`);
}

{
  const sm = await get('/sitemap.xml');
  ok(sm.status === 200, `sitemap HTTP ${sm.status}`);
  ok(/industries\/oil-gas\.html/.test(sm.body), 'sitemap missing industry subpages');
  const rb = await get('/robots.txt');
  ok(rb.status === 200, `robots HTTP ${rb.status}`);
  console.log(`\nsitemap HTTP ${sm.status} (industries=${/industries\//.test(sm.body)}), robots HTTP ${rb.status}\n`);
}

for (const p of PRIVATE) {
  const { status, body: h } = await get(p);
  const noindex = /name="robots"\s+content="noindex/.test(h);
  ok(status === 200 && noindex, `${p} not noindex (HTTP ${status}, noindex=${noindex})`);
  console.log(`${noindex ? '✓' : '✗'} ${p} noindex=${noindex} HTTP ${status}`);
}

console.log('\n== RESULT ==');
if (fails.length) { console.log(`FAIL (${fails.length}):`); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('ALL CHECKS PASS');
