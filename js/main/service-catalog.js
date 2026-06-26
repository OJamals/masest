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
    note: "Raw, tower, chilled, closed-loop, boiler, pretreatment, polisher, and condensate testing."
  },
  "Lab Testing - Biological": {
    icon: "ph-test-tube",
    title: "Biological testing",
    note: "Biological counts, Legionella culture, Legionella PCR, and biological identification."
  },
  "Testing - Materials": {
    icon: "ph-magnifying-glass",
    title: "Materials testing",
    note: "Corrosion coupon, pipe, deposit, single-element, and abbreviated material analysis."
  },
  "Consulting Services": {
    icon: "ph-compass-tool",
    title: "Consulting",
    note: "Equipment inspections, ultrasonic and borescope testing, sprinkler testing, and particle work."
  },
  "Bid Support": {
    icon: "ph-file-text",
    title: "Bid support",
    note: "Specification creation, spec review, and buyer-side bid interview support."
  },
  "Field Services": {
    icon: "ph-hard-hat",
    title: "Field services",
    note: "On-site sample collection and standard sampling visits."
  },
  "Water Management Plan": {
    icon: "ph-clipboard-text",
    title: "Water management",
    note: "ASHRAE 188 assessment, plan writing, renewal, and dashboard access."
  },
  "Service Packages": {
    icon: "ph-package",
    title: "Packages",
    note: "Bundled initial sampling, annual setup, quarterly audit, and yearly recertification."
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

function displayCategory(value) {
  const clean = normalizeText(value);
  if (clean === "Testing - Materials") return "Lab Testing - Materials";
  return clean;
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
  const priceA = Number(a.public_price || 0);
  const priceB = Number(b.public_price || 0);
  if (a.category === "Service Packages" && b.category === "Service Packages") return priceA - priceB;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function countLabel(count, category = "") {
  if (category === "Service Packages") return `${count} ${count === 1 ? "package" : "packages"}`;
  return `${count} ${count === 1 ? "line item" : "line items"}`;
}

function renderServiceCard(item) {
  const name = displayServiceName(item.name);
  const unit = normalizeText(item.unit || "service").replace(/^per\s+/i, "");
  const price = fmtMoney(item.public_price, item.currency || "USD");
  const sku = String(item.sku || "").trim();
  const href = `contact.html?intent=service&sku=${encodeURIComponent(sku)}`;
  const description = item.description
    ? normalizeText(item.description)
    : "Final scope, schedule, and deliverables are confirmed before work begins.";

  return `
    <article class="service-card" data-service-sku="${htmlEscape(sku)}">
      <div class="service-card-main">
        <h3>${htmlEscape(name)}</h3>
        <p>${htmlEscape(description)}</p>
      </div>
      <div class="service-card-meta">
        <span>${htmlEscape(unit)}</span>
        <b>${htmlEscape(price)}</b>
      </div>
      <a class="btn btn-secondary btn-sm" href="${href}" aria-label="Request ${htmlEscape(name)}">Request service</a>
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
          data-service-tab="${htmlEscape(category)}"
        >
          ${htmlEscape(display)}
        </button>
      `;
    })
    .join("");
}

function renderPanels(groups) {
  return CATEGORY_ORDER
    .filter((category) => groups.has(category))
    .map((category, index) => {
      const items = groups.get(category).slice().sort(serviceSort);
      const copy = CATEGORY_COPY[category] || { icon: "ph-briefcase", title: displayCategory(category), note: "Quote-confirmed technical service." };
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
              <p>${htmlEscape(copy.note)}</p>
            </div>
            <div class="service-category-price">
              <span>${htmlEscape(countLabel(items.length, category))}</span>
              <b>${htmlEscape(range)}</b>
            </div>
          </div>
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

function bindTabs(root) {
  root.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-service-tab]");
    if (!tab || !root.contains(tab)) return;
    const category = tab.getAttribute("data-service-tab");
    root.querySelectorAll("[data-service-tab]").forEach((button) => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    root.querySelectorAll("[data-service-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-service-panel") !== category;
    });
  });
}

function renderCatalog(root, catalog) {
  const items = [
    ...(Array.isArray(catalog?.services) ? catalog.services : []),
    ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
  ].filter((item) => item && item.active !== false);

  updateSummary(catalog, items);

  if (!items.length) {
    root.innerHTML = `<div class="service-empty"><b>No services listed yet.</b><p>Use the contact form and MASEST will scope the service you need.</p><a class="btn btn-secondary btn-sm" href="contact">Request service</a></div>`;
    return;
  }

  const groups = new Map();
  for (const item of items) {
    const rawCategory = normalizeText(item.category);
    const category = rawCategory === "Lab Testing - Materials" ? "Testing - Materials" : rawCategory;
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
      return catalog;
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
        root.innerHTML = `<div class="service-error"><b>Service catalog could not load.</b><p>Use the contact form and MASEST will confirm service scope manually.</p><a class="btn btn-secondary btn-sm" href="contact">Request service</a></div>`;
      });
    });
}

export default initServiceCatalog;
