#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const PORT = Number(process.env.VISUAL_AUDIT_PORT || 4317);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const AUDIT_LABEL = process.env.VISUAL_AUDIT_LABEL || new Date().toISOString().slice(0, 10);
const OUT_DIR = path.resolve(ROOT_PATH, "audits", `visual-qa-${AUDIT_LABEL}`);

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 820, height: 900 },
  mobile: { width: 390, height: 844 },
};

const PUBLIC_STEPS = [
  ["home", "/index.html"],
  ["products", "/products.html"],
  ["product-detail", "/products/hcr.html"],
  ["services", "/services.html"],
  ["programs", "/programs.html"],
  ["proof", "/proof.html"],
  ["resources", "/resources.html"],
  ["blog", "/blog.html"],
  ["blog-detail-descaling", "/blog/descaling-without-acid.html"],
  ["blog-detail-hmis", "/blog/hmis-000-explained.html"],
  ["blog-detail-launch", "/blog/vertkleen-launch.html"],
  ["industries", "/industries.html"],
  ["industry-detail", "/industries/plumbing.html"],
  ["comparison-beer-line", "/comparisons/beer-line-cleaner-cost-comparison.html"],
  ["comparison-crhd-simple-green", "/comparisons/cr-hd-vs-simple-green.html"],
  ["comparison-hcr-rydlyme", "/comparisons/hcr-vs-rydlyme.html"],
  ["comparison-lam3-wet-forget", "/comparisons/lam3-vs-wet-forget.html"],
  ["comparison-hcr-clr", "/comparisons/vertkleen-hcr-vs-clr.html"],
  ["about", "/about.html"],
  ["contact-quote", "/contact.html?type=quote"],
  ["cart", "/cart.html"],
  ["newsletter", "/newsletter.html"],
];

const AUTH_STEPS = [
  ["dashboard-overview", "/dashboard.html#overview"],
  ["dashboard-orders", "/dashboard.html#orders"],
  ["dashboard-messages", "/dashboard.html#messages"],
  ["dashboard-notifications", "/dashboard.html#notifications"],
  ["dashboard-business", "/dashboard.html#business"],
  ["dashboard-addresses", "/dashboard.html#addresses"],
  ["dashboard-profile", "/dashboard.html#profile"],
  ["admin-overview", "/admin.html#overview"],
  ["admin-orders", "/admin.html#orders"],
  ["admin-companies", "/admin.html#companies"],
  ["admin-products", "/admin.html#products"],
  ["admin-pricing", "/admin.html#pricing"],
  ["admin-content", "/admin.html#content"],
  ["admin-messages", "/admin.html#messages"],
  ["admin-quotes", "/admin.html#quotes"],
  ["admin-crm", "/admin.html#crm"],
  ["admin-offers", "/admin.html#offers"],
  ["admin-traffic", "/admin.html#traffic"],
];

function serviceFixtures() {
  return [
    {
      sku: "svc-tower-audit",
      name: "Cooling tower water chemistry audit",
      description: "On-site sample pull, deposit characterization, and treatment recommendations for tower loops and condenser water programs.",
      category: "field",
      public_price: 650,
      unit_label: "site visit",
      lead_time: "3-5 business days",
      active: true,
      sort: 1,
    },
    {
      sku: "svc-cip-validation",
      name: "CIP/SIP residue validation and rinse acceptance package",
      description: "Lab-backed residue profile, rinse targets, and documentation package for food, beverage, and process-equipment teams.",
      category: "lab",
      public_price: 1250,
      unit_label: "validation packet",
      lead_time: "5-7 business days",
      active: true,
      sort: 2,
    },
    {
      sku: "svc-scale-id",
      name: "Scale ID with corrosion and substrate compatibility review",
      description: "Deposit ID plus product-fit recommendation for mixed metals, gaskets, and downstream wastewater constraints.",
      category: "lab",
      public_price: 875,
      unit_label: "sample",
      lead_time: "4 business days",
      active: true,
      sort: 3,
    },
    {
      sku: "svc-emergency-dispatch",
      name: "Emergency descaling dispatch readiness review",
      description: "Scope confirmation for urgent shutdown windows, materials on hand, crew size, PPE, neutralization, and disposal planning.",
      category: "field",
      public_price: 1800,
      unit_label: "mobilization review",
      lead_time: "same day",
      active: true,
      sort: 4,
    },
    {
      sku: "svc-program-design",
      name: "Preventive maintenance program design",
      description: "Quarterly service scope, parts list, chemical usage model, and replenishment plan for multi-site facilities.",
      category: "program",
      public_price: 2400,
      unit_label: "program",
      lead_time: "10 business days",
      active: true,
      sort: 5,
    },
  ];
}

function catalogFixtures() {
  const products = [
    ["hcr", "VertKlean HCR", "buy", "img/chemistry/AdobeStock_554104937_Preview.jpeg"],
    ["cr", "VertKlean CR", "buy", "img/chemistry/AdobeStock_298635145_Preview.jpeg"],
    ["water-safe-60", "WaterSafe 60", "quote", "img/chemistry/AdobeStock_236245730_Preview.jpeg"],
    ["alumibrite", "Alumibrite", "buy", "img/chemistry/AdobeStock_636273322_Preview.jpeg"],
  ].map(([slug, name, mode, image_url], index) => ({
    sku: slug,
    slug,
    name,
    mode,
    active: true,
    sort: index + 1,
    image_url,
    photo_alt: `${name} product image`,
    product_variants: [
      { vsku: `${slug}-1`, sku: `${slug}-1`, label: "1 gal bottle", gallons: 1, price: 64 + index * 8, currency: "usd", active: true, sort: 1 },
      { vsku: `${slug}-5`, sku: `${slug}-5`, label: "5 gal pail", gallons: 5, price: 240 + index * 20, currency: "usd", active: true, sort: 2 },
    ],
  }));
  return { products };
}

function authModule() {
  const now = "2026-07-06T18:30:00Z";
  const productsPayload = catalogFixtures();
  const fixtures = {
    account: {
      email: "operations.buyer@acme-industrial.example",
      profile: { full_name: "Avery Procurement Lead" },
      company: {
        id: "co-1",
        name: "Acme HVAC and Water Systems International",
        status: "approved",
        net_terms_days: 30,
        tax_exempt: true,
        business_phone: "(727) 348-6519",
        business_email: "ap-long-routing-group@acme-industrial.example",
      },
      can_checkout: true,
      can_use_net_terms: true,
      credit: { net_outstanding: 1840, credit_available: 4160 },
      staff: { role: "admin" },
      can_admin: true,
    },
    productsPayload,
    orders: [
      {
        id: "ord-1001-long-reference",
        created_at: now,
        status: "net_open",
        total: 1840,
        currency: "usd",
        payment_method: "net",
        qbo_invoice_id: "QB-INV-2026-0001840-LONG",
        tracking_status: "processing",
        carrier: "LTL freight desk",
        tracking_number: "PRO-1234567890-ALONGREFERENCE",
        order_items: [
          { name: "VertKlean HCR 5 gal pail - replacement chemistry for condenser loop", qty: 4, line_total: 960 },
          { name: "WaterSafe 60 technical review packet", qty: 1, line_total: 880 },
        ],
        companies: { name: "Acme HVAC and Water Systems International", net_terms_days: 30 },
      },
      {
        id: "ord-1002",
        created_at: "2026-07-04T14:00:00Z",
        status: "fulfilled",
        total: 445.5,
        currency: "usd",
        payment_method: "stripe",
        order_items: [
          { name: "VertKlean CR 1 gal bottle", qty: 3, line_total: 445.5 },
        ],
      },
    ],
    notifications: [
      { id: "n-1", type: "message", title: "Quote follow-up with unusually long title", body: "Updated service packet is ready for the Tampa condenser loop review and wastewater neutralization plan.", read: false, created_at: now },
      { id: "n-2", type: "order", title: "Order awaiting NET payment", body: "Invoice is posted for review by AP before shipment release.", read: false, created_at: "2026-07-05T16:10:00Z" },
    ],
    messages: [
      { id: "m-1", sender_role: "buyer", body: "Can you confirm lead time and include a note about substrate compatibility for mixed copper, stainless, and EPDM?", created_at: "2026-07-06T12:10:00Z" },
      { id: "m-2", sender_role: "staff", body: "Two drums can ship Friday. The technical team recommends a reduced concentration on the first pass.", created_at: "2026-07-06T13:15:00Z" },
    ],
    addresses: [
      { id: "addr-1", type: "ship", line1: "1200 Cooling Tower Way, Building 18, Mechanical Penthouse Receiving", city: "Tampa", state: "FL", zip: "33602", is_default: true },
    ],
    companies: [
      {
        id: "co-1",
        name: "Acme HVAC and Water Systems International",
        status: "approved",
        price_tier: "wholesale",
        net_terms_days: 30,
        credit_limit: 6000,
        contact_email: "ap-long-routing-group@acme-industrial.example",
        contact_name: "Avery Procurement Lead",
        phone: "(727) 348-6519",
        industry: "Industrial HVAC service and water treatment",
        tax_exempt: true,
        profiles: [
          { full_name: "Avery Procurement Lead", role: "admin" },
          { full_name: "Marisol Vega", role: "buyer" },
        ],
      },
      {
        id: "co-2",
        name: "Great Lakes Refrigeration Maintenance Cooperative",
        status: "pending",
        price_tier: "hvac",
        net_terms_days: 0,
        credit_limit: 0,
        contact_email: "maintenance@glr.example",
        contact_name: "Renee Fox",
        industry: "Refrigeration",
        profiles: [],
      },
    ],
    quotes: [
      {
        id: "q-1",
        company: "Acme HVAC and Water Systems International",
        name: "Avery Procurement Lead",
        email: "operations.buyer@acme-industrial.example",
        message: "Need scope for an emergency descaling window, disposal review, and post-clean verification.",
        status: "new",
        priority: "urgent",
        pipeline_stage: "proposal",
        lead_score: 82,
        deal_value: 12800,
        assigned_to: "ops@masest.co",
        next_step: "Confirm shutdown window and lab pickup timing",
        due_at: now,
        contact_id: "contact-1",
      },
    ],
    tasks: [
      { id: "task-1", title: "Send condenser-loop service scope and wastewater neutralization note", status: "open", due_at: now, assigned_to: "ops@masest.co", subject_type: "quote", subject_id: "q-1", subject_label: "Acme service quote" },
    ],
    contacts: [
      { id: "contact-1", name: "Avery Procurement Lead", role: "buyer", title: "Facilities procurement", email: "operations.buyer@acme-industrial.example", phone: "(727) 348-6519", is_primary: true },
      { id: "contact-2", name: "Marisol Vega", role: "technical", title: "Chief engineer", email: "engineering@acme-industrial.example", phone: "(727) 111-1212", is_primary: false },
    ],
  };

  return `
const fixtures = ${JSON.stringify(fixtures)};
const okSession = { access_token: "stub-token", user: { id: "u-1", email: fixtures.account.email } };
export const supabase = { auth: { async getSession() { return { data: { session: okSession }, error: null }; }, async signOut() {}, async refreshSession() { return { data: { session: okSession }, error: null }; } } };
export async function me() { return fixtures.account; }
export async function logout() {}
export async function login() { return { session: okSession }; }
export async function resetPasswordForEmail() { return {}; }
export async function updatePassword() { return {}; }
export async function orders() { return fixtures.orders; }
export async function catalog() { return fixtures.productsPayload.products; }
export async function getToken() { return "stub-token"; }
export async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/admin/products")) return fixtures.productsPayload;
  if (pathname.startsWith("/api/admin/stats")) return {
    orders: fixtures.orders.length,
    revenue: 2285.5,
    pending_companies: 1,
    unread_messages: 2,
    new_quotes: 1,
    low_stock: 2,
    setup_followups: [{ company: fixtures.companies[1].name, reason: "Pending certificate review and credit terms" }],
    recent_orders: fixtures.orders
  };
  if (pathname.startsWith("/api/admin/inventory")) return { low_stock: fixtures.productsPayload.products.slice(0, 2) };
  if (pathname.startsWith("/api/admin/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (pathname.startsWith("/api/admin/companies")) return { companies: fixtures.companies, total: fixtures.companies.length, has_more: false };
  if (pathname.startsWith("/api/admin/customers")) return { customers: fixtures.contacts };
  if (pathname.startsWith("/api/admin/variant-pricing")) return { variants: [] };
  if (pathname.startsWith("/api/admin/coupons")) return { coupons: [{ code: "SUMMERPROCURE", percent_off: 10, max_redemptions: 50, expires_at: "2026-09-01" }] };
  if (pathname.startsWith("/api/admin/messages")) return { threads: [{ id: "t-1", subject: "Emergency condenser loop", company: fixtures.companies[0].name }], messages: fixtures.messages };
  if (pathname.startsWith("/api/admin/quotes/report")) return { count: 1, value: 12800, by_stage: { proposal: 1 }, weighted: 8960 };
  if (pathname.startsWith("/api/admin/quotes")) return { quotes: fixtures.quotes, total: fixtures.quotes.length, has_more: false, new_count: 1 };
  if (pathname.startsWith("/api/admin/offers")) return { offers: [{ title: "July service readiness", audience: "approved accounts with open service quotes", recipients: 42, created_at: "2026-07-01T15:00:00Z" }] };
  if (pathname.startsWith("/api/admin/traffic")) return {
    total: 1408,
    unique: 312,
    events: [{ key: "quote_submit", count: 24 }, { key: "checkout_start", count: 18 }],
    funnel: [{ step: "product_view", count: 240 }, { step: "quote_submit", count: 24 }],
    campaigns: [{ key: "hvac-service-summer-long-campaign-name", count: 61 }],
    days: [{ day: "2026-07-06", views: 118, unique: 43, conversions: 5 }],
    recent: [{ key: "services.html", count: 38 }]
  };
  if (pathname.startsWith("/api/admin/qbo") || pathname.startsWith("/api/qbo")) return { connected: false, pending: 0, errored: 0, synced: 0 };
  if (pathname.startsWith("/api/admin/crm/tasks")) return { tasks: fixtures.tasks, total: fixtures.tasks.length, has_more: false };
  if (pathname.startsWith("/api/admin/crm/contacts")) return { contacts: fixtures.contacts, total: fixtures.contacts.length, has_more: false };
  if (pathname.startsWith("/api/admin/crm")) return { timeline: [], notes: [], tasks: fixtures.tasks, contacts: fixtures.contacts };
  if (pathname === "/api/account/me") return fixtures.account;
  if (pathname.startsWith("/api/account/orders")) return { orders: fixtures.orders, total: fixtures.orders.length, has_more: false };
  if (pathname.startsWith("/api/account/messages")) return { messages: fixtures.messages };
  if (pathname.startsWith("/api/account/notifications")) return { notifications: fixtures.notifications, unread: 2, total: 2, has_more: false };
  if (pathname.startsWith("/api/account/addresses")) return { addresses: fixtures.addresses };
  if (pathname.startsWith("/api/account/company")) return { company: fixtures.account.company };
  if (pathname.startsWith("/api/account/invoices")) return { invoices: [{ id: "inv-1", created_at: "2026-07-01", status: "open", total: 1840, currency: "usd" }], summary: { net_terms_days: 30, net_outstanding: 1840, credit_available: 4160, unlimited: false } };
  if (pathname.startsWith("/api/account/team")) return { members: fixtures.contacts, invites: [{ id: "invite-1", email: "long-distribution-list@acme-industrial.example" }] };
  if (pathname.startsWith("/api/account/programs")) return { program: { status: "active", tier: "Regional maintenance", renewal_at: "2027-01-01" } };
  if (pathname.startsWith("/api/account/notification-prefs")) return { notify_orders: true, notify_messages: true, notify_offers: false };
  if (pathname.startsWith("/api/account/billing-portal")) return { url: "about:blank" };
  return {};
}
`;
}

async function withServer(fn) {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: ROOT_PATH,
    stdio: "ignore",
  });
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  try {
    for (let i = 0; i < 50; i += 1) {
      const ok = await fetch(`${BASE_URL}/index.html`).then((r) => r.ok).catch(() => false);
      if (ok) return await fn();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error("static server did not start");
  } finally {
    if (!exited) server.kill("SIGTERM");
    await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (!exited) server.kill("SIGKILL");
  }
}

async function newContext(browser, viewport, authenticated) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(({ authenticated: auth }) => {
    const fixedNow = new Date("2026-07-06T18:30:00Z").getTime();
    Date.now = () => fixedNow;
    Math.random = () => 0.5;
    window.MASEST_ENABLE_LOCAL_API = true;
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon";
    if (auth) localStorage.setItem("sb-stub-auth-token", JSON.stringify({ access_token: "stub-token" }));
  }, { authenticated });
  await context.route("**/js/auth.js", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: authModule(),
  }));
  await context.route("**/api/services", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ services: serviceFixtures() }),
  }));
  await context.route("**/api/products**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(catalogFixtures()),
  }));
  return context;
}

async function waitForStable(page, stepName) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
  await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
  if (stepName.startsWith("dashboard-")) {
    const panel = stepName.replace("dashboard-", "");
    await page.waitForSelector(`.dash-panel[data-panel="${panel}"]:not([hidden])`, { timeout: 10000 }).catch(() => {});
  }
  if (stepName.startsWith("admin-")) {
    const panel = stepName.replace("admin-", "");
    await page.waitForSelector(`.adm-panel[data-panel="${panel}"][data-active="true"]`, { timeout: 10000 }).catch(() => {});
  }
  if (stepName === "services") {
    await page.waitForSelector("[data-service-sku]", { timeout: 10000 }).catch(() => {});
  }
  await page.evaluate(() => {
    document.querySelectorAll("img").forEach((image) => {
      image.loading = "eager";
      image.decoding = "sync";
    });
    document.querySelectorAll("video, audio").forEach((media) => {
      media.pause();
      media.currentTime = 0;
    });
    window.scrollTo(0, 0);
    document.querySelector(".nav")?.classList.remove("scrolled");
  });
  await page.waitForTimeout(250);
}

function auditScript() {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const hasScrollableChild = (el) => [...el.querySelectorAll("*")].some((child) => {
    const style = getComputedStyle(child);
    return /(auto|scroll)/.test(`${style.overflow}${style.overflowX}`)
      && child.scrollWidth - child.clientWidth > 2;
  });
  const hasCornerCounterOverflow = (el) => {
    if (!el.matches(".dash-tab, .adm-tab")) return false;
    const rect = el.getBoundingClientRect();
    return [...el.querySelectorAll(":scope > .pill")].some((pill) => {
      if (!visible(pill)) return false;
      const pillStyle = getComputedStyle(pill);
      if (pillStyle.position !== "absolute") return false;
      const pillRect = pill.getBoundingClientRect();
      const outsideCorner = pillRect.top < rect.top + 1 && pillRect.right > rect.right - 1;
      const boundedOffset = pillRect.right - rect.right <= 12 && rect.top - pillRect.top <= 12;
      return outsideCorner && boundedOffset;
    });
  };
  const labelFor = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList].slice(0, 3).map((c) => `.${c}`).join("");
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text.slice(0, 90)}"` : ""}`;
  };
  const issues = [];
  const docOverflow = Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (docOverflow > 2) {
    issues.push({ type: "page-overflow-x", selector: "document", detail: `${docOverflow}px horizontal page overflow` });
  }

  const textContainers = [
    ".btn", "button", "summary", "select", "input", "textarea",
    ".badge", ".pill", ".service-tab", ".service-card", ".shop-card", ".prod-card",
    ".dash-card", ".dash-row", ".biz-card", ".biz-row", ".notif",
    ".adm-card", ".adm-tab", ".adm-input", ".adm-select", ".adm-textarea",
    ".quote-item", ".company-admin-card", ".product-admin-card", ".variant-row",
    "table.adm th", "table.adm td", ".adm-mini-table th", ".adm-mini-table td",
  ].join(",");

  for (const el of [...document.querySelectorAll(textContainers)]) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    const inputType = (el.getAttribute("type") || "").toLowerCase();
    const nativeControl = el.matches("input, select, textarea");
    const compactNative = nativeControl && ["checkbox", "radio", "range", "hidden", "file", "color"].includes(inputType);
    const compactUtility = el.matches(".gbtn, .nav-burger, .nav-logo, .nav-cart, .lb-close");
    const interactive = !compactNative && !compactUtility
      && el.matches("button, summary, select, input, textarea, .btn, .adm-tab, .service-tab, .notif[role='button']");
    const overflowX = Math.round(el.scrollWidth - el.clientWidth);
    const overflowY = Math.round(el.scrollHeight - el.clientHeight);
    const inspectOverflow = !el.matches("input, select, textarea");
    const childScrollExplainsOverflow = el.matches(".adm-card, .dash-card, .biz-card, .adm-panel") && hasScrollableChild(el);
    const cornerCounterExplainsOverflow = hasCornerCounterOverflow(el);
    const hasAllowedScroll = /(auto|scroll)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
    if (inspectOverflow && !childScrollExplainsOverflow && !cornerCounterExplainsOverflow && (overflowX > 2 || overflowY > 2) && !hasAllowedScroll && text) {
      issues.push({
        type: overflowX > 2 ? "text-overflow-x" : "text-overflow-y",
        selector: labelFor(el),
        detail: `${overflowX}px x, ${overflowY}px y`,
      });
    }
    if (interactive && rect.height < 40 && text) {
      issues.push({ type: "control-too-short", selector: labelFor(el), detail: `${Math.round(rect.height)}px high` });
    }
    if (interactive && text) {
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const hasOwnChrome = el.matches("input, select, textarea, button, .btn, .adm-tab, .service-tab")
        || style.backgroundColor !== "rgba(0, 0, 0, 0)"
        || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style[`border${side}Width`]) > 0);
      const enoughVerticalRoom = rect.height >= 40;
      if (hasOwnChrome && (padX < 12 || (padY < 6 && !enoughVerticalRoom))) {
        issues.push({ type: "thin-control-padding", selector: labelFor(el), detail: `${Math.round(padX)}px x, ${Math.round(padY)}px y` });
      }
    }
  }

  const touchPairs = [...document.querySelectorAll(".adm-tools, .dash-action-row, .biz-inline-form, .product-admin-actions, .company-admin-actions, .service-card-meta")]
    .filter(visible)
    .map((group) => {
      const children = [...group.children].filter(visible).map((child) => child.getBoundingClientRect());
      let minGap = Infinity;
      for (let i = 0; i < children.length; i += 1) {
        for (let j = i + 1; j < children.length; j += 1) {
          const a = children[i];
          const b = children[j];
          const sameRow = Math.abs(a.top - b.top) < 6;
          if (!sameRow) continue;
          const gap = Math.max(0, Math.max(b.left - a.right, a.left - b.right));
          minGap = Math.min(minGap, gap);
        }
      }
      return { group, minGap };
    });
  for (const { group, minGap } of touchPairs) {
    if (Number.isFinite(minGap) && minGap < 6) {
      issues.push({ type: "crowded-inline-group", selector: labelFor(group), detail: `${Math.round(minGap)}px nearest inline gap` });
    }
  }

  return issues.slice(0, 80);
}

async function captureStep(browser, mode, viewport, [name, url], authenticated) {
  const context = await newContext(browser, viewport, authenticated);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${url}`, { waitUntil: "domcontentloaded" });
    await waitForStable(page, name);
    const screenshotPath = path.join(OUT_DIR, mode, `${String(authenticated ? "auth" : "public")}-${name}.png`);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled", caret: "hide" });
    const issues = await page.evaluate(auditScript);
    return {
      mode,
      name,
      url,
      screenshot: path.relative(ROOT_PATH, screenshotPath),
      health: issues.length ? "needs attention" : "clear",
      issues,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const rows = [];
  await withServer(async () => {
    const browser = await chromium.launch();
    try {
      for (const [mode, viewport] of Object.entries(VIEWPORTS)) {
        for (const step of PUBLIC_STEPS) rows.push(await captureStep(browser, mode, viewport, step, false));
        for (const step of AUTH_STEPS) rows.push(await captureStep(browser, mode, viewport, step, true));
      }
    } finally {
      await browser.close();
    }
  });

  const issueRows = rows.flatMap((row) => row.issues.map((issue) => ({ ...row, issue })));
  const summary = [
    `# Visual QA Audit - ${AUDIT_LABEL}`,
    "",
    `Captured ${rows.length} screenshots across ${Object.keys(VIEWPORTS).join(", ")} viewports.`,
    "",
    "## Issues",
    "",
    ...(
      issueRows.length
        ? issueRows.map(({ mode, name, screenshot, issue }) => `- ${mode} / ${name}: ${issue.type} - ${issue.selector} (${issue.detail}) [${screenshot}]`)
        : ["- No DOM overflow or padding issues detected by the automated pass."]
    ),
    "",
    "## Steps",
    "",
    ...rows.map((row, index) => `${index + 1}. ${row.mode} / ${row.name} - ${row.health} - ${row.screenshot}`),
    "",
  ].join("\n");
  await writeFile(path.join(OUT_DIR, "audit.json"), JSON.stringify(rows, null, 2));
  await writeFile(path.join(OUT_DIR, "notes.md"), summary);
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
