import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");

test("admin controls keep consistent action spacing and touch rhythm", () => {
  assert.match(
    html,
    /\.adm-main :where\(\.adm-tools, \.adm-inline-actions, \.company-detail-actions, \.company-user-actions, \.account-filterbar, \.crm-inbox-tools\)\s*\{[^}]*row-gap:\s*10px;[^}]*column-gap:\s*10px;/,
    "dense admin action groups should keep usable row and column gaps",
  );
  assert.match(
    html,
    /\.adm-main :where\(\.crm-tabs, \.pipe-toggle, \.saved-views\)\s*\{[^}]*gap:\s*10px;/,
    "admin tabs and saved-view bars should not collapse into 4px spacing",
  );
  assert.match(
    html,
    /\.adm-main table\.adm \.link-name\s*\{[^}]*min-height:\s*36px;/,
    "link-style table buttons should still have a visible hit area",
  );
  assert.match(
    html,
    /\.company-bulk-tools\s*\{[^}]*align-items:\s*center;[^}]*padding:\s*8px 0;/s,
    "business approval bulk controls should sit centered in the toolbar",
  );
  assert.match(
    html,
    /\.company-bulk-tools \.admin-select-all\s*\{[^}]*min-height:\s*40px;[^}]*padding:\s*0 2px;/s,
    "the select-all label should match the height of the adjacent approve button",
  );
});

test("admin detail rows and compact forms keep label/value separation", () => {
  assert.match(
    html,
    /#companyDetail \.dash-row,[\s\S]*#admReviews \.dash-row\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*14px;/,
    "company, account, and review detail rows should render as separated label/value rows",
  );
  assert.match(
    html,
    /\.account-detail \.adm-form-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    "the account detail drawer should not inherit the six-column admin form grid",
  );
  assert.match(
    html,
    /@media \(max-width:\s*720px\)[\s\S]*\.account-detail \.adm-form-grid \{\s*grid-template-columns:\s*1fr;/,
    "the compact account form should collapse back to one column on mobile",
  );
});

test("admin file, locale, and reply controls have enough intrinsic width", () => {
  assert.match(
    html,
    /\.product-cms-image\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*center;/,
    "product CMS image controls should fill the media column",
  );
  assert.match(
    html,
    /#contentLocale\s*\{\s*min-width:\s*112px;\s*\}/,
    "the content locale select should fit the English locale label",
  );
});
