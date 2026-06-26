import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("build-content writes a manifest with counts and generated timestamp", () => {
  const outDir = mkdtempSync(join(tmpdir(), "masest-content-manifest-"));
  try {
    execFileSync(process.execPath, ["tools/build-content.mjs"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        CONTENT_EXPORT_OUT_DIR: outDir,
        CONTENT_EXPORT_SOURCE: JSON.stringify([
          {
            type: "service",
            slug: "water-analysis",
            title: "Water analysis",
            status: "published",
            locale: "en",
            payload: { sku: "MS-LAB-WATER", category: "Lab", active: true },
            seo: {},
          },
          {
            type: "service_package",
            slug: "quarterly-audit",
            title: "Quarterly audit",
            status: "published",
            locale: "en",
            payload: { sku: "MS-PKG-QUARTERLY", category: "Service Packages", active: true },
            seo: {},
          },
          {
            type: "faq_block",
            slug: "shipping",
            title: "Shipping",
            status: "published",
            locale: "en",
            payload: { question: "How does freight work?", answer: "Reviewed during quote." },
            seo: {},
          },
        ]),
      },
    });
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    assert.equal(typeof manifest.generated_at, "string");
    assert.equal(manifest.files["faqs.json"].count, 1);
    assert.equal(manifest.files["services.json"].count, 2);
    assert.deepEqual(manifest.files["services.json"].counts, {
      services: 1,
      service_packages: 1,
    });
    assert.match(manifest.files["faqs.json"].sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("admin content export status renders manifest group counts", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /manifestFileRows/);
  assert.match(source, /meta\.counts/);
  assert.match(source, /contentManifestRows/);
});
