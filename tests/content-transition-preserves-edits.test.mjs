import assert from "node:assert/strict";
import test from "node:test";
import { createContentRepository } from "../functions/_lib/content.js";

// Minimal in-memory Supabase double covering the transition() path:
//   existingEntry  -> from(t).select().eq().eq().eq().maybeSingle()
//   update         -> from(t).update(patch).eq("id", …).select("*").single()
//   writeRevision  -> from("content_revisions").insert(row)
function fakeSb(db) {
  return {
    from(table) {
      if (!db[table]) db[table] = [];
      const q = {
        _filters: [],
        _update: null,
        select() { return q; },
        eq(column, value) { q._filters.push([column, value]); return q; },
        update(patch) { q._update = patch; return q; },
        insert(row) { db[table].push({ ...row }); return Promise.resolve({ error: null }); },
        _match(row) { return q._filters.every(([c, v]) => row[c] === v); },
        async maybeSingle() { return { data: db[table].find((r) => q._match(r)) || null, error: null }; },
        async single() {
          const idx = db[table].findIndex((r) => q._match(r));
          if (q._update && idx >= 0) {
            db[table][idx] = { ...db[table][idx], ...q._update };
            return { data: { ...db[table][idx] }, error: null };
          }
          return { data: idx >= 0 ? { ...db[table][idx] } : null, error: null };
        },
      };
      return q;
    },
  };
}

function seedEntry(overrides = {}) {
  return {
    id: "e1",
    type: "service",
    slug: "water-analysis",
    locale: "en",
    title: "Water analysis",
    status: "draft",
    version: 3,
    payload: { sku: "OLD", category: "Lab", unit: "sample", public_price: 100, currency: "usd", active: true },
    seo: { description: "old seo" },
    ...overrides,
  };
}

test("workflow transition persists the editor's edited payload/title/seo (no silent edit loss)", async () => {
  const db = { content_entries: [seedEntry()], content_revisions: [] };
  const repo = createContentRepository(fakeSb(db));

  // The editor rewrites the body, then clicks "Submit for review" — runWorkflow sends the
  // full open-form entry. Before the fix, transition wrote only status and dropped these edits.
  const edited = {
    type: "service",
    slug: "water-analysis",
    locale: "en",
    title: "Water analysis updated",
    payload: { sku: "NEW", category: "Lab", unit: "sample", public_price: 150, currency: "usd", active: true },
    seo: { description: "new seo" },
  };
  const res = await repo.transition(edited, "staff_9", "in_review", "please review");

  assert.equal(res.ok, true);
  const row = db.content_entries[0];
  assert.equal(row.status, "in_review");
  assert.equal(row.payload.sku, "NEW", "edited payload must survive the workflow transition");
  assert.equal(row.payload.public_price, 150);
  assert.equal(row.title, "Water analysis updated", "edited title must survive the transition");
  assert.equal(row.seo.description, "new seo", "edited seo must survive the transition");
});

test("minimal transition (identity only, no payload) never wipes existing content", async () => {
  const db = {
    content_entries: [seedEntry({ status: "in_review", payload: { sku: "KEEP", category: "Lab", unit: "sample", public_price: 100, currency: "usd", active: true }, seo: { description: "keep seo" } })],
    content_revisions: [],
  };
  const repo = createContentRepository(fakeSb(db));

  // A bare transition (e.g. a queue action that posts only identity + status) must not blank fields.
  const res = await repo.transition({ type: "service", slug: "water-analysis", locale: "en" }, "rev_1", "changes_requested", "fix copy");

  assert.equal(res.ok, true);
  const row = db.content_entries[0];
  assert.equal(row.status, "changes_requested");
  assert.equal(row.payload.sku, "KEEP", "minimal transition must not wipe payload");
  assert.equal(row.seo.description, "keep seo", "minimal transition must not wipe seo");
});
