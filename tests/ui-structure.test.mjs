import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global navigation stays focused on buyer decisions", () => {
  const main = read("js/main.js");
  const navBlock = main.match(/const links = \[[\s\S]*?\];/);

  assert.ok(navBlock, "expected renderChrome nav links block");
  assert.match(navBlock[0], /products\.html/);
  assert.match(navBlock[0], /programs\.html/);
  assert.match(navBlock[0], /proof\.html/);
  assert.match(navBlock[0], /industries\.html/);
  assert.doesNotMatch(navBlock[0], /why-vertkleen\.html/);
  assert.doesNotMatch(navBlock[0], /about\.html/);
  assert.doesNotMatch(navBlock[0], /contact\.html/);
});

test("product cards use details as the only repeated card action", () => {
  const main = read("js/main.js");
  const cardBlock = main.match(/function productCard[\s\S]*?function initBeforeAfter/);

  assert.ok(cardBlock, "expected productCard block");
  assert.match(cardBlock[0], /View Details/);
  assert.doesNotMatch(cardBlock[0], /contact\.html\?product/);
  assert.doesNotMatch(cardBlock[0], /Request a Quote/);
});

test("products page starts with a buyer router before the dense matrix", () => {
  const products = read("products.html");
  const routerIndex = products.indexOf('class="buyer-router');
  const matrixIndex = products.indexOf("The function-by-function case");

  assert.ok(routerIndex > -1, "expected buyer router on products page");
  assert.ok(matrixIndex > -1, "expected comparison matrix to remain");
  assert.ok(routerIndex < matrixIndex, "router should appear before dense matrix");
});

test("programs page moves glycol pricing into an optional disclosure", () => {
  const programs = read("programs.html");
  const pricingIndex = programs.indexOf("Glycol price list");
  const disclosureIndex = programs.indexOf('class="resource-disclosure');

  assert.ok(pricingIndex > -1, "expected glycol pricing content to remain");
  assert.ok(disclosureIndex > -1, "expected pricing to be inside a disclosure");
  assert.ok(disclosureIndex < pricingIndex, "disclosure should wrap the price list");
});

test("dense product matrix is optional after buyer routing", () => {
  const products = read("products.html");
  const routerIndex = products.indexOf('class="buyer-router');
  const matrixIndex = products.indexOf("The function-by-function case");
  const matrixDisclosureIndex = products.indexOf('class="resource-disclosure matrix-disclosure');

  assert.ok(routerIndex > -1, "expected buyer router");
  assert.ok(matrixIndex > -1, "expected matrix content to remain");
  assert.ok(matrixDisclosureIndex > -1, "expected matrix disclosure");
  assert.ok(routerIndex < matrixDisclosureIndex, "router should lead the matrix");
  assert.ok(matrixDisclosureIndex < matrixIndex, "matrix should be wrapped by disclosure");
});

test("products page shows proof before dense details", () => {
  const products = read("products.html");
  const routerIndex = products.indexOf('class="buyer-router');
  const proofIndex = products.indexOf('class="conversion-proof');
  const matrixDisclosureIndex = products.indexOf('class="resource-disclosure matrix-disclosure');

  assert.ok(proofIndex > -1, "expected compact proof strip");
  assert.ok(routerIndex < proofIndex, "proof should follow buyer routing");
  assert.ok(proofIndex < matrixDisclosureIndex, "proof should precede dense matrix");
  assert.match(products, /30 min/);
  assert.match(products, /Brewery CIP/);
  assert.match(products, /Occupied sites/);
  assert.match(products, /proof\.html/);
});

test("program function map is optional below the tiers", () => {
  const programs = read("programs.html");
  const tiersIndex = programs.indexOf("Four tiers, one safe standard");
  const mapIndex = programs.indexOf("Every function, replaced with 0-0-0");
  const mapDisclosureIndex = programs.indexOf('class="resource-disclosure program-map-disclosure');

  assert.ok(tiersIndex > -1, "expected tiers content");
  assert.ok(mapIndex > -1, "expected function map content to remain");
  assert.ok(mapDisclosureIndex > -1, "expected program map disclosure");
  assert.ok(tiersIndex < mapDisclosureIndex, "tiers should stay primary");
  assert.ok(mapDisclosureIndex < mapIndex, "map should be wrapped by disclosure");
});

test("proof page leads with conversion proof, not internal notes", () => {
  const proof = read("proof.html");
  const heroIndex = proof.indexOf("The same job, on real sites.");
  const quickProofIndex = proof.indexOf('class="proof-decision-strip');
  const libraryIndex = proof.indexOf('class="proof-library');

  assert.ok(heroIndex > -1, "expected proof hero");
  assert.ok(quickProofIndex > -1, "expected quick proof decision strip");
  assert.ok(libraryIndex > -1, "expected full library to remain");
  assert.ok(heroIndex < quickProofIndex, "hero should lead quick proof");
  assert.ok(quickProofIndex < libraryIndex, "quick proof should precede library");
  assert.match(proof, /Book a Free Chemical Audit/);
  assert.match(proof, /30 min/);
  assert.match(proof, /Brewery CIP/);
  assert.doesNotMatch(proof, /broader company file/i);
  assert.doesNotMatch(proof, /private pipeline detail/i);
});

test("industries page routes buyers before the long industry list", () => {
  const industries = read("industries.html");
  const routerIndex = industries.indexOf('class="industry-router');
  const gridIndex = industries.indexOf('class="industry-grid');

  assert.ok(routerIndex > -1, "expected industry buyer router");
  assert.ok(gridIndex > -1, "expected industry grid to remain");
  assert.ok(routerIndex < gridIndex, "router should precede dense industry list");
  assert.match(industries, /Start with a quote/);
  assert.match(industries, /Match proof to your vertical/);
});

test("industry router stacks route cards on mobile", () => {
  const css = read("css/style.css");

  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.industry-router \.route-grid/);
  assert.match(css, /\.industry-router \.route-grid[\s\S]*grid-template-columns: 1fr/);
});

test("contact page makes quote and free audit intent obvious", () => {
  const contact = read("contact.html");
  const chooserIndex = contact.indexOf('class="cta-chooser contact-intent');
  const firstFieldIndex = contact.indexOf('name="name"');

  assert.ok(chooserIndex > -1, "expected compact contact intent chooser");
  assert.ok(firstFieldIndex > -1, "expected form fields to remain");
  assert.ok(chooserIndex < firstFieldIndex, "intent chooser should sit before form fields");
  assert.match(contact, /Quote/);
  assert.match(contact, /Free Audit/);
});

test("footer carries secondary navigation in grouped lanes", () => {
  const main = read("js/main.js");

  assert.match(main, /foot-kicker/);
  assert.match(main, /foot-secondary/);
  assert.match(main, /Resources \+ SDS/);
  assert.match(main, /Product Categories/);
  assert.match(main, /Company/);
  assert.match(main, /Quote/);
});

test("no-js fallback nav stays focused on primary categories", () => {
  const pages = [
    ...readdirSync(new URL("..", import.meta.url))
      .filter(file => file.endsWith(".html") && file !== "index.html")
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
    assert.match(nav, /Programs/);
    assert.match(nav, /Proof/);
    assert.match(nav, /Industries/);
    assert.match(nav, /Request a Quote/);
    assert.doesNotMatch(nav, />Home</);
    assert.doesNotMatch(nav, />Why VertKleen</);
    assert.doesNotMatch(nav, />About/);
    assert.doesNotMatch(nav, />Contact</);
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
  assert.match(resources, /Get SDS and certification files/);
  assert.match(resources, /Request a current quote/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.resource-router \.route-grid/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.resources-reference-disclosure summary/);
  assert.match(css, /\.resources-reference-disclosure summary b[\s\S]*white-space: normal/);
  assert.match(css, /\.resource-router \.route-card strong[\s\S]*grid-column: 2/);
});

test("why page routes buyers before dense comparison tables", () => {
  const why = read("why-vertkleen.html");
  const css = read("css/style.css");
  const storyIndex = why.indexOf('id="story"');
  const routerIndex = why.indexOf('class="why-router');
  const disclosureIndex = why.indexOf('class="resource-disclosure why-comparison-disclosure');
  const tablesIndex = why.indexOf("Now score the chemicals doing this work.");

  assert.ok(storyIndex > -1, "expected why story to remain");
  assert.ok(routerIndex > -1, "expected why buyer router");
  assert.ok(disclosureIndex > -1, "expected why comparison disclosure");
  assert.ok(tablesIndex > -1, "expected comparison tables to remain");
  assert.ok(storyIndex < routerIndex, "story should introduce router");
  assert.ok(routerIndex < disclosureIndex, "router should precede dense tables");
  assert.ok(disclosureIndex < tablesIndex, "comparison tables should be inside disclosure");
  assert.match(why, /Match the safer line/);
  assert.match(why, /Review field proof/);
  assert.match(why, /Book a free audit/);
  assert.doesNotMatch(why.slice(disclosureIndex, why.indexOf(">", disclosureIndex)), /\sopen\b/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.why-router \.route-grid/);
  assert.match(css, /\.why-comparison-disclosure summary b[\s\S]*white-space: normal/);
  assert.doesNotMatch(why.match(/class="why-router[^"]*"/)?.[0] || "", /reveal/);
});

test("about page routes buyers before service breadth", () => {
  const about = read("about.html");
  const css = read("css/style.css");
  const statsIndex = about.indexOf('class="stat-band"');
  const routerIndex = about.indexOf('class="about-router');
  const disclosureIndex = about.indexOf('class="resource-disclosure about-services-disclosure');
  const servicesIndex = about.indexOf("Full-spectrum technical services.");
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
  assert.match(about, /Review proof/);
  assert.match(about, /Compare programs/);
  assert.doesNotMatch(about.slice(disclosureIndex, about.indexOf(">", disclosureIndex)), /\sopen\b/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.about-router \.route-grid/);
  assert.match(css, /\.about-services-disclosure summary b[\s\S]*white-space: normal/);
});
