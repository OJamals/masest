#!/usr/bin/env node
/**
 * seo-inject.mjs — idempotent SEO/meta injector for the static site.
 *
 * Adds canonical, og:url/og:image, JSON-LD, and (for private pages) robots
 * directly into the committed HTML so Cloudflare Pages serves them as-is
 * (there is no build step on deploy). Re-running replaces the managed block,
 * so it is safe to run repeatedly. Run from repo root: `node tools/seo-inject.mjs`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';

const BASE = 'https://masest.co';
const OG_IMAGE = `${BASE}/img/og-card.png`; // 1200x630 social card, source: tools/og-card.html (regen: node tools/render-og.mjs)
const START = '<!-- seo:auto -->';
const END = '<!-- /seo:auto -->';

const ORG = {
  '@type': 'Organization',
  name: 'MASEST Consulting LLC',
  url: BASE + '/',
  logo: `${BASE}/img/masest-logo.png`,
  brand: 'VertKleen',
  description: 'HMIS 0-0-0 industrial cleaning chemistry — the power of acid with the safety of water.',
  areaServed: 'Worldwide',
  contactPoint: { '@type': 'ContactPoint', contactType: 'sales', url: `${BASE}/contact.html` },
};

// Public pages: indexable, get canonical + og + JSON-LD.
const PUBLIC = {
  'index.html': { loc: '/', jsonld: [ORG, { '@type': 'WebSite', name: 'MASEST VertKleen', url: BASE + '/' }] },
  'about.html': { loc: '/about.html', jsonld: [ORG] },
  'contact.html': { loc: '/contact.html', jsonld: [ORG] },
  'products.html': { loc: '/products.html', jsonld: [ORG] },
  'product.html': { loc: '/product.html', jsonld: [] },
  'programs.html': { loc: '/programs.html', jsonld: [ORG] },
  'proof.html': { loc: '/proof.html', jsonld: [ORG] },
  'resources.html': { loc: '/resources.html', jsonld: [ORG] },
  'industries.html': { loc: '/industries.html', jsonld: [ORG] },
};
for (const f of readdirSync('industries').filter((n) => n.endsWith('.html'))) {
  PUBLIC[`industries/${f}`] = { loc: `/industries/${f}`, jsonld: [ORG] };
}

// Private/transactional pages: ensure robots noindex, no canonical/og.
const PRIVATE = ['account.html', 'admin.html', 'dashboard.html', 'business.html', 'cart.html', 'order-confirmed.html', '404.html'];

const attr = (s) => String(s).replace(/"/g, '&quot;');
const pick = (html, re) => { const m = html.match(re); return m ? m[1] : null; };

function buildBlock(html, meta) {
  const title = pick(html, /<title>([^<]*)<\/title>/i) || 'MASEST VertKleen';
  const desc = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i) || '';
  const hasOgTitle = /property="og:title"/.test(html);
  const hasOgDesc = /property="og:description"/.test(html);
  const url = BASE + meta.loc;
  const lines = [START];
  lines.push(`<link rel="canonical" href="${url}">`);
  if (!hasOgTitle) lines.push(`<meta property="og:title" content="${attr(title)}">`);
  if (!hasOgDesc && desc) lines.push(`<meta property="og:description" content="${attr(desc)}">`);
  lines.push(`<meta property="og:url" content="${url}">`);
  lines.push(`<meta property="og:image" content="${OG_IMAGE}">`);
  lines.push('<meta name="twitter:card" content="summary_large_image">');
  if (meta.jsonld && meta.jsonld.length) {
    const data = meta.jsonld.length === 1
      ? { '@context': 'https://schema.org', ...meta.jsonld[0] }
      : { '@context': 'https://schema.org', '@graph': meta.jsonld };
    lines.push(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
  }
  lines.push(END);
  return lines.join('\n');
}

function stripOld(html) {
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, 'g');
  return html.replace(re, '\n');
}

let changed = 0;
async function process(file, meta, isPrivate) {
  let html = await readFile(file, 'utf8');
  const before = html;
  html = stripOld(html);
  if (isPrivate) {
    if (!/name="robots"/.test(html)) {
      html = html.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n<meta name="robots" content="noindex">`);
    }
  } else {
    const block = buildBlock(html, meta);
    html = html.replace(/<\/head>/i, `${block}\n</head>`);
  }
  if (html !== before) { await writeFile(file, html); changed++; console.log('updated', file); }
}

for (const [file, meta] of Object.entries(PUBLIC)) await process(file, meta, false);
for (const file of PRIVATE) await process(file, null, true);
console.log(`\nseo-inject: ${changed} files changed`);
