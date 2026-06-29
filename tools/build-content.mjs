#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { publicContentSnapshot } from "../functions/_lib/content.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = process.env.CONTENT_EXPORT_OUT_DIR || join(ROOT, "data/content");

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

function servicesPayload(snapshot) {
  return {
    services: (snapshot.service || []).map((entry) => ({
      slug: entry.slug,
      ...entry.payload,
      name: entry.payload?.name || entry.title,
      seo: entry.seo,
    })),
    service_packages: (snapshot.service_package || []).map((entry) => ({
      slug: entry.slug,
      ...entry.payload,
      name: entry.payload?.name || entry.title,
      seo: entry.seo,
    })),
  };
}

function pageMetaPayload(snapshot) {
  return {
    page_meta: (snapshot.page_meta || []).map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      ...entry.payload,
      seo: entry.seo,
    })),
  };
}

function typedPayload(snapshot, type, key) {
  return {
    [key]: (snapshot[type] || []).map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      ...entry.payload,
      seo: entry.seo,
    })),
  };
}

async function loadEntries() {
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
  mkdirSync(OUT_DIR, { recursive: true });

  const entries = await loadEntries();
  if (!entries) {
    console.log("build-content: content source not configured; no snapshots written");
    return;
  }

  const snapshot = publicContentSnapshot(entries);
  const writes = {
    "services.json": servicesPayload(snapshot),
    "page-meta.json": pageMetaPayload(snapshot),
    "proof.json": typedPayload(snapshot, "proof_card", "proof_cards"),
    "resources.json": typedPayload(snapshot, "resource_card", "resource_cards"),
    "industries.json": typedPayload(snapshot, "industry_card", "industry_cards"),
    "faqs.json": typedPayload(snapshot, "faq_block", "faq_blocks"),
    "page-sections.json": typedPayload(snapshot, "page_section", "page_sections"),
    "pricing.json": typedPayload(snapshot, "pricing_tier", "pricing_tiers"),
  };
  const files = {};
  for (const [file, value] of Object.entries(writes)) {
    files[file] = manifestEntry(writeJson(join(OUT_DIR, file), value), value);
  }
  writeJson(join(OUT_DIR, "manifest.json"), { generated_at: new Date().toISOString(), files });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
