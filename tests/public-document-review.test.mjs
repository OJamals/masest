import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validatePublicDocumentReview } from "../tools/public-document-policy.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function filesUnder(path) {
  const dir = new URL(path, root);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}${entry.name}`;
    if (entry.isDirectory()) return filesUnder(`${child}/`);
    return [child];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
}

test("public PDF review ledger covers the exact current document bytes", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const documents = Array.isArray(review.documents) ? review.documents : [];
  const onDisk = filesUnder("docs/").filter((path) => path.endsWith(".pdf")).sort();
  const recorded = documents.map((document) => document.path).sort();

  assert.equal(review.reviewed_on, "2026-07-24");
  assert.match(review.scope || "", /claim/i);
  assert.deepEqual(recorded, onDisk);
  assert.equal(new Set(recorded).size, recorded.length, "document paths must be unique");

  for (const document of documents) {
    assert.match(document.sha256 || "", /^[a-f0-9]{64}$/, `${document.path} needs a SHA-256`);
    assert.equal(document.sha256, sha256(document.path), `${document.path} changed after review`);
    assert.ok(
      ["no_automated_flags", "claim_review_required", "restricted"].includes(document.status),
      `${document.path} has an invalid review status`,
    );
    assert.ok(Array.isArray(document.flags), `${document.path} needs a flags array`);
  }
});

test("restricted proof PDFs cannot re-enter public content or the Pages build", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const restricted = review.documents
    .filter((document) => document.status === "restricted")
    .map((document) => document.path)
    .sort();

  assert.deepEqual(restricted, [
    "docs/trinidad-tank-cleaning-test.pdf",
    "docs/walmart-refrigeration-case-study.pdf",
  ]);

  const publicSources = [
    "index.html",
    "proof.html",
    "data/content/proof.json",
    "supabase/seed-proof-cards.sql",
  ].map((path) => [path, read(path)]);

  for (const path of restricted) {
    for (const [source, content] of publicSources) {
      assert.doesNotMatch(content, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${source} links ${path}`);
    }
  }

  execFileSync(process.execPath, ["tools/cf-build.mjs"], {
    cwd: root,
    stdio: "pipe",
  });
  for (const path of restricted) {
    assert.equal(existsSync(new URL(`dist/${path}`, root)), false, `${path} must not publish`);
  }
  assert.equal(
    existsSync(new URL("dist/data/public-document-review.json", root)),
    false,
    "internal review ledger must not publish",
  );
});

test("Pages document policy fails closed when a reviewed PDF changes", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-document-policy-"));
  try {
    mkdirSync(join(fixture, "data"), { recursive: true });
    mkdirSync(join(fixture, "docs"), { recursive: true });
    writeFileSync(join(fixture, "docs/example.pdf"), "changed bytes");
    writeFileSync(join(fixture, "data/public-document-review.json"), JSON.stringify({
      documents: [{
        path: "docs/example.pdf",
        sha256: "0".repeat(64),
        status: "no_automated_flags",
        flags: [],
      }],
    }));

    assert.throws(
      () => validatePublicDocumentReview(fixture),
      /changed after review/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
