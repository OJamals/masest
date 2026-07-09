import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("resale-cert endpoint is company-scoped and uses a PRIVATE bucket with signed access", () => {
  const src = read("functions/api/account/resale-cert.js");
  assert.match(src, /requireCompany/, "must scope to the caller's company");
  assert.match(src, /const BUCKET = 'resale-certs'/, "must target the resale-certs bucket");
  assert.match(src, /object\/sign\/\$\{BUCKET\}/, "must hand out signed URLs, not public links");
  assert.match(src, /resale_cert_path/, "must persist the private storage path");
  assert.match(src, /`\$\{companyId\}\/cert-/, "upload path must be scoped under the company id");
  assert.match(src, /onRequestPost/, "must accept uploads");
  assert.match(src, /onRequestDelete/, "must allow removing the certificate");
  assert.match(src, /ALLOWED[\s\S]*application\/pdf/, "must validate file type");
  // The private object must never be written to a public bucket path.
  assert.doesNotMatch(src, /object\/public\//, "must not expose the certificate via a public URL");
});

test("admin company detail signs the private cert path for staff (no public link)", () => {
  const src = read("functions/api/admin/company.js");
  assert.match(src, /resale_cert_path/, "must select the private path");
  assert.match(src, /object\/sign\/resale-certs/, "must produce a signed URL for staff");
  assert.match(src, /resale_cert_signed_url/, "must expose the signed URL to the admin UI");
});

test("business form offers a private certificate upload beside the URL field", () => {
  const src = read("js/business.js");
  assert.match(src, /id="resaleCertFile"/, "must render a file input");
  assert.match(src, /accept="application\/pdf,image\/png,image\/jpeg,image\/webp"/, "file input should constrain types");
  assert.match(src, /wireResaleCert/, "upload must be wired");
  assert.match(src, /\/api\/account\/resale-cert/, "must call the resale-cert endpoint");
  assert.match(src, /Authorization['"]?\s*:\s*['"]Bearer/, "multipart upload must attach the auth header");
  // Upload control only appears once a company exists (endpoint needs requireCompany).
  assert.match(src, /bizFields\(c \|\| \{\}, !isCreate\)/, "upload should be gated on an existing company");
});
