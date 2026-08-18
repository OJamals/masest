import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const tagById = (markup, id) => markup.match(new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`, "i"))?.[0] || "";

test("audited static forms expose input intent and complete placeholder copy", () => {
  const emailFields = {
    "account.html": ["liEmail", "rEmail"],
    "admin.html": ["gEmail"],
    "checkout.html": ["checkoutEmail"],
    "newsletter.html": ["nlEmail"],
    "resources.html": ["docNotifyEmail"],
  };

  for (const [path, ids] of Object.entries(emailFields)) {
    const markup = read(path);
    for (const id of ids) {
      const tag = tagById(markup, id);
      assert.ok(tag, `${path} is missing #${id}`);
      assert.match(tag, /\bspellcheck="false"/i, `${path} #${id} must disable email spellcheck`);
    }
  }

  const placeholderPages = [
    "account.html",
    "admin.html",
    "cart.html",
    "checkout.html",
    "contact.html",
    "newsletter.html",
    "resources.html",
    "review.html",
  ];
  for (const path of placeholderPages) {
    for (const [, value] of read(path).matchAll(/\bplaceholder="([^"]+)"/gi)) {
      assert.ok(value.endsWith("…"), `${path} placeholder must end with an ellipsis: ${value}`);
    }
  }
});

test("audited pages provide direct navigation, buyer-focused copy, and critical media hints", () => {
  const preview = read("content-preview.html");
  assert.match(preview, /<a class="skip-link" href="#contentPreviewRoot">Skip to content<\/a>/);

  assert.match(read("index.html"), /Industrial Cleaning Power Without the <span class="no-break">Harsh-Chemical<\/span> Tradeoff\./);
  for (const path of ["contact.html", "products.html", "programs.html", "resources.html"]) {
    assert.doesNotMatch(read(path), /\b(?:We will|We'll|we offer)\b/, `${path} should address the buyer directly`);
  }

  assert.match(read("admin.html"), /Scanning pages…/);
  assert.match(read("review.html"), /Checking your review link…/);
  assert.match(read("services.html"), /<img\b[^>]*technical-testing\.webp[^>]*fetchpriority="high"[^>]*>/i);
});

test("the publish build preloads the critical Satoshi face on every HTML response", () => {
  const build = read("tools/cf-build.mjs");
  assert.match(build, /const CRITICAL_FONT_PRELOAD =/);
  assert.match(build, /ensureCriticalFontPreload/);
  assert.match(build, /rel="preload" as="font" type="font\/woff2" crossorigin/);
  assert.match(build, /extname\(f\)\.toLowerCase\(\) === '\.html'/);
});

test("audited CSS motion uses compositor-friendly properties", () => {
  const paths = ["css/blog.css", "css/components.css", "css/customer-chat.css", "css/style.css"];
  const disallowed = /\b(?:top|right|bottom|left|width|height|margin|padding|background(?:-color)?|border(?:-color)?|box-shadow|color)\b/i;
  const offenders = [];

  for (const path of paths) {
    const source = read(path);
    for (const match of source.matchAll(/\btransition(?:-property)?\s*:\s*([^;}]*)/gi)) {
      if (disallowed.test(match[1])) offenders.push(`${path}: ${match[0].trim()}`);
    }
  }

  assert.deepEqual(offenders, []);
  assert.doesNotMatch(read("css/story.css"), /@keyframes pulse\s*\{[\s\S]{0,500}?box-shadow/);
});

test("audited focus, dialogs, fixed controls, and long lists preserve interaction context", () => {
  const components = read("css/components.css");
  const global = read("css/style.css");

  assert.doesNotMatch(global, /(?:input|select|textarea|commerce-vol|cart-ship-estimate-row|cart-line|cart-input)[^,{]*:focus(?!-visible|-within)/);
  assert.match(components, /\.detail-dialog\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(components, /\.modal\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(components, /\.confirm-dialog-image-library\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(components, /\.asset-replacement-dialog \.confirm-dialog-body\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(components, /\.asset-replacement-diffs\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(components, /\.shared-image-library-card\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:/s);
  assert.match(global, /#lightbox\s*\{[^}]*overscroll-behavior:\s*contain/s);
  assert.match(global, /#lightbox \.lb-close\s*\{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-right\)/s);
  assert.match(global, /#records\s*\{[^}]*scroll-margin-top:/s);
});

test("admin support stays compact over dense operational surfaces", () => {
  const admin = read("admin.html");
  const support = read("css/admin-support.css");
  const supportJs = read("js/admin-support.js");

  assert.match(admin, /<body class="[^"]*\badmin-page\b[^"]*">/);
  assert.match(support, /\.admin-page \.site-support__launcher\s*\{[^}]*width:\s*48px[^}]*min-height:\s*48px/s);
  assert.match(support, /\.admin-page \.site-support__launcher > span\s*\{[^}]*clip:/s);
  assert.match(supportJs, /class="site-support__launcher"[^>]+title="Customer support"/);
});

test("content library supports local title and slug search", () => {
  const content = read("js/admin/content.js");

  assert.match(content, /id="contentSearch"[^>]+type="search"[^>]+aria-label="Search content library"/);
  assert.match(content, /function contentMatchesQuery\(/);
  assert.match(content, /\.filter\(\(entry\) => contentMatchesQuery\(entry, query\)\)/);
  assert.match(content, /event\.target\.matches\("#contentSearch"\)[\s\S]{0,120}renderList\(\)/);
});

test("product catalog defers dense editors behind native disclosures", () => {
  const admin = read("admin.html");
  const products = read("js/admin/products.js");

  assert.match(products, /<details class="product-admin-editor"/);
  assert.match(products, /<summary[^>]*>Edit product details<\/summary>/);
  assert.match(admin, /\.product-admin-card\s*\{[^}]*content-visibility:\s*auto[^}]*contain-intrinsic-size:/s);
  assert.match(admin, /\.product-admin-editor > summary\s*\{/);
});

test("audited JavaScript-rendered controls expose stable form intent", () => {
  const paths = [
    "js/admin-support.js",
    "js/business.js",
    "js/admin/companies.js",
    "js/admin/content.js",
    "js/admin/image-library-picker.js",
    "js/admin/newsletter.js",
    "js/admin/orders.js",
    "js/admin/pricing.js",
    "js/admin/products.js",
    "js/admin/quotes.js",
    "js/admin/reviews.js",
    "js/admin/search.js",
    "js/main/commerce-ui.js",
    "js/reviews.js",
  ];

  for (const path of paths) {
    const source = read(path);
    for (const [tag, element] of source.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
      assert.match(tag, /\bname="[^"]+"/i, `${path} rendered ${element} needs a stable name: ${tag}`);
      if (element.toLowerCase() !== "input") continue;
      const type = tag.match(/\btype="([^"]+)"/i)?.[1]?.toLowerCase() || "text";
      if (["email", "password", "search", "tel", "text", "url"].includes(type)) {
        assert.match(tag, /\bautocomplete="[^"]+"/i, `${path} rendered ${type} input needs autocomplete: ${tag}`);
      }
      if (type === "email") assert.match(tag, /\bspellcheck="false"/i, `${path} rendered email needs spellcheck=false: ${tag}`);
    }
    for (const [, value] of source.matchAll(/\bplaceholder="([^"]+)"/gi)) {
      assert.ok(value.endsWith("…"), `${path} placeholder must end with an ellipsis: ${value}`);
    }
  }
});

test("audited dynamic icons, images, and drag state remain accessible", () => {
  const companies = read("js/admin/companies.js");
  assert.match(companies, /data-addr-delete=[^>]+aria-label=/);
  assert.match(companies, /class="co-check"[^>]+aria-label=/);
  assert.match(companies, /data-au-delete=[^>]+aria-label=/);

  for (const path of ["js/admin/qbo.js", "js/admin/traffic.js"]) {
    assert.doesNotMatch(read(path), /<i\b(?![^>]*aria-hidden="true")[^>]*class="ph [^"]+"[^>]*><\/i>/i, `${path} has an exposed decorative icon`);
  }

  const products = read("js/admin/products.js");
  assert.match(products, /class="product-photo"[^>]+loading="lazy"/);
  assert.doesNotMatch(products, /USD \$\{Number\([^)]*\)\.toFixed\(2\)\}/);

  assert.match(read("js/main/chrome.js"), /foot-logo[^>]+loading="lazy"/);
  assert.match(read("js/checkout.js"), /checkout-line-media[^\n]+<img[^>]+loading="lazy"[^>]+width="\$\{[^}]+\}" height="\$\{[^}]+\}"/);

  const quotes = read("js/admin/quotes.js");
  assert.match(quotes, /dragstart[^\n]+card\.inert = true/);
  assert.match(quotes, /dragend[^\n]+card\.inert = false/);
  assert.match(read("css/components.css"), /\.pipe-card\.is-dragging\s*\{[^}]*user-select:\s*none/s);
});

test("audited admin currency copy uses the canonical formatter", () => {
  const orders = read("js/admin/orders.js");
  const products = read("js/admin/products.js");
  assert.doesNotMatch(orders, /\$\$\{(?:amount|Number\([^)]*\))\.toFixed\(2\)\}/);
  assert.match(orders, /money\(amount/);
  assert.match(products, /import \{[^}]*\bmoney\b[^}]*\} from '\.\.\/util\.js/);
  assert.match(products, /money\(p\.price/);
  assert.match(products, /money\(v\.price/);
});

test("audited navigation and live regions avoid forced synchronous layout", () => {
  const accountNav = read("js/account-nav.js");
  assert.doesNotMatch(accountNav, /function positionAccountMenu|\.offset(?:Width|Height)|getBoundingClientRect\(\)/);
  assert.match(accountNav, /\.acct-dd-menu\s*\{[^}]*position:absolute[^}]*inset-inline-end:0/s);

  const chat = read("js/customer-chat.js");
  assert.doesNotMatch(chat, /setProperty\("--customer-chat-avoid", "0px"\)[\s\S]{0,180}getBoundingClientRect/);
  assert.match(chat, /currentLift[\s\S]+getBoundingClientRect/);
  assert.match(chat, /requestAnimationFrame\(\(\) => \{\s*list\.scrollTop = list\.scrollHeight/s);

  const dashboard = read("js/dashboard.js");
  assert.match(dashboard, /requestAnimationFrame\(\(\) => \{[\s\S]{0,180}thread\.scrollTop/s);
  assert.match(dashboard, /mountAddressAutocomplete\([\s\S]+addressAutocompleteMount/);
});

test("audited admin workspace protects unsaved edits", () => {
  const admin = read("js/admin.js");
  assert.match(admin, /function hasUnsavedAdminEdits/);
  assert.match(admin, /await confirmDialog\('Discard unsaved changes/);
  assert.match(admin, /addEventListener\('beforeunload'/);
  assert.match(admin, /querySelectorAll\('\[data-dirty="1"\]'\)[\s\S]+delete control\.dataset\.dirty/);
});

test("audited shop, proof, and service choices deep-link through the URL", () => {
  const shop = read("js/main/commerce-ui.js");
  assert.match(shop, /new URLSearchParams\(location\.search\)/);
  assert.match(shop, /params\.set\("category", state\.group\)/);
  assert.match(shop, /params\.set\("sort", state\.sort\)/);
  assert.match(shop, /params\.set\("q", state\.search\)/);

  const proof = read("js/main/engagement.js");
  assert.match(proof, /params\.set\("proof", kind\)/);
  assert.match(proof, /params\.get\("proof"\)/);

  const services = read("js/main/service-catalog.js");
  assert.match(services, /#service-\$\{slugify\(category\)\}/);
  assert.match(services, /location\.hash[\s\S]+data-service-tab/);
});
