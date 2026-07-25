#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalPublicImageUrl, rewriteCmsImageReferences } from "../js/image-url.js";
import { imageSize } from "./_image-size.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IMAGE_ROOT = join(ROOT, "img");
const OUTPUT = join(ROOT, "data/content/site-images.json");
const IMAGE_EXTENSIONS = new Set([".png", ".webp"]);
const MIME_TYPES = new Map([
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const IGNORED_DIRECTORIES = new Set([
  ".claude",
  ".git",
  ".qa-local",
  "_local",
  "audit",
  "audits",
  "backups",
  "dist",
  "node_modules",
  "output",
  "test-results",
]);
const PRIVATE_HTML = new Set([
  "account.html",
  "admin.html",
  "business.html",
  "content-preview.html",
  "dashboard.html",
  "quickbooks-connect.html",
  "quickbooks-disconnect.html",
  "quickbooks-launch.html",
]);

function walk(dir, predicate, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file, predicate, files);
    else if (predicate(file)) files.push(file);
  }
  return files;
}

function publicPathFor(raw, sourceFile) {
  const value = String(raw || "").trim().split(/[?#]/, 1)[0];
  if (!value || /^(?:data|blob):/i.test(value)) return "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname !== "masest.co" && url.hostname !== "www.masest.co") return "";
      return canonicalPublicImageUrl(url.pathname);
    } catch {
      return "";
    }
  }
  const absolute = value.startsWith("/")
    ? join(ROOT, value.slice(1))
    : resolve(dirname(sourceFile), value);
  const rel = relative(ROOT, absolute).replaceAll("\\", "/");
  return rel.startsWith("img/") ? `/${rel}` : "";
}

function collectAltText() {
  const candidates = new Map();
  const htmlFiles = walk(ROOT, (file) => extname(file).toLowerCase() === ".html")
    .filter((file) => !PRIVATE_HTML.has(relative(ROOT, file).replaceAll("\\", "/")));
  const add = (publicUrl, alt) => {
    const cleanAlt = String(alt || "").replace(/\s+/g, " ").trim();
    if (!publicUrl || !cleanAlt) return;
    const options = candidates.get(publicUrl) || new Map();
    options.set(cleanAlt, (options.get(cleanAlt) || 0) + 1);
    candidates.set(publicUrl, options);
  };

  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\b(?:src|data-reel-src)=["']([^"']+)["']/i)?.[1] || "";
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
      add(publicPathFor(src, file), alt);
    }
  }
  return candidates;
}

function fallbackAlt(publicUrl) {
  const parts = publicUrl.replace(/^\/img\//, "").split("/");
  const category = parts.length > 1 ? parts[0] : "site";
  const words = publicUrl
    .replace(/^\/img\//, "")
    .replace(/\.[^.]+$/, "")
    .split("/")
    .flatMap((part) => part.split(/[-_]+/))
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word[0].toUpperCase() + word.slice(1)));
  const label = words.join(" ");
  if (category === "clients") return `${label} client logo`;
  if (category === "products") return `${label} product image`;
  if (category === "industries") return `${label} industry image`;
  if (category === "before-after" || category === "field") return `${label} cleaning result`;
  if (category === "proof") return `${label} field proof`;
  if (category === "story") return `${label} cleanup story`;
  if (category === "blog") return `${label} article image`;
  return label;
}

function preferredAlt(publicUrl, candidates) {
  const options = [...(candidates.get(publicUrl) || new Map()).entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  return options[0]?.[0] || fallbackAlt(publicUrl);
}

function runtimeEnv() {
  const values = { ...process.env };
  const envFile = join(ROOT, ".dev.vars");
  if (!existsSync(envFile)) return values;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in values)) values[key] = value;
  }
  return values;
}

function encodeStoragePath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function rewriteValue(value, publicPaths, mediaBase) {
  if (typeof value === "string") return rewriteCmsImageReferences(value, publicPaths, mediaBase);
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, publicPaths, mediaBase));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      rewriteValue(item, publicPaths, mediaBase),
    ]));
  }
  return value;
}

async function mapConcurrent(items, limit, task) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function syncCmsImages(assets) {
  const env = runtimeEnv();
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  const bucket = String(env.CONTENT_ASSET_BUCKET || "content-assets");
  if (!supabaseUrl || !serviceKey) throw new Error("sync-cms requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const authorization = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const jsonHeaders = { ...authorization, "content-type": "application/json" };
  const mediaBase = `${supabaseUrl}/storage/v1/object/public/${bucket}/site`;
  const publicPaths = assets.map((asset) => asset.storage_path);

  const rest = async (path, init = {}) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: { ...jsonHeaders, ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${response.status} ${await response.text()}`);
    const prefer = String(init.headers?.Prefer || init.headers?.prefer || "");
    if (response.status === 204 || prefer.includes("return=minimal")) return null;
    return response.json();
  };
  const [existingAssets, products, entries] = await Promise.all([
    rest("content_assets?select=*&limit=1000"),
    rest("products?select=sku,image_url,gallery&limit=1000"),
    rest("content_entries?select=id,type,slug,payload,seo&limit=1000"),
  ]);
  const existingByPath = new Map(existingAssets.map((asset) => [asset.storage_path, asset]));

  await mapConcurrent(assets, 6, async (asset) => {
    const objectPath = `site${asset.storage_path}`;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodeStoragePath(objectPath)}`, {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": asset.mime_type,
        "cache-control": "max-age=60, must-revalidate",
        "x-upsert": "true",
      },
      body: readFileSync(join(ROOT, asset.storage_path.slice(1))),
    });
    if (!response.ok) throw new Error(`upload ${asset.storage_path}: ${response.status} ${await response.text()}`);
  });

  const rows = assets.map((asset) => {
    const existing = existingByPath.get(asset.storage_path) || {};
    const usage = new Set(Array.isArray(existing.usage) ? existing.usage : []);
    usage.add(`site:${asset.category}`);
    for (const product of products) {
      const source = JSON.stringify([product.image_url, product.gallery]);
      if (rewriteCmsImageReferences(source, [asset.storage_path], mediaBase) !== source) usage.add(`product:${product.sku}`);
    }
    for (const entry of entries) {
      const source = JSON.stringify([entry.payload, entry.seo]);
      if (rewriteCmsImageReferences(source, [asset.storage_path], mediaBase) !== source) {
        usage.add(`content:${entry.type}:${entry.slug}`);
      }
    }
    return {
      storage_path: asset.storage_path,
      status: existing.status || "available",
      alt: asset.alt,
      mime_type: asset.mime_type,
      byte_size: asset.byte_size,
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      focal_point: existing.focal_point || {},
      usage: [...usage].sort(),
      credit: existing.credit || null,
      source_url: `${mediaBase}${asset.storage_path}`,
    };
  });
  for (let index = 0; index < rows.length; index += 50) {
    await rest("content_assets?on_conflict=storage_path", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(index, index + 50)),
    });
  }

  let productUpdates = 0;
  await mapConcurrent(products, 6, async (product) => {
    const next = rewriteValue({ image_url: product.image_url, gallery: product.gallery }, publicPaths, mediaBase);
    if (JSON.stringify(next) === JSON.stringify({ image_url: product.image_url, gallery: product.gallery })) return;
    await rest(`products?sku=eq.${encodeURIComponent(product.sku)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(next),
    });
    productUpdates++;
  });

  let contentUpdates = 0;
  await mapConcurrent(entries, 6, async (entry) => {
    const current = { payload: entry.payload, seo: entry.seo };
    const next = rewriteValue(current, publicPaths, mediaBase);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await rest(`content_entries?id=eq.${encodeURIComponent(entry.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...next, updated_at: new Date().toISOString() }),
    });
    contentUpdates++;
  });

  console.log(`sync-cms-images: uploaded ${assets.length}; linked ${productUpdates} products and ${contentUpdates} content entries`);
}

const altCandidates = collectAltText();
const assets = walk(IMAGE_ROOT, (file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
  .map((file) => {
    const publicUrl = `/${relative(ROOT, file).replaceAll("\\", "/")}`;
    const bytes = readFileSync(file);
    const { width, height } = imageSize(file);
    const pathParts = publicUrl.split("/").filter(Boolean);
    return {
      storage_path: publicUrl,
      public_url: publicUrl,
      filename: pathParts.at(-1),
      alt: preferredAlt(publicUrl, altCandidates),
      width,
      height,
      byte_size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime_type: MIME_TYPES.get(extname(file).toLowerCase()),
      category: pathParts.length > 2 ? pathParts[1] : "site",
      status: "available",
      source: "site",
    };
  })
  .sort((a, b) => a.public_url.localeCompare(b.public_url));

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({ version: 1, count: assets.length, assets }, null, 2)}\n`);
console.log(`build-image-library: indexed ${assets.length} public images`);
if (process.argv.includes("--sync-cms")) await syncCmsImages(assets);
