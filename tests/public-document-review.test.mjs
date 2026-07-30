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
import { proofCardHtml } from "../js/proof-records.js";
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

const staleVerificationStatus = new RegExp([
  "pending verification",
  "failed authentication",
  "unverified",
  "unsubstantiated",
  "verification\\x20incomplete",
  "approval is not asserted",
  "claim-review status",
  "not established",
  "reference[- ]only",
  "review gate",
  "planning brief,? not field proof",
  "no controlled reference",
  "exact-record scope",
  "evidence boundaries?",
].join("|"), "i");

function sha256(path) {
  return createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("approved PDF ledger covers the exact current document bytes", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const documents = Array.isArray(review.documents) ? review.documents : [];
  const control = review.document_control || {};
  const onDisk = filesUnder("docs/").filter((path) => path.endsWith(".pdf")).sort();
  const recorded = documents.map((document) => document.path).sort();

  assert.equal(review.reviewed_on, "2026-07-25");
  assert.ok(review.scope?.trim());
  assert.equal(control.owner, "MASEST Consulting LLC");
  assert.match(control.revision || "", /^\d+\.\d+$/);
  assert.match(control.effective_date || "", /^\d{4}-\d{2}-\d{2}$/);
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
    assert.equal(
      document.superseded_status,
      document.status === "restricted" ? "restricted" : "current",
      `${document.path} has an invalid superseded status`,
    );
    const sensitive = document.flags.some((flag) => sensitivityFlags.has(flag));
    const technicalSheet = /-(?:sds|tds)\.pdf$/i.test(document.path);
    assert.equal(
      documentDistribution(document),
      sensitive ? "internal" : technicalSheet || document.status === "restricted" ? "request_only" : "public",
      `${document.path} has a distribution inconsistent with its document class`,
    );
  }
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
    { public: 15, request_only: 30, internal: 0 },
  );
});

test("confidential sources stay excluded while published documents stay in the controlled document room", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const proof = read("proof.html");
  const home = read("index.html");
  const resources = read("resources.html");
  assert.equal(
    review.documents.some((entry) => entry.flags?.includes("confidential_customer_data")),
    false,
    "customer-confidential files belong outside the public-repository ledger",
  );
  assert.match(proof, /Distribution-center equipment degreasing/);
  assert.match(proof, /customer assessment/i);

  for (const id of ["MAS-CIP-BREWLANDO-TRIAL", "MAS-CIP-CARIB-LAB"]) {
    const document = review.documents.find((entry) => entry.document_id === id);
    assert.equal(documentDistribution(document), "public", `${id}: reviewed public source`);
    const path = new RegExp(document.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(resources, path, `${id}: controlled document-room source`);
    assert.doesNotMatch(proof, path, `${id}: proof must publish a bounded summary, not the source file`);
    assert.doesNotMatch(home, path, `${id}: home proof must link to the case summary, not the source file`);
  }
});

test("approved public evidence surfaces expose no stale verification status", () => {
  const paths = [
    "index.html",
    "products.html",
    "industries.html",
    "proof.html",
    "resources.html",
    "data/content/blog.json",
    "data/content/proof.json",
    "js/main/catalog-data.js",
    "supabase/seed-proof-cards.sql",
    ...filesUnder("blog/").filter((path) => path.endsWith(".html")),
    ...filesUnder("comparisons/").filter((path) => path.endsWith(".html")),
    ...filesUnder("industries/").filter((path) => path.endsWith(".html")),
    ...filesUnder("products/").filter((path) => path.endsWith(".html")),
  ].filter((path) => /\.(?:html|json|js|mjs|sql|md)$/i.test(path));

  for (const path of paths) {
    assert.doesNotMatch(read(path), staleVerificationStatus, `${path}: stale verification status`);
  }
});

test("public surfaces use VertKleen without source-brand attribution", () => {
  const rootHtml = readdirSync(root)
    .filter((path) => path.endsWith(".html"));
  const paths = [
    ...rootHtml,
    ...filesUnder("blog/").filter((path) => path.endsWith(".html")),
    ...filesUnder("comparisons/").filter((path) => path.endsWith(".html")),
    ...filesUnder("industries/").filter((path) => path.endsWith(".html")),
    ...filesUnder("products/").filter((path) => path.endsWith(".html")),
    "data/catalog.seed.json",
    "data/products.seed.json",
    "data/content/blog.json",
    "data/content/proof.json",
    "data/industry-applications.json",
    "js/main/catalog-data.js",
    "js/main/chrome.js",
    "supabase/seed-proof-cards.sql",
    "tools/build-blog.mjs",
    "tools/gen_industries.mjs",
    "tools/seo-inject.mjs",
  ];

  for (const path of paths) {
    const source = read(path).replace(/"source"\s*:\s*"[^"]*"/g, "");
    assert.doesNotMatch(source, /SynTech|SynClean/, `${path}: source-brand vocabulary`);
  }
  const publicCopy = paths.map(read).join("\n");
  assert.match(publicCopy, /VertKleen/);
  assert.doesNotMatch(read("products/hcr.html"), /SynTech|SynClean/);
  assert.doesNotMatch(read("products/cr.html"), /SynTech|SynClean/);
});

test("proof cards expose conversion records without approval-process copy", () => {
  const cards = JSON.parse(read("data/content/proof.json")).proof_cards;
  const authorityProofSlugs = new Set(
    JSON.parse(read("data/public-document-review.json")).documents
      .flatMap((document) => document.authority_records || [])
      .map((record) => record.proof_slug),
  );
  const proof = read("proof.html");
  const seed = read("supabase/seed-proof-cards.sql");

  assert.doesNotMatch(proof, /data-source-doc=/, "unused source-file attributes must not expose internal provenance");
  assert.doesNotMatch(proof, /class="(?:doc-link|doc-badge|proof-doc-link)"/, "proof must not expose source-file affordances");
  assert.equal((proof.match(/data-proof-card/g) || []).length, cards.length);
  assert.equal((proof.match(/class="case-disclosure"/g) || []).length, cards.length);
  assert.doesNotMatch(proof, /not performance proof|unsubstantiated|not established/i);

  for (const card of cards) {
    assert.equal(card.href, undefined, `${card.slug}: proof-card payload must not expose a source URL`);
    assert.equal(card.boundary, undefined, `${card.slug}: obsolete evidence boundary must stay removed`);
    assert.equal(
      card.publication_scope,
      authorityProofSlugs.has(card.slug) ? "Published product record" : "Published result summary",
      `${card.slug}: public record label must match its proof class`,
    );
    assert.ok(card.narrative?.trim(), `${card.slug}: narrative required`);
    assert.match(card.source, /record|assessment|laboratory/i, `${card.slug}: source class required`);
    assert.doesNotMatch(
      `${card.eyebrow} ${card.chips.join(" ")} ${card.narrative} ${card.publication_scope} ${card.source}`,
      /signed|authenticated|verified/i,
      `${card.slug}: approval-process language must stay out of marketing copy`,
    );
    assert.ok(proof.includes(card.title), `${card.slug}: fallback title must match the snapshot`);
    assert.ok(proof.includes(card.result), `${card.slug}: fallback result must match the snapshot`);
    assert.ok(proof.includes(card.narrative), `${card.slug}: fallback narrative must match the snapshot`);
    assert.ok(proof.includes(card.publication_scope), `${card.slug}: fallback publication scope must match the snapshot`);
    assert.ok(proof.includes(card.source), `${card.slug}: fallback source must match the snapshot`);
    assert.ok(seed.includes(card.title), `${card.slug}: CMS seed title must match the snapshot`);
    assert.ok(seed.includes(card.result), `${card.slug}: CMS seed result must match the snapshot`);
    assert.ok(seed.includes(card.narrative), `${card.slug}: CMS seed narrative must match the snapshot`);
    assert.ok(seed.includes(card.publication_scope), `${card.slug}: CMS seed publication scope must match the snapshot`);
    assert.ok(seed.includes(card.source), `${card.slug}: CMS seed source must match the snapshot`);
    assert.doesNotMatch(`${card.result} ${card.narrative}`, staleVerificationStatus, `${card.slug}: stale copy`);
  }
});

test("exact-product authority records remain versioned internally and map only to their products", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const cards = JSON.parse(read("data/content/proof.json")).proof_cards;
  const guide = review.documents.find((document) => document.document_id === "MAS-VK-WS60-CR-GUIDE");
  const label = review.documents.find((document) => document.document_id === "MAS-VK-CR-LABEL");
  const authorityRecords = review.documents.flatMap((document) => (
    (document.authority_records || []).map((record) => ({ ...record, source_version: document.source_version }))
  ));

  assert.equal(guide.source_version, "1.4 revised 2026-02-04");
  assert.deepEqual(guide.skus, ["VK-WS60", "VK-CR", "VK-CR2"]);
  assert.equal(label.source_version, "FB label variant modified 2025-08-20");
  assert.deepEqual(
    authorityRecords
      .map((record) => [
        record.record_id, record.type, record.product, record.sku,
        record.proof_slug, record.statement, record.source_version,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      ["MAS-AUTH-VK-CR-NAOH-40", "equivalency", "cr", "VK-CR", "cr-caustic-replacement",
        "Direct replacement for 40% sodium hydroxide.", "1.4 revised 2026-02-04"],
      ["MAS-AUTH-VK-CR-NAOH-50", "equivalency", "cr", "VK-CR", "cr-caustic-replacement",
        "Replacement for 50% caustic soda.", "FB label variant modified 2025-08-20"],
      ["MAS-AUTH-VK-CR2-NAOH-60", "equivalency", "cr2", "VK-CR2", "cr2-caustic-replacement",
        "Direct replacement for 60% sodium hydroxide.", "1.4 revised 2026-02-04"],
      ["MAS-AUTH-VK-WS60-NSF60", "certification", "watersafe60", "VK-WS60", "watersafe60-nsf60",
        "NSF/ANSI/CAN 60 certified for the listed potable-water and water-system uses.",
        "1.4 revised 2026-02-04"],
    ],
  );

  const mappedCards = cards.filter((card) => card.publication_scope === "Published product record");
  assert.deepEqual(
    mappedCards.map((card) => card.slug),
    [
      "cr-caustic-replacement",
      "cr2-caustic-replacement",
      "watersafe60-nsf60",
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(mappedCards),
    /"(?:source_version|document_id|record_type|products)"\s*:|docs\/|\.pdf|40%|50%/,
    "public proof payload must omit internal source mechanics and conflicting CR concentrations",
  );
  assert.doesNotMatch(
    JSON.stringify(mappedCards),
    /controlled product record|concentration-matched qualification/i,
    "public proof copy must sell the bounded next step without internal control language",
  );
  assert.match(mappedCards.find((card) => card.slug === "cr2-caustic-replacement").result, /60%/);
  assert.match(mappedCards.find((card) => card.slug === "watersafe60-nsf60").result, /NSF\/ANSI\/CAN 60/);

  const productSlugs = ["cr", "cr2", "watersafe60"];
  const proofByProduct = new Map(authorityRecords.map((record) => [record.product, record.proof_slug]));
  const proofSlugs = productSlugs.map((product) => proofByProduct.get(product));
  for (const product of productSlugs) {
    const page = read(`products/${product}.html`);
    const ownSlug = proofByProduct.get(product);
    assert.match(page, new RegExp(`href="\\.\\.\\/proof#${ownSlug}"`), `${product}: mapped proof link`);
    for (const otherSlug of proofSlugs.filter((slug) => slug !== ownSlug)) {
      assert.doesNotMatch(page, new RegExp(`proof#${otherSlug}`), `${product}: unrelated proof link`);
    }
  }
  for (const path of filesUnder("products/").filter((path) => path.endsWith(".html"))) {
    if (productSlugs.some((product) => path === `products/${product}.html`)) continue;
    for (const proofSlug of proofSlugs) {
      assert.doesNotMatch(read(path), new RegExp(`proof#${proofSlug}`), `${path}: unrelated proof link`);
    }
  }
});

test("exact-product authority metadata is bounded, mapped, escaped, and backward-compatible", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-authority-policy-"));
  const pdf = "%PDF-1.4\nauthority fixture";
  const proof = {
    proof_cards: [{
      slug: "example-record",
      publication_scope: "Published product record",
    }],
  };
  const record = {
    record_id: "MAS-AUTH-VK-EXAMPLE",
    type: "equivalency",
    product: "example",
    sku: "VK-EXAMPLE",
    proof_slug: "example-record",
    statement: "Bounded exact-product equivalency.",
  };
  const review = {
    document_control: {
      owner: "MASEST Consulting LLC",
      revision: "1.0",
      effective_date: "2026-07-27",
    },
    distribution_policy: {
      public_rule: "Published documents.",
      request_only_rule: "Technical documents by request.",
      internal_rule: "Sensitive documents stay internal.",
    },
    documents: [{
      path: "docs/example-sds.pdf",
      sha256: sha256Bytes(pdf),
      status: "restricted",
      flags: [],
      document_id: "MAS-VK-EXAMPLE",
      title: "Example",
      skus: ["VK-EXAMPLE"],
      source: "sds/example.pdf",
      source_sha256: "0".repeat(64),
      source_version: "1.0",
      authority_records: [record],
      superseded_status: "restricted",
    }],
  };
  const writeReview = (value) => writeFileSync(
    join(fixture, "data/public-document-review.json"),
    JSON.stringify(value),
  );

  try {
    mkdirSync(join(fixture, "data/content"), { recursive: true });
    mkdirSync(join(fixture, "docs"), { recursive: true });
    writeFileSync(join(fixture, "docs/example-sds.pdf"), pdf);
    writeFileSync(join(fixture, "data/content/proof.json"), JSON.stringify(proof));
    writeReview(review);
    assert.doesNotThrow(() => validatePublicDocumentReview(fixture));

    writeFileSync(join(fixture, "data/content/proof.json"), JSON.stringify({
      proof_cards: [...proof.proof_cards, {
        slug: "orphan-record",
        publication_scope: "Published product record",
      }],
    }));
    assert.throws(
      () => validatePublicDocumentReview(fixture),
      /authority proof cards do not match controlled records/,
    );
    writeFileSync(join(fixture, "data/content/proof.json"), JSON.stringify(proof));

    writeReview({
      ...review,
      documents: [{
        ...review.documents[0],
        authority_records: [{ ...record, statement: "x".repeat(241) }],
      }],
    });
    assert.throws(() => validatePublicDocumentReview(fixture), /invalid authority record/);

    writeReview({
      ...review,
      documents: [{
        ...review.documents[0],
        source_version: "x".repeat(101),
      }],
    });
    assert.throws(() => validatePublicDocumentReview(fixture), /invalid authority record control/);

    const legacyDocument = { ...review.documents[0] };
    delete legacyDocument.source_version;
    delete legacyDocument.authority_records;
    writeReview({ ...review, documents: [legacyDocument] });
    assert.doesNotThrow(() => validatePublicDocumentReview(fixture));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const escaped = proofCardHtml({
    slug: 'record"><script>alert(1)</script>',
    title: "<b>Unsafe</b>",
    result: "Result & scope",
    narrative: "<img src=x onerror=alert(1)>",
    publication_scope: "Published product record",
    source: "Source: controlled product record",
  });
  assert.doesNotMatch(escaped, /<script|<b>Unsafe|<img src=x/i);
  assert.match(escaped, /&lt;b&gt;Unsafe&lt;\/b&gt;/);
  assert.match(escaped, /Result &amp; scope/);
});

test("industry case-study routes link to approved proof summaries, not source reports", () => {
  const page = read("industries/breweries-distilleries-wineries.html");

  assert.match(page, /href="\.\.\/proof#brewery-cip-trials"/);
  assert.match(page, /Brewery CIP case summary/);
  assert.doesNotMatch(page, /href="\.\.\/docs\/(?:brewery-cip-trial-brewlando|carib-brewery-lab-report)\.pdf"/);
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
  assert.equal(documentDistribution({
    path: "docs/restricted-guide.pdf",
    status: "restricted",
    flags: [],
  }), "request_only");
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

test("public document room indexes every current PDF by ID and revision without governance chrome", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const resources = read("resources.html");
  const listedDocuments = review.documents.filter((entry) => documentDistribution(entry) !== "internal");

  assert.doesNotMatch(resources, /doc-governance|Distribution revision|Effective<\/span>/);

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
      new RegExp(`${id}[^<]*· Rev ${review.document_control.revision.replace(".", "\\.")}[^<]*· SKUs: ${document.skus.join(", ")}`),
      `${document.path} needs concise document control`,
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
      assert.match(link, new RegExp(`${document.document_id}[^<]*· Rev ${review.document_control.revision.replace(".", "\\.")}[^<]*· SKUs:`), `${page} PDF link needs concise control`);
      assert.doesNotMatch(link, /Distribution:|Claims:|Approved|Authenticated|Signed|Verified/i);
    }
    for (const request of html.matchAll(/<button\b[^>]*data-document-request[^>]*>[\s\S]*?<\/button>/g)) {
      const id = request[0].match(/data-document-id="([^"]+)"/)?.[1];
      const document = review.documents.find((entry) => entry.document_id === id);
      assert.equal(document && documentDistribution(document), "request_only", `${page} requests unavailable document ${id}`);
      assert.doesNotMatch(request[0], /href=|docs\/|\.pdf/i, `${page} request control leaks a file path`);
    }
  }
});

test("public marketing surfaces avoid unsupported ingestion guarantees", () => {
  const paths = [
    "index.html",
    "products.html",
    "proof.html",
    "resources.html",
    ...filesUnder("products/").filter((path) => path.endsWith(".html")),
    ...filesUnder("industries/").filter((path) => path.endsWith(".html")),
    "data/content/proof.json",
    "js/main/catalog-data.js",
  ];
  const unsupportedFoodClaim = /safe to ingest|safe if (?:eaten|consumed)|drops? (?:end up|land) in food|splash(?:es)? in food/i;
  for (const path of paths) {
    assert.doesNotMatch(read(path), unsupportedFoodClaim, `${path}: unsupported ingestion claim`);
  }
});

test("approved documents publish while technical sheets remain request-only", () => {
  const review = JSON.parse(read("data/public-document-review.json"));
  const publicDocuments = review.documents
    .filter((document) => documentDistribution(document) === "public")
    .map((document) => document.path)
    .sort();
  const requestOnly = review.documents
    .filter((document) => documentDistribution(document) === "request_only")
    .map((document) => document.path)
    .sort();

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
  for (const path of publicDocuments) {
    assert.match(read("resources.html"), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
    for (const path of requestOnly) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), false, `${path} must remain request-only`);
    }
    for (const path of publicDocuments) {
      assert.equal(existsSync(new URL(`dist/${path}`, root)), true, `${path} must publish`);
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
