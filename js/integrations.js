/*
 * MASEST commerce third-party integrations.
 * Loads Crisp chat, enriches chat sessions with page/request context, and
 * exposes the newsletter helper used by the shared footer.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CRISP_SCRIPT_SRC = "https://client.crisp.chat/l.js";

function cleanString(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function hasWindow() {
  return typeof window !== "undefined";
}

function hasDocument() {
  return typeof document !== "undefined";
}

function crispDisabled() {
  return hasWindow() && (window.MASEST_DISABLE_CRISP === true || window.MASEST_DISABLE_CRISP === "true");
}

function hasAuthSessionMarker() {
  if (!hasWindow()) return false;
  try {
    return Object.keys(window.localStorage || {}).some((key) => key.startsWith("sb-") && key.includes("-auth-token"));
  } catch {
    return false;
  }
}

function crispQueue() {
  if (!hasWindow() || crispDisabled()) return null;
  if (!window.$crisp) window.$crisp = [];
  return window.$crisp;
}

function pushCrisp(command) {
  const queue = crispQueue();
  if (!queue) return false;
  queue.push(command);
  return true;
}

function scalarEntries(data) {
  return Object.entries(data)
    .map(([key, value]) => [cleanString(key, 48), cleanString(value, 240)])
    .filter(([key, value]) => key && value)
    .slice(0, 20);
}

function formDataToObject(formData) {
  const out = {};
  for (const [key, value] of formData.entries()) {
    if (key === "_gotcha" || key === "cf-turnstile-response") continue;
    const current = out[key];
    const clean = cleanString(value);
    if (!clean) continue;
    out[key] = current ? `${current}, ${clean}` : clean;
  }
  return out;
}

function currentPageContext() {
  if (!hasWindow() || !hasDocument()) return {};
  const params = new URLSearchParams(window.location.search || "");
  const bodyPage = document.body?.dataset?.page || "";
  const product = params.get("product") || document.querySelector("[data-product-name]")?.dataset?.productName || "";
  const requestType = params.get("type") || params.get("doc") || "";

  return {
    page_title: document.title,
    page_path: window.location.pathname,
    page_type: bodyPage || window.location.pathname.split("/").pop() || "home",
    product: product,
    request_hint: requestType,
  };
}

function cartSummary() {
  if (!hasWindow()) return { cart_count: 0, cart_skus: "" };
  try {
    const cart = JSON.parse(window.localStorage?.getItem("masest_cart") || "{}");
    const entries = Object.entries(cart)
      .map(([sku, qty]) => [cleanString(sku, 80), Math.max(0, Math.floor(Number(qty) || 0))])
      .filter(([sku, qty]) => sku && qty > 0);
    const count = entries.reduce((sum, [, qty]) => sum + qty, 0);
    return {
      cart_count: count,
      cart_skus: entries.map(([sku]) => sku).slice(0, 20).join(","),
      cart_has_items: count > 0,
    };
  } catch {
    return { cart_count: 0, cart_skus: "", cart_has_items: false };
  }
}

export function setCrispSessionData(data) {
  const entries = scalarEntries(data);
  if (!entries.length) return false;
  return pushCrisp(["set", "session:data", [entries]]);
}

export function setCrispSegments(segments, overwrite = false) {
  const clean = [...new Set((segments || []).map((item) => cleanString(item, 48)).filter(Boolean))];
  if (!clean.length) return false;
  return pushCrisp(["set", "session:segments", [clean, overwrite]]);
}

export function trackCrispEvent(name, data = {}, color = "blue") {
  const eventName = cleanString(name, 80);
  if (!eventName) return false;
  return pushCrisp(["set", "session:event", [[[eventName, Object.fromEntries(scalarEntries(data)), color]]]]);
}

export function syncCrispPageContext() {
  const context = currentPageContext();
  setCrispSessionData(context);
  const segments = ["masest_site"];
  if (context.page_type) segments.push(`page_${context.page_type.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}`);
  if (context.product) segments.push("product_interest");
  return setCrispSegments(segments);
}

export function syncCrispCartContext() {
  const summary = cartSummary();
  const pushed = setCrispSessionData(summary);
  if (summary.cart_count > 0) return setCrispSegments(["cart_active"]) || pushed;
  return pushed;
}

export async function syncCrispAccountContext() {
  if (!hasWindow() || !hasAuthSessionMarker()) return false;
  try {
    const auth = await import("./auth.js");
    const account = await auth.me();
    if (!account) return false;

    const profile = account.profile || {};
    const company = account.company || {};
    const email = cleanString(account.email).toLowerCase();
    const name = cleanString(profile.full_name);
    const phone = cleanString(profile.phone);
    const companyName = cleanString(company.name);

    let pushed = false;
    if (EMAIL_RE.test(email)) pushed = pushCrisp(["set", "user:email", [email]]) || pushed;
    if (name) pushed = pushCrisp(["set", "user:nickname", [name]]) || pushed;
    if (phone) pushed = pushCrisp(["set", "user:phone", [phone]]) || pushed;
    if (companyName) pushed = pushCrisp(["set", "user:company", [companyName]]) || pushed;

    pushed = setCrispSessionData({
      account_email: email,
      account_profile_id: profile.id,
      account_company: companyName,
      account_company_id: company.id,
      account_status: company.status,
      account_staff: account.can_admin === true,
      account_can_checkout: Boolean(account.can_checkout),
    }) || pushed;

    pushed = setCrispSegments([
      account.needs_profile ? "account_needs_profile" : "account_authenticated",
      account.can_admin === true ? "account_staff" : "",
      company.status ? `company_${company.status}` : "",
    ]) || pushed;
    return pushed;
  } catch {
    return false;
  }
}

export function identifyCrispLead(lead) {
  if (!lead || typeof lead !== "object") return false;
  const name = cleanString(lead.name);
  const email = cleanString(lead.email).toLowerCase();
  const phone = cleanString(lead.phone);
  const company = cleanString(lead.company);
  const type = cleanString(lead.type || "quote");
  const industry = cleanString(lead.industry);
  const product = cleanString(lead.product);

  let pushed = false;
  if (EMAIL_RE.test(email)) pushed = pushCrisp(["set", "user:email", [email]]) || pushed;
  if (name) pushed = pushCrisp(["set", "user:nickname", [name]]) || pushed;
  if (phone) pushed = pushCrisp(["set", "user:phone", [phone]]) || pushed;
  if (company) pushed = pushCrisp(["set", "user:company", [company]]) || pushed;

  pushed = setCrispSessionData({
    lead_type: type,
    lead_company: company,
    lead_industry: industry,
    lead_product: product,
    lead_location: lead.location,
    lead_volume: lead.volume,
    lead_timeline: lead.timeline,
  }) || pushed;

  pushed = setCrispSegments(["lead", `lead_${type}`, industry ? `industry_${industry}` : ""]) || pushed;
  return pushed;
}

export function openCrispChat(message) {
  if (message) pushCrisp(["set", "message:text", [cleanString(message, 500)]]);
  return pushCrisp(["do", "chat:open"]);
}

export function loadCrisp() {
  if (!hasWindow() || !hasDocument() || crispDisabled()) return false;

  const id = cleanString(window.MASEST_CRISP_ID, 80);
  if (!id) return false;

  const queue = crispQueue();
  if (!queue) return false;

  window.CRISP_WEBSITE_ID = id;
  const cookieDomain = cleanString(window.MASEST_CRISP_COOKIE_DOMAIN, 80);
  const cookieExpire = Number(window.MASEST_CRISP_COOKIE_EXPIRE || 0);
  if (cookieDomain) window.CRISP_COOKIE_DOMAIN = cookieDomain;
  if (Number.isFinite(cookieExpire) && cookieExpire > 0) window.CRISP_COOKIE_EXPIRE = cookieExpire;

  if (!document.querySelector('script[data-masest-crisp="true"]')) {
    const script = document.createElement("script");
    script.src = CRISP_SCRIPT_SRC;
    script.async = true;
    script.dataset.masestCrisp = "true";
    document.head.appendChild(script);
  }

  syncCrispPageContext();
  syncCrispCartContext();
  syncCrispAccountContext();
  return true;
}

export async function subscribeNewsletter(email) {
  const clean = cleanString(email, 254).toLowerCase();
  if (!EMAIL_RE.test(clean)) throw new Error("invalid_email");
  const response = await fetch("/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: clean }),
  });
  const out = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(out.error || "subscribe_failed");
  return out;
}

function wireQuoteFormContext() {
  if (!hasDocument() || document.__masestCrispQuoteBridge) return;
  document.__masestCrispQuoteBridge = true;
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "quoteForm") return;
    const lead = formDataToObject(new FormData(form));
    identifyCrispLead(lead);
    trackCrispEvent("quote_form_submitted", {
      type: lead.type,
      product: lead.product,
      industry: lead.industry,
      company: lead.company,
    });
  }, true);
}

function wireCrispOpeners() {
  if (!hasDocument() || document.__masestCrispOpenBridge) return;
  document.__masestCrispOpenBridge = true;
  document.addEventListener("click", (event) => {
    const opener = event.target?.closest?.("[data-crisp-open]");
    if (!opener) return;
    event.preventDefault();
    const message = opener.getAttribute("data-crisp-message") || "Hi, I need help with VertKleen.";
    openCrispChat(message);
    trackCrispEvent("chat_cta_clicked", {
      label: opener.textContent,
      page_path: window.location?.pathname,
    });
  });
}

function wireCrispContextSync() {
  if (!hasWindow() || !hasDocument() || document.__masestCrispContextBridge) return;
  document.__masestCrispContextBridge = true;
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === "masest_cart" || event.key.includes("-auth-token")) {
      syncCrispCartContext();
      syncCrispAccountContext();
    }
  });
  document.addEventListener("cart:updated", syncCrispCartContext);
  document.addEventListener("masest:cart", syncCrispCartContext);
}

if (hasWindow()) {
  window.MASEST = Object.assign(window.MASEST || {}, {
    identifyCrispLead,
    loadCrisp,
    openCrispChat,
    setCrispSegments,
    setCrispSessionData,
    subscribeNewsletter,
    syncCrispAccountContext,
    syncCrispCartContext,
    syncCrispPageContext,
    trackCrispEvent,
  });
}

if (hasDocument()) {
  wireQuoteFormContext();
  wireCrispOpeners();
  wireCrispContextSync();
  if (document.readyState !== "loading") loadCrisp();
  else document.addEventListener("DOMContentLoaded", loadCrisp);
}
