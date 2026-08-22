import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatUpdateIntakeReport,
  scanUpdateDirectory,
  scanUpdateText,
} from "../tools/update-intake-security.mjs";

const root = new URL("../", import.meta.url);

function fakeSecret() {
  return ["not", "a", "real", "credential", "for", "testing"].join("-");
}

test("update intake detects credential assignments without retaining secret values", () => {
  const secret = fakeSecret();
  const findings = scanUpdateText(`Deployment notes\nAPI key: ${secret}\n`, "notes.txt");

  assert.deepEqual(
    findings.map(({ detector, path, line }) => ({ detector, path, line })),
    [{ detector: "secret-assignment", path: "notes.txt", line: 2 }],
  );
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret));
  assert.doesNotMatch(formatUpdateIntakeReport({ findings, scannedFiles: 1, skippedFiles: [] }), new RegExp(secret));
});

test("update intake ignores placeholders and ordinary product copy", () => {
  const findings = scanUpdateText([
    "API key: <set-in-cloudflare>",
    "Password: ${PASSWORD}",
    "Token: REDACTED",
    "Use one product for salt, oil, and oxidation.",
  ].join("\n"), "safe.txt");

  assert.deepEqual(findings, []);
});

test("update intake catches hyphen-delimited password fields", () => {
  const secret = fakeSecret();
  const findings = scanUpdateText(`Password-${secret}\n`, "legacy-notes.txt");

  assert.equal(findings.length, 1);
  assert.equal(findings[0].detector, "secret-assignment");
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret));
});

test("directory scan blocks credential-bearing files and refuses symlinks", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-update-intake-"));
  const secret = fakeSecret();
  try {
    mkdirSync(join(fixture, "nested"));
    writeFileSync(join(fixture, "nested", "notes.rtf"), `{\\rtf1 Password: ${secret}}`);
    writeFileSync(join(fixture, "safe.txt"), "No credentials here.");
    symlinkSync(join(fixture, "safe.txt"), join(fixture, "linked.txt"));

    const report = scanUpdateDirectory(fixture);
    assert.equal(report.scannedFiles, 2);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].path, "nested/notes.rtf");
    assert.deepEqual(report.skippedFiles, [{ path: "linked.txt", reason: "symlink" }]);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("directory scan inspects Office XML archives without leaking values", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-update-office-"));
  const source = join(fixture, "source");
  const intake = join(fixture, "intake");
  const secret = fakeSecret();
  try {
    mkdirSync(join(source, "word"), { recursive: true });
    mkdirSync(intake);
    writeFileSync(join(source, "[Content_Types].xml"), "<Types />");
    writeFileSync(join(source, "word", "document.xml"), `<w:t>API key: ${secret}</w:t>`);
    execFileSync("zip", ["-q", "-r", join(intake, "notes.docx"), "[Content_Types].xml", "word"], { cwd: source });

    const report = scanUpdateDirectory(intake);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].path, "notes.docx");
    assert.equal(report.skippedFiles.length, 0);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("directory scan catches label-only credentials in RTF fields", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-update-rtf-"));
  const secret = fakeSecret();
  try {
    writeFileSync(join(fixture, "login.rtf"), `{\\rtf1 Portal access\\par Password:\\par ${secret}\\par}`);
    const report = scanUpdateDirectory(fixture);

    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].path, "login.rtf");
    assert.equal(report.findings[0].detector, "secret-field");
    assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("CLI fails closed and never prints detected values", () => {
  const fixture = mkdtempSync(join(tmpdir(), "masest-update-intake-cli-"));
  const secret = fakeSecret();
  try {
    writeFileSync(join(fixture, "private.txt"), `client_secret=${secret}\n`);
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../tools/update-intake-security.mjs", import.meta.url)), fixture],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(output, /Update intake blocked/);
    assert.match(output, /private\.txt/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.equal(readFileSync(join(fixture, "private.txt"), "utf8"), `client_secret=${secret}\n`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
