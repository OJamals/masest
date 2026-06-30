import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("Playwright tool specs use unique static-server ports", () => {
  const toolsDir = new URL("../tools", import.meta.url);
  const seen = new Map();
  const duplicates = [];

  for (const file of readdirSync(toolsDir).filter((name) => name.endsWith(".spec.mjs"))) {
    const source = readFileSync(join(toolsDir.pathname, file), "utf8");
    const match = source.match(/\bconst\s+PORT\s*=\s*(\d+)\s*;/);
    if (!match) continue;
    const port = match[1];
    if (seen.has(port)) {
      duplicates.push(`${port}: ${seen.get(port)}, ${file}`);
    } else {
      seen.set(port, file);
    }
  }

  assert.deepEqual(duplicates, []);
});
