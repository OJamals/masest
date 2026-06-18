import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepo = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Netlify Supabase helper imports the v2 named createClient export", () => {
  const helper = readRepo("netlify/lib/supabase.js");
  assert.match(helper, /import\s+\{\s*createClient\s*\}\s+from ['"]@supabase\/supabase-js['"]/);
  assert.doesNotMatch(helper, /import\s+createClient\s+from ['"]@supabase\/supabase-js['"]/);
});

test("NET checkout does not acknowledge orders before persistence succeeds", () => {
  const checkout = readRepo("netlify/functions/checkout.js");
  assert.match(checkout, /data:\s*order,\s*error:\s*orderErr/);
  assert.match(checkout, /if\s*\(orderErr\s*\)\s*return\s+json\(500,\s*\{\s*error:\s*orderErr\.message/);
  assert.match(checkout, /error:\s*itemsErr/);
  assert.match(checkout, /if\s*\(itemsErr\s*\)\s*return\s+json\(500,\s*\{\s*error:\s*itemsErr\.message/);
  assert.ok(
    checkout.indexOf("if (itemsErr)") < checkout.indexOf("return json(201"),
    "item insert errors must be handled before returning 201"
  );
});

test("checkout only sells active buy-mode products with positive numeric server prices", () => {
  const checkout = readRepo("netlify/functions/checkout.js");
  assert.match(checkout, /Number\.isFinite\(Number\(v\.price\)\)/);
  assert.match(checkout, /v\.price\s*==\s*null/);
  assert.match(checkout, /prod\.mode\s*!==\s*'buy'/);
  assert.match(checkout, /v\.active\s*===\s*false/);
  assert.match(checkout, /prod\.active\s*===\s*false/);
});
