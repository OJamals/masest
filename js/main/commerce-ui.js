/* Product cards, catalog filtering, and commerce UI behavior. */

import { CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_CATALOG_COPY, PRODUCTS, QUOTE_FIRST_IDS, catalogImageDimensions } from "./catalog-data.js?v=20260908c";
import { smoothPref } from "./engagement.js";
import { MARINE_CATALOG_GROUP, loadMarineCatalog, marineSearchRow } from "./marine-catalog.js?v=20260908c";
import { normalizeProductSearch, rankProductIds } from "./product-search.js?v=20260908c";

function imageDimsAttr(src) {
  const { width, height } = catalogImageDimensions(src);
  return `width="${width}" height="${height}"`;
}

export function productCard(id, heroCard = false, eager = false) {
  const p = PRODUCTS[id];
  const catalog = PRODUCT_CATALOG_COPY[id] || {};
  const badge = `<span class="hmis-badge note">${catalog.platform || `HMIS ${p.hmis || "0-0-0"}`}</span>`;
  const mediaLoading = heroCard || eager ? "eager" : "lazy";
  const mediaPriority = heroCard || eager ? ' fetchpriority="high"' : "";
  const media = p.image
    ? `<a class="prod-media" href="products/${id}" aria-label="View ${p.name} details"><img src="${p.image}" alt="${p.name} product photo" loading="${mediaLoading}"${mediaPriority} ${imageDimsAttr(p.image)}></a>`
    : "";
  return `
  <div class="prod-card${heroCard ? " hero-card" : ""} reveal">
    ${media}
    <div class="prod-top"><i class="ph ${p.icon}" aria-hidden="true"></i>${badge}</div>
    <span class="catalog-type">${catalog.job || p.replaces}</span>
    <h3>${p.name}</h3>
      <p>${catalog.summary}</p>
      <div class="prod-actions">
        <a class="btn btn-ink btn-sm" href="products/${id}">See how it works</a>
        <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button"></span>
      </div>
  </div>`;
}

/* ---------- Products shop: e-commerce grid ---------- */
// Whole-card link, e-commerce style. Used by the unified products grid.
const commerceState = {
  loaded: false,
  products: new Map(),
  productsByMarket: new Map(),
  promise: null
};

const COMMERCE_SKU_ALIASES = {
  crhd: "cr-hd",
};

export function adminCatalogHref(id) {
  const key = String(id || "").trim().toLowerCase();
  const sku = COMMERCE_SKU_ALIASES[key] || key;
  return `/admin.html?product_q=${encodeURIComponent(sku)}#products`;
}

function commerceRowFor(id, market = commerceMarket()) {
  const key = String(id || "").toLowerCase();
  if (QUOTE_FIRST_IDS.includes(key)) return null;
  const products = commerceState.productsByMarket.get(market) || commerceState.products;
  return products.get(key) || products.get(COMMERCE_SKU_ALIASES[key]);
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2
  }).format(Number(n));
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function caseSavingsFor(row, selected) {
  if (!row || !selected) return null;
  const selectedIsCase = selected.package_kind === "case";
  const availableCases = [
    ...(row.variants || []).filter(v => v.package_kind === "case"),
    ...(row.caseVariants || []),
  ];
  const caseVariant = selectedIsCase
    ? selected
    : availableCases.find(v => String(v.unit_vsku) === String(selected.vsku));
  if (!caseVariant || (caseVariant.active === false && caseVariant.case_contact_available !== true)) return null;

  const unitVariant = row.variants?.find(v => String(v.vsku) === String(caseVariant.unit_vsku));
  const units = Number(caseVariant.units_per_case);
  const unitPriceMinor = Math.round(Number(unitVariant?.price) * 100);
  const casePriceMinor = Math.round(Number(caseVariant.price) * 100);
  const unitCurrency = String(unitVariant?.currency || "").toUpperCase();
  const caseCurrency = String(caseVariant.currency || "").toUpperCase();
  if (
    !unitVariant
    || !Number.isInteger(units)
    || units < 2
    || !Number.isFinite(unitPriceMinor)
    || unitPriceMinor <= 0
    || !Number.isFinite(casePriceMinor)
    || casePriceMinor <= 0
    || !unitCurrency
    || unitCurrency !== caseCurrency
  ) return null;

  const regularPriceMinor = unitPriceMinor * units;
  const savingsMinor = regularPriceMinor - casePriceMinor;
  if (savingsMinor <= 0) return null;

  return {
    caseVariant,
    unitVariant,
    units,
    regularPrice: regularPriceMinor / 100,
    casePrice: casePriceMinor / 100,
    savings: savingsMinor / 100,
    percent: Math.round((savingsMinor / regularPriceMinor) * 100),
  };
}

export function caseSavingsText(row, selected) {
  const detail = caseSavingsFor(row, selected);
  if (!detail) return "";
  return `Case of ${detail.units} saves ${fmtMoney(detail.savings, detail.caseVariant.currency)} (${detail.percent}%)`;
}

function variantDedupeKey(v) {
  return `sku:${String(v?.vsku || "").toLowerCase()}`;
}

function preferVariant(next, prev) {
  if (!prev) return next;
  const sortDelta = Number(next?.sort ?? 0) - Number(prev?.sort ?? 0);
  if (sortDelta < 0) return next;
  if (sortDelta > 0) return prev;
  return String(next?.vsku || "").localeCompare(String(prev?.vsku || "")) < 0 ? next : prev;
}

function dedupeVariants(variants = []) {
  const byKey = new Map();
  for (const variant of variants) {
    if (!variant) continue;
    const key = variantDedupeKey(variant);
    byKey.set(key, preferVariant(variant, byKey.get(key)));
  }
  return [...byKey.values()]
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)
      || (Number(a.gallons) || 0) - (Number(b.gallons) || 0)
      || String(a.vsku || "").localeCompare(String(b.vsku || "")));
}

function commerceMarket() {
  const query = typeof location === "undefined" ? "" : location.search;
  const params = new URLSearchParams(query);
  return params.get("market") === "marine" || params.get("category") === "marine"
    ? "marine"
    : "industrial";
}

function normalizeCommerceRow(row, market = commerceMarket()) {
  const parent = row?.products && typeof row.products === "object" ? row.products : row;
  const sku = String(parent?.sku || row?.sku || "").trim().toLowerCase();
  const rawVariants = row?.vsku
    ? [{
      vsku: row.vsku,
      label: row.label || "Each",
      gallons: row.gallons,
      price: row.price,
      currency: row.currency || parent?.currency,
      active: row.active,
      market: row.market,
      package_kind: row.package_kind,
      marketing_name: row.marketing_name,
      units_per_case: row.units_per_case,
      unit_vsku: row.unit_vsku,
      case_contact_available: row.case_contact_available,
      requires_quote: row.requires_quote,
      sort: row.sort || 0,
    }]
    : Array.isArray(row?.product_variants) && row.product_variants.length ? row.product_variants : [{
      vsku: row?.sku,
      label: "Each",
      gallons: row?.gallons || 0,
      price: row?.price,
      currency: row?.currency,
      active: row?.active,
      sort: 0,
    }];
  const shapeVariant = (v) => ({
    vsku: v.vsku,
    label: v.label,
    gallons: Number(v.gallons) || 0,
    price: v.price == null ? null : Number(v.price),
    currency: String(v.currency || parent?.currency || row?.currency || "usd").toUpperCase(),
    active: v.active !== false,
    market: String(v.market || "industrial").toLowerCase(),
    package_kind: String(v.package_kind || "unit").toLowerCase(),
    marketing_name: v.marketing_name || parent?.name || row?.name || "",
    units_per_case: Number(v.units_per_case || 1),
    unit_vsku: v.unit_vsku || null,
    case_contact_available: v.case_contact_available === true,
    requires_quote: v.requires_quote === true,
    sort: Number(v.sort || 0),
  });
  const variants = dedupeVariants(rawVariants
    .filter(v => v && String(v.market || "industrial").toLowerCase() === market
      && v.active !== false && v.price != null && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(shapeVariant));
  const activeUnitSkus = new Set(variants
    .filter(v => v.package_kind !== "case")
    .map(v => String(v.vsku)));
  const caseVariants = dedupeVariants(rawVariants
    .filter(v => v && String(v.market || "industrial").toLowerCase() === market
      && v.active === false
      && v.case_contact_available === true
      && String(v.package_kind || "").toLowerCase() === "case"
      && v.price != null
      && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(shapeVariant))
    .filter(v => activeUnitSkus.has(String(v.unit_vsku)));
  // Bulk drums/totes (55/275 gal) are unpriced and never sold direct.
  const quoteVariants = dedupeVariants(rawVariants
    .filter(v => v && String(v.market || "industrial").toLowerCase() === market
      && v.active === false && (v.requires_quote === true || Number(v.gallons) >= 55))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(shapeVariant));
  return {
    sku,
    active: parent?.active !== false && row?.active !== false,
    mode: parent?.mode || row?.mode,
    image_url: parent?.image_url || row?.image_url || "",
    photo_alt: parent?.photo_alt || row?.photo_alt || "",
    variants,
    caseVariants,
    quoteVariants,
    purchasable: !!(sku && parent?.active !== false && row?.active !== false && (parent?.mode || row?.mode) === "buy" && variants.length)
  };
}

function buildCommerceProducts(rows, market) {
  const products = rows
    .map((row) => normalizeCommerceRow(row, market))
    .filter((row) => row.sku)
    .reduce((map, row) => {
      const existing = map.get(row.sku);
      if (!existing) {
        map.set(row.sku, row);
        return map;
      }
      existing.active = existing.active && row.active;
      existing.mode = existing.mode || row.mode;
      existing.variants = dedupeVariants(existing.variants.concat(row.variants));
      existing.caseVariants = dedupeVariants((existing.caseVariants || []).concat(row.caseVariants || []));
      existing.quoteVariants = dedupeVariants((existing.quoteVariants || []).concat(row.quoteVariants || []));
      if (!existing.image_url && row.image_url) existing.image_url = row.image_url;
      if (!existing.photo_alt && row.photo_alt) existing.photo_alt = row.photo_alt;
      existing.purchasable = existing.purchasable || row.purchasable;
      return map;
    }, new Map());
  for (const [alias, sku] of Object.entries(COMMERCE_SKU_ALIASES)) {
    const row = products.get(sku);
    if (row && !products.has(alias)) products.set(alias, row);
  }
  return products;
}

export async function loadCommerceCatalog() {
  if (commerceState.promise) return commerceState.promise;
  commerceState.promise = fetch("/api/products", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  })
    .then(async response => {
      if (!response.ok) throw new Error("catalog_unavailable");
      const payload = await response.json();
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      commerceState.productsByMarket = new Map([
        ["industrial", buildCommerceProducts(rows, "industrial")],
        ["marine", buildCommerceProducts(rows, "marine")],
      ]);
      commerceState.products = commerceState.productsByMarket.get(commerceMarket());
      commerceState.loaded = true;
      return commerceState.products;
    })
    .catch(() => {
      commerceState.loaded = true;
      commerceState.products = new Map();
      commerceState.productsByMarket = new Map();
      return commerceState.products;
    });
  return commerceState.promise;
}

function commerceActionHTML(id, variant = "chip", quoteFallback = "on", market = commerceMarket()) {
  const p = PRODUCTS[id];
  // Quote-first SKUs never expose a buy control here (catalogCard renders quoteActionHTML).
  if (QUOTE_FIRST_IDS.includes(String(id || "").toLowerCase())) return "";
  // Staff manage inventory and customer orders in the admin console. Sending them
  // into the buyer cart creates a dead end because that route correctly rejects staff.
  if (document.documentElement.dataset.accountKind === "staff") {
    if (variant === "quick") {
      return `<a class="shop-card-quick-add" href="${htmlEscape(adminCatalogHref(id))}" aria-label="Manage ${htmlEscape(p?.name || id)} in the catalog" title="Manage catalog">`
        + `<span class="shop-card-quick-add-copy" aria-hidden="true">Manage catalog</span>`
        + `<i class="ph ph-package" aria-hidden="true"></i>`
        + `</a>`;
    }
    const staffClass = variant === "button" ? "btn btn-secondary btn-sm" : "shop-card-quote";
    return `<a class="${staffClass} commerce-staff-admin" href="${htmlEscape(adminCatalogHref(id))}"><i class="ph ph-package" aria-hidden="true"></i>Manage catalog</a>`;
  }
  // Catalog still in flight → sized skeleton so the buy area isn't blank (and to avoid CLS
  // when the real control swaps in). refreshCommerceActions re-renders once the load settles.
  if (!commerceState.loaded) {
    if (variant === "quick") {
      return `<span class="shop-card-quick-add shop-card-quick-add-loading skeleton" aria-hidden="true"></span>`;
    }
    return `<span class="commerce-buy commerce-buy-loading" aria-hidden="true"><span class="skeleton commerce-skeleton"></span></span>`;
  }
  const row = commerceRowFor(id, market);
  if (row?.purchasable && row.variants.length) {
    // Root-absolute paths: these controls also hydrate on /products/<id> subpages,
    // where a relative "contact" or "account.html" would resolve under /products/.
    const accountPath = `/account.html?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
    // Strip the container noun so the sizes line up as a scannable list of volumes.
    // "jug" was missing, so one dropdown read "1 gal jug / 2.5 gal jug / 5 gal / 55 gal" —
    // the same column mixing packs that keep their noun with packs that lost it. The full
    // label is still spelled out under the price, which is where the detail belongs.
    const optLabel = (v) => {
      const label = String(v.label || "Pack").replace(/\s+(bottle|jug|pail|drum|tote)$/i, "");
      return v.package_kind === "case" ? label.replace(/^case of\s+(.+)$/i, "$1 case") : label;
    };
    const displayName = row.variants[0]?.marketing_name || p?.name || id;
    const unitOpts = row.variants
      .map((v, i) => {
        const savings = caseSavingsFor(row, v);
        const priceLabel = Number.isFinite(Number(v.price)) && Number(v.price) > 0
          ? ` — ${fmtMoney(v.price, v.currency)}`
          : "";
        const savingsLabel = savings && v.package_kind === "case" ? ` · ${savings.percent}% off` : "";
        return `<option value="${htmlEscape(v.vsku)}"${i === 0 ? " selected" : ""}>${htmlEscape(optLabel(v))}${htmlEscape(priceLabel)}${htmlEscape(savingsLabel)}</option>`;
      })
      .join("");
    const caseOpts = (row.caseVariants || [])
      .map((v) => {
        const savings = caseSavingsFor(row, v);
        return savings
          ? `<option value="${htmlEscape(v.vsku)}" data-quote="1" data-case-contact="1">${htmlEscape(optLabel(v))} — ${htmlEscape(fmtMoney(v.price, v.currency))} · ${savings.percent}% off</option>`
          : "";
      })
      .join("");
    const quoteOpts = (row.quoteVariants || [])
      .map((v) => `<option value="${htmlEscape(v.vsku)}" data-quote="1">${htmlEscape(optLabel(v))} — quoted</option>`)
      .join("");
    const opts = `${unitOpts}${caseOpts}${quoteOpts}`;
    const firstVariant = row.variants[0];
    const first = firstVariant.vsku;
    if (variant === "quick") {
      const packLabel = optLabel(firstVariant);
      const readyLabel = `Add ${displayName}, ${packLabel}, to cart`;
      return `<span class="commerce-buy" data-commerce-buy="${htmlEscape(id)}">`
        + `<button class="shop-card-quick-add" type="button" data-cart-add="${htmlEscape(first)}" data-cart-quick-add="${htmlEscape(id)}" data-cart-state="ready" data-cart-ready-label="${htmlEscape(readyLabel)}" data-cart-product-name="${htmlEscape(displayName)}" data-account-path="${htmlEscape(accountPath)}" aria-label="${htmlEscape(readyLabel)}" title="Quick add ${htmlEscape(packLabel)}">`
        + `<span class="shop-card-quick-add-copy" aria-hidden="true">Quick add ${htmlEscape(packLabel)}</span>`
        + `<i class="ph ph-shopping-cart-simple" aria-hidden="true"></i>`
        + `<span class="sr-only" data-cart-status aria-live="polite"></span>`
        + `</button>`
        + `</span>`;
    }
    // The "button" variant only mounts on /products/<id>, the highest-intent surface on the
    // site. Rendering the buy control as btn-secondary left it visually subordinate to the
    // quote and sample CTAs directly beneath it — primary is the correct weight for the
    // action the page exists to complete.
    const btnClass = variant === "button" ? "btn btn-primary btn-sm" : "shop-card-add";
    const quoteHref = `/contact?type=quote&product=${encodeURIComponent(displayName)}`;
    const firstPackLabel = optLabel(firstVariant);
    return `<span class="commerce-buy" data-commerce-buy="${htmlEscape(id)}">`
      + `<select class="commerce-vol" name="volume" aria-label="Volume for ${htmlEscape(displayName)}">${opts}</select>`
      + `<button class="${btnClass}" type="button" data-cart-add="${htmlEscape(first)}" data-cart-product-name="${htmlEscape(displayName)}" data-account-path="${htmlEscape(accountPath)}" aria-label="Add ${htmlEscape(displayName)}, ${htmlEscape(firstPackLabel)}, to cart">Add to cart</button>`
      + `<a class="${btnClass} commerce-quote-swap" hidden href="${htmlEscape(`${quoteHref}#quoteForm`)}" data-quote-base="${htmlEscape(quoteHref)}" aria-label="Request a bulk quote for ${htmlEscape(displayName)}">Request quote</a>`
      + `</span>`;
  }
  // Loaded, but no buyable variant — the catalog fetch failed (loadCommerceCatalog's catch
  // leaves an empty map) or this SKU isn't sellable online. Route the buyer forward to a
  // quote instead of leaving a dead, blank buy area (PRODUCT: route forward from every state).
  // Mounts that already sit next to a static quote CTA opt out via data-quote-fallback="off".
  if (quoteFallback === "off") return "";
  if (variant === "quick") {
    const name = p?.name || id;
    return `<a class="shop-card-quick-add" href="${htmlEscape(`/contact?type=quote&product=${encodeURIComponent(name)}#quoteForm`)}" aria-label="Request pricing for ${htmlEscape(name)}" title="Request pricing">`
      + `<span class="shop-card-quick-add-copy" aria-hidden="true">Request pricing</span>`
      + `<i class="ph ph-tag" aria-hidden="true"></i>`
      + `</a>`;
  }
  return `<a class="btn btn-secondary btn-sm commerce-quote-fallback" href="/contact?type=quote&product=${encodeURIComponent(p?.name || id)}#quoteForm">Request pricing</a>`;
}

function quoteActionHTML(id) {
  const name = PRODUCTS[id]?.name || id;
  // Mirror the buyable buybar's price-line + control rhythm so quote-only cards
  // read as a deliberate state, not a card missing its commerce block.
  return `<span class="shop-card-price"><strong class="price-main price-main-quote">Quote-priced</strong><span class="price-note">Volume &amp; freight quoted</span></span>`
    + `<a class="shop-card-quote" href="/contact?type=quote&product=${encodeURIComponent(name)}#quoteForm"><i class="ph ph-tag" aria-hidden="true"></i>Request quote</a>`;
}

function bulkPriceText(id) {
  const row = commerceRowFor(id);
  const variants = Array.isArray(row?.variants)
    ? row.variants.filter(v => Number.isFinite(Number(v.price)) && Number(v.price) > 0)
    : [];
  if (!variants.length) return "";
  const first = variants
    .slice()
    .sort((a, b) => (Number(a.gallons) || 0) - (Number(b.gallons) || 0))[0];
  return fmtMoney(first.price, first.currency);
}

function bulkPriceNote(id) {
  const row = commerceRowFor(id);
  const variants = Array.isArray(row?.variants)
    ? row.variants.filter(v => Number.isFinite(Number(v.price)) && Number(v.price) > 0)
    : [];
  if (!variants.length) return "";
  const first = variants
    .slice()
    .sort((a, b) => (Number(a.gallons) || 0) - (Number(b.gallons) || 0))[0];
  return first.label || "Selected pack";
}

function selectedVariantFor(id, vsku) {
  const row = commerceRowFor(id);
  return row?.variants?.find(v => String(v.vsku) === String(vsku))
    || row?.caseVariants?.find(v => String(v.vsku) === String(vsku))
    || row?.quoteVariants?.find(v => String(v.vsku) === String(vsku));
}

function bulkPerGallonText(id, selected = null) {
  const row = commerceRowFor(id);
  const variant = selected || row?.variants?.[0];
  if (!variant || !Number.isFinite(Number(variant.price)) || Number(variant.gallons) <= 0) return "";
  return `${fmtMoney(Number(variant.price) / Number(variant.gallons), variant.currency)}/gal`;
}

function bulkPriceMarkup(id) {
  const row = commerceRowFor(id);
  const selected = row?.variants?.[0];
  const text = bulkPriceText(id);
  const note = bulkPriceNote(id);
  const perGallon = bulkPerGallonText(id);
  const savings = caseSavingsText(row, selected);
  return `<strong class="price-main">${htmlEscape(text)}</strong>`
    + `<span class="price-note">${htmlEscape(note)}</span>`
    + `<span class="shop-card-savings" aria-live="polite"${savings ? "" : " hidden"}>${htmlEscape(savings)}</span>`
    + (perGallon ? `<span class="shop-card-bulk">${htmlEscape(perGallon)}</span>` : "");
}

function bulkPriceHTML(id) {
  const text = bulkPriceText(id);
  return `<span class="shop-card-price" data-commerce-price="${id}"${text ? "" : " hidden"}>`
    + bulkPriceMarkup(id)
    + `</span>`;
}

// The brand poster is a text-heavy marketing tile; in a photo grid it reads as
// clutter, so cards treat it as "no product photo" and fall back to the icon tile.
function isPosterFallback(src) {
  return /masest-poster-transparent\.png$/.test(String(src || ""));
}

function commerceMediaFor(id) {
  const row = commerceRowFor(id);
  const p = PRODUCTS[id];
  const src = row?.image_url || p?.image || "";
  return {
    src: isPosterFallback(src) ? "" : src,
    alt: row?.photo_alt || (p ? `${p.name} product image` : "")
  };
}

function productMarketMarker() {
  const market = new URLSearchParams(window.location.search).get("market");
  if (market !== "marine") return null;
  return document.querySelector('[data-product-market="marine"]');
}

function productMarketMedia() {
  const marker = productMarketMarker();
  const src = marker?.dataset.productMarketImage || "";
  if (!src) return null;
  return {
    src,
    alt: marker.dataset.productMarketImageAlt || `${marker.dataset.productMarketName} marine product jug`,
  };
}

function refreshCommerceMedia(root = document) {
  root.querySelectorAll(".shop-card[data-id], [data-commerce-media]").forEach(container => {
    const isDetail = container.hasAttribute("data-commerce-media");
    if (!isDetail && container.dataset.market === "marine") return;
    const media = isDetail
      ? productMarketMedia() || commerceMediaFor(container.dataset.commerceMedia)
      : commerceMediaFor(container.dataset.id);
    if (!media.src) return;
    const slot = isDetail ? container : container.querySelector(".shop-card-media");
    if (!slot) return;
    let img = slot.querySelector("img");
    if (!img) {
      slot.querySelector(".shop-card-placeholder, .media-fallback-label")?.remove();
      img = document.createElement("img");
      img.loading = isDetail ? "eager" : "lazy";
      img.decoding = "async";
      img.width = 900;
      img.height = 1200;
      slot.insertBefore(img, slot.firstChild);
    }
    img.src = isDetail && !/^(?:[a-z]+:|\/)/i.test(media.src) ? `/${media.src}` : media.src;
    img.alt = media.alt;
  });
}

function productMarketContext() {
  const marker = productMarketMarker();
  if (!marker) return null;
  return {
    market: "marine",
    name: marker.dataset.productMarketName,
    product: marker.dataset.productMarketProduct,
  };
}

// Add the selected volume variant (or the button's default vsku) to the cart, with transient feedback.
async function addToCartFromButton(button) {
  const wrap = button.closest("[data-commerce-buy]");
  const select = wrap && wrap.querySelector(".commerce-vol");
  const vsku = (select && select.value) || button.dataset.cartAdd;
  if (!vsku) return;
  const isQuickAdd = button.hasAttribute("data-cart-quick-add");
  const label = button.textContent;
  const readyLabel = button.dataset.cartReadyLabel || button.getAttribute("aria-label") || label;
  const productName = button.dataset.cartProductName || "product";
  const quickCopy = button.querySelector(".shop-card-quick-add-copy");
  const readyCopy = quickCopy?.textContent || "Quick add";
  const quickIcon = button.querySelector("i");
  const quickStatus = button.querySelector("[data-cart-status]");
  const setQuickState = (state, copy, ariaLabel, iconClass, announcement = "") => {
    if (!isQuickAdd) return;
    button.dataset.cartState = state;
    button.setAttribute("aria-label", ariaLabel);
    if (quickCopy) quickCopy.textContent = copy;
    if (quickIcon) quickIcon.className = iconClass;
    if (quickStatus) quickStatus.textContent = announcement;
  };
  button.disabled = true;
  if (isQuickAdd) {
    setQuickState("adding", "Adding…", `Adding ${productName} to cart`, "ph ph-shopping-cart-simple");
  } else {
    button.textContent = "Adding…";
  }
  try {
    const cart = await import("../cart.js");
    cart.add(vsku, 1, productMarketContext());
    if (isQuickAdd) {
      setQuickState("added", "Added", `Added ${productName} to cart`, "ph ph-check", `${productName} added to cart.`);
    } else {
      button.textContent = "Added";
    }
    setTimeout(() => {
      if (isQuickAdd) setQuickState("ready", readyCopy, readyLabel, "ph ph-shopping-cart-simple");
      else button.textContent = label;
      button.disabled = false;
    }, 900);
  } catch (err) {
    if (isQuickAdd) {
      setQuickState("error", "Try again", `Could not add ${productName}; try again`, "ph ph-warning-circle", `Could not add ${productName}. Try again.`);
    } else {
      button.textContent = "Try again";
    }
    setTimeout(() => {
      if (isQuickAdd) setQuickState("ready", readyCopy, readyLabel, "ph ph-shopping-cart-simple");
      else button.textContent = label;
      button.disabled = false;
    }, 1200);
  }
}

export function refreshCommerceActions(root = document) {
  refreshCommerceMedia(root);
  root.querySelectorAll("[data-commerce-price]").forEach(slot => {
    const text = bulkPriceText(slot.dataset.commercePrice);
    slot.innerHTML = bulkPriceMarkup(slot.dataset.commercePrice);
    slot.hidden = !text;
  });
  root.querySelectorAll("[data-commerce-action]").forEach(slot => {
    const id = slot.dataset.commerceAction;
    slot.innerHTML = commerceActionHTML(
      id,
      slot.dataset.commerceSize || "chip",
      slot.dataset.quoteFallback || "on",
      slot.dataset.commerceMarket || commerceMarket(),
    );
  });
}

export function catalogDecisionHTML(id, copy, context = null) {
  const fits = Array.isArray(copy?.fits)
    ? copy.fits.filter((fit) => typeof fit === "string" && fit.trim()).slice(0, 3)
    : [];
  const proof = typeof copy?.proof === "string" ? copy.proof.trim() : "";
  if (!fits.length && !proof) return "";

  const fitRow = fits.length
    ? `<div class="shop-card-decision-row">
        <span class="shop-card-decision-label" aria-hidden="true">Fits</span>
        <ul class="shop-card-fit-list" aria-label="Best fit">
          ${fits.map((fit) => `<li class="shop-card-fit">${fit}</li>`).join("")}
        </ul>
      </div>`
    : "";
  const detailHref = context?.href || `products/${id}`;
  const displayName = context?.name || PRODUCTS[id]?.name || id;
  const proofRow = proof
    ? `<p class="shop-card-decision-row shop-card-proof">
        <span class="shop-card-decision-label" aria-hidden="true">Results</span>
        <span class="shop-card-proof-copy">
          <span class="shop-card-proof-cue">${proof}</span>
          <a class="shop-card-proof-link" href="${htmlEscape(detailHref)}" aria-label="See results for ${htmlEscape(displayName)}">See details</a>
        </span>
      </p>`
    : "";

  return `<div class="shop-card-decision">${fitRow}${proofRow}</div>`;
}

export function catalogCard(id, eager = false, context = null) {
  const p = PRODUCTS[id];
  if (!p) return "";
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const displayName = context?.name || p.name;
  const detailHref = context?.href || `products/${id}`;
  const summary = context?.summary || copy.summary || p.replaces;
  const badge = `<span class="hmis-badge note">${copy.platform || `HMIS ${p.hmis || "0-0-0"}`}</span>`;
  const mediaInfo = context?.image
    ? { src: context.image, alt: `${displayName} marine product jug` }
    : commerceMediaFor(id);
  const group = CATALOG_GROUPS.find((g) => g.ids.includes(id));
  const media = mediaInfo.src
    ? `<img src="${htmlEscape(mediaInfo.src)}" alt="${htmlEscape(mediaInfo.alt)}" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} ${imageDimsAttr(mediaInfo.src)}>`
    : `<span class="shop-card-placeholder" aria-hidden="true"><i class="ph ${p.icon}"></i><span>${group?.label || "VertKleen line"}</span></span>`;
  const type = context?.market === "marine"
    ? "VertKleen Marine Line"
    : (p.cat === "glycol" ? "VertKleen Glycols" : (copy.job || "Industrial cleaner"));
  const quoteFirst = QUOTE_FIRST_IDS.includes(id);
  const buybar = quoteFirst
    ? quoteActionHTML(id)
    : bulkPriceHTML(id);
  const quickCommerce = quoteFirst
    ? ""
    : `<span class="shop-card-quick-commerce" data-commerce-action="${id}" data-commerce-size="quick"${context?.market ? ` data-commerce-market="${htmlEscape(context.market)}"` : ""} data-customer-chat-obstruction></span>`;
  const decision = CATALOG_ORDER.includes(id) ? catalogDecisionHTML(id, copy, context) : "";
  return `
    <article class="shop-card" data-id="${id}"${context?.market ? ` data-market="${htmlEscape(context.market)}"` : ""}>
      <div class="shop-card-core">
        <span class="shop-card-media-wrap">
          <a class="shop-card-media" href="${htmlEscape(detailHref)}" aria-label="View ${htmlEscape(displayName)} details">${media}${badge}</a>
          ${quickCommerce}
        </span>
        <a class="shop-card-link" href="${htmlEscape(detailHref)}" aria-label="See how ${htmlEscape(displayName)} works">
        <span class="shop-card-body">
          <span class="shop-card-type">${type}</span>
          <b class="shop-card-name">${htmlEscape(displayName)}</b>
          <span class="shop-card-replaces">${htmlEscape(summary)}</span>
          <span class="shop-card-cta">See how it works <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
        </span>
        </a>
        <div class="shop-card-buybar">
          ${buybar}
          ${decision}
        </div>
      </div>
    </article>`;
}

export function initCartButtons() {
  document.addEventListener("masest:account-role", () => refreshCommerceActions(document));

  document.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button || button.closest("#shopGrid")) return;
    e.preventDefault();
    addToCartFromButton(button);
  });

  document.addEventListener("change", e => {
    const select = e.target.closest(".commerce-vol");
    if (!select) return;
    const wrap = select.closest("[data-commerce-buy]");
    // Price slot lives in .shop-card-buybar on catalog cards and in
    // .product-hero-buy on the static /products/<id> detail pages.
    const buybar = select.closest(".shop-card-buybar, .product-hero-buy");
    const button = wrap?.querySelector("[data-cart-add]");
    const quoteLink = wrap?.querySelector(".commerce-quote-swap");
    const selected = select.selectedOptions?.[0];
    const isQuote = selected?.dataset.quote === "1";
    const isCaseContact = selected?.dataset.caseContact === "1";
    const variant = selectedVariantFor(wrap?.dataset.commerceBuy, select.value);
    const label = variant?.label || selected?.textContent || "";
    const price = variant?.price == null ? "" : fmtMoney(variant.price, variant.currency);
    if (button) {
      button.dataset.cartAdd = select.value;
      button.hidden = !!(isQuote && quoteLink);
      const productName = button.dataset.cartProductName || "product";
      button.setAttribute("aria-label", `Add ${productName}, ${label.trim()}, to cart`);
    }
    if (quoteLink) {
      quoteLink.hidden = !isQuote;
      quoteLink.textContent = isCaseContact ? "Request case order" : "Request quote";
      quoteLink.setAttribute("aria-label", isCaseContact
        ? `Request a case order for ${label.trim()}`
        : `Request a bulk quote for ${label.trim()}`);
      if (isQuote && label) {
        const base = quoteLink.dataset.quoteBase || quoteLink.getAttribute("href");
        const message = isCaseContact
          ? `Requesting the published case pack: ${label.trim()}. Please confirm freight.`
          : `Requesting a freight quote for the ${label.trim()}.`;
        quoteLink.setAttribute("href", `${base}&message=${encodeURIComponent(message)}#quoteForm`);
      }
    }
    if (!buybar) return;
    const main = buybar.querySelector(".price-main");
    const note = buybar.querySelector(".price-note");
    const savings = buybar.querySelector(".shop-card-savings");
    const perGallon = buybar.querySelector(".shop-card-bulk");
    if (main) main.textContent = isQuote && !isCaseContact ? "Quote-priced" : price.trim();
    if (note) note.textContent = isQuote
      ? `${label.trim()} — freight ${isCaseContact ? "confirmed before order" : "quoted"}`
      : label.trim();
    if (savings) {
      savings.textContent = caseSavingsText(commerceRowFor(wrap?.dataset.commerceBuy), variant);
      savings.hidden = !savings.textContent;
    }
    if (perGallon) {
      perGallon.textContent = isQuote && !isCaseContact ? "" : bulkPerGallonText(wrap?.dataset.commerceBuy, variant);
      perGallon.hidden = isQuote && !isCaseContact;
    }
  });

  if (document.querySelector("[data-commerce-action], [data-commerce-price]")) {
    loadCommerceCatalog().then(() => refreshCommerceActions(document));
  }
}

export function initShop() {
  const grid = document.getElementById("shopGrid");
  if (!grid) return;
  const chipsBox = document.getElementById("shopChips");
  const sortSel = document.getElementById("shopSort");
  const countEl = document.getElementById("shopCount");
  const emptyEl = document.getElementById("shopEmpty");
  const emptyContact = document.getElementById("shopEmptyContact");
  const searchEl = document.getElementById("shopSearch");
  const searchClear = document.getElementById("shopSearchClear");
  const clearAll = document.getElementById("shopClearAll");
  const moreButton = document.getElementById("shopMore");
  const moreCount = moreButton?.querySelector("[data-shop-more-count]");
  grid.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    addToCartFromButton(button);
  });

  const catalogGroups = [...CATALOG_GROUPS, MARINE_CATALOG_GROUP];
  const groupOf = (id) => (CATALOG_GROUPS.find((g) => g.ids.includes(id)) || {}).key || "";
  const validGroup = (group) => group === "all" || catalogGroups.some((item) => item.key === group);
  const groupFromHash = () => {
    const group = (location.hash.match(/^#cat-(.+)$/) || [])[1] || "";
    return validGroup(group) ? group : "";
  };
  const readUrlState = () => {
    const params = new URLSearchParams(location.search);
    const group = params.get("category") || "all";
    const sort = params.get("sort") || "featured";
    const query = (params.get("q") || "").trim();
    return {
      group: groupFromHash() || (validGroup(group) ? group : "all"),
      sort: ["featured", "az"].includes(sort) ? sort : "featured",
      search: normalizeProductSearch(query),
      query,
    };
  };
  const initialHashGroup = groupFromHash();
  const initialUrlState = readUrlState();
  const state = {
    ...initialUrlState,
    expanded: false,
    marineEntries: [],
    marineById: new Map(),
    marineLoaded: false,
  };
  if (searchEl) searchEl.value = state.query;
  if (sortSel) sortSel.value = state.sort;

  const chips = [{ key: "all", label: "All products" }, ...catalogGroups.map((g) => ({ key: g.key, label: g.label }))];
  chipsBox.innerHTML = chips
    .map((c) => `<button type="button" class="shop-chip${c.key === "all" ? " active" : ""}" data-group="${c.key}" aria-pressed="${c.key === "all"}">${c.label}</button>`)
    .join("");

  const syncChips = () => {
    chipsBox.querySelectorAll(".shop-chip").forEach((b) => {
      const on = b.dataset.group === state.group;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };

  const visibleIds = () => {
    const marineView = state.group === MARINE_CATALOG_GROUP.key;
    let ids = marineView ? state.marineEntries.map(({ id }) => id) : [...CATALOG_ORDER];
    if (state.sort === "az") {
      ids.sort((a, b) => {
        const nameA = state.marineById.get(a)?.name || PRODUCTS[a].name;
        const nameB = state.marineById.get(b)?.name || PRODUCTS[b].name;
        return nameA.localeCompare(nameB);
      });
    }
    if (state.group !== "all" && !marineView) ids = ids.filter((id) => groupOf(id) === state.group);
    if (state.search) {
      const matches = rankProductIds(ids, state.search, (id) => marineSearchRow(
        commerceRowFor(id, marineView ? "marine" : commerceMarket()),
        marineView ? state.marineById.get(id) : null,
      ));
      const matchIds = new Set(matches);
      ids = state.sort === "featured" ? matches : ids.filter((id) => matchIds.has(id));
    }
    return ids;
  };

  const syncUrl = () => {
    const params = new URLSearchParams(location.search);
    if (state.group === "all") params.delete("category");
    else params.set("category", state.group);
    if (state.sort === "featured") params.delete("sort");
    else params.set("sort", state.sort);
    if (!state.search) params.delete("q");
    else params.set("q", state.query);
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  };

  const apply = (options = {}) => {
    if (options?.updateUrl !== false) syncUrl();
    const ids = visibleIds();
    const canCollapse = state.group === "all" && !state.search && ids.length > 6;
    const collapsed = canCollapse && !state.expanded;
    const marineView = state.group === MARINE_CATALOG_GROUP.key;
    const marinePending = marineView && !state.marineLoaded;
    grid.innerHTML = ids.map((id, index) => catalogCard(
      id,
      index < 2,
      marineView ? state.marineById.get(id) : null,
    )).join("");
    grid.classList.toggle("is-collapsed", collapsed);
    if (moreButton) moreButton.hidden = !collapsed;
    if (moreCount) moreCount.textContent = String(Math.max(0, ids.length - 6));
    if (searchClear) searchClear.hidden = !state.query;
    if (clearAll) clearAll.hidden = state.group === "all" && !state.query && state.sort === "featured";
    refreshCommerceActions(grid);
    if (countEl) {
      const shown = collapsed && matchMedia("(max-width: 560px)").matches ? 6 : ids.length;
      const groupLabel = catalogGroups.find((group) => group.key === state.group)?.label;
      if (marinePending) {
        countEl.textContent = "Loading Marine Line…";
      } else if (state.search) {
        const noun = ids.length === 1 ? "result" : "results";
        countEl.textContent = ids.length
          ? `${ids.length} ${noun} for “${state.query}”${groupLabel ? ` in ${groupLabel}` : ""}`
          : `No results for “${state.query}”${groupLabel ? ` in ${groupLabel}` : ""}`;
      } else if (groupLabel) {
        countEl.textContent = `${ids.length} products in ${groupLabel}`;
      } else if (shown < ids.length) {
        countEl.textContent = `Showing ${shown} of ${ids.length} products`;
      } else {
        countEl.textContent = `${ids.length} products`;
      }
    }
    if (emptyEl) {
      const nextHidden = ids.length > 0 || marinePending;
      if (emptyEl.hidden !== nextHidden) {
        emptyEl.hidden = nextHidden;
        emptyEl.dispatchEvent(new CustomEvent("masest:customer-chat-obstruction-change", { bubbles: true }));
      }
    }
    if (emptyContact) {
      const query = searchEl?.value.trim() || "";
      const message = query
        ? `I need to replace or clean: ${query}. Please recommend the closest VertKleen fit.`
        : "Please recommend a VertKleen product for my current chemical or cleaning job.";
      emptyContact.href = `/contact?type=audit&message=${encodeURIComponent(message)}#quoteForm`;
    }
  };

  const reset = () => {
    state.group = "all";
    state.search = "";
    state.query = "";
    if (searchEl) searchEl.value = "";
    state.sort = "featured";
    state.expanded = false;
    if (sortSel) sortSel.value = "featured";
    syncChips();
    apply();
  };

  const clearSearch = () => {
    state.search = "";
    state.query = "";
    state.expanded = false;
    if (searchEl) {
      searchEl.value = "";
      searchEl.focus();
    }
    apply();
  };

  chipsBox.addEventListener("click", (e) => {
    const btn = e.target.closest(".shop-chip");
    if (!btn) return;
    state.group = btn.dataset.group;
    state.expanded = false;
    syncChips();
    apply();
  });

  sortSel?.addEventListener("change", () => {
    state.sort = sortSel.value;
    state.expanded = false;
    apply();
  });

  searchEl?.addEventListener("input", () => {
    state.query = searchEl.value.trim();
    state.search = normalizeProductSearch(state.query);
    state.expanded = false;
    apply();
  });

  searchEl?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.search) clearSearch();
  });

  searchClear?.addEventListener("click", clearSearch);
  clearAll?.addEventListener("click", reset);

  moreButton?.addEventListener("click", () => {
    state.expanded = true;
    apply();
  });

  // "/" focuses product search for keyboard-first buyers; skip while typing in a field
  if (searchEl) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      searchEl.focus();
    });
  }

  emptyEl?.addEventListener("click", (e) => {
    const suggestion = e.target.closest?.("[data-shop-search-suggestion]");
    if (suggestion) {
      const query = suggestion.dataset.shopSearchSuggestion?.trim() || "";
      if (!query) return;
      state.group = "all";
      state.query = query;
      state.search = normalizeProductSearch(query);
      state.expanded = false;
      if (searchEl) searchEl.value = query;
      syncChips();
      apply();
      searchEl?.focus();
      return;
    }
    if (e.target.closest?.("[data-shop-reset]")) {
      reset();
      searchEl?.focus();
    }
  });

  const restoreFromUrl = () => {
    const next = readUrlState();
    state.group = next.group;
    state.sort = next.sort;
    state.search = next.search;
    state.query = next.query;
    state.expanded = false;
    if (searchEl) searchEl.value = state.query;
    if (sortSel) sortSel.value = state.sort;
    syncChips();
    apply({ updateUrl: false });
  };
  window.addEventListener("popstate", restoreFromUrl);

  syncChips();
  apply();
  loadCommerceCatalog().then(apply);
  loadMarineCatalog().then((entries) => {
    state.marineEntries = entries;
    state.marineById = new Map(entries.map((entry) => [entry.id, entry]));
    state.marineLoaded = true;
    apply({ updateUrl: false });
  });

  if (initialHashGroup) document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
}
