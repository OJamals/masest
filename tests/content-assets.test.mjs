import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content schema stores asset metadata, usage, and focal points", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /content_assets/);
  assert.match(sql, /alt\s+text\s+not null/);
  assert.match(sql, /focal_point\s+jsonb/);
  assert.match(sql, /usage\s+jsonb/);
  assert.match(sql, /asset_status/);
});

test("asset endpoint is staff gated and content asset permission gated", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /staffCan\(role, "content\.assets"\)/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
});

test("asset endpoint accepts multipart upload into CMS asset storage", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /request\.formData\(\)/);
  assert.match(source, /CONTENT_ASSET_BUCKET/);
  assert.match(source, /storage\/v1\/object/);
  assert.match(source, /file_required/);
  assert.match(source, /not_an_image/);
  assert.match(source, /saveAsset/);
});

test("content editor has an asset picker contract", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetPicker/);
  assert.match(source, /data-content-asset-field/);
  assert.match(source, /\/api\/admin\/content-assets/);
});

test("content editor exposes native asset upload controls", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetUpload/);
  assert.match(source, /contentAssetFile/);
  assert.match(source, /contentAssetAlt/);
  assert.match(source, /data-content-action="upload_asset"/);
  assert.match(source, /new FormData\(\)/);
});

test("admin API helper preserves FormData bodies for uploads", () => {
  const source = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
  assert.match(source, /body instanceof FormData/);
  assert.match(source, /JSON\.stringify\(body\)/);
});
