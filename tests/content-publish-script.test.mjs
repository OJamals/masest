// Commit-gated CMS publish: build-content exposes reusable, side-effect-free
// snapshot builders, and tools/publish-content.mjs regenerates the committed
// snapshots from published entries so a human can review + commit them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { snapshotPayloads, writeSnapshots, loadEntries } from "../tools/build-content.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

const ENTRIES = [
  {
    type: "pricing_tier", slug: "essentials", title: "Essentials", status: "published", locale: "en",
    payload: { name: "Essentials", badge: "Bronze", features: ["a", "b"], featured: false, sort_order: 1, active: true },
    seo: {},
  },
  {
    type: "faq_block", slug: "shipping", title: "Shipping", status: "published", locale: "en",
    payload: { question: "Q?", answer: "A." }, seo: {},
  },
  // A draft must never reach the public snapshot.
  {
    type: "pricing_tier", slug: "draft-tier", title: "Draft", status: "draft", locale: "en",
    payload: { name: "Draft", sort_order: 9 }, seo: {},
  },
];

test("importing build-content.mjs is side-effect-free (exposes builders, runs no CLI)", () => {
  assert.equal(typeof snapshotPayloads, "function");
  assert.equal(typeof writeSnapshots, "function");
  assert.equal(typeof loadEntries, "function");
});

test("snapshotPayloads merges payload + drops drafts, keyed per snapshot file", () => {
  const out = snapshotPayloads(ENTRIES);
  assert.deepEqual(Object.keys(out).sort(), [
    "faqs.json", "industries.json", "page-meta.json", "page-sections.json",
    "pricing.json", "proof.json", "resources.json", "services.json",
  ]);
  assert.equal(out["pricing.json"].pricing_tiers.length, 1); // draft excluded
  const tier = out["pricing.json"].pricing_tiers[0];
  assert.equal(tier.slug, "essentials");
  assert.equal(tier.badge, "Bronze");
  assert.deepEqual(tier.features, ["a", "b"]);
  assert.equal(out["faqs.json"].faq_blocks.length, 1);
});

test("writeSnapshots writes every file + a manifest with counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "masest-publish-"));
  try {
    const names = writeSnapshots(ENTRIES, dir);
    const written = readdirSync(dir);
    for (const name of names) assert.ok(written.includes(name), `${name} written`);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.files["pricing.json"].count, 1);
    assert.equal(manifest.files["faqs.json"].count, 1);
    assert.match(manifest.files["pricing.json"].sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSnapshots regenerates empty snapshots for zero published entries (not skipped)", () => {
  // Guards the null-vs-empty distinction: a configured source with no published
  // rows must still rewrite every snapshot as empty (so the live site clears),
  // never leave stale files. (An empty array is truthy — it does not skip.)
  const dir = mkdtempSync(join(tmpdir(), "masest-publish-empty-"));
  try {
    const names = writeSnapshots([], dir);
    for (const name of names) {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
      for (const arr of Object.values(parsed)) assert.deepEqual(arr, []);
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.files["pricing.json"].count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSnapshots is idempotent — unchanged content keeps generated_at (no churn)", () => {
  const dir = mkdtempSync(join(tmpdir(), "masest-publish-idem-"));
  try {
    writeSnapshots(ENTRIES, dir);
    const first = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).generated_at;
    writeSnapshots(ENTRIES, dir); // same content again
    const second = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).generated_at;
    assert.equal(second, first, "timestamp must be sticky when content is unchanged");
    // Changing content rewrites the affected file (deterministic, clock-independent).
    const changed = [...ENTRIES, { type: "faq_block", slug: "returns", title: "Returns", status: "published", locale: "en", payload: { question: "R?", answer: "Yes." }, seo: {} }];
    writeSnapshots(changed, dir);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.files["faqs.json"].count, 2, "changed content must be rewritten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish:content regenerates snapshots from CONTENT_EXPORT_SOURCE", () => {
  const dir = mkdtempSync(join(tmpdir(), "masest-publish-cli-"));
  try {
    const stdout = execFileSync(process.execPath, ["tools/publish-content.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, CONTENT_EXPORT_OUT_DIR: dir, CONTENT_EXPORT_SOURCE: JSON.stringify(ENTRIES) },
    });
    assert.match(stdout, /regenerated snapshots from 2 published entries/);
    const pricing = JSON.parse(readFileSync(join(dir, "pricing.json"), "utf8"));
    assert.equal(pricing.pricing_tiers.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish:content errors with setup help when no source is configured", () => {
  const dir = mkdtempSync(join(tmpdir(), "masest-publish-none-"));
  try {
    // Strip every content-source env var so the script hits the unconfigured path.
    const env = { ...process.env };
    delete env.CONTENT_EXPORT_SOURCE;
    delete env.SUPABASE_URL;
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    delete env.SUPABASE_DB_URL;
    delete env.CONTENT_DB_URL;
    env.CONTENT_EXPORT_OUT_DIR = dir;
    let threw = false;
    try {
      execFileSync(process.execPath, ["tools/publish-content.mjs"], { cwd: ROOT, encoding: "utf8", env });
    } catch (err) {
      threw = true;
      assert.match(String(err.stderr || ""), /no content source configured/);
      assert.match(String(err.stderr || ""), /SUPABASE_DB_URL/);
    }
    assert.ok(threw, "exits non-zero when no source configured");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
