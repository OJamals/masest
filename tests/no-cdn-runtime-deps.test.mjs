import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Critical client JS must not import from a third-party CDN at runtime: an esm.sh 503
// outage took down all auth site-wide. Supabase is self-hosted in vendor/.
const AUTH = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
const BUNDLE = readFileSync(new URL("../vendor/supabase-js.esm.js", import.meta.url), "utf8");

test("js/auth.js imports supabase from the local vendor bundle, not a CDN", () => {
  assert.match(AUTH, /from ['"]\.\.\/vendor\/supabase-js\.esm\.js['"]/);
  // No import statement may pull from a third-party CDN host (a comment mentioning one is fine).
  const importLines = AUTH.match(/^\s*import[^\n]*$/gm) || [];
  for (const line of importLines) {
    assert.doesNotMatch(line, /esm\.sh|cdn\.jsdelivr|unpkg\.com|skypack|https?:\/\//, `CDN import: ${line}`);
  }
});

test("vendored supabase bundle is self-contained (no external/relative CDN imports)", () => {
  assert.match(BUNDLE, /export\s*\{[^}]*createClient/); // exports the API we use
  const imports = BUNDLE.match(/(?:^|[;\s])import[^;]*?["'][^"']+["']/g) || [];
  for (const imp of imports) {
    assert.doesNotMatch(imp, /https?:\/\/|\/npm\//, `bundle has an external import: ${imp}`);
  }
});
