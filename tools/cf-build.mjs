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
`);

console.log(`cf-build: copied ${n} static files to ${OUT}/`);
