#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalPublicImageUrl } from "../js/image-url.js";
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

const altCandidates = collectAltText();
const assets = walk(IMAGE_ROOT, (file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
  .map((file) => {
    const publicUrl = `/${relative(ROOT, file).replaceAll("\\", "/")}`;
    const { width, height } = imageSize(file);
    const pathParts = publicUrl.split("/").filter(Boolean);
    return {
      storage_path: publicUrl,
      public_url: publicUrl,
      filename: pathParts.at(-1),
      alt: preferredAlt(publicUrl, altCandidates),
      width,
      height,
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
