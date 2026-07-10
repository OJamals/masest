import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fmtDate, fmtDT, dateTime } from "../js/util.js";

const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");

test("blog editor uses one visible title and synchronizes payload.title", () => {
  assert.match(source, /type !== "blog_post" \|\| field\.key !== "title"/);
  assert.match(source, /if \(type === "blog_post"\)[\s\S]*values\.title = document\.getElementById\("contentTitle"\)/);
  assert.match(source, /entry\.title \|\| entry\.payload\?\.title/);
});

test("date helpers suppress epoch sentinels and invalid timestamps", () => {
  for (const value of [0, "1970-01-01T00:00:00.000Z", "not-a-date"]) {
    assert.equal(fmtDate(value), "");
    assert.equal(fmtDT(value), "");
    assert.equal(dateTime(value), "");
  }
  assert.match(fmtDate("2026-07-09T12:00:00.000Z"), /2026/);
});
