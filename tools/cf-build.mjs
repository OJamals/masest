// Cloudflare Pages build step. Assembles a clean static publish dir (dist/) from the
// repo's tracked site files, excluding backend/build artifacts. Pages compiles functions/
// into the Worker separately (from the repo root), so functions are NOT copied here.
// Run by Pages as the build command: `node tools/cf-build.mjs`.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = 'dist';

// Anything matching a deny pattern is kept out of the published static root.
const DENY = [
  /^functions\//, /^supabase\//, /^tools\//, /^tests\//, /^node_modules\//,
  /^dist\//, /^\.github\//, /^\.vscode\//,
  /^package(-lock)?\.json$/, /^wrangler\.toml$/, /^\.gitignore$/,
  /\.sql$/i, /\.spec\.mjs$/i, /\.test\.mjs$/i, /\.md$/i,
  // Internal seed sources — not client assets (only data/drum-pricing.json is fetched).
  /^data\/(catalog|products)\.seed\.json$/,
];

rmSync(OUT, { recursive: true, force: true });

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
let n = 0;
for (const f of files) {
  if (DENY.some((r) => r.test(f))) continue;
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
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://client.crisp.chat https://settings.crisp.chat; connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.crisp.chat https://client.crisp.chat https://settings.crisp.chat https://*.crisp.chat wss://*.crisp.chat; frame-src https://client.crisp.chat https://game.crisp.chat; form-action 'self'; upgrade-insecure-requests
`);

console.log(`cf-build: copied ${n} static files to ${OUT}/`);
