#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IMAGE_ROOT = join(ROOT, "img");
const LEDGER_PATH = join(ROOT, "data/image-optimization.json");
const MIN_SAVINGS_RATIO = 0.02;
const MIN_SSIM_DB = 18;
const WEBP_QUALITY = 82;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) walk(file, files);
    else if ([".png", ".webp"].includes(extname(entry.name).toLowerCase())) files.push(file);
  }
  return files;
}

function previousEntries() {
  if (!existsSync(LEDGER_PATH)) return new Map();
  try {
    const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    return new Map((ledger.assets || []).map((asset) => [asset.path, asset]));
  } catch {
    return new Map();
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") throw new Error(`${command} is required to optimize site images`);
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function webpCandidate(source, target) {
  const output = run("cwebp", [
    "-q", String(WEBP_QUALITY),
    "-m", "6",
    "-af",
    "-sharp_yuv",
    "-metadata", "none",
    "-print_ssim",
    source,
    "-o", target,
  ]);
  const ssimDb = Number(output.match(/SSIM:.*?Total:([0-9.]+)/)?.[1]);
  if (!Number.isFinite(ssimDb)) throw new Error(`cwebp did not report SSIM for ${source}`);
  return ssimDb;
}

function pngCandidate(source, target) {
  run("ffmpeg", [
    "-loglevel", "error",
    "-i", source,
    "-frames:v", "1",
    "-compression_level", "9",
    "-pred", "mixed",
    "-y",
    target,
  ]);
  return Number.POSITIVE_INFINITY;
}

export function shouldReplaceCandidate({
  originalBytes,
  optimizedBytes,
  ssimDb,
  minSavingsRatio = MIN_SAVINGS_RATIO,
  minSsimDb = MIN_SSIM_DB,
}) {
  if (![originalBytes, optimizedBytes].every((value) => Number.isFinite(value))) return false;
  if (!Number.isFinite(ssimDb) && ssimDb !== Number.POSITIVE_INFINITY) return false;
  if (originalBytes <= 0 || optimizedBytes <= 0 || optimizedBytes >= originalBytes) return false;
  const savingsRatio = (originalBytes - optimizedBytes) / originalBytes;
  return savingsRatio >= minSavingsRatio && ssimDb >= minSsimDb;
}

export function optimizeSiteImages({ apply = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "masest-images-"));
  const previous = previousEntries();
  const assets = [];
  let originalBytes = 0;
  let finalBytes = 0;
  let optimized = 0;
  let unchanged = 0;
  let alreadyOptimized = 0;

  try {
    for (const [index, source] of walk(IMAGE_ROOT).sort().entries()) {
      const publicPath = relative(ROOT, source).replaceAll("\\", "/");
      const currentHash = sha256(source);
      const sourceBytes = statSync(source).size;
      const prior = previous.get(publicPath);
      originalBytes += sourceBytes;

      if (prior?.sha256 === currentHash) {
        alreadyOptimized += 1;
        finalBytes += sourceBytes;
        assets.push(prior);
        continue;
      }

      const extension = extname(source).toLowerCase();
      const candidate = join(temp, `${index}${extension}`);
      const ssimDb = extension === ".webp"
        ? webpCandidate(source, candidate)
        : pngCandidate(source, candidate);
      const candidateBytes = statSync(candidate).size;
      const replace = shouldReplaceCandidate({
        originalBytes: sourceBytes,
        optimizedBytes: candidateBytes,
        ssimDb,
      });

      if (replace) {
        optimized += 1;
        finalBytes += candidateBytes;
        if (apply) copyFileSync(candidate, source);
      } else {
        unchanged += 1;
        finalBytes += sourceBytes;
      }

      const finalHash = apply && replace ? sha256(source) : currentHash;
      assets.push({
        path: publicPath,
        sha256: finalHash,
        byte_size: replace ? candidateBytes : sourceBytes,
        action: replace ? "optimized" : "retained",
      });
    }

    if (apply) {
      mkdirSync(dirname(LEDGER_PATH), { recursive: true });
      writeFileSync(LEDGER_PATH, `${JSON.stringify({
        version: 1,
        policy: {
          webp_quality: WEBP_QUALITY,
          min_savings_ratio: MIN_SAVINGS_RATIO,
          min_ssim_db: MIN_SSIM_DB,
          png: "lossless",
        },
        assets,
      }, null, 2)}\n`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  return {
    apply,
    files: assets.length,
    optimized,
    retained: unchanged,
    already_optimized: alreadyOptimized,
    original_bytes: originalBytes,
    final_bytes: finalBytes,
    saved_bytes: originalBytes - finalBytes,
    saved_percent: originalBytes
      ? Number((((originalBytes - finalBytes) / originalBytes) * 100).toFixed(1))
      : 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(optimizeSiteImages({ apply: process.argv.includes("--apply") }), null, 2));
}
