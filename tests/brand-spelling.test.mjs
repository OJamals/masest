import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("tracked text uses the canonical VertKleen brand spelling", () => {
  const wrongSpellings = [
    ["Vert", "Klean"].join(""),
    ["Vert", "Clean"].join(""),
  ];
  const result = spawnSync(
    "git",
    ["grep", "-n", "-I", "-i", "-E", wrongSpellings.join("|"), "--", "."],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );

  assert.equal(
    result.status,
    1,
    `found noncanonical brand spelling:\n${result.stdout || result.stderr}`,
  );
});
