// Cloudflare Pages build step. Assembles a clean static publish dir (dist/) from the
// repo's tracked site files plus unignored working-tree additions, excluding backend/build
// artifacts. Including additions keeps local verification honest before files are committed.
// Pages compiles functions/ into the Worker separately, so functions are NOT copied here.
// Run by Pages as the build command: `node tools/cf-build.mjs`.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { validatePublicDocumentReview } from './public-document-policy.mjs';

const OUT = 'dist';
const restrictedPublicPaths = validatePublicDocumentReview();

// Anything matching a deny pattern is kept out of the published static root.
const DENY = [
  /^functions\//, /^supabase\//, /^tools\//, /^tests\//, /^factory\//, /^node_modules(\/|$)/,
  /^dist\//, /^audit-[^/]+\//, /^audits?\//, /^masest\.co-audit\//,
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
for (const f of files) {
  if (DENY.some((r) => r.test(f))) continue;
  if (restrictedPublicPaths.has(f)) continue;
  if (!existsSync(f)) continue;
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(f, dest);
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
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; connect-src 'self' https://*.supabase.co https://api.stripe.com https://cloudflareinsights.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; form-action 'self'; upgrade-insecure-requests
`);

console.log(`cf-build: copied ${n} static files to ${OUT}/`);
