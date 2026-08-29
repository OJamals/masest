import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet, onRequestPost } from "../functions/api/reviews.js";

test("held product and variant reviews are unavailable before any database access", async () => {
  for (const sku of ["cr60", "CR60-1G"]) {
    const response = await onRequestGet({
      request: new Request(`https://masest.test/api/reviews?sku=${sku}`),
      env: {},
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
});

test("held product and variant review submissions are rejected before purchaser verification", async () => {
  for (const sku of ["cr60", "CR60-1G"]) {
    const response = await onRequestPost({
      request: new Request("https://masest.test/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: 5, sku, kind: "product" }),
      }),
      env: {},
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
});
