import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public pages expose data visualization mounts for review-worthy evidence", () => {
  const services = read("services.html");
  const proof = read("proof.html");
  const programs = read("programs.html");

  assert.match(services, /data-service-mix-viz/, "services page should expose a catalog mix visualization mount");
  assert.match(proof, /data-proof-coverage/, "proof page should expose a sector coverage visualization mount");
  assert.match(programs, /class="[^"]*\bprogram-scope-visual\b/, "programs page should compare tier scope visually");
  assert.match(programs, /<table class="program-scope-table">/, "program tier visual should remain accessible as a table");
});

test("data visualizations render from canonical data or page metadata", () => {
  const main = read("js/main.js");
  const visuals = read("js/main/data-visuals.js");
  const servicesData = JSON.parse(read("data/services.json"));
  const servicesTotal = servicesData.services.length + servicesData.service_packages.length;
  const proofKinds = [...read("proof.html").matchAll(/data-proof-kind="([^"]+)"/g)].map(match => match[1]);

  assert.equal(servicesTotal, 39, "services visual should be based on the current 35 services plus 4 packages");
  assert.ok(new Set(proofKinds).size >= 6, "proof visual needs enough sector categories to be useful");
  assert.match(main, /initDataVisualizations\(\);/, "main entrypoint should initialize data visuals");
  assert.match(visuals, /fetch\("data\/services\.json"/, "service mix should use the public catalog JSON");
  assert.match(visuals, /querySelectorAll\("\[data-proof-card\]"\)/, "proof coverage should derive from case-card metadata");
  assert.match(visuals, /data-proof-viz-filter/, "proof coverage segments should sync with filters");
});

test("visual CSS keeps mobile and direct-label behavior explicit", () => {
  const css = read("css/style.css");

  assert.match(css, /\.viz-stack[\s\S]*display: flex/, "visual stacks should use stable proportional layout");
  assert.match(css, /\.viz-segment b[\s\S]*font-variant-numeric: tabular-nums/, "values should be directly visible");
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.viz-stack[\s\S]*flex-wrap: wrap/, "visuals should wrap on mobile");
  assert.match(css, /\.program-scope-table-wrap[\s\S]*overflow-x: auto/, "wide program matrix should stay usable on mobile");
});
