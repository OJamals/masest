#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];

const ignoredDirs = new Set([
  ".git",
  ".qa-local",
  "_local",
  "backups",
  "dist",
"node_modules",
"masest.co-audit",
"test-results",
  "vendor",
]);

const htmlFiles = walk(projectRoot, [".html"]);
const cssFiles = walk(projectRoot, [".css"]);
const jsFiles = walk(projectRoot, [".js"]);

function walk(dir, extensions, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, files);
      continue;
    }
    if (extensions.includes(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function rel(file) {
  return path.relative(projectRoot, file).replaceAll(path.sep, "/");
}

function read(file) {
  return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

function ok(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function localPathFromUrl(raw, fromFile) {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!value || value.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value)) return null;
  if (value.startsWith("/api/")) return null;
  if (value.startsWith("{{") || value.startsWith("<%")) return null;

  const withoutHash = value.split("#", 1)[0].split("?", 1)[0];
  if (!withoutHash || withoutHash.startsWith("/api/")) return null;

  const candidate = withoutHash.startsWith("/")
    ? path.join(projectRoot, withoutHash.slice(1))
    : path.resolve(path.dirname(fromFile), withoutHash);

  if (withoutHash.endsWith("/")) return path.join(candidate, "index.html");
  return candidate;
}

function checkPathExists(file, rawUrl, source) {
  const resolved = localPathFromUrl(rawUrl, file);
  if (!resolved) return;

  if (fs.existsSync(resolved)) return;
  if (!path.extname(resolved) && fs.existsSync(`${resolved}.html`)) return;

  failures.push(`${source} missing local reference ${rawUrl}`);
}

function checkLocalRefs() {
  const attrPattern = /\b(?:href|src|poster|action)=["']([^"']+)["']/gi;
  const srcsetPattern = /\bsrcset=["']([^"']+)["']/gi;
  const cssUrlPattern = /url\(([^)]+)\)/gi;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(attrPattern)) {
      checkPathExists(file, match[1], `${rel(file)}`);
    }
    for (const match of html.matchAll(srcsetPattern)) {
      for (const part of match[1].split(",")) {
        checkPathExists(file, part.trim().split(/\s+/, 1)[0], `${rel(file)} srcset`);
      }
    }
  }

  for (const file of cssFiles) {
    const css = fs.readFileSync(file, "utf8");
    for (const match of css.matchAll(cssUrlPattern)) {
      checkPathExists(file, match[1], `${rel(file)} css url()`);
    }
  }
}

function sitemapEntries() {
const xml = read("sitemap.xml");
const urls = [...xml.matchAll(/<loc>https:\/\/masest\.co\/([^<]*)<\/loc>/g)].map((match) => match[1]);
return urls.map((canonicalPath) => ({ canonicalPath: canonicalPath || "" }));
}

function publicSourceForCanonical(canonicalPath) {
if (!canonicalPath) return "index.html";
const direct = `${canonicalPath}.html`;
if (fs.existsSync(path.join(projectRoot, direct))) return direct;
const index = path.join(canonicalPath, "index.html");
if (fs.existsSync(path.join(projectRoot, index))) return index;
return direct;
}

function extractMeta(html, name) {
  const tags = html.match(/<meta\s+[^>]*>/gi) || [];
  for (const tag of tags) {
    const metaName = getAttr(tag, "name") || getAttr(tag, "property");
    if (metaName === name) return getAttr(tag, "content") || "";
  }
  return "";
}

function getAttr(tag, attr) {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}=(["'])(.*?)\\1`, "i"));
  return match?.[2] || "";
}

function extractCanonical(html) {
  return html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || "";
}

function checkSeoContracts() {
  const entries = sitemapEntries();
  ok(entries.length >= 30, "sitemap should expose public product, proof, resource, and industry pages");

  for (const entry of entries) {
const page = publicSourceForCanonical(entry.canonicalPath);
    ok(fs.existsSync(path.join(projectRoot, page)), `sitemap page missing: ${page}`);
    if (!fs.existsSync(path.join(projectRoot, page))) continue;

    const html = read(page);
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || "";
    const description = extractMeta(html, "description");
    const ogImage = extractMeta(html, "og:image");
    const canonical = extractCanonical(html);
    const expectedCanonical = `https://masest.co/${entry.canonicalPath}`;

    ok(title.length >= 12, `${page} missing useful title`);
    ok(description.length >= 50, `${page} missing useful meta description`);
    warn(description.length <= 170, `${page} meta description is longer than 170 chars`);
    ok(canonical === expectedCanonical, `${page} canonical should be ${expectedCanonical}`);
    ok(Boolean(ogImage), `${page} missing og:image`);

    if (ogImage && ogImage.startsWith("https://masest.co/")) {
      const ogPath = ogImage.replace("https://masest.co/", "");
      ok(fs.existsSync(path.join(projectRoot, ogPath)), `${page} og:image file missing: ${ogPath}`);
    }
  }

  const homeJsonLd = [...read("index.html").matchAll(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
  ok(homeJsonLd.length > 0, "home page missing JSON-LD");
  for (const script of homeJsonLd) {
    try {
      JSON.parse(script[1]);
    } catch (error) {
      failures.push(`index.html has invalid JSON-LD: ${error.message}`);
    }
  }
}

function checkRobotsAndPrivatePages() {
  const robots = read("robots.txt");
  ok(/Sitemap:\s*https:\/\/masest\.co\/sitemap\.xml/i.test(robots), "robots.txt missing sitemap");

  const privatePages = [...robots.matchAll(/Disallow:\s*\/([^\s]+)/g)]
    .map((match) => match[1])
    .filter((page) => page.endsWith(".html"));

  for (const page of privatePages) {
    if (!fs.existsSync(path.join(projectRoot, page))) continue;
    ok(/<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(read(page)), `${page} should be noindex`);
  }
}

function checkClaimDiscipline() {
  const bannedClaims = /\b(?:non[-\s]?toxic|harmless|zero[-\s]?risk|risk[-\s]?free|no[-\s]?fumes|fume[-\s]?free|chemical[-\s]?free|safe for all)\b/i;
  const files = [
    ...htmlFiles,
    path.join(projectRoot, "data/catalog.seed.json"),
    path.join(projectRoot, "data/products.seed.json"),
    path.join(projectRoot, "data/services.json"),
  ].filter((file) => fs.existsSync(file));

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(bannedClaims);
    ok(!match, `${rel(file)} uses unsupported safety claim: ${match?.[0]}`);
  }
}

function checkCommerceContracts() {
  const products = read("products.html");
  const product = read("product.html");
  const contact = read("contact.html");
  const main = read("js/main.js");

  ok(/class=["'][^"']*product-job-router/.test(products), "products.html missing buyer job router");
  ok(/id=["']catalog["']/.test(products), "products.html missing catalog section");
  ok(/id=["']pName["']/.test(product) && /id=["']pBuyBtn["']/.test(product), "product.html missing product detail mounts");
  ok(/data-endpoint=["']\/api\/quote["']/.test(contact), "contact form should post to quote intake endpoint");
  ok(/window\.MASESTMain/.test(main), "js/main.js should preserve window.MASESTMain compatibility");
}

function checkSyntax() {
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failures.push(`${rel(file)} failed node --check: ${(result.stderr || result.stdout).trim()}`);
    }
  }
}

checkLocalRefs();
checkSeoContracts();
checkRobotsAndPrivatePages();
checkClaimDiscipline();
checkCommerceContracts();
checkSyntax();

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`site verification passed (${htmlFiles.length} html, ${cssFiles.length} css, ${jsFiles.length} js files checked)`);
