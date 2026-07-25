#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = resolve(ROOT, "data/content/site-images.json");
const CONFIG_PATH = resolve(ROOT, "js/config.js");
const MIME_TYPES = new Map([
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`site-images manifest: ${message}`);
}

export function validateManifest(manifest) {
  invariant(manifest?.version === 1, "version must be 1");
  invariant(Array.isArray(manifest?.assets), "assets must be an array");
  invariant(manifest.count === manifest.assets.length, "count must match assets length");

  const paths = new Set();
  for (const asset of manifest.assets) {
    const path = String(asset?.storage_path || "");
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();

    invariant(/^\/img\/[^?#]+\.(?:png|webp)$/.test(path), `${path || "(missing path)"} has an invalid storage path`);
    invariant(asset.public_url === path, `${path} must use the same stable public alias`);
    invariant(!paths.has(path), `${path} is duplicated`);
    invariant(asset.filename === path.split("/").at(-1), `${path} has the wrong filename`);
    invariant(String(asset.alt || "").trim(), `${path} needs alt text`);
    invariant(Number.isInteger(asset.width) && asset.width > 0, `${path} needs a positive integer width`);
    invariant(Number.isInteger(asset.height) && asset.height > 0, `${path} needs a positive integer height`);
    invariant(Number.isInteger(asset.byte_size) && asset.byte_size > 0, `${path} needs a positive integer byte size`);
    invariant(/^[a-f0-9]{64}$/.test(asset.sha256), `${path} needs a SHA-256 digest`);
    invariant(asset.mime_type === MIME_TYPES.get(extension), `${path} has the wrong MIME type`);
    invariant(String(asset.category || "").trim(), `${path} needs a category`);
    invariant(asset.status === "available", `${path} must be available`);
    invariant(asset.source === "site", `${path} must remain a site-library alias`);
    paths.add(path);
  }

  return manifest.assets;
}

function cmsMediaBase() {
  const override = String(process.env.CMS_MEDIA_BASE || "").replace(/\/+$/, "");
  if (override) return override;

  const config = readFileSync(CONFIG_PATH, "utf8");
  const supabaseUrl = config.match(/MASEST_SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1]?.replace(/\/+$/, "");
  invariant(supabaseUrl, "CMS_MEDIA_BASE or MASEST_SUPABASE_URL is required");
  const bucket = String(process.env.CONTENT_ASSET_BUCKET || "content-assets");
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/site`;
}

async function mapConcurrent(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export async function verifyCmsImages(assets, base = cmsMediaBase()) {
  const failures = [];
  let bytes = 0;

  await mapConcurrent(assets, 8, async (asset) => {
    try {
      const response = await fetch(`${base}${asset.storage_path}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const mime = String(response.headers.get("content-type") || "").split(";", 1)[0].trim();
      const sha256 = createHash("sha256").update(body).digest("hex");

      if (mime !== asset.mime_type) throw new Error(`MIME ${mime || "(missing)"} != ${asset.mime_type}`);
      if (body.byteLength !== asset.byte_size) throw new Error(`${body.byteLength} bytes != ${asset.byte_size}`);
      if (sha256 !== asset.sha256) throw new Error(`SHA-256 ${sha256} != ${asset.sha256}`);
      bytes += body.byteLength;
    } catch (error) {
      failures.push(`${asset.storage_path}: ${error.message}`);
    }
  });

  if (failures.length) {
    const shown = failures.slice(0, 20).join("\n");
    const remainder = failures.length > 20 ? `\n...and ${failures.length - 20} more` : "";
    throw new Error(`CMS image verification failed (${failures.length}/${assets.length}):\n${shown}${remainder}`);
  }

  return { count: assets.length, bytes, base };
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const assets = validateManifest(manifest);
  console.log(`build-image-library: validated ${assets.length} CMS image records`);

  if (process.argv.includes("--verify-cms")) {
    const result = await verifyCmsImages(assets);
    console.log(`verify-cms-images: verified ${result.count} objects (${result.bytes} bytes) at ${result.base}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
