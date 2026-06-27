import assert from "node:assert/strict";
import test from "node:test";
import { createContentRepository } from "../functions/_lib/content.js";

function applyFilters(rows, filters) {
  return rows.filter((row) => filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "lte") return String(row[filter.column] || "") <= String(filter.value);
    return true;
  }));
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.orderColumn = "";
    this.orderAscending = true;
    this.limitValue = 0;
    this.upsertRow = null;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ op: "lte", column, value });
    return this;
  }

  order(column, options = {}) {
    this.orderColumn = column;
    this.orderAscending = options.ascending !== false;
    return this;
  }

  limit(value) {
    this.limitValue = Number(value) || 0;
    return this;
  }

  insert(row) {
    this.db[this.table].push({ ...row });
    return Promise.resolve({ error: null });
  }

  upsert(row) {
    this.upsertRow = { ...row };
    return this;
  }

  async maybeSingle() {
    return { data: this.resolveSelect()[0] || null, error: null };
  }

  async single() {
    if (this.upsertRow) return this.resolveUpsert();
    return { data: this.resolveSelect()[0] || null, error: null };
  }

  then(resolve, reject) {
    return Promise.resolve({ data: this.resolveSelect(), error: null }).then(resolve, reject);
  }

  resolveSelect() {
    let rows = applyFilters(this.db[this.table] || [], this.filters);
    if (this.orderColumn) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[this.orderColumn] || "");
        const right = String(b[this.orderColumn] || "");
        return this.orderAscending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitValue > 0) rows = rows.slice(0, this.limitValue);
    return rows.map((row) => ({ ...row }));
  }

  resolveUpsert() {
    const row = this.upsertRow;
    const rows = this.db[this.table];
    const index = rows.findIndex((existing) => (
      existing.type === row.type
        && existing.slug === row.slug
        && existing.locale === row.locale
    ));
    const next = {
      ...(index >= 0 ? rows[index] : {}),
      ...row,
      id: row.id || rows[index]?.id || `entry_${rows.length + 1}`,
    };
    if (index >= 0) rows[index] = next;
    else rows.push(next);
    return { data: { ...next }, error: null };
  }
}

function fakeSupabase(db) {
  return {
    from(table) {
      if (!db[table]) db[table] = [];
      return new FakeQuery(db, table);
    },
  };
}

function serviceEntry(overrides = {}) {
  return {
    id: "entry_due",
    type: "service",
    slug: "water-analysis",
    title: "Water analysis",
    status: "scheduled",
    locale: "en",
    scheduled_at: "2026-06-30T10:00:00.000Z",
    review_note: "Ready for launch.",
    version: 4,
    payload: {
      sku: "MS-LAB-WATER",
      category: "Lab",
      unit: "sample",
      public_price: 125,
      currency: "usd",
      active: true,
    },
    seo: { description: "Industrial water analysis." },
    ...overrides,
  };
}

test("content repository publishes due scheduled entries and leaves future entries queued", async () => {
  const db = {
    content_entries: [
      serviceEntry(),
      serviceEntry({
        id: "entry_future",
        slug: "future-water-analysis",
        title: "Future water analysis",
        scheduled_at: "2026-07-01T10:00:00.000Z",
      }),
    ],
    content_revisions: [],
  };
  const repo = createContentRepository(fakeSupabase(db));

  const result = await repo.publishScheduledDue({ now: "2026-06-30T12:00:00.000Z" }, "staff_1");

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.entries[0].status, "published");
  assert.equal(result.entries[0].scheduled_at, null);
  assert.equal(result.entries[0].review_note, null);

  const published = db.content_entries.find((entry) => entry.id === "entry_due");
  assert.equal(published.status, "published");
  assert.equal(published.version, 5);
  assert.equal(published.updated_by, "staff_1");
  assert.equal(published.scheduled_at, null);
  assert.equal(published.review_note, null);
  assert.ok(published.published_at);

  const future = db.content_entries.find((entry) => entry.id === "entry_future");
  assert.equal(future.status, "scheduled");
  assert.equal(future.version, 4);

  assert.equal(db.content_revisions.length, 1);
  assert.equal(db.content_revisions[0].entry_id, "entry_due");
  assert.equal(db.content_revisions[0].status, "published");
  assert.equal(db.content_revisions[0].version, 5);
  assert.equal(db.content_revisions[0].note, "Published");
});
