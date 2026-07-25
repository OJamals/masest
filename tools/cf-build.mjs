// Cloudflare Pages build step. Assembles a clean static publish dir (dist/) from the
// repo's tracked site files plus unignored working-tree additions, excluding backend/build
// artifacts. Including additions keeps local verification honest before files are committed.
// Pages compiles functions/ into the Worker separately, so functions are NOT copied here.
// Run by Pages as the build command: `node tools/cf-build.mjs`.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import { rewriteCmsImageReferences } from '../js/image-url.js';
import { validatePublicDocumentReview } from './public-document-policy.mjs';

const OUT = 'dist';
const restrictedPublicPaths = validatePublicDocumentReview();
const siteImageManifest = JSON.parse(readFileSync('data/content/site-images.json', 'utf8'));
const siteImagePaths = (siteImageManifest.assets || []).map((asset) => asset.public_url);
const configuredMediaBase = String(process.env.CMS_MEDIA_BASE || '').trim().replace(/\/+$/, '');
const publicSupabaseUrl = readFileSync('js/config.js', 'utf8')
  .match(/window\.MASEST_SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1]
  ?.replace(/\/+$/, '');
if (!configuredMediaBase && !publicSupabaseUrl) {
  throw new Error('CMS media base unavailable: set CMS_MEDIA_BASE or configure MASEST_SUPABASE_URL');
}
const cmsMediaBase = configuredMediaBase
  || `${publicSupabaseUrl}/storage/v1/object/public/content-assets/site`;
const rewritableExtensions = new Set(['.css', '.html', '.js', '.json', '.xml']);

// Anything matching a deny pattern is kept out of the published static root.
const DENY = [
  /^functions\//, /^supabase\//, /^tools\//, /^tests\//, /^factory\//, /^node_modules(\/|$)/,
  /^dist\//, /^tmp\//, /^audit-[^/]+\//, /^audits?\//, /^masest\.co-audit\//,
  /^\.github\//, /^\.vscode\//,
  /^package(-lock)?\.json$/, /^wrangler\.toml$/, /^\.gitignore$/,
  /\.sql$/i, /\.spec\.mjs$/i, /\.test\.mjs$/i, /\.md$/i,
  /^data\/public-document-review\.json$/,
  /^data\/industry-applications\.json$/,
  // Internal seed sources — not client assets (only data/drum-pricing.json is fetched).
  /^data\/(catalog|products)\.seed\.json$/,
];

rmSync(OUT, { recursive: true, force: true });

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
let n = 0;
let rewritten = 0;
for (const f of files) {
  if (DENY.some((r) => r.test(f))) continue;
  if (restrictedPublicPaths.has(f)) continue;
  if (!existsSync(f)) continue;
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  if (rewritableExtensions.has(extname(f).toLowerCase()) && f !== 'data/content/site-images.json') {
    const source = readFileSync(f, 'utf8');
    const compiled = rewriteCmsImageReferences(source, siteImagePaths, cmsMediaBase);
    writeFileSync(dest, compiled);
    if (compiled !== source) rewritten++;
  } else {
    copyFileSync(f, dest);
  }
  n++;
}

// Static security headers.
writeFileSync(join(OUT, '_headers'),
`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; connect-src 'self' https://*.supabase.co https://api.stripe.com https://cloudflareinsights.com https://static.cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; form-action 'self'; upgrade-insecure-requests
`);

console.log(`cf-build: copied ${n} static files to ${OUT}/; CMS media linked in ${rewritten}`);
