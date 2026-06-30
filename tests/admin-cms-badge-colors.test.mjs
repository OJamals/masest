import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("CMS workflow statuses are colour-coded in the admin badge map, not left grey", () => {
  const html = read("admin.html");

  // published (success) and scheduled (accent) were already covered; in_review and
  // changes_requested fell through to the neutral default and rendered identical grey.
  assert.match(html, /\.badge\[data-s="changes_requested"\][^{]*\{[^}]*--status-danger/, "changes_requested should read as a problem state (danger)");
  assert.match(html, /\.badge\[data-s="in_review"\][^{]*\{[^}]*--status-warning/, "in_review should read as needs-attention (warning)");
  assert.match(html, /\.badge\[data-s="published"\][^{]*\{[^}]*--status-success/, "published stays success");
  assert.match(html, /\.badge\[data-s="scheduled"\][^{]*\{[^}]*--accent/, "scheduled stays accent");
});
