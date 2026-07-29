import { canonicalPublicImageUrl } from "../../js/image-url.js";
import { activeContentLock } from "./content.js";

function referenceKey(value) {
  const canonical = canonicalPublicImageUrl(value).split(/[?#]/, 1)[0];
  if (!canonical) return "";
  try {
    const url = new URL(canonical, "https://masest.co");
    if (/^(?:www\.)?masest\.co$/i.test(url.hostname) && /^\/img\//i.test(url.pathname)) {
      return url.pathname;
    }
  } catch {
    return canonical;
  }
  return canonical;
}

function collectReferences(value, path, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferences(item, `${path}[${index}]`, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectReferences(item, path ? `${path}.${key}` : key, found);
    });
  } else if (typeof value === "string") {
    found.push({ value, path });
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assetReferencePattern(source) {
  const boundary = "[^A-Za-z0-9._~%+@/:-]";
  return new RegExp(`(^|${boundary})${escapeRegExp(source)}(?=$|${boundary})`, "g");
}

function containsAssetReference(value, source) {
  return assetReferencePattern(source).test(String(value));
}

function replacementPairs(source = {}, target = {}) {
  const targetUrl = String(target.public_url || target.source_url || target.storage_path || "").trim();
  const pairs = new Map();
  [source.public_url, source.source_url, source.storage_path].forEach((value) => {
    const alias = String(value || "").trim();
    if (alias && targetUrl && alias !== targetUrl) pairs.set(alias, targetUrl);
  });
  return [...pairs.entries()].sort(([left], [right]) => right.length - left.length);
}

function replaceAssetReference(value, pairs) {
  return pairs.reduce((current, [source, target]) => {
    return current.replace(assetReferencePattern(source), (_match, prefix) => `${prefix}${target}`);
  }, String(value));
}

function replaceAssetReferences(value, path, pairs, fields) {
  if (Array.isArray(value)) {
    return value.map((item, index) => replaceAssetReferences(item, `${path}[${index}]`, pairs, fields));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      replaceAssetReferences(item, path ? `${path}.${key}` : key, pairs, fields),
    ]));
  }
  if (typeof value !== "string") return value;
  const after = replaceAssetReference(value, pairs);
  if (after !== value) fields.push({ path, before: value, after });
  return after;
}

export function withContentAssetReferences(assets = [], entries = []) {
  const aliases = new Map();
  const references = new Map();
  assets.forEach((asset, index) => {
    references.set(index, new Map());
    [asset.storage_path, asset.public_url, asset.source_url].forEach((value) => {
      const key = referenceKey(value);
      if (key) {
        const matches = aliases.get(key) || new Set();
        matches.add(index);
        aliases.set(key, matches);
      }
    });
  });

  entries.forEach((entry) => {
    const found = [];
    collectReferences(entry.payload, "payload", found);
    collectReferences(entry.seo, "seo", found);
    found.forEach(({ value, path }) => {
      const keys = new Set();
      const exact = referenceKey(value);
      if (aliases.has(exact)) keys.add(exact);
      if (String(value).includes("/")) {
        aliases.forEach((_matches, key) => {
          if (containsAssetReference(value, key)) keys.add(key);
        });
      }
      keys.forEach((key) => aliases.get(key).forEach((assetIndex) => {
        const entryKey = `${entry.type}:${entry.slug}:${entry.locale || "en"}`;
        const impacted = references.get(assetIndex);
        const reference = impacted.get(entryKey) || {
          type: entry.type,
          slug: entry.slug,
          locale: entry.locale || "en",
          status: entry.status,
          title: entry.title,
          fields: [],
        };
        if (!reference.fields.includes(path)) reference.fields.push(path);
        impacted.set(entryKey, reference);
      }));
    });
  });

  return assets.map((asset, index) => {
    const impacted = [...references.get(index).values()];
    return { ...asset, reference_count: impacted.length, references: impacted };
  });
}

export function planContentAssetReplacement({ source = {}, target = {}, entries = [] } = {}) {
  const pairs = replacementPairs(source, target);
  const changes = [];
  entries.forEach((entry) => {
    const fields = [];
    const payload = replaceAssetReferences(entry.payload, "payload", pairs, fields);
    const seo = replaceAssetReferences(entry.seo, "seo", pairs, fields);
    if (!fields.length) return;
    changes.push({
      id: entry.id,
      type: entry.type,
      slug: entry.slug,
      locale: entry.locale || "en",
      title: entry.title,
      status: entry.status,
      version: Number(entry.version || 0),
      fields,
      current: entry,
      next: { ...entry, payload, seo },
    });
  });
  return { source, target, changes };
}

function publicReplacementPreview(plan, impactHash) {
  const changes = plan.changes.map(({ current: _current, next: _next, ...change }) => change);
  return {
    source: plan.source,
    target: plan.target,
    change_count: changes.length,
    field_count: changes.reduce((total, change) => total + change.fields.length, 0),
    changes,
    impact_hash: impactHash,
    rollback: "Each changed content entry keeps its prior version. Roll back from Revisions.",
  };
}

async function sha256Hex(body) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function replacementImpactHash(plan) {
  const material = {
    source: plan.source.storage_path,
    target: plan.target.storage_path,
    changes: plan.changes.map((change) => ({
      id: change.id,
      type: change.type,
      slug: change.slug,
      locale: change.locale,
      version: change.version,
      fields: change.fields,
    })),
  };
  return sha256Hex(new TextEncoder().encode(JSON.stringify(material)));
}

export function createContentAssetReplacementService({
  repository,
  publicAsset = (asset) => asset,
  isContentLocked = activeContentLock,
  audit = async () => {},
} = {}) {
  if (!repository) throw new Error("content_repository_required");

  async function replacementPlan({ sourceStoragePath, targetStoragePath } = {}) {
    const sourcePath = String(sourceStoragePath || "").trim();
    const targetPath = String(targetStoragePath || "").trim();
    if (!sourcePath || !targetPath) {
      return { status: 400, body: { error: "source_and_target_required" } };
    }
    if (sourcePath === targetPath) {
      return { status: 409, body: { error: "replacement_asset_must_differ" } };
    }
    const [sourceRow, targetRow, entries] = await Promise.all([
      repository.getAsset(sourcePath),
      repository.getAsset(targetPath),
      repository.list({ status: "", locale: "" }),
    ]);
    if (!sourceRow || !targetRow) return { status: 404, body: { error: "asset_not_found" } };
    if (sourceRow.status !== "available" || targetRow.status !== "available") {
      return { status: 409, body: { error: "replacement_asset_unavailable" } };
    }
    const plan = planContentAssetReplacement({
      source: publicAsset(sourceRow),
      target: publicAsset(targetRow),
      entries,
    });
    const impactHash = await replacementImpactHash(plan);
    return { status: 200, plan, preview: publicReplacementPreview(plan, impactHash) };
  }

  async function preview(input = {}) {
    const result = await replacementPlan(input);
    if (result.status !== 200) return result;
    return { status: 200, body: { ok: true, preview: result.preview } };
  }

  async function apply({
    sourceStoragePath,
    targetStoragePath,
    impactHash,
    confirm,
    user,
  } = {}) {
    if (confirm !== "replace_everywhere") {
      return { status: 409, body: { error: "replace_everywhere_confirmation_required" } };
    }
    const input = { sourceStoragePath, targetStoragePath };
    const result = await replacementPlan(input);
    if (result.status !== 200) return result;
    if (!impactHash || impactHash !== result.preview.impact_hash) {
      return {
        status: 409,
        body: {
          error: "asset_impact_changed",
          message: "Content references changed. Review the updated diff before applying.",
          preview: result.preview,
        },
      };
    }

    const locked = result.plan.changes.find((change) => {
      return isContentLocked(change.current)
        && String(change.current.locked_by) !== String(user?.id);
    });
    if (locked) {
      return {
        status: 409,
        body: {
          error: "content_locked",
          message: `${locked.title || locked.slug} is being edited. Retry after its lock is released.`,
          entry: {
            type: locked.type,
            slug: locked.slug,
            locale: locked.locale,
            locked_by: locked.current.locked_by,
            locked_at: locked.current.locked_at,
          },
        },
      };
    }

    const applied = [];
    let failureCode = "";
    try {
      for (const change of result.plan.changes) {
        const saved = await repository.saveEntry(
          change.next,
          user?.id,
          `Media replaced: ${result.plan.source.storage_path} → ${result.plan.target.storage_path}`,
          { expectedVersion: change.version },
        );
        if (!saved.ok) {
          failureCode = saved.error || "content_save_failed";
          throw new Error(failureCode);
        }
        applied.push({ change, entry: saved.entry });
      }
    } catch (error) {
      const rollbackFailures = [];
      for (const item of [...applied].reverse()) {
        try {
          const restored = await repository.saveEntry(
            item.change.current,
            user?.id,
            "Automatic rollback after failed media replacement",
            { expectedVersion: item.entry.version },
          );
          if (!restored.ok) rollbackFailures.push(item.change.id || item.change.slug);
        } catch {
          rollbackFailures.push(item.change.id || item.change.slug);
        }
      }
      if (failureCode === "content_version_conflict" && !rollbackFailures.length) {
        const refreshed = await replacementPlan(input);
        return {
          status: 409,
          body: {
            error: "asset_impact_changed",
            message: "Content changed during replacement. Review the updated diff before applying again.",
            preview: refreshed.status === 200 ? refreshed.preview : undefined,
            rolled_back: applied.length,
            rollback_failures: [],
          },
        };
      }
      return {
        status: 500,
        body: {
          error: "replace_everywhere_failed",
          message: error.message,
          rolled_back: applied.length - rollbackFailures.length,
          rollback_failures: rollbackFailures,
        },
      };
    }

    await audit({
      user,
      action: "content_asset.references_replaced",
      targetType: "content_asset",
      targetId: result.plan.source.storage_path,
      detail: {
        source_storage_path: result.plan.source.storage_path,
        target_storage_path: result.plan.target.storage_path,
        impact_hash: result.preview.impact_hash,
        replaced_entries: applied.length,
        replaced_fields: result.preview.field_count,
        revisions: applied.map(({ change, entry }) => ({
          type: change.type,
          slug: change.slug,
          locale: change.locale,
          previous_version: change.version,
          current_version: entry.version,
        })),
      },
    });
    return {
      status: 200,
      body: {
        ok: true,
        target: result.preview.target,
        replaced_entries: applied.length,
        replaced_fields: result.preview.field_count,
        rollback: applied.map(({ change, entry }) => ({
          type: change.type,
          slug: change.slug,
          locale: change.locale,
          version: change.version,
          current_version: entry.version,
        })),
      },
    };
  }

  return { preview, apply };
}
