#!/usr/bin/env node
/**
 * tools/build-reviews.mjs — collect approved-review aggregates into data/reviews.json,
 * keyed "<kind>:<sku>" -> { avg, count }. seo-inject.mjs reads this tracked snapshot to
 * bake static AggregateRating JSON-LD into product and service pages at build time,
 * before any client JS runs.
 *
 * Reads the site's own public endpoint rather than Supabase. GET /api/reviews returns
 * `stats: { avg, count, dist }` computed by aggregateStats() in functions/_lib/reviews.js
 * with the same Math.round((sum / count) * 10) / 10 this file used to apply itself, and
 * the Worker filters to status = 'approved' server-side.
 *
 * That keeps the service-role key where the architecture puts it. Approved reviews are
 * already public — functions/api/reviews.js serves them to any browser — but the
 * credential that reads the table belongs to the Worker runtime, not to a public repo's
 * build. tests/github-pages-deploy.test.mjs holds that boundary by forbidding
 * SUPABASE_SERVICE_ROLE_KEY anywhere in the deploy workflow.
 *
 * Best-effort by design: any failure writes `{}` and exits 0, so a CI run never breaks
 * over review metadata. The log line distinguishes the outcomes, because an empty snapshot
 * from "no reviews yet" and one from "could not reach the site" look identical on disk.
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "data/reviews.json";
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

function baseUrl() {
  const configured = String(process.env.REVIEWS_BASE_URL || process.env.APP_URL || "").trim();
  try {
    return new URL(configured || "https://masest.co").origin;
  } catch {
    return "https://masest.co";
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Products are keyed by catalog slug, which is what seo-inject's commerceSku() resolves to
// and what data-sku carries on the rendered review widget.
export function reviewTargets() {
  const products = readJson("data/catalog.seed.json")?.products || [];
  const services = readJson("data/services.json")?.services || [];
  return [
    ...products.map((product) => ({ kind: "product", sku: String(product?.slug || "").trim() })),
    ...services.map((service) => ({ kind: "service", sku: String(service?.sku || "").trim() })),
  ].filter((target) => target.sku);
}

async function fetchStats(origin, { kind, sku }) {
  const url = `${origin}/api/reviews?kind=${encodeURIComponent(kind)}&sku=${encodeURIComponent(sku)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // An unpublished or unknown SKU is a 404 and simply has no ratings to bake.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const payload = await response.json();
  const count = Number(payload?.stats?.count);
  const avg = Number(payload?.stats?.avg);
  if (!Number.isFinite(count) || count < 1) return null;
  if (!Number.isFinite(avg) || avg < 1 || avg > 5) return null;
  return { avg, count };
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

export async function main() {
  const origin = baseUrl();
  const targets = reviewTargets();
  if (!targets.length) {
    writeFileSync(OUT, "{}\n");
    console.log("build-reviews: no catalog targets, wrote empty snapshot");
    return;
  }

  const stats = await mapWithLimit(targets, CONCURRENCY, (target) => fetchStats(origin, target));
  const snapshot = {};
  targets.forEach((target, index) => {
    const entry = stats[index];
    if (entry) snapshot[`${target.kind}:${target.sku}`] = entry;
  });

  const ordered = {};
  for (const key of Object.keys(snapshot).sort()) ordered[key] = snapshot[key];
  writeFileSync(OUT, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`build-reviews: wrote ${Object.keys(ordered).length} aggregates from ${targets.length} targets at ${origin}`);
}

// Importers (tests) get the pieces; running the file does the work.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Never fail the build over review metadata.
    writeFileSync(OUT, "{}\n");
    console.log("build-reviews: could not reach the reviews API, wrote empty snapshot:", error?.message || error);
  });
}
