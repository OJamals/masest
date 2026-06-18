import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["functions", "js", "tools"];
const excluded = new Set(["node_modules", ".git", "dist", "test-results"]);
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (excluded.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (path.endsWith(".js") || path.endsWith(".mjs")) files.push(path);
  }
}

for (const root of roots) walk(root);
files.sort();

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`Syntax check failed: ${relative(process.cwd(), file)}\n`);
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
