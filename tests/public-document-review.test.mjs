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

import {
  documentDistribution,
  validatePublicDocumentReview,
} from "../tools/public-document-policy.mjs";
import { STYLE_VERSION } from "../tools/static-release.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const sensitivityFlags = new Set([
  "confidential_customer_data",
  "personal_contact",
  "named_approval",
  "commercial_terms",
  "publication_permission_missing",
]);

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

  assert.equal(review.reviewed_on, "2026-07-25");
  assert.match(review.scope || "", /claim/i);
  assert.match(review.claim_disposition?.review_scope || "", /not technical or legal substantiation/i);
  assert.match(review.claim_disposition?.reference_only_rule || "", /cannot substantiate public copy/i);
  assert.match(review.claim_disposition?.resource_only_rule || "", /exclude from product and industry pages/i);
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
      ["no_automated_flags", "reference_only", "resource_only", "restricted"].includes(document.status),
      `${document.path} has an invalid review status`,
    );
    assert.ok(Array.isArray(document.flags), `${document.path} needs a flags array`);
    if (["reference_only", "resource_only"].includes(document.status)) {
      assert.ok(document.flags.length, `${document.path}: bounded status needs flagged claims`);
    }
    assert.equal(
      document.superseded_status,
      document.status === "restricted" ? "restricted" : "current",
      `${document.path} has an invalid superseded status`,
    );
    const sensitive = document.flags.some((flag) => sensitivityFlags.has(flag));
    const technicalSheet = /-(?:sds|tds)\.pdf$/i.test(document.path);
    assert.equal(
      documentDistribution(document),
      sensitive ? "internal" : technicalSheet ? "request_only" : document.status === "restricted" ? "internal" : "public",
      `${document.path} has a distribution inconsistent with its document class`,
    );
  }
  assert.equal(
    documents.filter((document) => document.status === "claim_review_required").length,
    0,
    "claim review queue must have an explicit disposition",
  );
  assert.deepEqual(
    Object.fromEntries(["no_automated_flags", "reference_only", "resource_only", "restricted"]
      .map((status) => [status, documents.filter((document) => document.status === status).length])),
    { no_automated_flags: 13, reference_only: 5, resource_only: 9, restricted: 18 },
  );
  assert.deepEqual(
    Object.fromEntries(["public", "request_only", "internal"]
      .map((distribution) => [
        distribution,
        documents.filter((document) => documentDistribution(document) === distribution).length,
      ])),
    { public: 15, request_only: 22, internal: 8 },
  );
});

test("confidential sources stay outside the public repository while reviewed sources stay public", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const proof = read("proof.html");
  assert.equal(
    review.documents.some((entry) => entry.flags?.includes("confidential_customer_data")),
    false,
    "customer-confidential files belong outside the public-repository ledger",
  );
  assert.match(proof, /Distribution-center degreasing assessment/);
  assert.match(proof, /restricted customer assessment; sanitized public summary/i);

  for (const id of ["MAS-CIP-BREWLANDO-TRIAL", "MAS-CIP-CARIB-LAB"]) {
    const document = review.documents.find((entry) => entry.document_id === id);
    assert.equal(document.status, "reference_only", `${id}: claim boundary`);
    assert.equal(documentDistribution(document), "public", `${id}: reviewed public source`);
    assert.match(proof, new RegExp(document.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("proof cards expose only public references, sanitized summaries, or context-only field media", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const cards = JSON.parse(read("data/content/proof.json")).proof_cards;
  const proof = read("proof.html");
  const seed = read("supabase/seed-proof-cards.sql");
  const contextSource = "Source: public field context; verification incomplete";
  let contextCount = 0;

  assert.doesNotMatch(proof, /data-source-doc=/, "unused source-file attributes must not expose internal provenance");

  for (const card of cards) {
    assert.ok(proof.includes(card.title), `${card.slug}: fallback title must match the snapshot`);
    assert.ok(proof.includes(card.result), `${card.slug}: fallback boundary must match the snapshot`);
    assert.ok(proof.includes(card.source), `${card.slug}: fallback source must match the snapshot`);
    assert.ok(seed.includes(card.title), `${card.slug}: CMS seed title must match the snapshot`);
    assert.ok(seed.includes(card.result), `${card.slug}: CMS seed boundary must match the snapshot`);
    assert.ok(seed.includes(card.source), `${card.slug}: CMS seed source must match the snapshot`);

    if (card.href) {
      const document = review.documents.find((entry) => entry.path === card.href);
      assert.equal(document?.status, "reference_only", `${card.slug}: linked proof must be reference-only`);
      assert.equal(documentDistribution(document), "public", `${card.slug}: linked proof must be public`);
      assert.match(card.source, /public reference document/i);
    } else if (card.slug === "distribution-center-assessment") {
      assert.match(card.source, /sanitized public summary/i);
      assert.match(card.result, /does not assert endorsement or verified performance/i);
    } else {
      contextCount += 1;
      assert.equal(card.source, contextSource, `${card.slug}: field media must stay context-only`);
      assert.match(card.result, /not performance(?: or savings)? proof/i, `${card.slug}: field boundary missing`);
    }
  }

  assert.equal(contextCount, 10, "all non-document field records must stay context-only");
});

test("sensitivity flags fail closed even when a record is misclassified", () => {
  assert.equal(documentDistribution({
    path: "docs/customer-record.pdf",
    status: "no_automated_flags",
    flags: ["confidential_customer_data"],
  }), "internal");
  assert.equal(documentDistribution({
    path: "docs/sds/customer-record-sds.pdf",
    status: "reference_only",
    flags: ["personal_contact"],
  }), "internal");
});

test("technical-document sync uploads and activates current files before retiring stale rows", () => {
  const source = read("tools/public-document-policy.mjs");
  const uploadAt = source.indexOf('.from("technical-documents")');
  const activateAt = source.indexOf('.from("technical_documents")\n    .upsert');
  const retireAt = source.indexOf(".update({ active: false");

  assert.ok(uploadAt > 0, "private-bucket upload must exist");
  assert.ok(activateAt > uploadAt, "catalog activation must follow successful uploads");
  assert.ok(retireAt > activateAt, "stale rows must retire only after current catalog activation");
  assert.match(source, /storagePath: `\$\{documentType\(document\)\}\/\$\{document\.document_id\}\/\$\{revision\}-\$\{document\.sha256\}\.pdf`/,
    "storage objects must be immutable per document revision and bytes");
});

test("customer-facing PDFs embed the approved document-control record", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const control = review.document_control;
  const publicDocuments = review.documents.filter((document) => documentDistribution(document) === "public");

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
  const listedDocuments = review.documents.filter((entry) => documentDistribution(entry) !== "internal");

  assert.match(resources, new RegExp(review.document_control.owner));
  assert.match(resources, new RegExp(review.document_control.revision.replace(".", "\\.")));
  assert.match(resources, /July 24, 2026/);

  for (const document of listedDocuments) {
    const path = document.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const id = String(document.document_id || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const skus = document.skus.join(" ");
    if (documentDistribution(document) === "request_only") {
      const request = new RegExp(
        `<button[^>]+data-document-request[^>]+data-document-id="${id}"[^>]+data-document-revision="${review.document_control.revision}"[^>]+data-document-skus="${skus}"`,
      );
      assert.match(resources, request, `${document.path} needs a controlled request entry`);
      assert.doesNotMatch(resources, new RegExp(`href="${path}"`), `${document.path} must not expose a public URL`);
    } else {
      const link = new RegExp(
        `<a[^>]+href="${path}"[^>]+data-document-id="${id}"[^>]+data-document-revision="${review.document_control.revision}"[^>]+data-document-skus="${skus}"`,
      );
      assert.match(resources, link, `${document.path} needs a controlled document-room entry`);
    }
    assert.match(
      resources,
      new RegExp(`${id}[^<]*· Rev ${review.document_control.revision.replace(".", "\\.")}[^<]*· Distribution: (?:Current|Request only)[^<]*· Claims: (?:Reference only - flagged claims unsubstantiated|Document room only - not proof|No automated flags|Restricted - named approval required)`),
      `${document.path} needs separate distribution and claim-review status`,
    );
  }

  const indexedIds = [...resources.matchAll(/data-document-id="(MAS-[A-Z0-9-]+)"/g)]
    .map((match) => match[1]);
  assert.equal(indexedIds.length, listedDocuments.length, "document room must index each available PDF once");
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
      assert.ok(
        document && documentDistribution(document) === "public",
        `${page} links unavailable document ${path}`,
      );
      assert.match(link, new RegExp(`data-document-id="${document.document_id}"`), `${page} PDF link needs its exact document ID`);
      assert.match(link, new RegExp(`data-document-revision="${review.document_control.revision.replace(".", "\\.")}"`), `${page} PDF link needs the current revision`);
      assert.match(link, /class="doc-control"/, `${page} PDF link needs visible document control`);
      assert.match(link, /Distribution: Current/, `${page} PDF link needs distribution status`);
      assert.match(link, /Claims: (?:Reference only - flagged claims unsubstantiated|No automated flags)/, `${page} PDF link needs claim-review status`);
    }
    for (const request of html.matchAll(/<button\b[^>]*data-document-request[^>]*>[\s\S]*?<\/button>/g)) {
      const id = request[0].match(/data-document-id="([^"]+)"/)?.[1];
      const document = review.documents.find((entry) => entry.document_id === id);
      assert.equal(document && documentDistribution(document), "request_only", `${page} requests unavailable document ${id}`);
      assert.doesNotMatch(request[0], /href=|docs\/|\.pdf/i, `${page} request control leaks a file path`);
    }
  }
});

test("restricted claim sources cannot re-enter public content or the Pages build", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const resourceOnly = review.documents
    .filter((document) => document.status === "resource_only")
    .map((document) => document.path)
    .sort();
  const restricted = review.documents
    .filter((document) => document.status === "restricted")
    .map((document) => document.path)
    .sort();
  const requestOnly = review.documents
    .filter((document) => documentDistribution(document) === "request_only")
    .map((document) => document.path)
    .sort();

  assert.deepEqual(restricted, [
    "docs/sds/vertkleen-cr-label.pdf",
    "docs/sds/vertkleen-cr-tds.pdf",
    "docs/sds/vertkleen-crhd-tds.pdf",
    "docs/sds/vertkleen-crs-label.pdf",
    "docs/sds/vertkleen-descaler-tds.pdf",
    "docs/sds/vertkleen-hcr-descaler-userguide.pdf",
    "docs/sds/vertkleen-hcr-label.pdf",
    "docs/sds/vertkleen-hcr-tds.pdf",
    "docs/sds/vertkleen-lam3-tds.pdf",
    "docs/sds/vertkleen-multiwash-label.pdf",
    "docs/sds/vertkleen-multiwash-tds.pdf",
    "docs/sds/vertkleen-neutral-tds.pdf",
    "docs/sds/vertkleen-purgo-label.pdf",
    "docs/sds/vertkleen-sar-label.pdf",
    "docs/sds/vertkleen-sar-tds.pdf",
    "docs/sds/vertkleen-torque-tds.pdf",
    "docs/sds/watersafe60-cr-nsf60-user-guide.pdf",
    "docs/sds/watersafe60-tds.pdf",
  ]);
  assert.deepEqual(resourceOnly, [
    "docs/sds/vertkleen-cooling-tower-brochure.pdf",
    "docs/sds/vertkleen-crhd-label.pdf",
    "docs/sds/vertkleen-descaler-label.pdf",
    "docs/sds/vertkleen-lam3-label-back.pdf",
    "docs/sds/vertkleen-lam3-label-front.pdf",
    "docs/sds/vertkleen-neutral-label.pdf",
    "docs/sds/vertkleen-purgo-101.pdf",
    "docs/sds/vertkleen-purgo-base-data.pdf",
    "docs/sds/vertkleen-torque-label.pdf",
  ]);

  const retiredPaths = [
    "docs/trinidad-tank-cleaning-test.pdf",
    "img/proof/cases/trinidad-tank-before.webp",
    "img/proof/cases/trinidad-tank-cr.webp",
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
    "data/content/proof.json",
    "data/content/site-images.json",
    "supabase/seed-proof-cards.sql",
    ...filesUnder("products/").filter((path) => path.endsWith(".html")),
    ...filesUnder("industries/").filter((path) => path.endsWith(".html")),
  ].map((path) => [path, read(path)]);
  for (const path of restricted) {
    for (const [source, content] of publicSources) {
      assert.doesNotMatch(content, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${source} exposes ${path}`);
    }
  }
  const proofSources = publicSources.filter(([source]) => source !== "resources.html");
  for (const path of resourceOnly) {
    assert.match(read("resources.html"), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const [source, content] of proofSources) {
      assert.doesNotMatch(content, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${source} exposes ${path}`);
    }
  }

  const retiredMarkers = [
    ...retiredPaths,
    "trinidad-tank",
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
    for (const path of restricted) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), false, `${path} must not publish`);
    }
    for (const path of requestOnly) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), false, `${path} must remain request-only`);
    }
    for (const path of resourceOnly) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), true, `${path} must remain in document room`);
    }
    assert.match(
      read("dist/industries/marine.html"),
      /storage\/v1\/object\/public\/content-assets\/site\/img\/industries\/marine\/g1\.webp/,
      "owner-approved field context must publish through CMS media",
    );
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
  }).trim().split("\n").filter((page) => page && existsSync(new URL(page, root)));
  for (const page of pages) {
    const html = read(page);
    if (!/css\/style\.css\?v=/.test(html)) continue;
    assert.match(
      html,
      new RegExp(`css/style\\.css\\?v=${STYLE_VERSION}`),
      `${page} needs the current stylesheet cache key`,
    );
  }
});
