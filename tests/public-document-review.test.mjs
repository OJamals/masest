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

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("public PDF review ledger covers the exact current document bytes", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const documents = Array.isArray(review.documents) ? review.documents : [];
  const control = review.document_control || {};
  const onDisk = filesUnder("docs/").filter((path) => path.endsWith(".pdf")).sort();
  const recorded = documents.map((document) => document.path).sort();

  assert.equal(review.reviewed_on, "2026-07-24");
  assert.match(review.scope || "", /claim/i);
  assert.equal(control.owner, "MASEST Consulting LLC");
  assert.match(control.revision || "", /^\d+\.\d+$/);
  assert.match(control.effective_date || "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(control.approval || "", /customer review/i);
  assert.match(control.approval_scope || "", /distribution/i);
  assert.deepEqual(recorded, onDisk);
  assert.equal(new Set(recorded).size, recorded.length, "document paths must be unique");

  const documentIds = new Set();
  for (const document of documents) {
    assert.match(document.sha256 || "", /^[a-f0-9]{64}$/, `${document.path} needs a SHA-256`);
    assert.equal(document.sha256, sha256(document.path), `${document.path} changed after review`);
    assert.match(document.source_sha256 || "", /^[a-f0-9]{64}$/, `${document.path} needs a source SHA-256`);
    assert.match(document.document_id || "", /^MAS-[A-Z0-9-]+$/, `${document.path} needs a document ID`);
    assert.ok(!documentIds.has(document.document_id), `${document.document_id} must be unique`);
    documentIds.add(document.document_id);
    assert.ok(document.title?.trim(), `${document.path} needs a title`);
    assert.ok(Array.isArray(document.skus) && document.skus.length, `${document.path} needs at least one SKU`);
    assert.ok(document.source?.trim(), `${document.path} needs source provenance`);
    assert.ok(
      ["no_automated_flags", "claim_review_required", "restricted"].includes(document.status),
      `${document.path} has an invalid review status`,
    );
    assert.ok(Array.isArray(document.flags), `${document.path} needs a flags array`);
    assert.equal(
      document.superseded_status,
      document.status === "restricted" ? "restricted" : "current",
      `${document.path} has an invalid superseded status`,
    );
  }
});

test("customer-facing PDFs embed the approved document-control record", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const control = review.document_control;
  const publicDocuments = review.documents.filter((document) => document.status !== "restricted");

  for (const document of publicDocuments) {
    const bytes = readFileSync(new URL(document.path, root)).toString("latin1");
    const marker = [
      "% MASEST-CONTROL",
      `ID=${document.document_id}`,
      `REV=${control.revision}`,
      `EFFECTIVE=${control.effective_date}`,
      "STATUS=CURRENT",
      "APPROVAL=CUSTOMER-REVIEW",
      "OWNER=MASEST-CONSULTING-LLC",
    ].join(" ");
    assert.match(bytes, new RegExp(marker), `${document.path} needs embedded document control`);
  }
});

test("public document room indexes every current PDF by ID and revision", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const resources = read("resources.html");
  const publicDocuments = review.documents.filter((entry) => entry.status !== "restricted");

  assert.match(resources, new RegExp(review.document_control.owner));
  assert.match(resources, new RegExp(review.document_control.revision.replace(".", "\\.")));
  assert.match(resources, /July 24, 2026/);

  for (const document of publicDocuments) {
    const path = document.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const id = String(document.document_id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const skus = document.skus.join(" ");
    const link = new RegExp(
      `<a[^>]+href="${path}"[^>]+data-document-id="${id}"[^>]+data-document-revision="${review.document_control.revision}"[^>]+data-document-skus="${skus}"`,
    );
    assert.match(resources, link, `${document.path} needs a controlled document-room entry`);
    assert.match(
      resources,
      new RegExp(`${id}[^<]*· Rev ${review.document_control.revision.replace(".", "\\.")}[^<]*· Distribution: Current[^<]*· Claims: (?:Review required|No automated flags)`),
      `${document.path} needs separate distribution and claim-review status`,
    );
  }

  const indexedIds = [...resources.matchAll(/data-document-id="(MAS-[A-Z0-9-]+)"/g)]
    .map((match) => match[1]);
  assert.equal(indexedIds.length, publicDocuments.length, "document room must index each current PDF once");
  assert.equal(new Set(indexedIds).size, indexedIds.length, "document room must not duplicate document IDs");
});

test("generated product and industry PDF links expose visible document control", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const reviewByPath = new Map(review.documents.map((document) => [document.path, document]));
  const pages = [
    ...filesUnder("products/").filter((path) => path.endsWith(".html")),
    ...filesUnder("industries/").filter((path) => path.endsWith(".html")),
  ];

  for (const page of pages) {
    const html = read(page);
    const pdfLinks = [...html.matchAll(/<a\b[^>]*href="\.\.\/docs\/[^"]+\.pdf"[^>]*>[\s\S]*?<\/a>/g)]
      .map((match) => match[0]);
    for (const link of pdfLinks) {
      const path = link.match(/href="\.\.\/(docs\/[^"]+\.pdf)"/)?.[1];
      const document = reviewByPath.get(path);
      assert.ok(document && document.status !== "restricted", `${page} links unavailable document ${path}`);
      assert.match(link, new RegExp(`data-document-id="${document.document_id}"`), `${page} PDF link needs its exact document ID`);
      assert.match(link, new RegExp(`data-document-revision="${review.document_control.revision.replace(".", "\\.")}"`), `${page} PDF link needs the current revision`);
      assert.match(link, /class="doc-control"/, `${page} PDF link needs visible document control`);
      assert.match(link, /Distribution: Current/, `${page} PDF link needs distribution status`);
      assert.match(link, /Claims: (?:Review required|No automated flags)/, `${page} PDF link needs claim-review status`);
    }
  }
});

test("retired restricted proof sources cannot re-enter public content or the Pages build", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const restricted = review.documents
    .filter((document) => document.status === "restricted")
    .map((document) => document.path)
    .sort();

  assert.deepEqual(restricted, []);

  const retiredPaths = [
    "docs/trinidad-tank-cleaning-test.pdf",
    "docs/walmart-refrigeration-case-study.pdf",
    "img/proof/cases/trinidad-tank-before.webp",
    "img/proof/cases/trinidad-tank-cr.webp",
    "img/proof/cases/walmart-refrigeration-results.webp",
    "img/industries/distribution-cold-storage/g3.webp",
  ];
  for (const path of retiredPaths) {
    assert.equal(existsSync(new URL(path, root)), false, `${path} must remain retired`);
  }

  const publicSources = [
    "index.html",
    "proof.html",
    "resources.html",
    "js/main/catalog-data.js",
    "products/descaler.html",
    "industries/distribution-cold-storage.html",
    "data/asset-manifest.json",
    "data/content/proof.json",
    "data/content/site-images.json",
    "data/image-optimization.json",
    "supabase/seed-proof-cards.sql",
  ].map((path) => [path, read(path)]);

  const retiredMarkers = [
    ...retiredPaths,
    "walmart-refrigeration-results",
    "trinidad-tank",
    "Case Study: Walmart Refrigeration Systems",
    "up to 94% heat-transfer efficiency",
    "Heat-transfer efficiency restored on refrigeration descaling",
  ];
  for (const marker of retiredMarkers) {
    for (const [source, content] of publicSources) {
      assert.doesNotMatch(content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${source} exposes ${marker}`);
    }
  }

  const tempFixture = new URL("tmp/cf-build-policy-fixture/restricted-proof-page.png", root);
  try {
    mkdirSync(new URL(".", tempFixture), { recursive: true });
    writeFileSync(tempFixture, "restricted derivative");
    execFileSync(process.execPath, ["tools/cf-build.mjs"], {
      cwd: root,
      stdio: "pipe",
    });
    for (const path of retiredPaths) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), false, `${path} must not publish`);
    }
    assert.equal(
      existsSync(new URL("dist/data/public-document-review.json", root)),
      false,
      "internal review ledger must not publish",
    );
    assert.equal(
      existsSync(new URL("dist/tmp/cf-build-policy-fixture/restricted-proof-page.png", root)),
      false,
      "temporary review derivatives must not publish",
    );
  } finally {
    rmSync(new URL("tmp/cf-build-policy-fixture", root), { recursive: true, force: true });
  }
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

test("document-source verification fails closed when provenance bytes change", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-document-source-policy-"));
  const sourceRoot = mkdtempSync(join(tmpdir(), "masest-document-sources-"));
  try {
    mkdirSync(join(fixture, "data"), { recursive: true });
    mkdirSync(join(fixture, "docs"), { recursive: true });
    mkdirSync(join(sourceRoot, "sds"), { recursive: true });
    const pdf = [
      "%PDF-1.4",
      "% MASEST-CONTROL ID=MAS-VK-EXAMPLE REV=1.0 EFFECTIVE=2026-07-24 STATUS=CURRENT APPROVAL=CUSTOMER-REVIEW OWNER=MASEST-CONSULTING-LLC",
    ].join("\n");
    writeFileSync(join(fixture, "docs/example.pdf"), pdf);
    writeFileSync(join(sourceRoot, "sds/example.pdf"), "changed source bytes");
    writeFileSync(join(fixture, "data/public-document-review.json"), JSON.stringify({
      document_control: {
        owner: "MASEST Consulting LLC",
        revision: "1.0",
        effective_date: "2026-07-24",
        approval: "Released for customer review",
        approval_scope: "Distribution approval only",
      },
      documents: [{
        path: "docs/example.pdf",
        sha256: sha256Bytes(pdf),
        status: "no_automated_flags",
        flags: [],
        document_id: "MAS-VK-EXAMPLE",
        title: "Example",
        skus: ["VK-EXAMPLE"],
        source: "sds/example.pdf",
        source_sha256: "0".repeat(64),
        superseded_status: "current",
      }],
    }));

    assert.throws(
      () => validatePublicDocumentReview(fixture, { sourceRoot, requireSources: true }),
      /source changed after review/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("release build regenerates controlled pages and busts the shared stylesheet cache", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts.prebuild || "", /seo-inject/);
  const pages = execFileSync("git", ["ls-files", "*.html", "**/*.html"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  for (const page of pages) {
    const html = read(page);
    if (!/css\/style\.css\?v=/.test(html)) continue;
    assert.match(html, /css\/style\.css\?v=20260724a/, `${page} needs the current stylesheet cache key`);
  }
});
