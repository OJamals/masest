import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COMPANY_IDENTITY,
  organizationJsonLd,
  validateCompanyIdentity,
} from "../tools/company-identity.mjs";
import {
  validateUpdateMediaReview,
} from "../tools/update-media-policy.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const updateSourceRoot = process.env.MASEST_UPDATE_SOURCE_ROOT
  || join(homedir(), "Desktop", "masest", "updates");
const updateSourceOptions = existsSync(updateSourceRoot)
  ? { sourceRoot: updateSourceRoot }
  : {};

test("company identity has one legal owner, domain, sales route, and no unconfirmed street address", () => {
  assert.doesNotThrow(() => validateCompanyIdentity(COMPANY_IDENTITY));
  assert.equal(COMPANY_IDENTITY.legal_name, "MASEST Consulting LLC");
  assert.equal(COMPANY_IDENTITY.website, "https://masest.co/");
  assert.equal(COMPANY_IDENTITY.primary_contact.email, "sales@masest.co");
  assert.equal(COMPANY_IDENTITY.location.locality, "Merritt Island");
  assert.equal(COMPANY_IDENTITY.street_address.status, "withheld_pending_confirmation");
  assert.equal(COMPANY_IDENTITY.street_address.value, null);

  const org = organizationJsonLd();
  assert.equal(org.name, COMPANY_IDENTITY.legal_name);
  assert.equal(org.url, COMPANY_IDENTITY.website);
  assert.equal(org.contactPoint.email, COMPANY_IDENTITY.primary_contact.email);
  assert.equal(org.contactPoint.telephone, COMPANY_IDENTITY.primary_contact.phone_e164);
  assert.equal(org.address, undefined);
  assert.doesNotMatch(org.description, /HMIS|safe|non[- ]toxic|certif/i);

  for (const file of ["about.html", "contact.html"]) {
    const html = read(file);
    for (const contact of COMPANY_IDENTITY.named_contacts) {
      assert.match(html, new RegExp(contact.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(html, new RegExp(contact.phone_display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("all generated organization schema uses the controlled neutral identity", () => {
  const expected = JSON.stringify(organizationJsonLd());
  const findControlledOrganization = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findControlledOrganization(item);
        if (found) return found;
      }
      return null;
    }
    if (!value || typeof value !== "object") return null;
    if (value["@type"] === "Organization" && value.contactPoint) return value;
    for (const item of Object.values(value)) {
      const found = findControlledOrganization(item);
      if (found) return found;
    }
    return null;
  };
  const expectedOrganization = JSON.parse(expected);
  for (const file of ["index.html", "about.html", "contact.html", "industries/marine.html", "blog.html"]) {
    const schemas = [...read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => JSON.parse(match[1]));
    const actual = findControlledOrganization(schemas);
    assert.ok(actual, `${file}: controlled organization schema`);
    const { "@context": _context, ...actualOrganization } = actual;
    assert.deepEqual(actualOrganization, expectedOrganization, `${file}: exact controlled identity`);
  }
});

test("customer content preserves the owner-approved VertKleen HMIS claim", () => {
  const { blog_posts: posts } = JSON.parse(read("data/content/blog.json"));
  const explainer = posts.find(({ slug }) => slug === "hmis-000-explained");
  assert.ok(explainer, "HMIS explainer remains published");
  assert.match(
    explainer.body,
    /Every VertKleen product MASEST offers is rated HMIS 0-0-0\./,
  );
});

test("August media rights are approved and complete product photos receive controlled placement", () => {
  const review = JSON.parse(read("data/update-media-review.json"));
  const records = validateUpdateMediaReview(review, updateSourceOptions);

  assert.equal(records.length, 15);
  assert.deepEqual(review.review_control.rights_approval, {
    owner: "MASEST Consulting LLC",
    approved_by_role: "Owner",
    approved_on: "2026-08-22",
    ownership_status: "approved",
    customer_permission: "approved",
    media_release: "approved",
    scope: "All hash-pinned candidate_media source bytes in revision 1.3",
  });
  assert.equal(new Set(records.map(({ source_sha256 }) => source_sha256)).size, 15);
  const recordsById = Object.fromEntries(records.map((record) => [record.candidate_id, record]));
  for (const id of ["MAS-UPD-MEDIA-013", "MAS-UPD-MEDIA-014", "MAS-UPD-MEDIA-015"]) {
    assert.equal(recordsById[id].asset_class, "generated_marketing_image");
    assert.equal(recordsById[id].generator, "Meta AI Vanguard");
    assert.match(recordsById[id].generation_date, /^2026-07-\d{2}T\d{2}:\d{2}:\d{2}$/);
  }
  for (const record of records) {
    assert.ok(Array.isArray(record.missing));
    assert.equal(record.missing.includes("customer_permission"), false);
    assert.equal(record.missing.includes("media_release"), false);
    assert.match(record.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(record.width > 0 && record.height > 0);
  }
  assert.equal(recordsById["MAS-UPD-MEDIA-001"].status, "approved_for_public_use");
  assert.equal(recordsById["MAS-UPD-MEDIA-001"].public_url, "/img/updates/vertkleen-product-lineup.webp");
  assert.match(recordsById["MAS-UPD-MEDIA-001"].caption, /MultiWash/);
  assert.equal(recordsById["MAS-UPD-MEDIA-002"].status, "approved_for_brand_library");
  assert.equal(recordsById["MAS-UPD-MEDIA-012"].status, "approved_for_public_use");
  assert.equal(recordsById["MAS-UPD-MEDIA-012"].public_url, "/img/updates/vertkleen-hvac-hcr-5gal.webp");
  for (const id of ["MAS-UPD-MEDIA-001", "MAS-UPD-MEDIA-012"]) {
    const record = recordsById[id];
    assert.equal(record.storage_path, record.public_url);
    assert.match(record.public_sha256, /^[a-f0-9]{64}$/);
    assert.ok(record.approved_usage?.trim());
  }
  for (const record of records.filter(({ missing }) => missing.length)) {
    assert.equal(record.status, "restricted_pending_metadata");
    assert.equal("public_url" in record, false);
    assert.equal("storage_path" in record, false);
  }
});

test("generated marketing images require AI provenance and cannot masquerade as field evidence", () => {
  const review = JSON.parse(read("data/update-media-review.json"));
  const records = validateUpdateMediaReview(review);
  const generated = records.filter(({ asset_class }) => asset_class === "generated_marketing_image");

  assert.equal(generated.length, 3);
  for (const record of generated) {
    assert.deepEqual(record.missing, ["approved_usage"]);
    assert.equal(record.synthetic_disclosure, "AI-generated; not field evidence.");
    assert.equal("capture_date" in record, false);
  }

  const missingGenerator = structuredClone(review);
  delete missingGenerator.candidate_media.find(
    ({ candidate_id }) => candidate_id === "MAS-UPD-MEDIA-013",
  ).generator;
  assert.throws(
    () => validateUpdateMediaReview(missingGenerator),
    /update_media:MAS-UPD-MEDIA-013:missing_metadata_mismatch/,
  );

  const falseFieldEvidence = structuredClone(review);
  falseFieldEvidence.candidate_media.find(
    ({ candidate_id }) => candidate_id === "MAS-UPD-MEDIA-013",
  ).capture_date = "2026-07-30T12:39:59";
  assert.throws(
    () => validateUpdateMediaReview(falseFieldEvidence),
    /update_media:MAS-UPD-MEDIA-013:generated_field_metadata_forbidden/,
  );
});

test("field-context media keeps embedded dates without inventing before-and-after proof", () => {
  const review = JSON.parse(read("data/update-media-review.json"));
  const records = validateUpdateMediaReview(review);
  const recordsById = Object.fromEntries(records.map((record) => [record.candidate_id, record]));
  const embeddedDates = {
    "MAS-UPD-MEDIA-003": "2026-07-16T09:50:26",
    "MAS-UPD-MEDIA-004": "2026-07-16T09:50:34",
    "MAS-UPD-MEDIA-005": "2026-07-28T10:34:49",
    "MAS-UPD-MEDIA-006": "2026-07-28T10:34:54",
    "MAS-UPD-MEDIA-007": "2026-07-28T10:38:00",
    "MAS-UPD-MEDIA-008": "2026-07-28T10:38:15",
    "MAS-UPD-MEDIA-009": "2026-07-28T10:51:05",
  };

  for (const [id, captureDate] of Object.entries(embeddedDates)) {
    const record = recordsById[id];
    assert.equal(record.capture_date, captureDate);
    assert.equal(record.capture_date_source, "embedded image metadata");
    assert.equal(record.before_after_role, "context_only_unpaired");
    assert.equal(record.missing.includes("capture_date"), false);
    assert.equal(record.missing.includes("before_after_role"), false);
    assert.equal(record.missing.includes("product_and_job"), true);
  }
});

test("brand and product assets do not inherit field-photo metadata requirements", () => {
  const review = JSON.parse(read("data/update-media-review.json"));
  const records = validateUpdateMediaReview(review);
  const recordsById = Object.fromEntries(records.map((record) => [record.candidate_id, record]));

  assert.equal(recordsById["MAS-UPD-MEDIA-001"].asset_class, "product_photo");
  assert.deepEqual(recordsById["MAS-UPD-MEDIA-001"].missing, []);
  assert.equal(recordsById["MAS-UPD-MEDIA-002"].asset_class, "brand_asset");
  assert.deepEqual(recordsById["MAS-UPD-MEDIA-002"].missing, []);
  assert.equal(recordsById["MAS-UPD-MEDIA-012"].asset_class, "product_photo");
  assert.deepEqual(recordsById["MAS-UPD-MEDIA-012"].missing, []);

  for (const id of ["MAS-UPD-MEDIA-010", "MAS-UPD-MEDIA-011"]) {
    assert.equal(recordsById[id].before_after_role, "context_only_unpaired");
    assert.deepEqual(recordsById[id].missing, ["capture_date", "product_and_job"]);
  }
});

test("same-day HVAC correspondence remains a hash-pinned lead, not public job attribution", () => {
  const review = JSON.parse(read("data/update-media-review.json"));
  const records = validateUpdateMediaReview(review, updateSourceOptions);
  const hvacSequence = records.filter(({ candidate_id }) => (
    Number(candidate_id.slice(-3)) >= 5 && Number(candidate_id.slice(-3)) <= 9
  ));

  assert.equal(hvacSequence.length, 5);
  for (const record of hvacSequence) {
    assert.equal(record.context_confidence, "probable_not_public_authority");
    assert.match(record.context_basis, /does not identify attachment filenames/);
    assert.equal(record.missing.includes("product_and_job"), true);
  }

  if (updateSourceOptions.sourceRoot) {
    const changedContext = structuredClone(review);
    changedContext.candidate_media.find(
      ({ candidate_id }) => candidate_id === "MAS-UPD-MEDIA-005",
    ).context_source_sha256 = "0".repeat(64);
    assert.throws(
      () => validateUpdateMediaReview(changedContext, updateSourceOptions),
      /update_media:MAS-UPD-MEDIA-005:source_hash_changed/,
    );
  }
});
