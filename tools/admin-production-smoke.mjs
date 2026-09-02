import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CANONICAL_PRODUCTION_ORIGIN = "https://masest.co";
const DEFAULT_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 2_500;

export class AdminProductionSmokeError extends Error {
  constructor(code, { status = null, cause = undefined } = {}) {
    super(code, { cause });
    this.name = "AdminProductionSmokeError";
    this.code = code;
    this.status = status;
  }
}

function exactOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AdminProductionSmokeError("admin_production_base_forbidden");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || !["", "/"].includes(url.pathname)
    || url.origin !== CANONICAL_PRODUCTION_ORIGIN
  ) {
    throw new AdminProductionSmokeError("admin_production_base_forbidden");
  }
  return url.origin;
}

export function loadAdminProductionConfig(env = process.env) {
  const baseUrl = exactOrigin(String(env?.ADMIN_PRODUCTION_BASE_URL || CANONICAL_PRODUCTION_ORIGIN).trim());
  return Object.freeze({ baseUrl });
}

function extractAdminScriptSrc(html) {
  const scripts = String(html || "").matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
  for (const match of scripts) {
    if (/(?:^|\/)js\/admin\.js\?v=[A-Za-z0-9._-]+$/.test(match[1])) return match[1];
  }
  return null;
}

export async function readExpectedAdminScriptSrc() {
  const html = await readFile(new URL("../admin.html", import.meta.url), "utf8");
  const scriptSrc = extractAdminScriptSrc(html);
  if (!scriptSrc) throw new AdminProductionSmokeError("admin_production_local_release_unknown");
  return scriptSrc;
}

async function get(fetchImpl, url, code) {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html,application/json;q=0.9" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new AdminProductionSmokeError(code, { cause });
  }
}

async function verifyAdminHtml(config, expectedScriptSrc, fetchImpl) {
  const response = await get(fetchImpl, `${config.baseUrl}/admin`, "admin_production_admin_unavailable");
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (response.status !== 200 || !contentType.includes("text/html")) {
    throw new AdminProductionSmokeError("admin_production_admin_unavailable", { status: response.status });
  }

  const html = await response.text();
  const gatePresent = /\bid=["']admGate["']/.test(html);
  const appFailClosed = /<[^>]+\bid=["']admApp["'][^>]*\bhidden(?:\s|=|>)/i.test(html);
  const deployedScriptSrc = extractAdminScriptSrc(html);
  if (!gatePresent || !appFailClosed) {
    throw new AdminProductionSmokeError("admin_production_gate_markup_missing");
  }
  if (deployedScriptSrc !== expectedScriptSrc) {
    throw new AdminProductionSmokeError("admin_production_release_mismatch");
  }
  return deployedScriptSrc;
}

async function verifyAnonymousApiGate(config, fetchImpl) {
  const response = await get(fetchImpl, `${config.baseUrl}/api/admin/stats`, "admin_production_api_unavailable");
  if (response.status !== 401) {
    throw new AdminProductionSmokeError("admin_production_api_not_gated", { status: response.status });
  }
  const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
  if (!cacheControl.split(",").some((value) => value.trim() === "no-store")) {
    throw new AdminProductionSmokeError("admin_production_api_cacheable", { status: response.status });
  }
  const body = await response.json().catch(() => null);
  if (body?.error !== "unauthenticated") {
    throw new AdminProductionSmokeError("admin_production_api_contract_mismatch", { status: response.status });
  }
  return response.status;
}

export async function probeProductionAdmin(config, {
  expectedScriptSrc,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!expectedScriptSrc) throw new AdminProductionSmokeError("admin_production_local_release_unknown");
  const attemptCount = Number.isSafeInteger(attempts) && attempts > 0 ? attempts : DEFAULT_ATTEMPTS;
  let deployedScriptSrc = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    try {
      deployedScriptSrc = await verifyAdminHtml(config, expectedScriptSrc, fetchImpl);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attemptCount) await sleep(retryDelayMs);
    }
  }
  if (lastError) throw lastError;

  const adminApiStatus = await verifyAnonymousApiGate(config, fetchImpl);
  return Object.freeze({
    baseUrl: config.baseUrl,
    adminScriptSrc: deployedScriptSrc,
    adminApiStatus,
  });
}

export async function main() {
  const config = loadAdminProductionConfig();
  const expectedScriptSrc = await readExpectedAdminScriptSrc();
  const result = await probeProductionAdmin(config, { expectedScriptSrc });
  process.stdout.write(
    `admin-production-smoke: ${result.adminScriptSrc}; anonymous API ${result.adminApiStatus}; GET-only\n`,
  );
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().catch((error) => {
    process.stderr.write(`admin-production-smoke: ${error?.code || "admin_production_smoke_failed"}\n`);
    process.exitCode = 1;
  });
}
