#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONTENT_ASSET_PUBLIC_BASE } from "../js/image-url.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");
const DEFAULT_SOURCE_BUCKET = "content-assets";
const DEFAULT_TARGET_BUCKET = "masest-site-images";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const LIST_PAGE_SIZE = 1000;
const DEFAULT_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 120_000;

const MIME_BY_EXTENSION = new Map([
  ["avif", "image/avif"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`content image migration: ${message}`);
}

function normalizedBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizedStorageKey(value) {
  const key = String(value || "").trim().replace(/^\/+/, "");
  if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return key;
}

function encodedStorageKey(key) {
  return normalizedStorageKey(key).split("/").map(encodeURIComponent).join("/");
}

function metadataByteSize(metadata = {}) {
  const size = Number(metadata.size ?? metadata.contentLength ?? metadata.content_length ?? 0);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

function metadataMimeType(metadata = {}, name = "") {
  const supplied = String(metadata.mimetype || metadata.mime_type || metadata.contentType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (supplied) return supplied;
  return MIME_BY_EXTENSION.get(String(name).split(".").at(-1)?.toLowerCase()) || "application/octet-stream";
}

export function parseEnvFile(source) {
  const parsed = {};
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function migrationEnvironments(localEnvironment = {}, runtimeEnvironment = process.env) {
  return {
    source: { ...localEnvironment, ...runtimeEnvironment },
    wrangler: { ...runtimeEnvironment },
  };
}

export function sourceObjectUrl(sourceBase, key) {
  const base = normalizedBase(sourceBase);
  const encodedKey = encodedStorageKey(key);
  invariant(base && encodedKey, "source base and safe object key are required");
  return `${base}/${encodedKey}`;
}

export async function listSupabaseObjects({
  supabaseUrl,
  serviceKey,
  bucket = DEFAULT_SOURCE_BUCKET,
  fetchImpl = fetch,
}) {
  const base = normalizedBase(supabaseUrl);
  const sourceBucket = normalizedStorageKey(bucket);
  invariant(base && serviceKey && sourceBucket, "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and source bucket are required");

  const endpoint = `${base}/storage/v1/object/list/${encodeURIComponent(sourceBucket)}`;
  const folders = [""];
  const visitedFolders = new Set();
  const objects = [];

  while (folders.length) {
    const prefix = folders.shift();
    if (visitedFolders.has(prefix)) continue;
    visitedFolders.add(prefix);

    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prefix,
          limit: LIST_PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      invariant(response.ok, `Supabase list failed for ${prefix || "(root)"}: HTTP ${response.status}`);
      const entries = await response.json();
      invariant(Array.isArray(entries), `Supabase list returned invalid data for ${prefix || "(root)"}`);

      for (const entry of entries) {
        const name = normalizedStorageKey(prefix ? `${prefix}/${entry?.name || ""}` : entry?.name);
        invariant(name, `unsafe Supabase object name under ${prefix || "(root)"}`);
        if (entry?.id || entry?.metadata) {
          objects.push({
            name,
            byteSize: metadataByteSize(entry.metadata),
            mimeType: metadataMimeType(entry.metadata, name),
          });
        } else {
          folders.push(name);
        }
      }
      if (entries.length < LIST_PAGE_SIZE) break;
    }
  }

  return objects.sort((a, b) => a.name.localeCompare(b.name));
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

export async function migrateContentAssets(objects, {
  sourceBase,
  fetchImpl = fetch,
  upload,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress = () => {},
}) {
  invariant(Array.isArray(objects), "object inventory is required");
  invariant(typeof upload === "function", "upload function is required");
  const migrated = new Array(objects.length);
  const failures = [];

  await mapConcurrent(objects, concurrency, async (object, index) => {
    const key = normalizedStorageKey(object?.name);
    try {
      invariant(key, "unsafe object key");
      const response = await fetchImpl(sourceObjectUrl(sourceBase, key), {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      invariant(response.ok, `${key}: source HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const responseMime = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const mimeType = responseMime || metadataMimeType({}, key);
      if (object.byteSize) invariant(body.byteLength === object.byteSize, `${key}: ${body.byteLength} bytes != ${object.byteSize}`);
      if (object.mimeType && object.mimeType !== "application/octet-stream") {
        invariant(mimeType === object.mimeType, `${key}: MIME ${mimeType || "(missing)"} != ${object.mimeType}`);
      }
      invariant(mimeType.startsWith("image/"), `${key}: non-image MIME ${mimeType}`);

      const asset = {
        key,
        body,
        byteSize: body.byteLength,
        mimeType,
        sha256: sha256(body),
        cacheControl: CACHE_CONTROL,
      };
      await upload(asset);
      migrated[index] = asset;
      onProgress(index + 1, objects.length, key);
    } catch (error) {
      failures.push(`${key || "(unsafe key)"}: ${error.message}`);
    }
  });

  if (failures.length) {
    throw new Error(`content image migration failed (${failures.length}/${objects.length}):\n${failures.slice(0, 20).join("\n")}`);
  }
  return migrated;
}

export async function verifyMigratedContentAssets(assets, {
  targetBase = CONTENT_ASSET_PUBLIC_BASE,
  fetchImpl = fetch,
  concurrency = DEFAULT_CONCURRENCY,
  onProgress = () => {},
} = {}) {
  const base = normalizedBase(targetBase);
  invariant(base, "target public base is required");
  const failures = [];
  let bytes = 0;

  await mapConcurrent(assets, concurrency, async (asset, index) => {
    try {
      const url = `${sourceObjectUrl(base, asset.key)}?verify=${asset.sha256.slice(0, 16)}`;
      const response = await fetchImpl(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      invariant(response.ok, `${asset.key}: target HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      const mimeType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
      invariant(body.byteLength === asset.byteSize, `${asset.key}: target byte size changed`);
      invariant(sha256(body) === asset.sha256, `${asset.key}: target SHA-256 changed`);
      invariant(mimeType === asset.mimeType, `${asset.key}: target MIME ${mimeType || "(missing)"} != ${asset.mimeType}`);
      invariant(cacheControl.includes("max-age=31536000") && cacheControl.includes("immutable"), `${asset.key}: target cache policy missing`);
      bytes += body.byteLength;
      onProgress(index + 1, assets.length, asset.key);
    } catch (error) {
      failures.push(`${asset.key}: ${error.message}`);
    }
  });

  if (failures.length) {
    throw new Error(`content image verification failed (${failures.length}/${assets.length}):\n${failures.slice(0, 20).join("\n")}`);
  }
  return { count: assets.length, bytes, targetBase: base };
}

function readLocalEnvironment() {
  const path = resolve(ROOT, ".dev.vars");
  return existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
}

async function putWithWrangler(asset, bucket, environment) {
  invariant(existsSync(WRANGLER_BIN), "run npm install before migration");
  const args = [
    WRANGLER_BIN,
    "r2",
    "object",
    "put",
    `${bucket}/${asset.key}`,
    "--remote",
    "--pipe",
    "--content-type",
    asset.mimeType,
    "--cache-control",
    asset.cacheControl,
    "--force",
  ];

  await new Promise((resolveUpload, rejectUpload) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: environment,
      stdio: ["pipe", "ignore", "ignore"],
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectUpload(error);
      else resolveUpload();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("wrangler upload timed out"));
    }, UPLOAD_TIMEOUT_MS);
    child.once("error", finish);
    child.once("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error(`wrangler exited ${code}`));
    });
    child.stdin.once("error", finish);
    try {
      child.stdin.end(asset.body);
    } catch (error) {
      finish(error);
    }
  });
}

function progress(label) {
  return (completed, total, key) => {
    if (completed === total || completed % 25 === 0) console.log(`${label}: ${completed}/${total} (${key})`);
  };
}

async function main() {
  const local = readLocalEnvironment();
  const environments = migrationEnvironments(local, process.env);
  const environment = environments.source;
  const supabaseUrl = environment.SUPABASE_URL;
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const sourceBucket = environment.CONTENT_ASSET_BUCKET || DEFAULT_SOURCE_BUCKET;
  const targetBucket = environment.CONTENT_IMAGE_R2_BUCKET || DEFAULT_TARGET_BUCKET;
  const targetBase = environment.CONTENT_ASSET_PUBLIC_BASE || CONTENT_ASSET_PUBLIC_BASE;
  const sourceBase = `${normalizedBase(supabaseUrl)}/storage/v1/object/public/${encodeURIComponent(sourceBucket)}`;
  const execute = process.argv.includes("--execute");

  const objects = await listSupabaseObjects({ supabaseUrl, serviceKey, bucket: sourceBucket });
  const declaredBytes = objects.reduce((sum, object) => sum + object.byteSize, 0);
  console.log(`inventory: ${objects.length} objects; ${declaredBytes} declared bytes; source=${sourceBucket}; target=${targetBucket}`);
  if (!execute) {
    console.log("dry run only; pass --execute to upload and verify");
    return;
  }

  const migrated = await migrateContentAssets(objects, {
    sourceBase,
    concurrency: DEFAULT_CONCURRENCY,
    upload: (asset) => putWithWrangler(asset, targetBucket, environments.wrangler),
    onProgress: progress("upload"),
  });
  const verified = await verifyMigratedContentAssets(migrated, {
    targetBase,
    concurrency: DEFAULT_CONCURRENCY,
    onProgress: progress("verify"),
  });
  console.log(`verified: ${verified.count} objects; ${verified.bytes} bytes; target=${verified.targetBase}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
