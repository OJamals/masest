import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 16 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".conf", ".csv", ".env", ".html", ".ini", ".json", ".md",
  ".rtf", ".text", ".tsv", ".txt", ".xml", ".yaml", ".yml",
]);
const ARCHIVE_EXTENSIONS = new Set([".docx", ".ods", ".odt", ".pptx", ".xlsx"]);
const IMAGE_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp",
]);
const ARCHIVE_TEXT_ENTRY = /(?:\.xml|\.rels|\.txt|\.csv)$/i;
const PLACEHOLDER = /^(?:<[^>]+>|\$\{[^}]+\}|\[[^\]]+\]|x+|redacted|removed|none|null|n\/a|not[-_ ]?set|placeholder|example|sample|changeme|protected|required|reset|policy|set[-_ ]in[-_ ](?:cloudflare|environment|env))$/i;

const DETECTORS = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/gi,
  },
  {
    id: "embedded-url-credential",
    pattern: /https?:\/\/[^\s/:]+:[^\s/@]{8,}@/gi,
  },
  {
    id: "known-token-prefix",
    pattern: /\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|github_pat_[0-9A-Za-z_]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|sk_live_[0-9A-Za-z]{16,}|rk_live_[0-9A-Za-z]{16,}|xox[baprs]-[0-9A-Za-z-]{20,})\b/g,
  },
];

const SECRET_ASSIGNMENT = /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|auth[_ -]?token|password|passwd|secret[_ -]?key|private[_ -]?key)\b[ \t]*(?::|=|-|\bis\b)[ \t]*["']?([^"'\s,;}{]{8,})/gi;
const SECRET_FIELD = /^(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|auth[_ -]?token|password|passwd|passcode|secret[_ -]?key|private[_ -]?key)\s*:?\s*$/i;

function lineAt(text, index) {
  let line = 1;
  for (let at = 0; at < index; at += 1) {
    if (text.charCodeAt(at) === 10) line += 1;
  }
  return line;
}

function normalizedRelative(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function finding(detector, path, text, index) {
  return { detector, path, line: lineAt(text, index) };
}

export function scanUpdateText(text, path = "(memory)") {
  const source = String(text || "");
  const findings = [];
  const seen = new Set();
  const add = (detector, index) => {
    const item = finding(detector, path, source, index);
    const key = `${item.detector}:${item.path}:${item.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(item);
    }
  };
  const addLine = (detector, line) => {
    const item = { detector, path, line };
    const key = `${item.detector}:${item.path}:${item.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(item);
    }
  };

  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0;
    for (const match of source.matchAll(detector.pattern)) add(detector.id, match.index);
  }

  SECRET_ASSIGNMENT.lastIndex = 0;
  for (const match of source.matchAll(SECRET_ASSIGNMENT)) {
    const rawCandidate = String(match[1] || "");
    if (PLACEHOLDER.test(rawCandidate)) continue;
    const candidate = rawCandidate.replace(/[)>\].]+$/g, "");
    if (!candidate || PLACEHOLDER.test(candidate)) continue;
    add("secret-assignment", match.index);
  }

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!SECRET_FIELD.test(lines[index].trim())) continue;
    const nextIndex = lines.findIndex((line, at) => at > index && at <= index + 3 && line.trim());
    if (nextIndex === -1) continue;
    const candidate = lines[nextIndex].trim().replace(/^["'(<\[]+|["')>\].]+$/g, "");
    if (candidate.length < 4 || candidate.length > 240 || PLACEHOLDER.test(candidate)) continue;
    addLine("secret-field", index + 1);
  }

  return findings.sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.detector.localeCompare(right.detector)
  ));
}

function rawText(path) {
  const bytes = readFileSync(path);
  return bytes.toString("utf8").replaceAll("\0", "");
}

function rtfText(path) {
  try {
    return execFileSync("textutil", ["-convert", "txt", "-stdout", path], {
      encoding: "utf8",
      maxBuffer: MAX_EXTRACTED_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
  } catch {
    // Portable fallback for CI hosts without macOS textutil.
  }
  return rawText(path)
    .replace(/\\(?:line|par[d]?)\b/gi, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\[a-z]+-?\d*\s?/gi, " ")
    .replace(/\\([{}\\])/g, "$1")
    .replace(/[{}]/g, " ");
}

function archiveText(path) {
  const entries = execFileSync("unzip", ["-Z1", path], {
    encoding: "utf8",
    maxBuffer: MAX_EXTRACTED_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).split(/\r?\n/).filter((entry) => (
    ARCHIVE_TEXT_ENTRY.test(entry)
    && !/[\[\]*?]/.test(entry)
    && !entry.startsWith("-")
    && !entry.split("/").includes("..")
  )).slice(0, 1_000);
  const chunks = [];
  let total = 0;
  for (const entry of entries) {
    const bytes = execFileSync("unzip", ["-p", path, entry], {
      encoding: "buffer",
      maxBuffer: MAX_EXTRACTED_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    total += bytes.length;
    if (total > MAX_EXTRACTED_BYTES) throw new Error("archive-expanded-too-large");
    chunks.push(bytes.toString("utf8"));
  }
  return chunks.join("\n").replace(/<[^>]+>/g, " ");
}

function pdfText(path) {
  return execFileSync("pdftotext", ["-layout", path, "-"], {
    encoding: "utf8",
    maxBuffer: MAX_EXTRACTED_BYTES,
    timeout: 20_000,
  });
}

function extractText(path, extension) {
  if (extension === ".rtf") return { text: rtfText(path) };
  if (TEXT_EXTENSIONS.has(extension)) return { text: rawText(path) };
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    try {
      return { text: archiveText(path) };
    } catch {
      return { text: rawText(path), warning: "archive-text-extraction-unavailable" };
    }
  }
  if (extension === ".pdf") {
    try {
      return { text: pdfText(path) };
    } catch {
      return { text: rawText(path), warning: "pdf-text-extraction-unavailable" };
    }
  }
  if (IMAGE_EXTENSIONS.has(extension)) return { skip: "manual-image-review" };
  return { text: rawText(path), warning: "unknown-binary-format" };
}

function walk(root, current, files, skippedFiles) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store") continue;
    const path = resolve(current, entry.name);
    const relativePath = normalizedRelative(root, path);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      skippedFiles.push({ path: relativePath, reason: "symlink" });
    } else if (info.isDirectory()) {
      walk(root, path, files, skippedFiles);
    } else if (info.isFile()) {
      files.push({ path, relativePath, size: info.size });
    }
  }
}

export function scanUpdateDirectory(sourceRoot) {
  const root = resolve(String(sourceRoot || ""));
  if (!sourceRoot || !statSync(root).isDirectory()) throw new Error("Update source root must be a directory.");
  const files = [];
  const skippedFiles = [];
  const findings = [];
  let scannedFiles = 0;
  walk(root, root, files, skippedFiles);

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      skippedFiles.push({ path: file.relativePath, reason: "file-too-large" });
      continue;
    }
    const extracted = extractText(file.path, extname(file.path).toLowerCase());
    if (extracted.skip) {
      skippedFiles.push({ path: file.relativePath, reason: extracted.skip });
      continue;
    }
    scannedFiles += 1;
    findings.push(...scanUpdateText(extracted.text, file.relativePath));
    if (extracted.warning) skippedFiles.push({ path: file.relativePath, reason: extracted.warning });
  }

  return {
    sourceRoot: root,
    scannedFiles,
    findings: findings.sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.line - right.line
      || left.detector.localeCompare(right.detector)
    )),
    skippedFiles: skippedFiles.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function formatUpdateIntakeReport(report) {
  const paths = new Set(report.findings.map((item) => item.path));
  const lines = report.findings.length
    ? [`Update intake blocked: ${report.findings.length} credential indicator(s) across ${paths.size} file(s).`]
    : [`Update intake clear: ${report.scannedFiles} file(s) scanned; no credential indicators found.`];
  for (const item of report.findings) {
    lines.push(`- ${item.path} [${item.detector}] line ${item.line}`);
  }
  if (report.skippedFiles?.length) {
    lines.push(`${report.skippedFiles.length} file(s) require separate or manual review.`);
    for (const item of report.skippedFiles) lines.push(`- ${item.path} [${item.reason}]`);
  }
  if (report.findings.length) {
    lines.push("No secret values shown. Revoke/rotate exposed credentials before publication or repository intake.");
  }
  return lines.join("\n");
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const report = scanUpdateDirectory(process.argv[2]);
    process.stdout.write(`${formatUpdateIntakeReport(report)}\n`);
    const unsafeSkip = report.skippedFiles.some(({ reason }) => reason !== "manual-image-review");
    process.exitCode = report.findings.length || unsafeSkip ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Update intake blocked: ${error.message}\n`);
    process.exitCode = 2;
  }
}
