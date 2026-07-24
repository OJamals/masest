import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const REVIEW_PATH = "data/public-document-review.json";
const VALID_STATUSES = new Set([
  "no_automated_flags",
  "claim_review_required",
  "restricted",
]);

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

export function validatePublicDocumentReview(root = process.cwd()) {
  const review = JSON.parse(readFileSync(join(root, REVIEW_PATH), "utf8"));
  if (!Array.isArray(review.documents) || review.documents.length === 0) {
    throw new Error(`${REVIEW_PATH}: documents must be a non-empty array`);
  }

  const recorded = [];
  const restricted = new Set();
  for (const document of review.documents) {
    const path = String(document?.path || "");
    if (!/^docs\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.pdf$/i.test(path) || path.includes("\\")) {
      throw new Error(`${REVIEW_PATH}: invalid document path ${path || "(empty)"}`);
    }
    if (recorded.includes(path)) {
      throw new Error(`${REVIEW_PATH}: duplicate document path ${path}`);
    }
    if (!VALID_STATUSES.has(document.status)) {
      throw new Error(`${REVIEW_PATH}: invalid status for ${path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(document.sha256 || "")) {
      throw new Error(`${REVIEW_PATH}: invalid SHA-256 for ${path}`);
    }
    if (!Array.isArray(document.flags)) {
      throw new Error(`${REVIEW_PATH}: flags must be an array for ${path}`);
    }

    const actualHash = fileSha256(join(root, path));
    if (actualHash !== document.sha256) {
      throw new Error(`${path} changed after review; update ${REVIEW_PATH} before publishing`);
    }
    recorded.push(path);
    if (document.status === "restricted") restricted.add(path);
  }

  const onDisk = pdfPaths(root).sort();
  const reviewed = [...recorded].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(reviewed)) {
    throw new Error(`${REVIEW_PATH}: PDF inventory changed; review every file before publishing`);
  }
  return restricted;
}
