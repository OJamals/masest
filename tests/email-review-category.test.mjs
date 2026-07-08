import test from "node:test";
import assert from "node:assert/strict";
import { categoryStream, MARKETING_CATEGORIES } from "../functions/_lib/email.js";

test("review_request is a marketing (opt-out-able) stream", () => {
  assert.equal(MARKETING_CATEGORIES.has("review_request"), true);
  assert.equal(categoryStream("review_request"), "marketing");
  // order stays transactional
  assert.equal(categoryStream("order"), "transactional");
});
