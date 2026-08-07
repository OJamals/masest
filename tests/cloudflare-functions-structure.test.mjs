import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepo = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Cloudflare Supabase helper imports the v2 named createClient export", () => {
  const helper = readRepo("functions/_lib/supabase.js");
  assert.match(helper, /import\s+\{\s*createClient\s*\}\s+from ['"]@supabase\/supabase-js['"]/);
  assert.doesNotMatch(helper, /import\s+createClient\s+from ['"]@supabase\/supabase-js['"]/);
});

test("the public checkout endpoint acknowledges no order it did not persist", () => {
  const checkout = readRepo("functions/api/checkout.js");
  const migration = readRepo("supabase/schema-order-integrity.sql");
  // Online checkout hands off to Stripe and the paid order is written by the webhook, so
  // the endpoint must never write an order itself nor report one as placed.
  assert.doesNotMatch(checkout, /from\(['"]orders['"]\)\.insert/);
  assert.doesNotMatch(checkout, /from\(['"]order_items['"]\)\.insert/);
  assert.doesNotMatch(checkout, /\.rpc\(\s*['"]place_net_order/, "no NET ledger RPC may run here");
  assert.doesNotMatch(checkout, /net:\s*true/, "the endpoint must not acknowledge an on-account order");
  // The atomic ledger RPC still backs staff-raised NET orders, so its migration stands.
  assert.match(migration, /function\s+public\.place_net_order_v2/i);
  assert.match(migration, /insert\s+into\s+public\.orders/i);
  assert.match(migration, /insert\s+into\s+public\.order_items/i);
});

test("checkout only sells active buy-mode products with positive numeric server prices", () => {
  const checkout = readRepo("functions/api/checkout.js");
  assert.match(checkout, /Number\.isFinite\(Number\(v\.price\)\)/);
  assert.match(checkout, /v\.price\s*==\s*null/);
  assert.match(checkout, /prod\.mode\s*!==\s*'buy'/);
  assert.match(checkout, /v\.active\s*===\s*false/);
  assert.match(checkout, /prod\.active\s*===\s*false/);
});
