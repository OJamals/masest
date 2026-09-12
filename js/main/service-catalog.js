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

const SERVICE_SEARCH_INITIAL_COUNT = 8;

function normalizeText(value) {
  return String(value || "")
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/[·•]/g, " / ")
    .replace(/\s+-\s+/g, " - ")
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

function categoryCopy(categories, value) {
  const key = categoryKey(value);
  return categories.get(key) || {
    key,
    slug: slugify(key),
    icon: "ph-briefcase",
    title: displayCategory(key),
    note: "Practical help for a specific facility need.",
    description: "Tell us what you need to learn or fix, and MASEST will help choose the right service.",
    cta: "Request service",
    what_you_send: "The system, sample, or facility question and the result you need.",
    what_you_receive: "The result listed by the selected service.",
    timing: "Scope, schedule, and final price are confirmed before work starts.",
  };
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
  return `${count} ${count === 1 ? "service" : "services"}`;
}

function renderLifecycle(items) {
  if (!items.length) return "";
  return `<br><span class="service-lifecycle" aria-label="Water plan steps">${items
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

function renderServiceCard(item, { showCategory = false, categories = new Map(), hidden = false } = {}) {
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
  const copy = categoryCopy(categories, item.category);
  const description = normalizeText(item.summary)
    || copy.description
    || "Tell us what you need to learn or fix, and we will help you choose the right service.";
  const cta = copy.cta || "Request service";

  return `
    <article${hidden ? " hidden" : ""} class="service-card" data-service-sku="${htmlEscape(sku)}">
      <div class="service-card-main">
        ${showCategory ? `<span class="service-card-category">${htmlEscape(displayCategory(item.category))}</span>` : ""}
        <h3>${htmlEscape(name)}</h3>
        <p>${htmlEscape(description)}</p>
        <details class="service-card-details">
          <summary>What to expect</summary>
          <dl>
            <div><dt>What you send</dt><dd>${htmlEscape(copy.what_you_send)}</dd></div>
            <div><dt>What MASEST does</dt><dd>${htmlEscape(description)}</dd></div>
            <div><dt>What you receive</dt><dd>${htmlEscape(copy.what_you_receive)}</dd></div>
            <div><dt>Timing &amp; preparation</dt><dd>${htmlEscape(copy.timing)}</dd></div>
          </dl>
        </details>
        <div class="rv-compact" data-reviews data-compact data-sku="${htmlEscape(sku)}" data-kind="service" hidden></div>
      </div>
      <div class="service-card-meta">
        <span>${htmlEscape(unit)}</span>
        <b>${htmlEscape(price)}</b>
      </div>
      <a class="btn btn-secondary btn-sm" href="${href}" aria-label="${htmlEscape(cta)}: ${htmlEscape(name)}">${htmlEscape(cta)}</a>
    </article>
  `;
}

function serviceSearchText(item) {
  return [
    item.sku,
    displayServiceName(item.name),
    displayCategory(item.category),
    item.summary,
    item.lifecycle_stage,
  ]
    .map((value) => normalizeText(value).toLocaleLowerCase())
    .join(" ");
}

function renderSearchResults(items, query, categories) {
  if (!items.length) {
    const note = `Service search: ${query}. No catalog match found.`;
    return `
      <div class="service-search-empty" data-service-search-empty>
        <b>No services match “${htmlEscape(query)}”.</b>
        <p>Send the question, sample, system, or result you need. MASEST can route it directly.</p>
        <a class="btn btn-secondary btn-sm" href="contact?type=services&message=${encodeURIComponent(note)}">Ask MASEST</a>
      </div>
    `;
  }

  const visibleCount = Math.min(SERVICE_SEARCH_INITIAL_COUNT, items.length);
  const remainingCount = items.length - visibleCount;

  return `
    <div class="service-search-results-head">
      <b>Matching services</b>
      <span data-service-search-visible-count>Showing ${visibleCount} of ${items.length}</span>
    </div>
    <div class="service-card-grid" id="service-search-grid">
      ${items.map((item, index) => renderServiceCard(item, {
        showCategory: true,
        categories,
        hidden: index >= visibleCount,
      })).join("")}
    </div>
    ${remainingCount > 0 ? `
      <button
        class="btn btn-secondary btn-sm service-search-more"
        type="button"
        aria-controls="service-search-grid"
        aria-expanded="false"
        data-service-search-more
      >Show ${remainingCount} more services</button>
    ` : ""}
  `;
}

function serviceSearchStatus(total, visible, query) {
  const count = total === 1 ? "result" : "results";
  if (total === 0) return `0 ${count} for “${query}”`;
  const shown = visible === total ? `Showing all ${total}` : `Showing ${visible} of ${total}`;
  return `${shown} ${count} for “${query}”`;
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

function renderPanels(groups, categories) {
  const lifecycle = [...groups.values()]
    .flat()
    .filter((item) => item.lifecycle_stage && Number.isFinite(Number(item.sort_order)))
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));

  return CATEGORY_ORDER
    .filter((category) => groups.has(category))
    .map((category, index) => {
      const items = groups.get(category).slice().sort(serviceSort);
      const copy = categoryCopy(categories, category);
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
              <i class="ph ${htmlEscape(copy.icon)}" aria-hidden="true"></i>
              <h3>${htmlEscape(copy.title)}</h3>
              <p>${htmlEscape(copy.note)}${category === "Water Management Plan" ? renderLifecycle(lifecycle) : ""}</p>
              <a class="service-category-guide-link" href="services/${htmlEscape(copy.slug)}">View ${htmlEscape(copy.title)} guide</a>
            </div>
            <div class="service-category-price">
              <span>${htmlEscape(countLabel(items.length, category))}</span>
              <b>${htmlEscape(range)}</b>
            </div>
          </div>
          ${renderCategoryMedia(copy)}
          <div class="service-card-grid">
            ${items.map((item) => renderServiceCard(item, { categories })).join("")}
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

function activateServiceTab(root, tab, { focus = false, syncUrl = true } = {}) {
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
  if (syncUrl) {
    history.replaceState(null, "", `${location.pathname}${location.search}#service-${slugify(category)}`);
  }
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

function serviceQueryFromUrl() {
  return (new URLSearchParams(location.search).get("q") || "").trim();
}

function syncServiceQueryUrl(query) {
  const params = new URLSearchParams(location.search);
  if (query) params.set("q", query);
  else params.delete("q");
  const search = params.toString();
  const next = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) history.replaceState(null, "", next);
}

function bindSearch(root, items, categories) {
  const input = root.querySelector("[data-service-search]");
  const clear = root.querySelector("[data-service-search-clear]");
  const status = root.querySelector("[data-service-search-status]");
  const tabs = root.querySelector(".service-tabs");
  const panels = root.querySelector(".service-panels");
  const results = root.querySelector("[data-service-search-results]");
  const total = items.length;

  const update = ({ syncUrl = true } = {}) => {
    const rawQuery = input.value.trim();
    const query = normalizeText(rawQuery);
    const needle = query.toLocaleLowerCase();
    const searching = Boolean(needle);
    const matches = searching
      ? items.filter((item) => searchTextMatchesQuery(serviceSearchText(item), needle))
      : [];

    if (syncUrl) syncServiceQueryUrl(rawQuery);

    clear.hidden = !searching;
    tabs.hidden = searching;
    panels.hidden = searching;
    results.hidden = !searching;

    if (!searching) {
      results.replaceChildren();
      status.textContent = `${total} services and packages`;
      return;
    }

    results.innerHTML = renderSearchResults(matches, query, categories);
    status.textContent = serviceSearchStatus(
      matches.length,
      Math.min(SERVICE_SEARCH_INITIAL_COUNT, matches.length),
      query,
    );
  };

  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-service-search-more]");
    if (!button || !results.contains(button)) return;

    const cards = [...results.querySelectorAll(".service-card")];
    const expanded = button.getAttribute("aria-expanded") !== "true";
    const visibleCount = expanded ? cards.length : Math.min(SERVICE_SEARCH_INITIAL_COUNT, cards.length);
    const firstNewResultAction = expanded
      ? cards[SERVICE_SEARCH_INITIAL_COUNT]?.querySelector("a")
      : null;
    const focusTarget = firstNewResultAction || button;

    cards.forEach((card, index) => {
      card.hidden = !expanded && index >= SERVICE_SEARCH_INITIAL_COUNT;
    });
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded
      ? "Show fewer"
      : `Show ${cards.length - visibleCount} more services`;
    results.querySelector("[data-service-search-visible-count]").textContent = expanded
      ? `Showing all ${cards.length}`
      : `Showing ${visibleCount} of ${cards.length}`;
    status.textContent = serviceSearchStatus(cards.length, visibleCount, normalizeText(input.value));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!focusTarget.isConnected) return;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView({ block: "center" });
    }));
  });

  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !input.value) return;
    event.preventDefault();
    input.value = "";
    update();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    update();
    input.focus();
  });
  const restoreFromUrl = () => {
    input.value = serviceQueryFromUrl();
    update({ syncUrl: false });
  };
  window.addEventListener("popstate", restoreFromUrl);
  restoreFromUrl();
}

function renderCatalog(root, catalog) {
  const items = [
    ...(Array.isArray(catalog?.services) ? catalog.services : []),
    ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
  ].filter((item) => item && item.active !== false);
  const categories = new Map(
    (Array.isArray(catalog?.service_categories) ? catalog.service_categories : [])
      .filter((category) => category?.key)
      .map((category) => [categoryKey(category.key), category]),
  );

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
    <div class="service-search-toolbar" role="search">
      <label class="service-search-label">
        <span>Search services</span>
        <span class="service-search-field">
          <input type="search" autocomplete="off" placeholder="Try water, Legionella, field support…" data-service-search>
          <button type="button" data-service-search-clear aria-label="Clear service search" hidden>Clear</button>
        </span>
      </label>
      <p class="service-search-status" data-service-search-status role="status" aria-live="polite"></p>
    </div>
    <div class="service-tabs" role="tablist" aria-label="Service categories">
      ${renderTabs(groups)}
    </div>
    <section class="service-search-results" data-service-search-results aria-label="Service search results" hidden></section>
    <div class="service-panels">
      ${renderPanels(groups, categories)}
    </div>
  `;
  bindTabs(root);
  bindSearch(root, items, categories);
  let requestedHash = location.hash;
  try { requestedHash = decodeURIComponent(requestedHash); } catch { /* ignore malformed external fragments */ }
  const requestedTab = [...root.querySelectorAll("[data-service-tab]")]
    .find((tab) => requestedHash === `#service-${slugify(tab.dataset.serviceTab)}`);
  if (requestedTab) activateServiceTab(root, requestedTab, { syncUrl: false });

  // Reviews: compact star badge per line item/package, hydrated once the cards
  // above exist. Dynamic import keeps auth.js (and the Supabase SDK it pulls
  // in) out of this file's static module graph - js/main/service-catalog.js is
  // imported by every page via js/main.js, but only services.html needs it.
  import("../reviews.js?v=20260911g").then((m) => m.initReviewMounts(root)).catch(() => {});
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
      let catalog = await response.json();
      if (path === "/data/content/services.json" && !hasServicesCatalog(catalog)) {
        lastError = new Error("content_services_empty");
        continue;
      }
      if (
        path !== "/data/services.json"
        && (!Array.isArray(catalog.service_categories) || !catalog.service_categories.length)
      ) {
        try {
          const staticResponse = await fetch("/data/services.json", { cache: "no-store" });
          if (staticResponse.ok) {
            const staticCatalog = await staticResponse.json();
            catalog = { ...catalog, service_categories: staticCatalog.service_categories || [] };
          }
        } catch { /* generic category copy remains available */ }
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
import { searchTextMatchesQuery } from "./fuzzy-search.js?v=20260911g";
import { loadPricingData } from "./pricing-data.js?v=20260911g";
