import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REVIEW_PATH = "data/public-document-review.json";
const VALID_STATUSES = new Set([
  "no_automated_flags",
  "reference_only",
  "resource_only",
  "restricted",
]);
const DOCUMENT_ID_PATTERN = /^MAS-[A-Z0-9-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function documentClaimLabel(status) {
  if (status === "no_automated_flags") return "No automated flags";
  if (status === "reference_only") return "Reference only - flagged claims unsubstantiated";
  if (status === "resource_only") return "Document room only - not proof";
  if (status === "restricted") return "Restricted - named approval required";
  throw new Error(`Unknown document claim status: ${status}`);
}

export function documentType(document) {
  const path = String(document?.path || "");
  if (/-sds\.pdf$/i.test(path)) return "sds";
  if (/-tds\.pdf$/i.test(path)) return "tds";
  return "other";
}

export function documentDistribution(document) {
  if (["sds", "tds"].includes(documentType(document))) return "request_only";
  return document?.status === "restricted" ? "internal" : "public";
}

export function documentSurfaceMode(document, surface) {
  if (!["resource", "product", "industry"].includes(surface)) {
    throw new Error(`Unknown document surface: ${surface}`);
  }
  const distribution = documentDistribution(document);
  if (distribution === "internal") return null;
  if (distribution === "request_only") return "request";
  if (document?.status === "resource_only" && surface !== "resource") return null;
  return "download";
}

export function documentAllowedOnSurface(document, surface) {
  return documentSurfaceMode(document, surface) !== null;
}

function pdfPaths(root, dir = join(root, "docs"), paths = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) pdfPaths(root, file, paths);
    else if (entry.name.toLowerCase().endsWith(".pdf")) {
      paths.push(relative(root, file).replaceAll("\\", "/"));
    }
  }
  return paths;
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validatePublicDocumentReview(
  root = process.cwd(),
  { sourceRoot = null, requireSources = false } = {},
) {
  const review = JSON.parse(readFileSync(join(root, REVIEW_PATH), "utf8"));
  if (!Array.isArray(review.documents) || review.documents.length === 0) {
    throw new Error(`${REVIEW_PATH}: documents must be a non-empty array`);
  }

  const recorded = new Set();
  const documentIds = new Set();
  const excludedPublicPaths = new Set();
  for (const document of review.documents) {
    const path = String(document?.path || "");
    if (!/^docs\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.pdf$/i.test(path) || path.includes("\\")) {
      throw new Error(`${REVIEW_PATH}: invalid document path ${path || "(empty)"}`);
    }
    if (recorded.has(path)) {
      throw new Error(`${REVIEW_PATH}: duplicate document path ${path}`);
    }
    if (!VALID_STATUSES.has(document.status)) {
      throw new Error(`${REVIEW_PATH}: invalid status for ${path}`);
    }
    if (!SHA256_PATTERN.test(document.sha256 || "")) {
      throw new Error(`${REVIEW_PATH}: invalid SHA-256 for ${path}`);
    }
    if (!Array.isArray(document.flags)) {
      throw new Error(`${REVIEW_PATH}: flags must be an array for ${path}`);
    }
    if (["reference_only", "resource_only"].includes(document.status) && document.flags.length === 0) {
      throw new Error(`${REVIEW_PATH}: bounded document needs flagged claims for ${path}`);
    }

    const actualHash = fileSha256(join(root, path));
    if (actualHash !== document.sha256) {
      throw new Error(`${path} changed after review; update ${REVIEW_PATH} before publishing`);
    }
    if (!DOCUMENT_ID_PATTERN.test(document.document_id || "") || documentIds.has(document.document_id)) {
      throw new Error(`${REVIEW_PATH}: invalid or duplicate document ID for ${path}`);
    }
    const source = String(document.source || "");
    if (
      typeof document.title !== "string"
      || !document.title.trim()
      || !Array.isArray(document.skus)
      || document.skus.length === 0
      || !document.skus.every((sku) => typeof sku === "string" && /^[A-Z0-9-]+$/.test(sku))
      || !source
      || source.startsWith("/")
      || source.includes("\\")
      || source.split("/").includes("..")
      || !SHA256_PATTERN.test(document.source_sha256 || "")
      || document.superseded_status !== (document.status === "restricted" ? "restricted" : "current")
    ) {
      throw new Error(`${REVIEW_PATH}: incomplete document control for ${path}`);
    }
    if (sourceRoot || requireSources) {
      if (!sourceRoot) throw new Error(`${REVIEW_PATH}: document source root is required`);
      const sourcePath = join(sourceRoot, source);
      if (!existsSync(sourcePath)) {
        throw new Error(`${source}: reviewed source is missing`);
      }
      if (fileSha256(sourcePath) !== document.source_sha256) {
        throw new Error(`${source}: source changed after review`);
      }
    }
    recorded.add(path);
    documentIds.add(document.document_id);
    if (documentDistribution(document) !== "public") excludedPublicPaths.add(path);
  }

  const onDisk = pdfPaths(root).sort();
  const reviewed = [...recorded].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(reviewed)) {
    throw new Error(`${REVIEW_PATH}: PDF inventory changed; review every file before publishing`);
  }

  const control = review.document_control || {};
  if (
    control.owner !== "MASEST Consulting LLC"
    || !/^\d+\.\d+$/.test(control.revision || "")
    || !/^\d{4}-\d{2}-\d{2}$/.test(control.effective_date || "")
    || !/customer review/i.test(control.approval || "")
    || !/distribution/i.test(control.approval_scope || "")
  ) {
    throw new Error(`${REVIEW_PATH}: incomplete document-control release`);
  }
  const disposition = review.claim_disposition || {};
  if (
    !/not technical or legal substantiation/i.test(disposition.review_scope || "")
    || !/cannot substantiate public copy/i.test(disposition.reference_only_rule || "")
    || !/exclude from product and industry pages/i.test(disposition.resource_only_rule || "")
    || !/exclude from public pages and deployment/i.test(disposition.restricted_rule || "")
  ) {
    throw new Error(`${REVIEW_PATH}: incomplete claim disposition`);
  }
  const distribution = review.distribution_policy || {};
  if (
    !/non-restricted documents other than SDS and TDS/i.test(distribution.public_rule || "")
    || !/registered-user request and staff approval/i.test(distribution.request_only_rule || "")
    || !/remain internal and unavailable by request/i.test(distribution.internal_rule || "")
  ) {
    throw new Error(`${REVIEW_PATH}: incomplete distribution policy`);
  }

  for (const document of review.documents) {
    if (documentDistribution(document) !== "public") continue;
    const marker = [
      "% MASEST-CONTROL",
      `ID=${document.document_id}`,
      `REV=${control.revision}`,
      `EFFECTIVE=${control.effective_date}`,
      "STATUS=CURRENT",
      "APPROVAL=CUSTOMER-REVIEW",
      "OWNER=MASEST-CONSULTING-LLC",
    ].join(" ");
    if (!readFileSync(join(root, document.path), "latin1").includes(marker)) {
      throw new Error(`${document.path}: embedded document control is missing or stale`);
    }
  }
  return excludedPublicPaths;
}

export async function syncTechnicalDocuments(root = process.cwd(), { validate = true } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  if (validate) validatePublicDocumentReview(root);
  const review = JSON.parse(readFileSync(join(root, REVIEW_PATH), "utf8"));
  const documents = review.documents.filter(
    (document) => documentDistribution(document) === "request_only",
  );
  const revision = review.document_control.revision;
  const entries = documents.map((document) => ({
    document,
    storagePath: `${documentType(document)}/${document.document_id}/${revision}-${document.sha256}.pdf`,
  }));
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();

  let bytes = 0;
  for (const { document, storagePath } of entries) {
    const body = readFileSync(join(root, document.path));
    const { error: uploadError } = await sb.storage
      .from("technical-documents")
      .upload(storagePath, body, {
        contentType: "application/pdf",
        cacheControl: "300",
        upsert: true,
      });
    if (uploadError) throw new Error(`${document.path} upload failed: ${uploadError.message}`);
    bytes += body.byteLength;
  }

  const rows = entries.map(({ document, storagePath }) => ({
    document_id: document.document_id,
    title: document.title,
    document_type: documentType(document),
    revision,
    source_path: document.path,
    storage_path: storagePath,
    sha256: document.sha256,
    claim_status: document.status,
    active: true,
    updated_at: now,
  }));
  const { error } = await sb
    .from("technical_documents")
    .upsert(rows, { onConflict: "document_id" });
  if (error) throw new Error(`technical document catalog sync failed: ${error.message}`);

  const { data: activeRows, error: activeError } = await sb
    .from("technical_documents")
    .select("document_id")
    .eq("active", true);
  if (activeError) throw new Error(`technical document catalog read failed: ${activeError.message}`);
  const currentIds = new Set(rows.map((row) => row.document_id));
  const staleIds = (activeRows || [])
    .map((row) => row.document_id)
    .filter((documentId) => !currentIds.has(documentId));
  if (staleIds.length) {
    const { error: deactivateError } = await sb
      .from("technical_documents")
      .update({ active: false, updated_at: now })
      .in("document_id", staleIds);
    if (deactivateError) {
      throw new Error(`technical document retirement failed: ${deactivateError.message}`);
    }
  }
  return { documents: rows.length, bytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceRoot = process.env.MASEST_DOCUMENT_SOURCE_ROOT || join(homedir(), "Desktop", "masest");
  validatePublicDocumentReview(process.cwd(), { sourceRoot, requireSources: true });
  if (process.argv.includes("--sync")) {
    const result = await syncTechnicalDocuments(process.cwd(), { validate: false });
    console.log(`public-document-policy: synced ${result.documents} request-only files (${result.bytes} bytes)`);
  } else {
    console.log(`public-document-policy: verified reviewed source bytes under ${sourceRoot}`);
  }
}
