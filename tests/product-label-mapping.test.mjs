import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { CATALOG_ORDER, PRODUCTS } from "../js/main/catalog-data.js";

const expectedLabels = {
  cr: {
    name: "VertKleen CIP CR",
    image: "img/products/cip-cr-studio.webp",
  },
  cr2: {
    name: "VertKleen HVAC CR",
    image: "img/products/hvac-cr-studio.webp",
  },
  hcr: {
    name: "VertKleen CIP HCR",
    image: "img/products/cip-hcr-studio.webp",
  },
  "hcr-t16": {
    name: "VertKleen HVAC HCR",
    image: "img/products/hvac-hcr-studio.webp",
  },
  multiwash: {
    name: "VertKleen MultiWash",
    image: "img/products/multiwash-gym-studio.webp",
  },
  purgo: {
    name: "Purgo",
    image: "img/products/purgo-studio.webp",
  },
};

test("Products grid uses the real application labels and permitted jug images", () => {
  for (const [id, expected] of Object.entries(expectedLabels)) {
    assert.equal(PRODUCTS[id]?.name, expected.name, `${id} display name`);
    assert.equal(PRODUCTS[id]?.image, expected.image, `${id} product image`);
    assert.ok(
      existsSync(new URL(`../${expected.image}`, import.meta.url)),
      `${expected.image} should exist`,
    );
  }

  for (const id of CATALOG_ORDER) {
    assert.doesNotMatch(
      PRODUCTS[id]?.image || "",
      /food-beverage|pressure-wash/i,
      `${id} should not use an FB or PW jug on the main Products grid`,
    );
  }
});

test("catalog seed exposes the same corrected product names", () => {
  const catalog = JSON.parse(
    readFileSync(new URL("../data/catalog.seed.json", import.meta.url), "utf8"),
  );
  const names = new Map(catalog.products.map((product) => [product.slug, product.name]));

  for (const id of ["cr", "cr2", "hcr", "hcr-t16"]) {
    const expected = expectedLabels[id];
    assert.equal(names.get(id), expected.name, `${id} seed name`);
  }
});
