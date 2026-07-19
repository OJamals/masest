import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepo = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Cloudflare Supabase helper imports the v2 named createClient export", () => {
  const helper = readRepo("functions/_lib/supabase.js");
  assert.match(helper, /import\s+\{\s*createClient\s*\}\s+from ['"]@supabase\/supabase-js['"]/);
  assert.doesNotMatch(helper, /import\s+createClient\s+from ['"]@supabase\/supabase-js['"]/);
});

test("NET checkout does not acknowledge orders before persistence succeeds", () => {
  const checkout = readRepo("functions/api/checkout.js");
  const migration = readRepo("supabase/schema-order-integrity.sql");
  // v2 owns header, item, and stock persistence. Worker must error-check the RPC before
  // acknowledging success, fail closed when absent, and never leak the raw DB message.
  assert.match(checkout, /data:\s*placed,\s*error:\s*placeErr/);
  assert.match(checkout, /if\s*\(placeErr\s*&&\s*isMissingFunctionError\(placeErr\)\)[\s\S]*net_order_unavailable/);
  assert.match(checkout, /if\s*\(placeErr\s*\|\|[\s\S]*net_order_unavailable/);
  assert.doesNotMatch(checkout, /placeErr\.message/, "must not return the raw DB error to the client");
  assert.doesNotMatch(checkout, /from\(['"]orders['"]\)\.insert/);
  assert.doesNotMatch(checkout, /from\(['"]order_items['"]\)\.insert/);
  assert.match(migration, /function\s+public\.place_net_order_v2/i);
  assert.match(migration, /insert\s+into\s+public\.orders/i);
  assert.match(migration, /insert\s+into\s+public\.order_items/i);
  assert.ok(
    checkout.indexOf("if (placeErr ||") < checkout.indexOf("return json(placed.duplicate ? 200 : 201"),
    "RPC errors must be handled before acknowledging NET success"
  );
});

test("checkout only sells active buy-mode products with positive numeric server prices", () => {
  const checkout = readRepo("functions/api/checkout.js");
  assert.match(checkout, /Number\.isFinite\(Number\(v\.price\)\)/);
  assert.match(checkout, /v\.price\s*==\s*null/);
  assert.match(checkout, /prod\.mode\s*!==\s*'buy'/);
  assert.match(checkout, /v\.active\s*===\s*false/);
  assert.match(checkout, /prod\.active\s*===\s*false/);
});
