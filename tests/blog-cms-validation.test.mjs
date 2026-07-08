import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTENT_TYPE_DEFINITIONS, validateStructuredPayload } from "../js/content-types.js";

const base = {
  title: "T", category: "technical", date: "2026-07-01",
  excerpt: "e", body: "b",
};

test("blog_post category is a constrained select", () => {
  const cat = CONTENT_TYPE_DEFINITIONS.blog_post.fields.find((f) => f.key === "category");
  assert.equal(cat.kind, "select");
  assert.deepEqual(cat.options, ["marketing", "technical", "news"]);
});

test("blog_post date is a date field", () => {
  const d = CONTENT_TYPE_DEFINITIONS.blog_post.fields.find((f) => f.key === "date");
  assert.equal(d.kind, "date");
});

test("valid blog_post payload passes", () => {
  assert.equal(validateStructuredPayload("blog_post", base).ok, true);
});

test("rejects a category not in the option set", () => {
  assert.deepEqual(
    validateStructuredPayload("blog_post", { ...base, category: "Blog" }),
    { ok: false, error: "category_invalid_option" },
  );
});

test("accepts each valid category", () => {
  for (const c of ["marketing", "technical", "news"]) {
    assert.equal(validateStructuredPayload("blog_post", { ...base, category: c }).ok, true, c);
  }
});

test("rejects a non-ISO date", () => {
  assert.deepEqual(
    validateStructuredPayload("blog_post", { ...base, date: "07/07/2026" }),
    { ok: false, error: "date_invalid_date" },
  );
});

test("rejects an unparseable ISO-shaped date", () => {
  assert.deepEqual(
    validateStructuredPayload("blog_post", { ...base, date: "2026-13-45" }),
    { ok: false, error: "date_invalid_date" },
  );
});

test("still enforces required fields", () => {
  assert.deepEqual(
    validateStructuredPayload("blog_post", { ...base, title: "" }),
    { ok: false, error: "title_required" },
  );
});
