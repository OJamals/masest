/* Product cards, catalog filtering, and commerce UI behavior. */

import { CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_CATALOG_COPY, PRODUCTS, QUOTE_FIRST_IDS } from "./catalog-data.js?v=20260725f";
import { smoothPref } from "./engagement.js";

const IMAGE_DIMS = {
  "img/products/masest-poster-transparent.png": [1193, 610],
  "img/products/dbnpa-studio.webp": [900, 822],
  "img/products/crs-studio.webp": [899, 1200],
  "img/products/neutral-studio.webp": [919, 1200],
};

function imageDimsAttr(src) {
  const [width, height] = IMAGE_DIMS[src] || [900, 1200];
  return `width="${width}" height="${height}"`;
}

export function productCard(id, heroCard = false, eager = false) {
  const p = PRODUCTS[id];
  const catalog = PRODUCT_CATALOG_COPY[id] || {};
 const badge = '<span class="hmis-badge note">REVIEW SDS</span>';
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
      <p>${catalog.summary || p.tag}</p>
      <div class="prod-actions">
        <a class="btn btn-ink btn-sm" href="products/${id}">View details</a>
        <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button"></span>
      </div>
  </div>`;
}

/* ---------- Products shop: e-commerce grid ---------- */
// Whole-card link, e-commerce style. Used by the unified products grid.
const commerceState = {
  loaded: false,
  products: new Map(),
  promise: null
};

const COMMERCE_SKU_ALIASES = {
  crhd: "cr-hd",
};

function commerceRowFor(id) {
  const key = String(id || "").toLowerCase();
  if (QUOTE_FIRST_IDS.includes(key)) return null;
  return commerceState.products.get(key) || commerceState.products.get(COMMERCE_SKU_ALIASES[key]);
}

function isLocalStaticPreview() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  return localHost && !window.MASEST_ENABLE_LOCAL_API;
}

export function isLocalStaticCommerceSuppressed() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  const accountPath = /(^|\/)account\.html$/.test(location.pathname);
  return isLocalStaticPreview() || (localHost && accountPath && !window.MASEST_ENABLE_LOCAL_API);
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2
  }).format(Number(n));
}

function variantRank(v) {
  return /^VK-/i.test(String(v?.vsku || "")) ? 0 : 1;
}

function variantDedupeKey(v) {
  const gallons = Number(v?.gallons);
  return Number.isFinite(gallons) && gallons > 0
    ? `gal:${gallons}`
    : `sku:${String(v?.vsku || "").toLowerCase()}`;
}

function preferVariant(next, prev) {
  if (!prev) return next;
  const rankDelta = variantRank(next) - variantRank(prev);
  if (rankDelta < 0) return next;
  if (rankDelta > 0) return prev;
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
    .sort((a, b) => (Number(a.gallons) || 0) - (Number(b.gallons) || 0) || (Number(a.sort) || 0) - (Number(b.sort) || 0));
}

function normalizeCommerceRow(row) {
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
    price: Number(v.price),
    currency: String(v.currency || parent?.currency || row?.currency || "usd").toUpperCase(),
    sort: Number(v.sort || 0),
  });
  const variants = dedupeVariants(rawVariants
    .filter(v => v && v.active !== false && v.price != null && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(shapeVariant));
  // Bulk drums/totes (55/275 gal): priced and shown, but never sold direct —
  // the server rejects inactive variants at checkout; the UI routes them to a quote.
  const quoteVariants = dedupeVariants(rawVariants
    .filter(v => v && v.active === false && Number(v.gallons) >= 55 && v.price != null && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(shapeVariant));
  return {
    sku,
    active: parent?.active !== false && row?.active !== false,
    mode: parent?.mode || row?.mode,
    image_url: parent?.image_url || row?.image_url || "",
    photo_alt: parent?.photo_alt || row?.photo_alt || "",
    variants,
    quoteVariants,
    purchasable: !!(sku && parent?.active !== false && row?.active !== false && (parent?.mode || row?.mode) === "buy" && variants.length)
  };
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
      commerceState.products = rows
        .map(normalizeCommerceRow)
        .filter(row => row.sku)
      .reduce((map, row) => {
        const existing = map.get(row.sku);
        if (!existing) {
          map.set(row.sku, row);
          return map;
          }
          existing.active = existing.active && row.active;
      existing.mode = existing.mode || row.mode;
      existing.variants = dedupeVariants(existing.variants.concat(row.variants));
      existing.quoteVariants = dedupeVariants((existing.quoteVariants || []).concat(row.quoteVariants || []));
      if (!existing.image_url && row.image_url) existing.image_url = row.image_url;
      if (!existing.photo_alt && row.photo_alt) existing.photo_alt = row.photo_alt;
        existing.purchasable = existing.purchasable || row.purchasable;
        return map;
      }, new Map());
      for (const [alias, sku] of Object.entries(COMMERCE_SKU_ALIASES)) {
        const row = commerceState.products.get(sku);
        if (row && !commerceState.products.has(alias)) commerceState.products.set(alias, row);
      }
      commerceState.loaded = true;
      return commerceState.products;
    })
    .catch(() => {
      commerceState.loaded = true;
      commerceState.products = new Map();
      return commerceState.products;
    });
  return commerceState.promise;
}

function commerceActionHTML(id, variant = "chip", quoteFallback = "on") {
  const p = PRODUCTS[id];
  // Quote-first SKUs never expose a buy control here (catalogCard renders quoteActionHTML).
  if (QUOTE_FIRST_IDS.includes(String(id || "").toLowerCase())) return "";
  // Static-only hosting suppresses commerce; the card's "View details" link is the path.
  if (isLocalStaticCommerceSuppressed()) return "";
  // Catalog still in flight → sized skeleton so the buy area isn't blank (and to avoid CLS
  // when the real control swaps in). refreshCommerceActions re-renders once the load settles.
  if (!commerceState.loaded) {
    return `<span class="commerce-buy commerce-buy-loading" aria-hidden="true"><span class="skeleton commerce-skeleton"></span></span>`;
  }
  const row = commerceRowFor(id);
  if (row?.purchasable && row.variants.length) {
    // Root-absolute paths: these controls also hydrate on /products/<id> subpages,
    // where a relative "contact" or "account.html" would resolve under /products/.
    const accountPath = `/account.html?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
    const optLabel = (v) => String(v.label || "Pack").replace(/\s+(bottle|pail|drum|tote)$/i, "");
    const opts = row.variants
      .map((v, i) => `<option value="${v.vsku}"${i === 0 ? " selected" : ""}>${optLabel(v)}</option>`)
      .concat((row.quoteVariants || [])
        .map((v) => `<option value="${v.vsku}" data-quote="1">${optLabel(v)} — quoted</option>`))
      .join("");
    const btnClass = variant === "button" ? "btn btn-secondary btn-sm" : "shop-card-add";
    const first = row.variants[0].vsku;
    const quoteHref = `/contact?type=quote&product=${encodeURIComponent(p?.name || id)}`;
    return `<span class="commerce-buy" data-commerce-buy="${id}">`
      + `<select class="commerce-vol" aria-label="Volume for ${p?.name || id}">${opts}</select>`
      + `<button class="${btnClass}" type="button" data-cart-add="${first}" data-account-path="${accountPath}" aria-label="Add ${p?.name || id} to cart">Add to cart</button>`
      + `<a class="${btnClass} commerce-quote-swap" hidden href="${quoteHref}#quoteForm" data-quote-base="${quoteHref}" aria-label="Request a bulk quote for ${p?.name || id}">Request quote</a>`
      + `</span>`;
  }
  // Loaded, but no buyable variant — the catalog fetch failed (loadCommerceCatalog's catch
  // leaves an empty map) or this SKU isn't sellable online. Route the buyer forward to a
  // quote instead of leaving a dead, blank buy area (PRODUCT: route forward from every state).
  // Mounts that already sit next to a static quote CTA opt out via data-quote-fallback="off".
  if (quoteFallback === "off") return "";
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
    || row?.quoteVariants?.find(v => String(v.vsku) === String(vsku));
}

function bulkPerGallonText(id) {
  const row = commerceRowFor(id);
  const variant = row?.variants?.find(v => Number(v.gallons) === 55);
  if (!variant || !Number.isFinite(Number(variant.price))) return "";
  return `${fmtMoney(Number(variant.price) / 55, variant.currency)}/gal`;
}

function bulkPriceMarkup(id) {
  const text = bulkPriceText(id);
  const note = bulkPriceNote(id);
  const perGallon = bulkPerGallonText(id);
  return `<strong class="price-main">${text}</strong>`
    + `<span class="price-note">${note}</span>`
    + (perGallon ? `<span class="shop-card-bulk">${perGallon}</span>` : "");
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

function refreshCommerceMedia(root = document) {
  root.querySelectorAll(".shop-card[data-id]").forEach(card => {
    const media = commerceMediaFor(card.dataset.id);
    if (!media.src) return;
    const slot = card.querySelector(".shop-card-media");
    if (!slot) return;
    let img = slot.querySelector("img");
    if (!img) {
      slot.querySelector("i")?.remove();
      img = document.createElement("img");
      img.loading = "lazy";
      slot.insertBefore(img, slot.firstChild);
    }
    img.src = media.src;
    img.alt = media.alt;
  });
}

// Add the selected volume variant (or the button's default vsku) to the cart, with transient feedback.
async function addToCartFromButton(button) {
  const wrap = button.closest("[data-commerce-buy]");
  const select = wrap && wrap.querySelector(".commerce-vol");
  const vsku = (select && select.value) || button.dataset.cartAdd;
  if (!vsku) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const cart = await import("../cart.js");
    cart.add(vsku, 1);
    button.textContent = "Added";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 900);
  } catch (err) {
    button.textContent = "Try again";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 1200);
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
    slot.innerHTML = commerceActionHTML(id, slot.dataset.commerceSize || "chip", slot.dataset.quoteFallback || "on");
  });
}

export function catalogDecisionHTML(id, copy) {
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
  const proofRow = proof
    ? `<p class="shop-card-decision-row shop-card-proof">
        <span class="shop-card-decision-label" aria-hidden="true">Proof</span>
        <span class="shop-card-proof-copy">
          <span class="shop-card-proof-cue">${proof}</span>
          <a class="shop-card-proof-link" href="products/${id}" aria-label="Review proof for ${PRODUCTS[id]?.name || id}">Review proof</a>
        </span>
      </p>`
    : "";

  return `<div class="shop-card-decision">${fitRow}${proofRow}</div>`;
}

export function catalogCard(id, eager = false) {
  const p = PRODUCTS[id];
  if (!p) return "";
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const badge = '<span class="hmis-badge note">REVIEW SDS</span>';
  const mediaInfo = commerceMediaFor(id);
  const group = CATALOG_GROUPS.find((g) => g.ids.includes(id));
  const media = mediaInfo.src
    ? `<img src="${mediaInfo.src}" alt="${mediaInfo.alt}" loading="${eager ? "eager" : "lazy"}"${eager ? ' fetchpriority="high"' : ""} ${imageDimsAttr(mediaInfo.src)}>`
    : `<span class="shop-card-placeholder" aria-hidden="true"><i class="ph ${p.icon}"></i><span>${group?.label || "VertKleen line"}</span></span>`;
  const type = p.cat === "glycol" ? "VertKleen Glycols" : (copy.job || "Industrial chemistry");
  const quoteFirst = QUOTE_FIRST_IDS.includes(id);
  const buybar = quoteFirst
    ? quoteActionHTML(id)
    : `${bulkPriceHTML(id)}<span class="shop-card-commerce" data-commerce-action="${id}"></span>`;
  const decision = CATALOG_ORDER.includes(id) ? catalogDecisionHTML(id, copy) : "";
  return `
    <article class="shop-card" data-id="${id}">
      <div class="shop-card-core">
      <a class="shop-card-link" href="products/${id}" aria-label="View details for ${p.name}">
        <span class="shop-card-media">${media}${badge}</span>
        <span class="shop-card-body">
          <span class="shop-card-type">${type}</span>
          <b class="shop-card-name">${p.name}</b>
          <span class="shop-card-replaces">${p.replaces}</span>
          <span class="shop-card-cta">View details <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
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
    const variant = selectedVariantFor(wrap?.dataset.commerceBuy, select.value);
    const label = variant?.label || selected?.textContent || "";
    const price = variant ? fmtMoney(variant.price, variant.currency) : "";
    // Bulk drum/tote options swap the buy control for a prefilled quote link —
    // list price stays visible, but the order routes through freight review.
    if (button) {
      button.dataset.cartAdd = select.value;
      button.hidden = !!(isQuote && quoteLink);
    }
    if (quoteLink) {
      quoteLink.hidden = !isQuote;
      if (isQuote && label) {
        const base = quoteLink.dataset.quoteBase || quoteLink.getAttribute("href");
        quoteLink.setAttribute("href", `${base}&message=${encodeURIComponent(`Requesting a freight quote for the ${label.trim()}.`)}#quoteForm`);
      }
    }
    if (!buybar || !price) return;
    const main = buybar.querySelector(".price-main");
    const note = buybar.querySelector(".price-note");
    if (main) main.textContent = price.trim();
    if (note) note.textContent = isQuote ? `${label.trim()} — freight quoted` : label.trim();
  });
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
  grid.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    addToCartFromButton(button);
  });

  const groupOf = (id) => (CATALOG_GROUPS.find((g) => g.ids.includes(id)) || {}).key || "";
  const state = { group: "all", sort: "featured", search: "" };

  const chips = [{ key: "all", label: "All products" }, ...CATALOG_GROUPS.map((g) => ({ key: g.key, label: g.label }))];
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
    let ids = state.sort === "az"
      ? [...CATALOG_ORDER].sort((a, b) => PRODUCTS[a].name.localeCompare(PRODUCTS[b].name))
      : [...CATALOG_ORDER];
    if (state.group !== "all") ids = ids.filter((id) => groupOf(id) === state.group);
    if (state.search) {
      const q = state.search;
      ids = ids.filter((id) => {
        const p = PRODUCTS[id];
        return [p.name, p.desc, p.tag, p.replaces, id].filter(Boolean).join(" ").toLowerCase().includes(q);
      });
    }
    return ids;
  };

  const apply = () => {
    const ids = visibleIds();
    grid.innerHTML = ids.map((id, index) => catalogCard(id, index < 2)).join("");
    refreshCommerceActions(grid);
    if (countEl) countEl.textContent = `Showing ${ids.length} of ${CATALOG_ORDER.length}`;
    if (emptyEl) emptyEl.hidden = ids.length > 0;
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
    if (searchEl) searchEl.value = "";
    state.sort = "featured";
    if (sortSel) sortSel.value = "featured";
    syncChips();
    apply();
  };

  chipsBox.addEventListener("click", (e) => {
    const btn = e.target.closest(".shop-chip");
    if (!btn) return;
    state.group = btn.dataset.group;
    syncChips();
    apply();
  });

  sortSel?.addEventListener("change", () => {
    state.sort = sortSel.value;
    apply();
  });

  searchEl?.addEventListener("input", () => {
    state.search = searchEl.value.trim().toLowerCase();
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
    if (e.target.tagName === "BUTTON") reset();
  });

  // Deep link: products.html#cat-water preselects a category (footer + home cards).
  const catHash = (location.hash.match(/^#cat-(.+)$/) || [])[1];
  if (catHash && CATALOG_GROUPS.some((g) => g.key === catHash)) {
    state.group = catHash;
    syncChips();
  }

  apply();
  if (!isLocalStaticCommerceSuppressed()) {
    loadCommerceCatalog().then(apply);
  }

  if (catHash) document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
}
