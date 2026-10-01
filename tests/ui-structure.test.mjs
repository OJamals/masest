import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mainCatalogData = read("js/main/catalog-data.js");
const chrome = read("js/main/chrome.js");
const accountNav = read("js/account-nav.js");
const commerceUi = read("js/main/commerce-ui.js");
const serviceCatalog = read("js/main/service-catalog.js");

test("global navigation stays focused on buyer decisions", () => {
  const navBlock = chrome.match(/const links = \[[\s\S]*?\];/);

  assert.ok(navBlock, "expected renderChrome nav links block");
  assert.match(navBlock[0], /products/);
  assert.match(navBlock[0], /programs/);          // recurring-revenue programs + the only public price list belong in nav
  assert.match(navBlock[0], /proof/);
  assert.match(navBlock[0], /industries/);
  assert.match(navBlock[0], /about/);             // Company (about) is a B2B vendor-vetting destination
  assert.doesNotMatch(navBlock[0], /why-vertkleen\.html/);
  assert.doesNotMatch(navBlock[0], /contact/);    // contact stays a CTA/lead-bar action, not a nav tab
});

test("global navigation exposes account sign-in and registration", () => {
  assert.match(accountNav, /href="\$\{root\}account\.html"/);
  assert.match(accountNav, /Sign in/);
});

test("global logo links navigate to the home page from top-level pages", () => {
  assert.match(chrome, /const homeHref = root \|\| "\.\/"/, "shared chrome should define an explicit home link for top-level pages");
  assert.match(chrome, /class="nav-logo" href="\$\{homeHref\}"/, "header logo should use the explicit home link");
  assert.match(chrome, /class="foot-logo-link" href="\$\{homeHref\}"/, "footer logo should use the explicit home link");
  assert.doesNotMatch(chrome, /class="(?:nav-logo|foot-logo-link)" href="\$\{root\}"/, "logo href must not collapse to the current page on top-level routes");
});

test("global navigation exposes distinct industry and system routes with product support grouped", () => {
  const navBlock = chrome.match(/const links = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(navBlock, /Applications|useCases/);
  for (const label of ["Industries", "HVAC & Water Systems", "Results", "Chemical Programs", "Testing & Technical Services"]) assert.ok(navBlock.includes(label));
  assert.ok(navBlock.indexOf('key: "products"') < navBlock.indexOf('label: "Chemical Programs"'));
});

test("industry product cards lead with direct purchase before product details", () => {
  const cardBlock = commerceUi.match(/function productCard[\s\S]*?const commerceState/);

  assert.ok(cardBlock, "expected productCard block");
  assert.match(cardBlock[0], /Product details/);
  assert.ok(
    cardBlock[0].indexOf('data-commerce-action="${id}"') < cardBlock[0].indexOf('Product details'),
    "direct purchase should precede the secondary product-details link",
  );
  assert.doesNotMatch(cardBlock[0], /contact\?product/);
  assert.doesNotMatch(cardBlock[0], /Request a Quote/);
});

test("products page omits the retired replacement checker and keeps the catalog before proof", () => {
  const products = read("products.html");
  const catalogIndex = products.indexOf('id="shopGrid"');
  const proofIndex = products.indexOf('class="conversion-proof');

  assert.ok(catalogIndex > -1, "expected product grid on products page");
  assert.ok(catalogIndex < proofIndex, "catalog should come before proof details");
  assert.doesNotMatch(products, /Replacement checker|Find replacement/);
  assert.doesNotMatch(products, /id="swap"|id="replacementRouter"|id="swapMatrix"|id="swapResult"/);
});

test("about page exposes latest quote-service catalog from seed data", () => {
  const about = read("about.html");
  const serviceData = JSON.parse(read("data/services.json"));

  assert.match(about, /id="serviceCatalog"/);
  assert.match(about, /See every service in one place/);
  assert.match(about, /Browse service pricing/);
  assert.equal(serviceData.services.length, 35);
  assert.equal(serviceData.service_packages.length, 4);
  assert.match(serviceCatalog, /function initServiceCatalog/);
  assert.match(serviceCatalog, /data\/services\.json/);
});

test("products grid offers category chips, sorting, and clickable cards", () => {
  const products = read("products.html");

  assert.match(products, /id="shopChips"/);
  assert.match(products, /id="shopSort"/);
  assert.match(products, /value="featured"/);
  assert.match(products, /value="az"/);
  assert.match(products, /id="shopCount"/);
});

test("products page wires the catalog grid from product data", () => {
  assert.match(mainCatalogData, /export const CATALOG_ORDER/);
  assert.match(mainCatalogData, /export const CATALOG_GROUPS/);
  assert.match(commerceUi, /function catalogCard/);
  assert.match(commerceUi, /function initShop/);
  assert.match(read("js/main.js"), /initShop\(\);/);
  // whole-card link + one footer action: buy controls for buyable items, quote CTA for quote-first items
  assert.match(commerceUi, /<article class="shop-card"/);
  assert.match(commerceUi, /class="shop-card-link" href="\$\{htmlEscape\(detailHref\)\}"/);
  assert.doesNotMatch(commerceUi, /<a class="shop-card"[\s\S]*?<button class="shop-card-add"/);
  assert.match(commerceUi, /QUOTE_FIRST_IDS\.includes\(id\)/);
  assert.match(commerceUi, /shop-card-quote/);
  assert.match(commerceUi, /shop-card-bulk/);
  assert.match(read("products.html"), /<details class="catalog-buying-details">/);
  assert.doesNotMatch(read("products.html"), /href="#catalog">Shop by cleaning job/);
  assert.match(read("products.html"), /contact\?type=distributor/);
  assert.doesNotMatch(read("products.html"), /Request a Quote/);
});

test("generated product details include source-backed application guidance", () => {
  const product = read("products/hcr.html");

  assert.match(product, /product-dilution-hcr/);
  assert.match(product, /product-application-hcr/);
  assert.match(product, /Carib Brewery laboratory report/);
  assert.doesNotMatch(product, /class="product-application-media"/);
  assert.doesNotMatch(product, /Request a Quote/);
  assert.doesNotMatch(product, /type=distributor/);
});

test("programs page keeps glycol quote handling in an optional disclosure", () => {
  const programs = read("programs.html");
  const pricingIndex = programs.indexOf("Glycol quote list");
  const disclosureIndex = programs.indexOf('class="resource-disclosure');

  assert.ok(pricingIndex > -1, "expected glycol quote content to remain");
  assert.ok(disclosureIndex > -1, "expected quote handling to be inside a disclosure");
  assert.ok(disclosureIndex < pricingIndex, "disclosure should wrap the quote list");
  assert.doesNotMatch(programs, /PG inhibited 100% \(96%\)[\s\S]*\$141/, "glycol prices should not be public without workbook confirmation");
});

test("products page keeps the conversion-results strip between catalog and CTA", () => {
  const products = read("products.html");
  const catalogIndex = products.indexOf('id="shopGrid"');
  const proofIndex = products.indexOf('class="conversion-proof');
  const ctaIndex = products.search(/<section[^>]+class="[^"]*\bblock-dark\b[^"]*"/);

  assert.ok(proofIndex > -1, "expected compact evidence strip");
  assert.ok(ctaIndex > -1, "expected closing CTA");
  assert.ok(catalogIndex < proofIndex, "evidence should follow the catalog");
  assert.ok(proofIndex < ctaIndex, "evidence should precede the CTA");
  assert.match(products, /HVAC rust and scale restoration/);
  assert.match(products, /CR \+ HCR brewery CIP/);
  assert.match(products, /Drone-applied exterior cleaning/);
  assert.doesNotMatch(products, /Field context|Reference only|record incomplete/i);
  assert.doesNotMatch(products, /30 min|36 hours|Occupied sites/);
});

test("Programs delegates treatment comparison and methods to the single system hub", () => {
  const programs = read("programs.html"), hub = read("industries/hvac-water.html");
  assert.ok(programs.includes('id="water-treatment"'));
  assert.ok(programs.includes('industries/hvac-water#water-treatment'));
  assert.doesNotMatch(programs, /program-scope-table|program-map-disclosure|data-water-programs/);
  assert.match(hub, /data-water-programs/);
  assert.match(hub, /id="recirculation"/);
});

test("proof page leads with scoped records and expandable conversion evidence", () => {
  const proof = read("proof.html");
  const proofCards = JSON.parse(read("data/content/proof.json")).proof_cards;
  const heroIndex = proof.indexOf("See what VertKleen can do on real cleaning jobs.");
  const libraryIndex = proof.indexOf('class="proof-library');

  assert.ok(heroIndex > -1, "expected proof hero");
  assert.ok(libraryIndex > -1, "expected proof library");
  assert.ok(heroIndex < libraryIndex, "hero should lead proof library");
  assert.doesNotMatch(proof, /proof-decision-strip/);
  assert.doesNotMatch(proof, /class="proof-decision"/);
  assert.match(proof, /Plan my side-by-side test/);
  assert.match(proof, /Every job is different\. Try it on your surface and compare the result\./);
  assert.match(proof, /Two cleaners\. One complete brewery cycle\./);
  assert.equal((proof.match(/data-proof-card/g) || []).length, proofCards.length);
  assert.equal((proof.match(/Read the story/g) || []).length, proofCards.length);
  assert.doesNotMatch(proof, /Published result summary|Published product record|Source:/);
  assert.equal((proof.match(/<details class="case-disclosure"/g) || []).length, proofCards.length);
  assert.doesNotMatch(proof, /href="docs\/(?:brewery-cip-trial-brewlando|carib-brewery-lab-report)\.pdf"/);
  assert.doesNotMatch(proof, /30 min|36 hours|280&#215;|\$75|2,500 square feet/);
  assert.doesNotMatch(proof, /broader company file/i);
  assert.doesNotMatch(proof, /private pipeline detail/i);
});

test("home proof routes to a documented field record instead of a source PDF", () => {
  const home = read("index.html");

  assert.match(home, /href="blog\/hcr-brevard-hvac-rust-case-study">Read the field record/);
  assert.match(home, /href="proof">All results/);
  assert.doesNotMatch(home, /href="docs\/brewery-cip-trial-brewlando\.pdf"/);
  assert.doesNotMatch(home, /class="(?:doc-link|doc-badge)"/);
});

test("industry directory shows all routes with optional search and job filters", () => {
  const industries = read("industries.html");
  assert.ok(industries.indexOf('data-industry-search') < industries.indexOf('class="industry-directory"'));
  assert.match(industries, /data-filter-type="job"/);
  assert.doesNotMatch(industries, /data-filter-type="role"|class="industry-grid"/);
  assert.equal((industries.match(/data-industry-discovery-card/g) || []).length, 26);
});

test("industry router stacks route cards on mobile", () => {
  const css = read("css/style.css");

  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.industry-router \.route-grid/);
  assert.match(css, /\.industry-router \.route-grid[\s\S]*grid-template-columns: 1fr/);
});

test("contact page makes quote and audit intent obvious", () => {
  const contact = read("contact.html");
  const chooserIndex = contact.indexOf('class="cta-chooser contact-intent');
  const firstFieldIndex = contact.indexOf('name="name"');

  assert.ok(chooserIndex > -1, "expected compact contact intent chooser");
  assert.ok(firstFieldIndex > -1, "expected form fields to remain");
  assert.ok(chooserIndex < firstFieldIndex, "intent chooser should sit before form fields");
  assert.match(contact, /Quote/);
  assert.match(contact, /Replace a Cleaner/);
});

test("footer carries secondary navigation in grouped lanes", () => {
  // The "Procurement routes" foot-kicker was a dead label (no content under it)
  // and was removed 2026-07-05; guard against it quietly returning.
  assert.doesNotMatch(chrome, /foot-kicker/);
  assert.match(chrome, /foot-secondary/);
  assert.match(chrome, /SDS &amp; Product Help/);
  assert.match(chrome, /Product Categories/);
  assert.match(chrome, /Company/);
  assert.match(chrome, /Contact/);
});

test("no-js fallback nav stays focused on primary categories", () => {
  const pages = [
    ...readdirSync(new URL("..", import.meta.url))
      .filter(file => file.endsWith(".html") && !["index.html", "admin.html"].includes(file))
      .map(file => file),
    ...readdirSync(new URL("../industries", import.meta.url))
      .filter(file => file.endsWith(".html"))
      .map(file => `industries/${file}`)
  ];

  for (const page of pages) {
    const html = read(page);
    const nav = html.match(/<nav class="nojs-nav"[\s\S]*?<\/nav>/)?.[0] || "";

  assert.ok(nav, `${page} should keep no-js nav`);
  assert.match(nav, /Products/);
  assert.doesNotMatch(nav, /Applications/);
  assert.match(nav, /HVAC &amp; Water Systems/);
  assert.match(nav, /Industries/);
  assert.match(nav, /Results/);
  assert.match(nav, /SDS &amp; Resources/);
  assert.doesNotMatch(nav, /Request a Quote/);
    assert.doesNotMatch(nav, />Home</);
    assert.doesNotMatch(nav, />Why VertKleen</);
    assert.doesNotMatch(nav, />About/);
    assert.doesNotMatch(nav, />Contact</);
  }
});

test("industry generator exposes chemical programs and the system hub in fallback navigation", () => {
  const generator = read("tools/gen_industries.mjs");
  const navBlock = generator.match(/const NAV = \[[\s\S]*?\];/)?.[0] || "";
  assert.match(navBlock, /Chemical Programs/);
  assert.match(navBlock, /HVAC &amp; Water Systems/);
  assert.doesNotMatch(navBlock, /Applications/);
});

test("no-js fallback uses the same customer labels as the primary nav", () => {
  const pages = ["index.html", "proof.html", "industries.html", "resources.html"];

  for (const page of pages) {
    const html = read(page);
    const nav = html.match(/<nav class="nojs-nav"[\s\S]*?<\/nav>/)?.[0] || "";
    if (page !== "index.html") assert.match(nav, /HVAC &amp; Water Systems/);
    assert.match(nav, />Results</);
    if (page !== "index.html") assert.match(nav, />Industries</);
    assert.match(nav, page === "index.html" ? />Resources</ : />SDS &amp; Resources</);
    assert.doesNotMatch(nav, />Field Results</);
  }
});

test("resources page puts dense technical tables behind disclosure", () => {
  const resources = read("resources.html");
  const css = read("css/style.css");
  const routerIndex = resources.indexOf('class="resource-router');
  const disclosureIndex = resources.indexOf('class="resource-disclosure resources-reference-disclosure');
  const dilutionIndex = resources.indexOf("<!-- DILUTION GUIDE -->");
  const docsIndex = resources.indexOf("<!-- DOCUMENT LIBRARY -->");

  assert.ok(routerIndex > -1, "expected resources buyer router");
  assert.ok(disclosureIndex > -1, "expected technical reference disclosure");
  assert.ok(dilutionIndex > -1, "expected dilution content to remain");
  assert.ok(docsIndex > -1, "expected document library to remain");
  assert.ok(routerIndex < disclosureIndex, "router should precede dense reference");
  assert.ok(disclosureIndex < dilutionIndex, "dense reference should be inside disclosure");
  assert.ok(dilutionIndex < docsIndex, "document library should stay after technical reference");

  const summaryTag = resources.slice(disclosureIndex, resources.indexOf(">", disclosureIndex));
  assert.doesNotMatch(summaryTag, /\sopen\b/, "technical disclosure should be closed by default");
  assert.match(resources, /Get labels, guides, and results/);
  assert.match(resources, /Request a current quote/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.resource-router \.route-grid/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.resources-reference-disclosure summary/);
  assert.match(css, /\.resources-reference-disclosure summary b[\s\S]*white-space: normal/);
  assert.match(css, /\.resource-router \.route-card strong[\s\S]*grid-column: 2/);
});

test("about page routes buyers before service breadth", () => {
  const about = read("about.html");
  const css = read("css/style.css");
  // 2026-07-05: credentials render as a compact chip strip (.cred-band), not
  // display-stat numerals.
  const statsIndex = about.indexOf('class="cred-band"');
  const routerIndex = about.indexOf('class="about-router');
  const disclosureIndex = about.indexOf('class="resource-disclosure about-services-disclosure');
  const servicesIndex = about.indexOf("See every service in one place.");
  const teamIndex = about.indexOf("Talk to the people who built it.");

  assert.ok(statsIndex > -1, "expected credentials band to remain");
  assert.ok(routerIndex > -1, "expected about buyer router");
  assert.ok(disclosureIndex > -1, "expected services disclosure");
  assert.ok(servicesIndex > -1, "expected service breadth content to remain");
  assert.ok(teamIndex > -1, "expected direct team contact to remain");
  assert.ok(statsIndex < routerIndex, "credentials should lead router");
  assert.ok(routerIndex < disclosureIndex, "router should precede service breadth");
  assert.ok(disclosureIndex < servicesIndex, "services should be inside disclosure");
  assert.ok(disclosureIndex < teamIndex, "team contact should stay after service breadth");
  assert.match(about, /Start a quote/);
  assert.match(about, /See customer results/);
  assert.match(about, /Compare programs/);
  assert.doesNotMatch(about.slice(disclosureIndex, about.indexOf(">", disclosureIndex)), /\sopen\b/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.about-router \.route-grid/);
  assert.match(css, /\.about-services-disclosure summary b[\s\S]*white-space: normal/);
});

test("scrolly story state remains available to responsive chrome", () => {
  const storyJs = read("js/story.js");
  const storyCss = read("css/story.css");

  assert.match(storyJs, /story\.dataset\.activeScene = st\.config\.id/);
  assert.match(storyJs, /story-in-view/);
  assert.doesNotMatch(storyCss, /crisp-client|crisp-chatbox/);
});

test("scrolly hazard overlays avoid stripe-gradient decoration", () => {
  const storyCss = read("css/story.css");

  assert.doesNotMatch(storyCss, /repeating-linear-gradient/);
});

test("shared media fallback avoids stripe-gradient decoration", () => {
  const css = read("css/style.css");

  assert.doesNotMatch(css, /repeating-linear-gradient/);
});

test("scrolly stage finish avoids svg turbulence filters", () => {
  const storyCss = read("css/story.css");

  assert.doesNotMatch(storyCss, /feTurbulence/);
});

test("simplified routes avoid black cards and cramped section seams", () => {
  const css = read("css/style.css");

  assert.doesNotMatch(css, /\.eyebrow::before/);
  assert.match(css, new RegExp("\\.route-card[\\s\\S]*grid-template-columns: 44px 1fr"));
  assert.match(css, new RegExp("\\.route-card span[\\s\\S]*grid-row: 1 / span 2"));
  assert.match(css, new RegExp("\\.route-card strong,\\s*\\.route-card b[\\s\\S]*grid-column: 2"));
  assert.match(css, new RegExp("\\.resource-disclosure[\\s\\S]*max-width: var\\(--maxw\\)"));
  assert.match(css, new RegExp("\\.resource-disclosure[\\s\\S]*margin-inline: auto"));
  assert.doesNotMatch(css, new RegExp("\\.route-card-strong[\\s\\S]{0,120}background: var\\(--ink\\)"));
  assert.doesNotMatch(css, new RegExp("\\.btn-ink[\\s\\S]{0,120}background: var\\(--ink\\)"));
  assert.match(css, /\.section-slim \+ \.resource-disclosure/);
  assert.match(css, /\.resource-disclosure \+ section/);
});
test("commerce setup exposes a complete buyer cart path", () => {
  const main = read("js/main.js");
  const products = read("products.html");
  const cart = read("cart.html");
  const checkout = read("checkout.html");
  const confirmation = read("order-confirmed.html");
  const cartJs = read("js/cart.js");

  assert.match(chrome, /cart/);
  assert.match(chrome, /cart-count/);
  assert.match(commerceUi, /data-cart-add/);
  assert.match(commerceUi, /initCartButtons/);
  assert.match(products, /id="shopGrid"/);
  assert.match(cart, /id="cartLines"/);
  assert.match(cart, /id="checkoutContinue"/);
  assert.match(checkout, /id="shippingAddress1"/);
  assert.match(checkout, /id="billingSameAsShipping"/);
  assert.match(checkout, /id="shippingRates"/);
  assert.match(checkout, /id="checkoutPay"/);
  assert.match(cart, /contact\.html\?type=quote/);
  assert.match(confirmation, /session_id/);
assert.match(confirmation, /contact\.html\?type=quote/);
assert.match(cartJs, /cart:updated/);
assert.match(cartJs, /safeReadCart/);
});
