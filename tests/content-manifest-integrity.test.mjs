// Guard: verify_site must fail when a committed data/content snapshot no longer
// hashes to its manifest sha256. The publish workflow (npm run publish:content)
// trusts those shas to decide "nothing to publish", so a stale/hand-edited
// manifest must break the gate rather than silently mislead a publish.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = fileURLToPath(new URL("../data/content/manifest.json", import.meta.url));

function runVerifySite() {
  try {
    execFileSync(process.execPath, ["tools/verify_site.mjs"], { cwd: ROOT, encoding: "utf8" });
    return { code: 0, out: "" };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

test("verify_site passes with the committed (consistent) manifest", () => {
  assert.equal(runVerifySite().code, 0, "baseline verify_site must pass");
});

test("verify_site fails when a snapshot sha drifts from the manifest", () => {
  const original = readFileSync(MANIFEST); // raw bytes, restored verbatim below
  try {
    const manifest = JSON.parse(original.toString("utf8"));
    // Forge a wrong sha for one snapshot without touching the file itself.
    manifest.files["pricing.json"].sha256 = "0".repeat(64);
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    const { code, out } = runVerifySite();
    assert.equal(code, 1, "tampered manifest must fail the gate");
    assert.match(out, /pricing\.json sha256 does not match manifest/);
  } finally {
    writeFileSync(MANIFEST, original); // restore exact original bytes
  }
});
