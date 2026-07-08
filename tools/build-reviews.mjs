#!/usr/bin/env node
/**
 * tools/build-reviews.mjs — pull approved-review aggregates from Supabase into
 * data/reviews.json, keyed "<kind>:<sku>" -> { avg, count }. seo-inject.mjs
 * reads this tracked snapshot to bake static AggregateRating JSON-LD into
 * product/service pages at build time, before any client JS runs.
 *
 * Best-effort: if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent (e.g. the
 * env isn't provisioned yet), or the query fails, write `{}` and exit 0 so the
 * CF build stays green.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUT = "data/reviews.json";

async function main() {
  if (!url || !key) {
    writeFileSync(OUT, "{}\n");
    console.log("build-reviews: no Supabase creds, wrote empty snapshot");
    return;
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("product_reviews")
    .select("kind,sku,rating")
    .eq("status", "approved");

  if (error) {
    writeFileSync(OUT, "{}\n");
    console.log("build-reviews: query failed, wrote empty snapshot:", error.message || error);
    return;
  }

  const byKey = {};
  for (const r of data || []) {
    const kind = r.kind === "service" ? "service" : "product";
    const sku = String(r.sku || "").trim();
    if (!sku) continue;
    const rating = Number(r.rating);
    if (!(rating >= 1 && rating <= 5)) continue;
    const k = `${kind}:${sku}`;
    (byKey[k] ||= { sum: 0, count: 0 });
    byKey[k].sum += rating;
    byKey[k].count += 1;
  }

  const snapshot = {};
  for (const k of Object.keys(byKey).sort()) {
    const e = byKey[k];
    snapshot[k] = { avg: Math.round((e.sum / e.count) * 10) / 10, count: e.count };
  }

  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`build-reviews: wrote ${Object.keys(snapshot).length} aggregates`);
}

main().catch((err) => {
  // Never fail the build over this — write empty and move on.
  writeFileSync(OUT, "{}\n");
  console.log("build-reviews: unexpected error, wrote empty snapshot:", err?.message || err);
});
