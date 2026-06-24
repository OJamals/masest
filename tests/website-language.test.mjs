import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const roots = ["account.html", "admin.html", "business.html", "cart.html", "checkout.html", "dashboard.html", "index.html", "products.html", "product.html", "programs.html", "resources.html", "contact.html", "about.html", "industries.html", "css", "js", "industries", "products", "data"];
const exts = new Set([".html", ".css", ".js", ".json"]);

function walk(path, files = []) {
  const abs = join(root, path);
  if (!existsSync(abs)) return files;
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const entry of readdirSync(abs)) walk(join(path, entry), files);
  } else if ([...exts].some((ext) => path.endsWith(ext))) {
    files.push(path);
  }
  return files;
}

test("website and authenticated UI copy avoids retired positioning language", () => {
  const retiredTerm = "leg" + "acy";
  const retiredPattern = new RegExp(`\\b${retiredTerm}\\b`, "i");
  const files = roots.flatMap((path) => walk(path));
  const offenders = [];
  for (const file of files) {
    const src = readFileSync(join(root, file), "utf8");
    if (retiredPattern.test(src)) offenders.push(relative(root, join(root, file)));
  }
  assert.deepEqual(offenders, []);
});
