import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Every form on the site is JS/fetch-driven (no native `action`). Until the inline ES
// module binds (slow esm.sh import / JS error), a native submit would GET the field
// values — including passwords (account/admin login) and PII — into the URL (browser
// history, server access logs, Referer header). `onsubmit="return false"` blocks the
// native submit synchronously regardless of module timing; the addEventListener
// handlers still run the real logic. Guard against regressing any form.
const PAGES = ["account.html", "admin.html", "business.html", "contact.html", "newsletter.html", "dashboard.html"];

for (const page of PAGES) {
  test(`${page}: no form can native-submit (no action, onsubmit guarded)`, () => {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    const forms = html.match(/<form\b[^>]*>/g) || [];
    assert.ok(forms.length > 0, `${page} has no <form> — update PAGES if intentional`);
    for (const tag of forms) {
      assert.doesNotMatch(tag, /\baction=/i, `${page}: a form declares an action (native submit): ${tag}`);
      assert.match(tag, /onsubmit="return false"/, `${page}: unguarded form (native-GET leak risk): ${tag}`);
    }
  });
}

// The password forms specifically — the highest-severity leak.
test("login password forms are guarded (account loginForm + admin gateForm)", () => {
  const acct = readFileSync(new URL("../account.html", import.meta.url), "utf8");
  const adm = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(acct.match(/<form\b[^>]*id="loginForm"[^>]*>/)[0], /onsubmit="return false"/);
  assert.match(adm.match(/<form\b[^>]*id="gateForm"[^>]*>/)[0], /onsubmit="return false"/);
});
