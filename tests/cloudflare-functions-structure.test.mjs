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
  // Order persistence (atomic place_net_order RPC, or the legacy fallback insert) must
  // be error-checked before any success ack, and must NOT leak the raw DB message.
  assert.match(checkout, /error:\s*orderErr/);
  assert.match(checkout, /if\s*\(orderErr\s*\)\s*return\s+json\(500,\s*\{\s*error:\s*'order_persist_failed'/);
  assert.doesNotMatch(checkout, /error:\s*orderErr\.message/, "must not return the raw DB error to the client");
  // Item insert errors must be handled (masked) before returning 201.
  assert.match(checkout, /error:\s*itemsErr/);
  assert.match(checkout, /if\s*\(itemsErr\s*\)\s*return\s+json\(500,\s*\{\s*error:\s*'order_items_persist_failed'/);
  assert.ok(
    checkout.indexOf("if (itemsErr)") < checkout.indexOf("return json(201"),
    "item insert errors must be handled before returning 201"
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
