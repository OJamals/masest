import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { imageSize } from "../tools/_image-size.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const htmlFiles = readdirSync(new URL("../", import.meta.url), { recursive: true })
  .filter((path) => path.endsWith(".html"))
  .filter((path) => !/^(?:dist|backups|_local|supabase|node_modules)\//.test(path));
const jsFiles = readdirSync(new URL("../js/", import.meta.url), { recursive: true })
  .filter((path) => path.endsWith(".js"))
  .map((path) => `js/${path}`);

test("shared interaction styles preserve visible focus and touch intent", () => {
  const components = read("css/components.css");
  const global = read("css/style.css");

  assert.match(components, /\.adm-chip-input:focus-visible\s*\{[^}]*outline:/s);
  assert.match(global, /touch-action:\s*manipulation/);
  assert.match(global, /-webkit-tap-highlight-color:/);
});

test("secondary application pages declare browser chrome color", () => {
  const pages = {
    "admin.html": "#fafbfc",
    "content-preview.html": "#fafbfc",
    "eula.html": "#fafbfc",
    "privacy.html": "#fafbfc",
    "quickbooks-connect.html": "#fafbfc",
    "quickbooks-disconnect.html": "#fafbfc",
    "quickbooks-launch.html": "#fafbfc",
    "services.html": "#fafbfc",
    "terms.html": "#fafbfc",
    "tools/og-card.html": "#0a0c12",
  };

  for (const [page, color] of Object.entries(pages)) {
    assert.match(read(page), new RegExp(`<meta name="theme-color" content="${color}">`), `${page} needs matching theme-color`);
  }
});

test("generated public imagery uses each source image's intrinsic ratio", () => {
  const blog = read("tools/build-blog.mjs");
  const products = read("tools/seo-inject.mjs");

  assert.match(blog, /canonicalPublicImageUrl\(post\.hero\)/);
  assert.match(blog, /imageSize\(join\(ROOT, heroUrl\.replace/);
  assert.match(products, /imageSize\(new URL\(`/);
  assert.doesNotMatch(products, /\}\.\.\.\`;\s*$/m, "generated descriptions should use a true ellipsis");

  for (const path of htmlFiles.filter((file) => /^(?:blog(?:\/|\.html$)|products\/)/.test(file))) {
    const markup = read(path);
    const pageUrl = new URL(`../${path}`, import.meta.url);
    for (const [tag, src, width, height] of markup.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*\bwidth="(\d+)"\s+height="(\d+)"[^>]*>/gi)) {
      const fileUrl = new URL(src, pageUrl);
      if (fileUrl.protocol !== "file:" || !existsSync(fileUrl)) continue;
      const intrinsic = imageSize(fileUrl);
      assert.deepEqual([Number(width), Number(height)], [intrinsic.width, intrinsic.height], `${path} needs the source ratio: ${tag}`);
    }
  }
});

test("shared footer form and brands expose input and translation semantics", () => {
  const chrome = read("js/main/chrome.js");

  assert.match(chrome, /translate="no">MASEST/);
  assert.match(chrome, /type="email"[^>]+name="email"[^>]+autocomplete="email"[^>]+spellcheck="false"/);
  assert.match(chrome, /placeholder="you@company\.com…"/);
});

test("admin list filters are shareable through URL parameters", () => {
  const quotes = read("js/admin/quotes.js");
  const companies = read("js/admin/companies.js");
  const crm = read("js/admin/crm-workspace.js");

  assert.match(quotes, /history\.replaceState/);
  assert.match(quotes, /quote_q:[^\n]+qSearch/);
  assert.match(companies, /history\.replaceState/);
  assert.match(companies, /account_filter/);
  assert.match(crm, /history\.replaceState/);
  assert.match(crm, /crm_q/);
  assert.match(crm, /crm_view/);
  assert.match(crm, /crm_task_scope/);
  assert.match(crm, /crm_task_assignee/);
});

test("large quote result sets use rendering containment", () => {
  const components = read("css/components.css");
  assert.match(components, /\.quote-item\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:/s);
});

test("active HTML reserves image space and gives form controls stable names", () => {
  for (const path of htmlFiles) {
    const markup = read(path);
    for (const [tag] of markup.matchAll(/<img\b[^>]*>/gi)) {
      assert.match(tag, /\bwidth="\d+"/, `${path} image needs width: ${tag}`);
      assert.match(tag, /\bheight="\d+"/, `${path} image needs height: ${tag}`);
    }
    for (const [tag, element] of markup.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      if (/\btype="(?:hidden|submit|button|reset|checkbox|radio|file)"/i.test(tag)) continue;
      assert.match(tag, /\bname="[^"]+"/i, `${path} ${element} needs a name: ${tag}`);
      if (element.toLowerCase() === "input" && /\btype="(?:email|text|search|tel|url|password)"/i.test(tag)) {
        assert.match(tag, /\bautocomplete="[^"]+"/i, `${path} input needs autocomplete: ${tag}`);
      }
    }
  }
});

test("dynamic content renderers reserve image space", () => {
  const renderers = [
    "js/admin/content-assets.js",
    "js/admin/image-library-picker.js",
    "js/admin/products.js",
    "js/content-preview.js",
    "js/main/content-snapshots.js",
    "js/main/media.js",
    "js/md.js",
    "js/newsletter-render.js",
  ];
  for (const path of renderers) {
    const source = read(path);
    assert.doesNotMatch(source, /<img\b(?![^>]*(?:width=|imageDimsAttr|\$\{(?:dims|afterDims)\}))[^>]*>/i, `${path} has an image without dimensions`);
  }
});

test("JavaScript-rendered forms give every control a stable name", () => {
  for (const path of jsFiles) {
    const source = read(path);
    for (const [form] of source.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
      for (const [tag, element] of form.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
        assert.match(tag, /\bname="[^"]+"/i, `${path} rendered ${element} needs a name: ${tag}`);
      }
    }
  }
});

test("progress copy uses the ellipsis character", () => {
  const sources = ["account.html", "admin.html", "cart.html", "dashboard.html", "product.html", "review.html", "js/admin.js", "js/dashboard.js", "js/reviews.js"];
  for (const path of sources) {
    assert.doesNotMatch(read(path), /(?:Loading|Saving|Submitting|Starting|Checking|Adding|Preparing|Running|Opening|Uploading)\.\.\./, `${path} uses three periods in progress copy`);
  }
});
