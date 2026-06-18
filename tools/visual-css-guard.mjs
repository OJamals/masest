import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const BASE_URL = "http://127.0.0.1:4179";
const OUT_ROOT = path.resolve(new URL("../test-results/css-visual", import.meta.url).pathname);
const MODES = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

function usage() {
  console.error("Usage: node tools/visual-css-guard.mjs baseline|capture|diff [label]");
  process.exit(2);
}

async function pages() {
  const rootEntries = await readdir(ROOT, { withFileTypes: true });
  const rootPages = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);
  const industryEntries = await readdir(new URL("../industries", import.meta.url), { withFileTypes: true });
  const industryPages = industryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => `industries/${entry.name}`);
  return [...rootPages, ...industryPages].sort();
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function staticPath(requestUrl) {
  const url = new URL(requestUrl, BASE_URL);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(ROOT_PATH, `.${pathname}`);
  return resolved.startsWith(ROOT_PATH) ? resolved : null;
}

async function serveStatic(request, response) {
  const filePath = staticPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    const resolved = info.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await readFile(resolved);
    response.writeHead(200, { "content-type": MIME[path.extname(resolved)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}

async function withServer(fn) {
  const server = createServer((request, response) => {
    serveStatic(request, response).catch(() => {
      response.writeHead(500).end("server error");
    });
  });
  await new Promise((resolve) => server.listen(4179, "127.0.0.1", resolve));
  try {
    return await fn();
  } finally {
    server.close();
    await Promise.race([
      once(server, "close"),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).catch(() => {});
  }
}
async function preparePage(page) {
  await page.evaluate(() => {
    document.querySelectorAll("img").forEach((image) => {
      image.loading = "eager";
      image.decoding = "sync";
    });
    document.querySelectorAll("video, audio").forEach((media) => {
      media.pause();
      media.currentTime = 0;
    });
  });
  await page.evaluate(async () => {
    const step = Math.max(400, window.innerHeight - 120);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector(".nav")?.classList.remove("scrolled");
    await Promise.all(
      Array.from(document.images, (image) => {
        if (image.complete) return Promise.resolve();
        return Promise.race([
          image.decode().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      }),
    );
  });
}

async function capture(label) {
  const outputDir = path.join(OUT_ROOT, label);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const pageList = await pages();
  await withServer(async () => {
    const browser = await chromium.launch();
    try {
      for (const [mode, viewport] of Object.entries(MODES)) {
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        await context.addInitScript(() => {
          const fixedTime = new Date("2026-06-18T12:00:00Z").getTime();
          Date.now = () => fixedTime;
          Math.random = () => 0.5;
          window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(fixedTime), 16);
          window.cancelAnimationFrame = (id) => window.clearTimeout(id);
          window.setInterval = () => 0;
        });
        const page = await context.newPage();
        for (const pagePath of pageList) {
          await page.goto(`${BASE_URL}/${pagePath}`, { waitUntil: "networkidle" });
          await preparePage(page);
          const fileName = `${mode}-${pagePath.replaceAll("/", "__")}.png`;
          await page.screenshot({
            path: path.join(outputDir, fileName),
            fullPage: true,
            animations: "disabled",
            caret: "hide",
          });
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });

  const files = (await readdir(outputDir)).filter((file) => file.endsWith(".png"));
  const expected = pageList.length * Object.keys(MODES).length;
  if (files.length !== expected) {
    const seen = new Set(files);
    const missing = [];
    for (const mode of Object.keys(MODES)) {
      for (const pagePath of pageList) {
        const fileName = `${mode}-${pagePath.replaceAll("/", "__")}.png`;
        if (!seen.has(fileName)) missing.push(fileName);
      }
    }
    console.error(missing.join("\n"));
    throw new Error(`captured ${files.length} screenshots, expected ${expected}`);
  }
  console.log(`Captured ${expected} screenshots in ${outputDir}`);
}

async function diff(label) {
  const currentDir = path.join(OUT_ROOT, label);
  const baselineDir = path.join(OUT_ROOT, "baseline");
  const script = `
from pathlib import Path
from PIL import Image
import sys

baseline = Path(sys.argv[1])
current = Path(sys.argv[2])
files = sorted(p.name for p in baseline.glob("*.png"))
if not files:
    print("No baseline screenshots found", file=sys.stderr)
    sys.exit(2)

total = 0
changed = []
for name in files:
    left_path = baseline / name
    right_path = current / name
    if not right_path.exists():
        changed.append((name, "missing-current"))
        continue
    left = Image.open(left_path).convert("RGBA")
    right = Image.open(right_path).convert("RGBA")
    if left.size != right.size:
        changed.append((name, f"size {left.size} != {right.size}"))
        continue
    diff_pixels = 0
    for a, b in zip(left.getdata(), right.getdata()):
        if a != b:
            diff_pixels += 1
    if diff_pixels:
        total += diff_pixels
        changed.append((name, str(diff_pixels)))

if changed:
    for name, count in changed:
        print(f"{name}: {count}")
    print(f"TOTAL_DIFF_PIXELS={total}")
    sys.exit(1)

print("TOTAL_DIFF_PIXELS=0")
`;
  const child = spawn("python3", ["-", baselineDir, currentDir], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin.end(script);
  const [code] = await once(child, "exit");
  if (code !== 0) process.exit(code);
}

const [command, label = "current"] = process.argv.slice(2);
if (!["baseline", "capture", "diff"].includes(command)) usage();

if (command === "baseline") {
  await capture("baseline");
} else if (command === "capture") {
  await capture(label);
} else {
  await diff(label);
}
