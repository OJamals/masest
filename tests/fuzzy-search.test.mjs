import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSearchText, searchTextMatchesQuery } from "../js/main/fuzzy-search.js";

test("shared search normalization handles punctuation, spacing, and diacritics", () => {
  assert.equal(normalizeSearchText("  PCR / Légionella  "), "pcr legionella");
});

test("shared search preserves existing substring matches", () => {
  assert.equal(searchTextMatchesQuery("Lab Testing - Water Analysis", "wa"), true);
});

test("shared search tolerates conservative typos without matching unrelated terms", () => {
  const service = "Legionella - Full Culture + Species ID";
  assert.equal(searchTextMatchesQuery(service, "legionela"), true);
  assert.equal(searchTextMatchesQuery(service, "unrelated"), false);
});
