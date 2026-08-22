import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCANNED_EXTENSIONS = new Set([".html", ".js", ".json", ".mjs", ".sql", ".svg", ".xml"]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".claude",
  ".codebase-memory",
  "artifacts",
  "dist",
  "docs",
  "node_modules",
  "tests",
  "tmp",
]);

const GLOBAL_LINE_CLAIMS = [
  /every\s+(?:current\s+)?VertKleen product(?:s)?(?:\s+MASEST offers)?[^.!?]{0,100}HMIS\s+0-0-0/i,
  /HMIS\s+0-0-0[^.!?]{0,100}every\s+(?:current\s+)?VertKleen product/i,
  /(?:complete|entire)\s+(?:current\s+)?HMIS\s+0-0-0\s+VertKleen line/i,
  /(?:complete|entire)\s+(?:current\s+)?VertKleen line[^.!?]{0,80}HMIS\s+0-0-0/i,
  /HMIS\s+0-0-0\s+across\s+(?:the\s+)?(?:entire\s+|current\s+|offered\s+)?(?:VertKleen\s+)?line/i,
  /linewide\s+HMIS\s+0-0-0/i,
];

const walk = (root, directory = root, files = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith("audit-")) {
        walk(root, join(directory, entry.name), files);
      }
      continue;
    }
    if (!entry.isFile() || !SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const path = join(directory, entry.name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (rel === "tools/marketing-claim-policy.mjs") continue;
    files.push({ path, rel });
  }
  return files;
};

export function findUnsupportedGlobalClaims(rootUrl = new URL("../", import.meta.url)) {
  const root = fileURLToPath(rootUrl);
  const violations = [];
  for (const { path, rel } of walk(root)) {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (GLOBAL_LINE_CLAIMS.some((pattern) => pattern.test(line))) {
        violations.push({
          file: rel,
          line: index + 1,
          excerpt: line.trim().slice(0, 240),
        });
      }
    }
  }
  return violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const violations = findUnsupportedGlobalClaims();
  if (violations.length) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line}: unsupported line-wide claim`);
    }
    process.exitCode = 1;
  } else {
    console.log("marketing-claim-policy: no unsupported line-wide claims");
  }
}
