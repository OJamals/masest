import assert from "node:assert/strict";
import test from "node:test";
import {
  createContentAssetReplacementService,
  planContentAssetReplacement,
} from "../functions/_lib/content-asset-replacement.js";

const source = {
  storage_path: "cms/old.webp",
  public_url: "https://cdn.example/cms/old.webp",
  status: "available",
};
const target = {
  storage_path: "cms/new.webp",
  public_url: "https://cdn.example/cms/new.webp",
  status: "available",
};

function contentEntry(overrides = {}) {
  return {
    id: "entry-1",
    type: "page_section",
    slug: "home-hero",
    locale: "en",
    title: "Home hero",
    status: "published",
    version: 4,
    payload: { image: source.public_url },
    seo: { og_image: source.public_url },
    ...overrides,
  };
}

function fakeRepository({
  entries = [contentEntry()],
  failSlug = "",
} = {}) {
  const assets = new Map([
    [source.storage_path, source],
    [target.storage_path, target],
  ]);
  const saves = [];
  let failed = false;

  return {
    saves,
    entry(id) {
      return entries.find((entry) => entry.id === id);
    },
    async getAsset(path) {
      return assets.get(path) || null;
    },
    async list() {
      return entries;
    },
    async saveEntry(next, _userId, note, options) {
      const index = entries.findIndex((entry) => entry.id === next.id);
      const current = entries[index];
      saves.push({ next: structuredClone(next), note, options: { ...options } });
      if (!failed && next.slug === failSlug) {
        failed = true;
        return { ok: false, error: "content_version_conflict" };
      }
      if (Number(options?.expectedVersion) !== Number(current.version)) {
        return { ok: false, error: "content_version_conflict" };
      }
      const saved = { ...structuredClone(next), version: current.version + 1 };
      entries.splice(index, 1, saved);
      return { ok: true, entry: structuredClone(saved) };
    },
  };
}

test("replacement plan rewrites exact asset aliases and exposes changed fields", () => {
  const entry = contentEntry({
    payload: {
      image: source.public_url,
      caption: `Use ${source.storage_path} safely`,
      unrelated: `${source.storage_path}-variant`,
    },
  });

  const plan = planContentAssetReplacement({ source, target, entries: [entry] });

  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0].fields.map(({ path }) => path), [
    "payload.image",
    "payload.caption",
    "seo.og_image",
  ]);
  assert.equal(plan.changes[0].next.payload.image, target.public_url);
  assert.equal(plan.changes[0].next.payload.unrelated, `${source.storage_path}-variant`);
});

test("replacement service rejects stale previews and foreign content locks", async () => {
  const repository = fakeRepository({
    entries: [contentEntry({
      locked_by: "other-editor",
      locked_at: new Date().toISOString(),
    })],
  });
  const service = createContentAssetReplacementService({
    repository,
    publicAsset: (asset) => asset,
  });
  const preview = await service.preview({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
  });

  const stale = await service.apply({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
    impactHash: "stale",
    confirm: "replace_everywhere",
    user: { id: "owner-id" },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "asset_impact_changed");

  const locked = await service.apply({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
    impactHash: preview.body.preview.impact_hash,
    confirm: "replace_everywhere",
    user: { id: "owner-id" },
  });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, "content_locked");
  assert.equal(repository.saves.length, 0);
});

test("replacement service rolls back earlier entries with their applied versions", async () => {
  const first = contentEntry();
  const second = contentEntry({ id: "entry-2", slug: "home-footer", version: 7 });
  const repository = fakeRepository({ entries: [first, second], failSlug: second.slug });
  const service = createContentAssetReplacementService({
    repository,
    publicAsset: (asset) => asset,
  });
  const preview = await service.preview({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
  });

  const result = await service.apply({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
    impactHash: preview.body.preview.impact_hash,
    confirm: "replace_everywhere",
    user: { id: "owner-id" },
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.error, "asset_impact_changed");
  assert.equal(result.body.rolled_back, 1);
  assert.deepEqual(result.body.rollback_failures, []);
  assert.equal(repository.entry(first.id).payload.image, source.public_url);
  assert.equal(repository.entry(first.id).version, 6);
  assert.deepEqual(repository.saves.map(({ options }) => options.expectedVersion), [4, 7, 5]);
});

test("replacement service records one audit event after all versioned writes succeed", async () => {
  const repository = fakeRepository();
  const audits = [];
  const service = createContentAssetReplacementService({
    repository,
    publicAsset: (asset) => asset,
    audit: async (event) => audits.push(event),
  });
  const preview = await service.preview({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
  });

  const result = await service.apply({
    sourceStoragePath: source.storage_path,
    targetStoragePath: target.storage_path,
    impactHash: preview.body.preview.impact_hash,
    confirm: "replace_everywhere",
    user: { id: "owner-id" },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.replaced_entries, 1);
  assert.equal(result.body.replaced_fields, 2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "content_asset.references_replaced");
  assert.equal(audits[0].targetId, source.storage_path);
  assert.equal(audits[0].detail.revisions[0].previous_version, 4);
  assert.equal(audits[0].detail.revisions[0].current_version, 5);
});
