#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_MEDIA_BASE } from "../js/image-url.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = resolve(ROOT, "data/content/site-images.json");
const MIME_TYPES = new Map([
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
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

    invariant(/^\/img\/[^?#]+\.(?:png|svg|webp)$/.test(path), `${path || "(missing path)"} has an invalid storage path`);
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
  return override || SITE_MEDIA_BASE;
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

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function retryDelayMs(response, attempt) {
  const retryAfter = String(response?.headers?.get("retry-after") || "").trim();
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.min(15_000, Math.max(0, Math.round(Number(retryAfter) * 1_000)));
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) return Math.min(15_000, Math.max(0, retryAt - Date.now()));
  return Math.min(15_000, 1_000 * (2 ** attempt));
}

async function fetchCmsImage(url, { fetchImpl, maxAttempts, sleepImpl }) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { cache: "no-store" });
      const retryable = response.status === 429 || response.status === 500
        || response.status === 502 || response.status === 503 || response.status === 504;
      if (response.ok || !retryable || attempt === maxAttempts - 1) return response;
      await sleepImpl(retryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
      await sleepImpl(Math.min(15_000, 1_000 * (2 ** attempt)));
    }
  }
  throw lastError || new Error("CMS image fetch failed");
}

export async function verifyCmsImages(assets, base = cmsMediaBase(), options = {}) {
  const failures = [];
  let bytes = 0;
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleep || sleep;
  const configuredConcurrency = Number.parseInt(
    String(options.concurrency ?? process.env.CMS_IMAGE_VERIFY_CONCURRENCY ?? "4"),
    10,
  );
  const configuredAttempts = Number.parseInt(String(options.maxAttempts ?? "4"), 10);
  const concurrency = Math.min(8, Math.max(1, configuredConcurrency || 4));
  const maxAttempts = Math.min(6, Math.max(1, configuredAttempts || 4));

  await mapConcurrent(assets, concurrency, async (asset) => {
    try {
      const response = await fetchCmsImage(`${base}${asset.storage_path}`, {
        fetchImpl,
        maxAttempts,
        sleepImpl,
      });
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
