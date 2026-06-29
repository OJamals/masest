#!/usr/bin/env node
// Publish CMS content to the live static site, commit-gated.
//
// Admin edits live in Supabase (content_entries). The public site serves the
// committed data/content/*.json snapshots, which Cloudflare Pages copies as-is
// (the build never pulls Supabase). This script regenerates those snapshots
// from the currently *published* entries so a human can review the diff and
// commit — keeping git as the source of truth for what is actually live.
//
// Usage:
//   SUPABASE_DB_URL='postgresql://…pooler…:5432/postgres' npm run publish:content
//     (or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the REST path)
//   git diff data/content/        # review
//   git add data/content/ && git commit && git push   # publish → CF deploy
//
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEntries, writeSnapshots } from "./build-content.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = process.env.CONTENT_EXPORT_OUT_DIR || join(ROOT, "data/content");
const DB_URL = process.env.SUPABASE_DB_URL || process.env.CONTENT_DB_URL || "";

// Pull published entries over a direct Postgres (pooler) connection — the path
// for operators who hold the pooler connection string rather than the REST
// service-role key. Ordered to match build-content's Supabase query so output
// stays byte-identical across sources.
async function loadEntriesFromDb(connectionString) {
  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    throw new Error(
      "SUPABASE_DB_URL is set but the 'pg' driver is not installed. Run: npm i pg --no-save",
    );
  }
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select * from public.content_entries where status='published' order by type asc, slug asc",
    );
    return rows;
  } finally {
    await client.end();
  }
}

function changedSnapshotFiles() {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "data/content"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null; // not a git checkout — skip the diff hint
  }
}

async function main() {
  const entries = DB_URL ? await loadEntriesFromDb(DB_URL) : await loadEntries();
  if (!entries) {
    console.error(
      [
        "publish-content: no content source configured.",
        "Set ONE of:",
        "  SUPABASE_DB_URL=postgresql://…pooler…:5432/postgres   (direct Postgres / pooler)",
        "  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY              (Supabase REST)",
        "Then re-run: npm run publish:content",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const published = entries.filter((e) => e?.status === "published");
  writeSnapshots(entries, OUT_DIR);
  console.log(`publish-content: regenerated snapshots from ${published.length} published entr${published.length === 1 ? "y" : "ies"}.`);

  const changed = changedSnapshotFiles();
  if (changed === null) {
    console.log(`Wrote snapshots to ${OUT_DIR}.`);
  } else if (changed.length === 0) {
    console.log("No snapshot changes — committed content already matches Supabase. Nothing to publish.");
  } else {
    console.log("\nChanged snapshot files:");
    for (const line of changed) console.log(`  ${line}`);
    console.log("\nNext: review and publish");
    console.log("  git diff data/content/");
    console.log("  git add data/content/ && git commit -m 'content: publish CMS updates' && git push");
  }
}

main().catch((error) => {
  console.error(`publish-content failed: ${error?.message || error}`);
  process.exitCode = 1;
});
