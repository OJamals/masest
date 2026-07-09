import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("invoice-pdf endpoint is company-scoped, invoice-gated, and QBO-degradable", () => {
  const src = read("functions/api/account/invoice-pdf.js");
  assert.match(src, /requireCompany/, "must scope to the caller's company");
  assert.match(src, /\.eq\('company_id', companyId\)/, "ownership must be enforced on the order query");
  assert.match(src, /qbo_invoice_id/, "must require an issued QuickBooks invoice");
  assert.match(src, /getAccessToken/, "must use the shared QBO token loader/refresher");
  assert.match(src, /\/pdf\?minorversion=/, "must hit the QBO invoice /pdf endpoint");
  assert.match(src, /503[\s\S]*qbo_unavailable/, "must degrade to 503 when QuickBooks is not connected");
  assert.match(src, /content-type["']?\s*:\s*["']application\/pdf/, "must return the PDF content type");
});

test("business invoicing UI offers a self-serve PDF download for issued invoices", () => {
  const src = read("js/business.js");
  assert.match(src, /data-invoice-pdf=/, "invoice rows should expose a download control");
  assert.match(src, /inv\.qbo_invoice_id \? `<button[\s\S]*data-invoice-pdf/, "download button should only render when an invoice exists");
  assert.match(src, /downloadInvoicePdf/, "a download handler should be wired");
  assert.match(src, /\/api\/account\/invoice-pdf\?id=/, "handler should call the invoice-pdf endpoint");
  assert.match(src, /Authorization['"]?\s*:\s*['"]Bearer/, "download must attach the auth header (blob fetch, not a plain link)");
  assert.doesNotMatch(src, /Need a copy of an invoice[\s\S]*Message your account team/, "the 'message us for a copy' fallback should be replaced by self-serve download");
});
