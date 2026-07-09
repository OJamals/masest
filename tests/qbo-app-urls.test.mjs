import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const adminJs = read("js/admin.js");

const pages = [
  {
    file: "quickbooks-launch.html",
    canonical: "https://masest.co/quickbooks-launch",
    required: [/QuickBooks launch/i, /href="account"/, /href="admin#quickbooks"/],
  },
  {
    file: "quickbooks-connect.html",
    canonical: "https://masest.co/quickbooks-connect",
    required: [/QuickBooks connect/i, /Connect QuickBooks/i, /href="admin#quickbooks"/],
  },
  {
    file: "quickbooks-disconnect.html",
    canonical: "https://masest.co/quickbooks-disconnect",
    required: [/QuickBooks disconnect/i, /connection has been disconnected/i, /href="quickbooks-connect"/],
  },
];

test("Intuit production app URLs have dedicated public landing pages", () => {
  for (const page of pages) {
    const url = new URL(`../${page.file}`, import.meta.url);
    assert.equal(existsSync(url), true, `${page.file} should exist`);
    const html = read(page.file);

    assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical}">`));
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /js\/main\.js/);
    assert.doesNotMatch(html, /\/api\/admin\/qbo\/connect/, "Intuit-facing URL should not be the staff-only OAuth endpoint");

    for (const pattern of page.required) assert.match(html, pattern);
  }
});

test("admin supports QuickBooks deep links from Intuit landing pages", () => {
  assert.match(adminJs, /tab === 'quickbooks'/);
  assert.match(adminJs, /scrollIntoView/);
  assert.match(adminJs, /admQbo/);
});
