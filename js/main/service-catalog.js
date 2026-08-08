const CATEGORY_ORDER = [
  "Lab Testing - Water Analysis",
  "Lab Testing - Biological",
  "Testing - Materials",
  "Consulting Services",
  "Bid Support",
  "Field Services",
  "Water Management Plan",
  "Service Packages"
];

const CATEGORY_COPY = {
  "Lab Testing - Water Analysis": {
    icon: "ph-drop",
    title: "Water analysis",
    note: "Raw, tower, chilled, closed-loop, boiler, pretreatment, polisher, and condensate testing.",
    description: "See what is in your water and get a clearer next step for the treatment program.",
    cta: "Request water analysis"
  },
  "Lab Testing - Biological": {
    icon: "ph-test-tube",
    title: "Biological testing",
    note: "Biological counts, Legionella culture, Legionella PCR, and biological identification.",
    description: "Measure biological activity and identify what may be growing in the system.",
    cta: "Request biological testing"
  },
  "Testing - Materials": {
    icon: "ph-magnifying-glass",
    title: "Materials testing",
    note: "Corrosion coupon, pipe, deposit, single-element, and abbreviated material analysis.",
    description: "Learn what a deposit, pipe, or corrosion sample can tell you about the equipment problem.",
    representative_image: "/img/representative/applications/deposit-analysis-service-v1.webp",
    cta: "Request materials analysis"
  },
  "Consulting Services": {
    icon: "ph-compass-tool",
    title: "Consulting",
    note: "Equipment inspections, ultrasonic and borescope testing, sprinkler testing, and particle work.",
    description: "Get experienced eyes, useful measurements, and a clear path forward for an equipment problem.",
    cta: "Request technical review"
  },
  "Bid Support": {
    icon: "ph-file-text",
    title: "Bid support",
    note: "Specification creation, spec review, and buyer-side bid interview support.",
    description: "Write a stronger bid, ask sharper questions, and compare vendors on what matters to your operation.",
    representative_image: "/img/representative/applications/bid-wmp-review-desk-v1.webp",
    cta: "Request bid support"
  },
  "Field Services": {
    icon: "ph-hard-hat",
    title: "Field services",
    note: "On-site sample collection and standard sampling visits.",
    description: "Have MASEST collect and route samples so your testing starts with reliable field work.",
    cta: "Request site sampling"
  },
  "Water Management Plan": {
    icon: "ph-clipboard-text",
    title: "Water management",
    note: "ASHRAE 188 assessment, plan writing, renewal, and dashboard access.",
    description: "Build a practical water plan around your facility, systems, team, and day-to-day work.",
    representative_image: "/img/representative/applications/bid-wmp-review-desk-v1.webp",
    cta: "Request a WMP review"
  },
  "Service Packages": {
    icon: "ph-package",
    title: "Packages",
    note: "Bundled initial sampling, annual setup, quarterly audit, and yearly recertification.",
    description: "Bundle sampling, planning, audits, and annual support into one easier engagement.",
    cta: "Request a package"
  }
};

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/[·•]/g, " / ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryKey(value) {
  const clean = normalizeText(value);
  if (clean === "Lab Testing - Materials") return "Testing - Materials";
  return clean;
}

function displayCategory(value) {
  const key = categoryKey(value);
  return key === "Testing - Materials" ? "Lab Testing - Materials" : key;
}

function displayServiceName(value) {
  return normalizeText(value)
    .replace(/\bStd\b/g, "Standard")
    .replace(/\bBio\b/g, "Biological")
    .replace(/\bSpecie ID\b/g, "Species ID")
    .replace(/\s+\+\s+/g, " + ");
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fmtMoney(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Quoted";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number);
}

function serviceSort(a, b) {
  const orderA = Number(a.sort_order);
  const orderB = Number(b.sort_order);
  const hasOrderA = Number.isFinite(orderA);
  const hasOrderB = Number.isFinite(orderB);
  const wmpItems = categoryKey(a.category) === "Water Management Plan"
    && categoryKey(b.category) === "Water Management Plan";
  if (wmpItems && (hasOrderA || hasOrderB)) {
    if (!hasOrderA) return 1;
    if (!hasOrderB) return -1;
    if (orderA !== orderB) return orderA - orderB;
  }
  const priceA = Number(a.public_price || 0);
  const priceB = Number(b.public_price || 0);
  if (a.category === "Service Packages" && b.category === "Service Packages") return priceA - priceB;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function countLabel(count, category = "") {
  if (category === "Service Packages") return `${count} ${count === 1 ? "package" : "packages"}`;
  return `${count} ${count === 1 ? "line item" : "line items"}`;
}

function renderLifecycle(items) {
  if (!items.length) return "";
  return `<br><span class="service-lifecycle" aria-label="Water Management Plan lifecycle">${items
    .map((item, index) => (
      `<b title="${htmlEscape(displayServiceName(item.name))}">${htmlEscape(item.lifecycle_stage)}</b>${index < items.length - 1 ? ' <span aria-hidden="true">→</span> ' : ""}`
    ))
    .join("")}</span>`;
}

function renderCategoryMedia(copy) {
  if (!copy.representative_image) return "";
  return `
    <figure class="service-category-media">
      <img src="${htmlEscape(copy.representative_image)}" alt="${htmlEscape(copy.title)} service setup" width="1536" height="1024" loading="lazy" decoding="async">
      <figcaption>
        <b>Built around the real problem</b>
        <span>Testing, planning, and field support shaped around your equipment and the decision in front of you.</span>
      </figcaption>
    </figure>
  `;
}

function renderServiceCard(item) {
  const name = displayServiceName(item.name);
  // Keep the "per" — a bare "sample" next to a dollar figure reads as
  // "sample price", not the billing unit.
  const rawUnit = normalizeText(item.unit || "service").replace(/^per\s+/i, "");
  const unit = `per ${rawUnit}`;
  const price = fmtMoney(item.public_price, item.currency || "USD");
  const sku = String(item.sku || "").trim();
  // The contact form reads ?type and ?message (not intent/sku) — carry the chosen
  // line item into the notes field so it actually reaches the request.
  const note = `Service request: ${name}${sku ? ` (${sku})` : ""}.`;
  const href = `contact?type=services&message=${encodeURIComponent(note)}`;
  const copy = CATEGORY_COPY[categoryKey(item.category)] || {};
  const description = normalizeText(item.summary)
    || copy.description
    || "Tell us what you need to learn or fix, and we will help you choose the right service.";
  const cta = copy.cta || "Request service";

  return `
    <article class="service-card" data-service-sku="${htmlEscape(sku)}">
      <div class="service-card-main">
        <h3>${htmlEscape(name)}</h3>
        <p>${htmlEscape(description)}</p>
        <div class="rv-compact" data-reviews data-compact data-sku="${htmlEscape(sku)}" data-kind="service" hidden></div>
      </div>
      <div class="service-card-meta">
        <span>${htmlEscape(unit)}</span>
        <b>${htmlEscape(price)}</b>
      </div>
      <a class="btn btn-secondary btn-sm" href="${href}" aria-label="${cta}: ${htmlEscape(name)}">${cta}</a>
    </article>
  `;
}

function renderTabs(groups) {
  return CATEGORY_ORDER
    .filter((category) => groups.has(category))
    .map((category, index) => {
      const display = displayCategory(category);
      const selected = index === 0;
      return `
        <button
          class="service-tab${selected ? " active" : ""}"
          type="button"
          role="tab"
          id="service-tab-${slugify(category)}"
          aria-selected="${selected ? "true" : "false"}"
          aria-controls="service-panel-${slugify(category)}"
          tabindex="${selected ? "0" : "-1"}"
          data-service-tab="${htmlEscape(category)}"
        >
          ${htmlEscape(display)}
        </button>
      `;
    })
    .join("");
}

function renderPanels(groups) {
  const lifecycle = [...groups.values()]
    .flat()
    .filter((item) => item.lifecycle_stage && Number.isFinite(Number(item.sort_order)))
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

  return CATEGORY_ORDER
    .filter((category) => groups.has(category))
    .map((category, index) => {
      const items = groups.get(category).slice().sort(serviceSort);
      const copy = CATEGORY_COPY[category] || { icon: "ph-briefcase", title: displayCategory(category), note: "Practical help for a specific facility need." };
      const prices = items.map((item) => Number(item.public_price)).filter(Number.isFinite);
      const low = prices.length ? Math.min(...prices) : null;
      const high = prices.length ? Math.max(...prices) : null;
      const range = low == null ? "Quoted" : low === high ? fmtMoney(low) : `${fmtMoney(low)} to ${fmtMoney(high)}`;
      const hiddenAttr = index === 0 ? "" : " hidden";

      return `
        <section
          class="service-panel"
          role="tabpanel"
          id="service-panel-${slugify(category)}"
          aria-labelledby="service-tab-${slugify(category)}"
          data-service-panel="${htmlEscape(category)}"
          ${hiddenAttr}
        >
          <div class="service-category-head">
            <div>
              <i class="ph ${copy.icon}" aria-hidden="true"></i>
              <h3>${htmlEscape(copy.title)}</h3>
              <p>${htmlEscape(copy.note)}${category === "Water Management Plan" ? renderLifecycle(lifecycle) : ""}</p>
            </div>
            <div class="service-category-price">
              <span>${htmlEscape(countLabel(items.length, category))}</span>
              <b>${htmlEscape(range)}</b>
            </div>
          </div>
          ${renderCategoryMedia(copy)}
          <div class="service-card-grid">
            ${items.map(renderServiceCard).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function updateSummary(catalog, items) {
  const serviceCount = Array.isArray(catalog?.services) ? catalog.services.length : 0;
  const packageCount = Array.isArray(catalog?.service_packages) ? catalog.service_packages.length : 0;
  const categoryCount = new Set(items.map((item) => normalizeText(item.category))).size;
  document.querySelectorAll("[data-service-count]").forEach((target) => {
    target.textContent = String(serviceCount);
  });
  document.querySelectorAll("[data-package-count]").forEach((target) => {
    target.textContent = String(packageCount);
  });
  document.querySelectorAll("[data-category-count]").forEach((target) => {
    target.textContent = String(categoryCount);
  });
}

function activateServiceTab(root, tab, { focus = false } = {}) {
  const category = tab.getAttribute("data-service-tab");
  root.querySelectorAll("[data-service-tab]").forEach((button) => {
    const active = button === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    // Roving tabindex: only the selected tab is in the tab order (WAI-ARIA tabs pattern).
    button.tabIndex = active ? 0 : -1;
  });
  root.querySelectorAll("[data-service-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-service-panel") !== category;
  });
  if (focus) tab.focus();
}

function bindTabs(root) {
  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-service-tab]");
    if (!tab || !root.contains(tab)) return;
    activateServiceTab(root, tab);
  });
  // Keyboard support for the horizontal tablist (WAI-ARIA APG): arrow keys move
  // between tabs with wrap-around, Home/End jump to the ends, with automatic
  // activation (panels are cheap, so focus follows selection).
  root.addEventListener("keydown", (event) => {
    const current = event.target.closest("[data-service-tab]");
    if (!current || !root.contains(current)) return;
    const tabs = [...root.querySelectorAll("[data-service-tab]")];
    const i = tabs.indexOf(current);
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    else if (event.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (event.key === "Home") next = tabs[0];
    else if (event.key === "End") next = tabs[tabs.length - 1];
    else return;
    event.preventDefault();
    activateServiceTab(root, next, { focus: true });
  });
}

function renderCatalog(root, catalog) {
  const items = [
    ...(Array.isArray(catalog?.services) ? catalog.services : []),
    ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
  ].filter((item) => item && item.active !== false);

  updateSummary(catalog, items);

  if (!items.length) {
    root.innerHTML = `<div class="service-empty"><b>No services listed yet.</b><p>Tell us what you need to test, understand, or fix, and we will help.</p><a class="btn btn-secondary btn-sm" href="contact">Request service</a></div>`;
    return;
  }

  const groups = new Map();
  for (const item of items) {
    const category = categoryKey(item.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  root.innerHTML = `
    <div class="service-tabs" role="tablist" aria-label="Service categories">
      ${renderTabs(groups)}
    </div>
    <div class="service-panels">
      ${renderPanels(groups)}
    </div>
  `;
  bindTabs(root);

  // Reviews: compact star badge per line item/package, hydrated once the cards
  // above exist. Dynamic import keeps auth.js (and the Supabase SDK it pulls
  // in) out of this file's static module graph - js/main/service-catalog.js is
  // imported by every page via js/main.js, but only services.html needs it.
  import("../reviews.js?v=20260711w").then((m) => m.initReviewMounts(root)).catch(() => {});
}

function hasServicesCatalog(catalog) {
  return Boolean(
    (Array.isArray(catalog?.services) && catalog.services.length)
    || (Array.isArray(catalog?.service_packages) && catalog.service_packages.length)
  );
}

async function fetchServicesCatalog() {
  const paths = ["/data/content/services.json", "/data/services.json"];
  let lastError;
  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      const catalog = await response.json();
      if (path === "/data/content/services.json" && !hasServicesCatalog(catalog)) {
        lastError = new Error("content_services_empty");
        continue;
      }
      try {
        const pricing = await loadPricingData();
        const liveBySku = new Map((pricing.services || []).map((service) => [service.sku, service]));
        const applyPrices = (services = []) => services.map((service) => ({
          ...service,
          public_price: liveBySku.get(service.sku)?.public_price ?? null,
        }));
        return {
          ...catalog,
          services: applyPrices(catalog.services),
          service_packages: applyPrices(catalog.service_packages),
        };
      } catch {
        return catalog;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("services_catalog_unavailable");
}

export function initServiceCatalog() {
  const roots = Array.from(document.querySelectorAll("[data-service-catalog]"));
  if (!roots.length) return;

  fetchServicesCatalog()
    .then((catalog) => {
      roots.forEach((root) => renderCatalog(root, catalog));
    })
    .catch(() => {
      roots.forEach((root) => {
        root.innerHTML = `<div class="service-error"><b>Service catalog could not load.</b><p>Tell us what you need, and the MASEST team will help directly.</p><a class="btn btn-secondary btn-sm" href="contact">Request service</a></div>`;
      });
    });
}

export default initServiceCatalog;
import { loadPricingData } from "./pricing-data.js?v=20260807h";
