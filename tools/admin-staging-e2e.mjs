import { randomBytes, randomUUID as cryptoRandomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { wrapBrowserWithMediaIsolation } from "./test-media-isolation.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_PANELS = Object.freeze([
  "overview",
  "quotes",
  "crm",
  "companies",
  "orders",
  "products",
  "content",
  "reviews",
  "newsletter",
  "analytics",
  "finance",
  "integrations",
]);

export class AdminE2EError extends Error {
  constructor(code, { status = null, cause = undefined } = {}) {
    super(code, { cause });
    this.name = "AdminE2EError";
    this.code = code;
    this.status = status;
  }
}

function required(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) throw new AdminE2EError(`admin_e2e_missing_${name.toLowerCase()}`);
  return value;
}

function exactOrigin(raw, code, { allowLocalHttp = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AdminE2EError(code);
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLocalHttp && local && url.protocol === "http:")) {
    throw new AdminE2EError(code);
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new AdminE2EError(code);
  }
  return url.origin;
}

export function isReadOnlyAdminRequest(method) {
  return ["GET", "HEAD"].includes(String(method || "").toUpperCase());
}

export function isSameOriginApplicationApi(baseUrl, rawUrl) {
  try {
    const base = new URL(baseUrl);
    const request = new URL(rawUrl);
    return request.origin === base.origin && request.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export async function waitForApplicationApiIdle(pendingRequests, {
  timeoutMs = 15_000,
  idleMs = 250,
  pollMs = 50,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const startedAt = now();
  let idleSince = null;
  while (now() - startedAt <= timeoutMs) {
    const timestamp = now();
    if (pendingRequests.size === 0) {
      if (idleSince === null) idleSince = timestamp;
      if (timestamp - idleSince >= idleMs) return;
    } else {
      idleSince = null;
    }
    await sleep(pollMs);
  }
  throw new AdminE2EError("admin_e2e_api_idle_timeout");
}

export function loadAdminStagingConfig(env = process.env, { productionSupabaseUrl } = {}) {
  if (String(env?.ADMIN_E2E_ENABLE || "") !== "staging-only") {
    throw new AdminE2EError("admin_e2e_not_enabled");
  }

  const baseUrl = exactOrigin(required(env, "ADMIN_E2E_BASE_URL"), "admin_e2e_invalid_base_url", { allowLocalHttp: true });
  const baseHost = new URL(baseUrl).hostname.toLowerCase();
  if (baseHost === "masest.co" || baseHost.endsWith(".masest.co") || baseHost === "masest-commerce.pages.dev") {
    throw new AdminE2EError("admin_e2e_production_base_forbidden");
  }

  if (!productionSupabaseUrl) throw new AdminE2EError("admin_e2e_production_database_unknown");
  const productionOrigin = exactOrigin(productionSupabaseUrl, "admin_e2e_production_database_unknown");
  const supabaseUrl = exactOrigin(
    required(env, "ADMIN_E2E_SUPABASE_URL"),
    "admin_e2e_invalid_supabase_url",
    { allowLocalHttp: true },
  );
  const supabaseHost = new URL(supabaseUrl).hostname.toLowerCase();
  const localSupabase = ["127.0.0.1", "localhost", "::1"].includes(supabaseHost);
  if (!localSupabase && !supabaseHost.endsWith(".supabase.co")) {
    throw new AdminE2EError("admin_e2e_invalid_supabase_url");
  }
  if (supabaseUrl === productionOrigin) {
    throw new AdminE2EError("admin_e2e_production_database_forbidden");
  }

  const anonKey = required(env, "ADMIN_E2E_SUPABASE_ANON_KEY");
  const serviceRoleKey = required(env, "ADMIN_E2E_SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey === serviceRoleKey) throw new AdminE2EError("admin_e2e_key_roles_invalid");

  return Object.freeze({ baseUrl, supabaseUrl, anonKey, serviceRoleKey });
}

export async function readProductionSupabaseUrl() {
  const source = await readFile(new URL("../js/config.js", import.meta.url), "utf8");
  const match = source.match(/MASEST_SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]/);
  if (!match) throw new AdminE2EError("admin_e2e_production_database_unknown");
  return match[1];
}

function serviceHeaders(config, { json = false, prefer = null } = {}) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
  if (json) headers["content-type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function jsonBody(response) {
  return response.json().catch(() => null);
}

async function requestJson(fetchImpl, url, options, { ok = [200], code }) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      ...options,
    });
  } catch (cause) {
    throw new AdminE2EError(code, { cause });
  }
  if (!ok.includes(response.status)) throw new AdminE2EError(code, { status: response.status });
  return response.status === 204 ? null : jsonBody(response);
}

export async function assertStagingHealth(config, { fetchImpl = fetch } = {}) {
  const health = await requestJson(
    fetchImpl,
    `${config.baseUrl}/api/health`,
    { method: "GET", signal: AbortSignal.timeout(10_000) },
    { ok: [200], code: "admin_e2e_health_unavailable" },
  );
  let reportedOrigin = null;
  try {
    reportedOrigin = new URL(health?.env?.supabase_url || "").origin;
  } catch {
    // Stable mismatch below; never echo the remote response.
  }
  if (health?.ok !== true || reportedOrigin !== config.supabaseUrl) {
    throw new AdminE2EError("admin_e2e_environment_mismatch");
  }
}

function disposableIdentity({ randomUUID, randomPassword }) {
  const nonce = randomUUID();
  if (!UUID_RE.test(nonce)) throw new AdminE2EError("admin_e2e_identity_generation_failed");
  const email = `admin-e2e-${nonce}@masest.test`;
  const password = randomPassword();
  if (!password || password.length < 16) throw new AdminE2EError("admin_e2e_identity_generation_failed");
  return { email, password };
}

export async function cleanupDisposableStaff(config, userId, { fetchImpl = fetch } = {}) {
  if (!UUID_RE.test(String(userId || ""))) throw new AdminE2EError("admin_e2e_invalid_cleanup_target");
  const encodedId = encodeURIComponent(userId);
  const profileUrl = `${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodedId}`;
  const userUrl = `${config.supabaseUrl}/auth/v1/admin/users/${encodedId}`;

  // Attempt both deletes even if the first request fails. Final absence is authoritative.
  await fetchImpl(profileUrl, {
    method: "DELETE",
    headers: serviceHeaders(config),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  await fetchImpl(userUrl, {
    method: "DELETE",
    headers: serviceHeaders(config),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);

  const profileResponse = await fetchImpl(`${profileUrl}&select=id`, {
    method: "GET",
    headers: serviceHeaders(config),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch((cause) => { throw new AdminE2EError("admin_e2e_cleanup_verify_failed", { cause }); });
  const profiles = profileResponse.ok ? await jsonBody(profileResponse) : null;
  if (!Array.isArray(profiles) || profiles.length !== 0) {
    throw new AdminE2EError("admin_e2e_profile_cleanup_failed", { status: profileResponse.status });
  }

  const userResponse = await fetchImpl(userUrl, {
    method: "GET",
    headers: serviceHeaders(config),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch((cause) => { throw new AdminE2EError("admin_e2e_cleanup_verify_failed", { cause }); });
  if (userResponse.status !== 404) {
    throw new AdminE2EError("admin_e2e_user_cleanup_failed", { status: userResponse.status });
  }
}

export async function provisionDisposableStaff(config, {
  fetchImpl = fetch,
  randomUUID = cryptoRandomUUID,
  randomPassword = () => `${randomBytes(24).toString("base64url")}Aa1!`,
} = {}) {
  const { email, password } = disposableIdentity({ randomUUID, randomPassword });
  let userId = null;
  try {
    const user = await requestJson(
      fetchImpl,
      `${config.supabaseUrl}/auth/v1/admin/users`,
      {
        method: "POST",
        headers: serviceHeaders(config, { json: true }),
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "MASEST Admin E2E" } }),
      },
      { ok: [200, 201], code: "admin_e2e_user_create_failed" },
    );
    userId = String(user?.id || "");
    if (!UUID_RE.test(userId)) throw new AdminE2EError("admin_e2e_user_create_failed");

    const profile = {
      id: userId,
      role: "buyer",
      is_staff: true,
      staff_role: "owner",
      full_name: "MASEST Admin E2E",
    };
    await requestJson(
      fetchImpl,
      `${config.supabaseUrl}/rest/v1/profiles?on_conflict=id`,
      {
        method: "POST",
        headers: serviceHeaders(config, { json: true, prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(profile),
      },
      { ok: [200, 201], code: "admin_e2e_profile_create_failed" },
    );

    const session = await requestJson(
      fetchImpl,
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: config.anonKey, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      { ok: [200], code: "admin_e2e_session_failed" },
    );
    if (!session?.access_token || session?.user?.id !== userId) {
      throw new AdminE2EError("admin_e2e_session_failed");
    }

    return Object.freeze({ userId, accessToken: session.access_token });
  } catch (error) {
    if (userId) {
      try {
        await cleanupDisposableStaff(config, userId, { fetchImpl });
      } catch (cleanupError) {
        throw new AdminE2EError("admin_e2e_provision_rollback_failed", { cause: new AggregateError([error, cleanupError]) });
      }
    }
    throw error;
  }
}

function interceptedAuthModule() {
  return `
    const proxySession = { access_token: "admin-e2e-proxy", user: { id: "admin-e2e" } };
    export const supabase = { auth: {
      async getSession() { return { data: { session: proxySession }, error: null }; },
      async refreshSession() { return { data: { session: proxySession }, error: null }; },
      async signOut() {},
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    } };
    export async function getToken() { return "admin-e2e-proxy"; }
    export async function login() { return { session: proxySession }; }
    export async function logout() {}
    export async function api(path, options = {}) {
      const headers = { ...(options.headers || {}), Authorization: "Bearer admin-e2e-proxy" };
      const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
      if (options.body !== undefined && !isFormData) headers["content-type"] = "application/json";
      const body = options.body === undefined || isFormData ? options.body : JSON.stringify(options.body);
      const response = await fetch(path, { method: options.method || "GET", headers, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || "request_failed"), { status: response.status, data });
      return data;
    }
    export async function apiBlob(path, options = {}) {
      const response = await fetch(path, { method: options.method || "GET", headers: { Authorization: "Bearer admin-e2e-proxy" } });
      if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status });
      return response.blob();
    }
  `;
}

export async function runAuthenticatedAdminBrowser(config, accessToken) {
  if (!accessToken) throw new AdminE2EError("admin_e2e_session_failed");
  const { chromium } = await import("@playwright/test");
  const browser = wrapBrowserWithMediaIsolation(await chromium.launch({ headless: true }));
  const appErrors = [];
  const badResponses = [];
  const blockedOrigins = new Set();
  const pendingApiRequests = new Set();
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.emulateMedia({ reducedMotion: "reduce" });

    page.on("pageerror", (error) => appErrors.push(`pageerror:${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const url = message.location().url || "";
      if (url.includes("static.cloudflareinsights.com")) return;
      appErrors.push(`console:${message.text()}`);
    });
    page.on("request", (request) => {
      if (isSameOriginApplicationApi(config.baseUrl, request.url())) pendingApiRequests.add(request);
    });
    page.on("requestfinished", (request) => pendingApiRequests.delete(request));
    page.on("requestfailed", (request) => {
      pendingApiRequests.delete(request);
      const url = request.url();
      if (url.includes("static.cloudflareinsights.com")) return;
      if (blockedOrigins.has(new URL(url).origin)) return;
      appErrors.push(`requestfailed:${new URL(url).pathname}`);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (isSameOriginApplicationApi(config.baseUrl, url) && response.status() >= 400) {
        badResponses.push(`${response.status()}:${url.pathname}`);
      }
    });

    await page.route("**/js/auth.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: interceptedAuthModule(),
    }));
    await page.route("**/api/**", (route) => {
      if (!isSameOriginApplicationApi(config.baseUrl, route.request().url())) {
        appErrors.push("admin_e2e_cross_origin_api_request_blocked");
        return route.abort("blockedbyclient");
      }
      if (!isReadOnlyAdminRequest(route.request().method())) {
        appErrors.push("admin_e2e_mutation_request_blocked");
        return route.abort("blockedbyclient");
      }
      const headers = { ...route.request().headers(), authorization: `Bearer ${accessToken}` };
      return route.continue({ headers });
    });
    await page.route("https://*.supabase.co/**", (route) => {
      const origin = new URL(route.request().url()).origin;
      if (origin === config.supabaseUrl) return route.fallback();
      blockedOrigins.add(origin);
      appErrors.push("production_database_request_blocked");
      return route.abort("blockedbyclient");
    });

    await page.goto(`${config.baseUrl}/admin.html#overview`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (new URL(page.url()).origin !== config.baseUrl) {
      throw new AdminE2EError("admin_e2e_navigation_origin_mismatch");
    }
    await page.locator("#admApp").waitFor({ state: "visible", timeout: 20_000 });
    if (await page.locator("#admGate").isVisible()) throw new AdminE2EError("admin_e2e_staff_gate_visible");

    for (const panel of ADMIN_PANELS) {
      if (panel !== "overview") await page.locator(`[data-tab="${panel}"]`).click();
      await page.locator(`[data-panel="${panel}"][data-active="true"]`).waitFor({ state: "visible", timeout: 15_000 });
      await waitForApplicationApiIdle(pendingApiRequests);
    }

    if (appErrors.length) throw new AdminE2EError("admin_e2e_browser_error");
    if (badResponses.length) throw new AdminE2EError("admin_e2e_admin_api_error");
    return Object.freeze({ panels: [...ADMIN_PANELS] });
  } catch (error) {
    if (page) {
      await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
      await page.screenshot({ path: new URL("../test-results/admin-staging-e2e.png", import.meta.url).pathname, fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
  }
}

export async function main() {
  const productionSupabaseUrl = await readProductionSupabaseUrl();
  const config = loadAdminStagingConfig(process.env, { productionSupabaseUrl });
  await assertStagingHealth(config);
  const provisioned = await provisionDisposableStaff(config);
  let result;
  let browserError = null;
  try {
    result = await runAuthenticatedAdminBrowser(config, provisioned.accessToken);
  } catch (error) {
    browserError = error;
  }

  let cleanupError = null;
  try {
    await cleanupDisposableStaff(config, provisioned.userId);
  } catch (error) {
    cleanupError = error;
  }
  if (browserError && cleanupError) throw new AggregateError([browserError, cleanupError], "admin_e2e_browser_and_cleanup_failed");
  if (browserError) throw browserError;
  if (cleanupError) throw cleanupError;

  process.stdout.write(`admin-staging-e2e: ${result.panels.length} authenticated panels passed; disposable identity removed\n`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().catch((error) => {
    const code = error?.code || (error instanceof AggregateError ? error.message : "admin_e2e_failed");
    process.stderr.write(`admin-staging-e2e: ${code}\n`);
    process.exitCode = 1;
  });
}
