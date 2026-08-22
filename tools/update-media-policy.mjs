import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REVIEW_URL = new URL("../data/update-media-review.json", import.meta.url);
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[\\\0])[\s\S]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const RESTRICTED_STATUS = "restricted_pending_metadata";
const PUBLIC_STATUS = "approved_for_public_use";
const BRAND_LIBRARY_STATUS = "approved_for_brand_library";
const CONCEPT_LIBRARY_STATUS = "approved_for_concept_library";
const FIELD_LIBRARY_STATUS = "approved_for_field_library";
const PUBLIC_PATH = /^\/img\/updates\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;
const REQUIRED_METADATA_BY_ASSET_CLASS = Object.freeze({
  brand_asset: ["caption"],
  product_photo: ["caption", "product_and_job"],
  field_context: ["caption", "capture_date", "site_or_asset", "product_and_job", "before_after_role"],
  generated_marketing_image: [
    "caption",
    "generation_date",
    "generator",
    "synthetic_disclosure",
    "approved_usage",
  ],
});

const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`update_media:${field}_required`);
  }
  return value.trim();
};

const validateRelativePath = (value, field) => {
  const path = requiredText(value, field);
  if (!SAFE_PATH.test(path)) throw new Error(`update_media:${field}_unsafe`);
  return path;
};

const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const hasMetadata = (record, field) => (
  typeof record?.[field] === "string" && Boolean(record[field].trim())
);

const verifySource = (sourceRoot, relativePath, expectedHash, candidateId) => {
  const path = join(sourceRoot, relativePath);
  if (!existsSync(path)) throw new Error(`update_media:${candidateId}:source_missing:${relativePath}`);
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`update_media:${candidateId}:source_symlink_refused:${relativePath}`);
  }
  if (hashFile(path) !== expectedHash) {
    throw new Error(`update_media:${candidateId}:source_hash_changed:${relativePath}`);
  }
};

const expectedStatus = (record, missingMetadata) => {
  if (missingMetadata.length) return RESTRICTED_STATUS;
  if (record.asset_class === "product_photo") return PUBLIC_STATUS;
  if (record.asset_class === "brand_asset") return BRAND_LIBRARY_STATUS;
  if (record.asset_class === "generated_marketing_image") return CONCEPT_LIBRARY_STATUS;
  return FIELD_LIBRARY_STATUS;
};

const verifyPublicAsset = (record, id) => {
  const publicPath = requiredText(record.public_url, `${id}.public_url`);
  const storagePath = requiredText(record.storage_path, `${id}.storage_path`);
  if (publicPath !== storagePath || !PUBLIC_PATH.test(publicPath)) {
    throw new Error(`update_media:${id}:public_path_invalid`);
  }
  if (!SHA256.test(record.public_sha256 || "")) {
    throw new Error(`update_media:${id}:public_hash_invalid`);
  }
  if (!Number.isInteger(record.public_width) || record.public_width < 1) {
    throw new Error(`update_media:${id}:public_width_invalid`);
  }
  if (!Number.isInteger(record.public_height) || record.public_height < 1) {
    throw new Error(`update_media:${id}:public_height_invalid`);
  }
  if (!Number.isInteger(record.public_byte_size) || record.public_byte_size < 1) {
    throw new Error(`update_media:${id}:public_byte_size_invalid`);
  }
  const path = join(PROJECT_ROOT, publicPath.slice(1));
  if (!existsSync(path)) throw new Error(`update_media:${id}:public_asset_missing`);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`update_media:${id}:public_asset_symlink_refused`);
  if (hashFile(path) !== record.public_sha256) throw new Error(`update_media:${id}:public_asset_hash_changed`);
  if (statSync(path).size !== record.public_byte_size) throw new Error(`update_media:${id}:public_asset_size_changed`);
  return publicPath;
};

export function validateUpdateMediaReview(review, { sourceRoot } = {}) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new Error("update_media:review_object_required");
  }
  const control = review.review_control;
  requiredText(control?.owner, "review_control.owner");
  requiredText(control?.revision, "review_control.revision");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(control?.effective_date || "")) {
    throw new Error("update_media:review_control.effective_date_invalid");
  }
  requiredText(control?.public_rule, "review_control.public_rule");
  const rights = control?.rights_approval;
  if (
    rights?.owner !== "MASEST Consulting LLC"
    || rights?.approved_by_role !== "Owner"
    || !/^\d{4}-\d{2}-\d{2}$/.test(rights?.approved_on || "")
    || rights?.ownership_status !== "approved"
    || rights?.customer_permission !== "approved"
    || rights?.media_release !== "approved"
  ) {
    throw new Error("update_media:rights_approval_invalid");
  }
  requiredText(rights.scope, "review_control.rights_approval.scope");
  const configuredMetadata = control?.required_metadata_by_asset_class;
  if (JSON.stringify(configuredMetadata) !== JSON.stringify(REQUIRED_METADATA_BY_ASSET_CLASS)) {
    throw new Error("update_media:required_metadata_by_asset_class_invalid");
  }

  if (!Array.isArray(review.candidate_media) || review.candidate_media.length < 1) {
    throw new Error("update_media:candidate_media_missing");
  }
  const ids = new Set();
  const hashes = new Set();
  const publicPaths = new Set();
  const placementKeys = new Set();
  for (const [index, record] of review.candidate_media.entries()) {
    const id = requiredText(record?.candidate_id, `candidate_media.${index}.candidate_id`);
    if (!/^MAS-UPD-MEDIA-\d{3}$/.test(id)) throw new Error(`update_media:${id}:id_invalid`);
    if (ids.has(id)) throw new Error(`update_media:${id}:id_duplicate`);
    ids.add(id);

    const sourcePath = validateRelativePath(record.source_path, `${id}.source_path`);
    if (!SHA256.test(record.source_sha256 || "")) throw new Error(`update_media:${id}:hash_invalid`);
    if (hashes.has(record.source_sha256)) throw new Error(`update_media:${id}:hash_duplicate`);
    hashes.add(record.source_sha256);
    if (!Number.isInteger(record.width) || record.width < 1) throw new Error(`update_media:${id}:width_invalid`);
    if (!Number.isInteger(record.height) || record.height < 1) throw new Error(`update_media:${id}:height_invalid`);
    const requiredMetadata = REQUIRED_METADATA_BY_ASSET_CLASS[record.asset_class];
    if (!requiredMetadata) throw new Error(`update_media:${id}:asset_class_invalid`);
    const missingMetadata = requiredMetadata.filter((field) => !hasMetadata(record, field));
    if (JSON.stringify(record.missing) !== JSON.stringify(missingMetadata)) {
      throw new Error(`update_media:${id}:missing_metadata_mismatch`);
    }
    if (
      record.asset_class === "generated_marketing_image"
      && ["capture_date", "site_or_asset", "before_after_role"].some((field) => field in record)
    ) {
      throw new Error(`update_media:${id}:generated_field_metadata_forbidden`);
    }
    if (
      record.asset_class === "generated_marketing_image"
      && record.synthetic_disclosure !== "AI-generated; not field evidence."
    ) {
      throw new Error(`update_media:${id}:synthetic_disclosure_invalid`);
    }
    const status = expectedStatus(record, missingMetadata);
    if (record.status !== status) throw new Error(`update_media:${id}:status_invalid`);
    if (status === PUBLIC_STATUS) {
      requiredText(record.approved_usage, `${id}.approved_usage`);
      const placementKey = requiredText(record.placement_key, `${id}.placement_key`);
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(placementKey) || placementKeys.has(placementKey)) {
        throw new Error(`update_media:${id}:placement_key_invalid_or_duplicate`);
      }
      const publicPath = verifyPublicAsset(record, id);
      if (publicPaths.has(publicPath)) throw new Error(`update_media:${id}:public_path_duplicate`);
      publicPaths.add(publicPath);
      placementKeys.add(placementKey);
    } else {
      if (["public_url", "storage_path", "public_sha256", "public_width", "public_height", "public_byte_size", "placement_key"]
        .some((field) => field in record)) {
        throw new Error(`update_media:${id}:public_path_forbidden`);
      }
      if (status !== RESTRICTED_STATUS) requiredText(record.approved_usage, `${id}.approved_usage`);
    }

    const duplicatePaths = record.duplicate_paths || [];
    if (!Array.isArray(duplicatePaths)) throw new Error(`update_media:${id}:duplicate_paths_invalid`);
    for (const [duplicateIndex, duplicatePath] of duplicatePaths.entries()) {
      validateRelativePath(duplicatePath, `${id}.duplicate_paths.${duplicateIndex}`);
    }

    const hasContextLead = [
      "context_source_path",
      "context_source_sha256",
      "context_basis",
      "context_confidence",
    ].some((field) => field in record);
    let contextSourcePath;
    if (hasContextLead) {
      contextSourcePath = validateRelativePath(record.context_source_path, `${id}.context_source_path`);
      if (!SHA256.test(record.context_source_sha256 || "")) {
        throw new Error(`update_media:${id}:context_source_hash_invalid`);
      }
      requiredText(record.context_basis, `${id}.context_basis`);
      if (record.context_confidence !== "probable_not_public_authority") {
        throw new Error(`update_media:${id}:context_confidence_invalid`);
      }
    }

    if (sourceRoot) {
      verifySource(sourceRoot, sourcePath, record.source_sha256, id);
      for (const duplicatePath of duplicatePaths) {
        verifySource(sourceRoot, duplicatePath, record.source_sha256, id);
      }
      if (contextSourcePath) {
        verifySource(sourceRoot, contextSourcePath, record.context_source_sha256, id);
      }
    }
  }
  return review.candidate_media;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const review = JSON.parse(readFileSync(REVIEW_URL, "utf8"));
  const sourceRoot = process.env.MASEST_UPDATE_SOURCE_ROOT
    || join(homedir(), "Desktop", "masest", "updates");
  const availableRoot = existsSync(sourceRoot) ? sourceRoot : undefined;
  const records = validateUpdateMediaReview(review, { sourceRoot: availableRoot });
  console.log(
    `update-media-policy: ${records.filter(({ status }) => status === PUBLIC_STATUS).length} public, ${records.filter(({ status }) => status === RESTRICTED_STATUS).length} restricted; ${availableRoot ? "source bytes verified" : "schema verified (source root unavailable)"}`,
  );
}
