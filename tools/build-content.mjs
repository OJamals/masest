#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { publicContentSnapshot } from "../functions/_lib/content.js";
import { snapshotGroups } from "../js/content-types.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = process.env.CONTENT_EXPORT_OUT_DIR || join(ROOT, "data/content");

// Default published-entry ordering used by every snapshot source (Supabase REST,
// the pooler, and CONTENT_EXPORT_SOURCE) so regenerated files are byte-stable
// regardless of which path produced them.
export const ENTRY_ORDER_SQL = "status='published' order by type asc, slug asc";

function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  return text;
}

function manifestEntry(text, value) {
  const counts = Object.fromEntries(
    Object.entries(value)
      .filter(([, rows]) => Array.isArray(rows))
      .map(([key, rows]) => [key, rows.length]),
  );
  return {
    count: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function snapshotRow(entry, type) {
  const service = type === "service" || type === "service_package";
  return {
    slug: entry.slug,
    ...(!service ? { title: entry.title } : {}),
    ...entry.payload,
    ...(service ? { name: entry.payload?.name || entry.title } : {}),
    seo: entry.seo,
  };
}

// Map published content_entries → the per-file snapshot payloads. Pure: same
// entries always yield the same payloads, so build-content and publish-content
// produce byte-identical output.
export function snapshotPayloads(entries) {
  const snapshot = publicContentSnapshot(entries);
  return Object.fromEntries(snapshotGroups().map(({ file, types }) => [
    file,
    Object.fromEntries(types.map(({ type, key }) => [
      key,
      (snapshot[type] || []).map((entry) => snapshotRow(entry, type)),
    ])),
  ]));
}

// Read the prior manifest's generated_at, but only if every file's sha matches —
// so regenerating an unchanged snapshot set keeps the same timestamp and produces
// no git diff. Makes publishing deterministic: a diff means content actually changed.
function stableGeneratedAt(outDir, files) {
  try {
    const prev = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    const prevFiles = prev?.files || {};
    const keys = Object.keys(files);
    const unchanged = keys.length === Object.keys(prevFiles).length
      && keys.every((f) => prevFiles[f]?.sha256 === files[f].sha256);
    if (unchanged && typeof prev.generated_at === "string") return prev.generated_at;
  } catch { /* no prior manifest — fall through to a fresh timestamp */ }
  return new Date().toISOString();
}

// Total rows across every snapshot key in a payload object ({ key: [...rows] }).
export function snapshotRowCount(payload) {
  let total = 0;
  for (const value of Object.values(payload || {})) {
    if (Array.isArray(value)) total += value.length;
  }
  return total;
}

// Find snapshots that would be regenerated down to zero rows while a non-empty
// version already exists on disk. This is the silent-wipe failure mode: an empty
// or partial source (unreachable DB, wrong credentials) would otherwise blow away
// live content and publish the deletion. Returns "file: N → 0" descriptions.
export function findSnapshotWipes(payloads, outDir) {
  const wipes = [];
  for (const [file, payload] of Object.entries(payloads)) {
    if (snapshotRowCount(payload) > 0) continue;
    const path = join(outDir, file);
    if (!existsSync(path)) continue;
    let oldCount = 0;
    try {
      oldCount = snapshotRowCount(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      continue;
    }
    if (oldCount > 0) wipes.push(`${file}: ${oldCount} → 0`);
  }
  return wipes;
}

// Write all snapshot files + manifest into outDir. Returns the list of file names.
// Refuses to wipe a currently non-empty snapshot to zero rows (e.g. from an empty
// or partial source) unless allowEmpty is set — guarding both `build:content` and
// `publish:content`, which both funnel through here.
export function writeSnapshots(entries, outDir = OUT_DIR, { allowEmpty = false } = {}) {
  mkdirSync(outDir, { recursive: true });
  const writes = snapshotPayloads(entries);
  if (!allowEmpty) {
    const wipes = findSnapshotWipes(writes, outDir);
    if (wipes.length) {
      throw new Error(
        `refusing to wipe non-empty snapshots to zero rows: ${wipes.join("; ")}. ` +
        "The content source returned no rows (unreachable DB, wrong credentials, or a " +
        "partial pull). Pass { allowEmpty: true } / --allow-empty if the deletion is intentional.",
      );
    }
  }
  const files = {};
  for (const [file, value] of Object.entries(writes)) {
    files[file] = manifestEntry(writeJson(join(outDir, file), value), value);
  }
  writeJson(join(outDir, "manifest.json"), { generated_at: stableGeneratedAt(outDir, files), files });
  return Object.keys(writes);
}

export async function loadEntries() {
  if (process.env.CONTENT_EXPORT_SOURCE) return JSON.parse(process.env.CONTENT_EXPORT_SOURCE);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb
    .from("content_entries")
    .select("*")
    .eq("status", "published")
    .order("type", { ascending: true })
    .order("slug", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function main() {
  const entries = await loadEntries();
  // loadEntries returns null ONLY when no source is configured — skip then.
  // An empty array means the source IS configured with zero published entries,
  // which must still regenerate (writing empty snapshots), so guard on null
  // explicitly rather than falsiness (an empty array is truthy anyway).
  if (entries === null) {
    console.log("build-content: content source not configured; no snapshots written");
    return;
  }
  writeSnapshots(entries, OUT_DIR, { allowEmpty: process.argv.includes("--allow-empty") });
}

// Run the CLI only when invoked directly — importing this module (publish-content,
// tests) must be side-effect-free.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
