/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */
import { CATALOG_GROUPS, CATALOG_ORDER, PRODUCT_CATALOG_COPY, PRODUCT_GALLERY, PRODUCTS, REPLACEMENT_MAP } from "./main/catalog-data.js";
import { renderChrome } from "./main/chrome.js";
import { initResponsiveTables, initReveal } from "./main/effects.js";
import { initServiceCatalog } from "./main/service-catalog.js";

window.MASESTMain = {
  CATALOG_GROUPS,
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCT_GALLERY,
  PRODUCTS,
  REPLACEMENT_MAP,
  catalogCard,
  initReveal,
  productCard,
};

function productCard(id, heroCard = false) {
  const p = PRODUCTS[id];
  const catalog = PRODUCT_CATALOG_COPY[id] || {};
 const badge = p.hmis === "0-0-0"
 ? '<span class="hmis-badge">HMIS 0-0-0</span>'
 : '<span class="hmis-badge note">LOW HAZARD</span>';
  const media = p.image
    ? `<a class="prod-media" href="product.html?id=${id}" aria-label="View ${p.name} details"><img src="${p.image}" alt="${p.name} product photo" loading="lazy"></a>`
    : "";
  const fitList = (catalog.fits || []).map((fit) => `<li>${fit}</li>`).join("");
  return `
  <div class="prod-card${heroCard ? " hero-card" : ""} reveal">
    ${media}
    <div class="prod-top"><i class="ph ${p.icon}" aria-hidden="true"></i>${badge}</div>
    <span class="catalog-type">${catalog.job || p.replaces}</span>
    <h3>${p.name}</h3>
      <p>${catalog.summary || p.tag}</p>
      ${fitList ? `<ul class="product-fit-list">${fitList}</ul>` : ""}
      <span class="product-proof-line">${catalog.proof || "Stats, studies, and documents on the detail page"}</span>
      <div class="prod-actions">
        <a class="btn btn-ink btn-sm" href="product.html?id=${id}">View Details</a>
        <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button"></span>
      </div>
  </div>`;
}

/* ---------- Products shop: e-commerce grid + replacement checker ---------- */
// Whole-card link, e-commerce style. Used by the unified products grid.
const commerceState = {
  loaded: false,
  products: new Map(),
  promise: null
};

function isLocalStaticHomepage() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  const homePath = /(^|\/)(index\.html)?$/.test(location.pathname);
  return localHost && homePath && !window.MASEST_ENABLE_LOCAL_API;
}

function isLocalStaticCommerceSuppressed() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  const accountPath = /(^|\/)account\.html$/.test(location.pathname);
  return isLocalStaticHomepage() || (localHost && accountPath && !window.MASEST_ENABLE_LOCAL_API);
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2
  }).format(Number(n));
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
  const variants = rawVariants
    .filter(v => v && v.active !== false && v.price != null && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(v => ({
      vsku: v.vsku,
      label: v.label,
      gallons: Number(v.gallons) || 0,
      price: Number(v.price),
      currency: String(v.currency || parent?.currency || row?.currency || "usd").toUpperCase()
    }));
  return {
    sku,
    active: parent?.active !== false && row?.active !== false,
    mode: parent?.mode || row?.mode,
    image_url: parent?.image_url || row?.image_url || "",
    photo_alt: parent?.photo_alt || row?.photo_alt || "",
    variants,
    purchasable: !!(sku && parent?.active !== false && row?.active !== false && (parent?.mode || row?.mode) === "buy" && variants.length)
  };
}

async function loadCommerceCatalog() {
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
      existing.variants = existing.variants.concat(row.variants)
        .sort((a, b) => (a.gallons || 0) - (b.gallons || 0));
      if (!existing.image_url && row.image_url) existing.image_url = row.image_url;
      if (!existing.photo_alt && row.photo_alt) existing.photo_alt = row.photo_alt;
      existing.purchasable = existing.purchasable || row.purchasable;
          return map;
        }, new Map());
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

function commerceActionHTML(id, variant = "chip") {
  const row = commerceState.products.get(String(id).toLowerCase());
  const p = PRODUCTS[id];
  if (!row?.purchasable || !row.variants.length) return "";
  const opts = row.variants
    .map((v, i) => `<option value="${v.vsku}"${i === 0 ? " selected" : ""}>${v.label} · ${fmtMoney(v.price, v.currency)}</option>`)
    .join("");
  const btnClass = variant === "button" ? "btn btn-secondary btn-sm" : "shop-card-add";
  const first = row.variants[0].vsku;
  return `<span class="commerce-buy" data-commerce-buy="${id}">`
    + `<select class="commerce-vol" aria-label="Volume for ${p?.name || id}">${opts}</select>`
    + `<button class="${btnClass}" type="button" data-cart-add="${first}" aria-label="Add ${p?.name || id} to cart">Add to cart</button>`
    + `</span>`;
}

function bulkPriceHTML(id) {
  const row = commerceState.products.get(String(id).toLowerCase());
  const variant = row?.variants?.find(v => Number(v.gallons) === 55);
  if (!variant || !Number.isFinite(Number(variant.price))) return "";
  const perGallon = Number(variant.price) / 55;
  return `<span class="shop-card-bulk">${fmtMoney(perGallon, variant.currency)}/gal</span>`;
}

function commerceMediaFor(id) {
  const row = commerceState.products.get(String(id).toLowerCase());
  const p = PRODUCTS[id];
  return {
    src: row?.image_url || p?.image || "",
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
  button.textContent = "Adding...";
  try {
    const cart = await import("./cart.js");
    cart.add(vsku, 1);
    button.textContent = "Added";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 900);
  } catch (err) {
    button.textContent = "Try again";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 1200);
  }
}

function refreshCommerceActions(root = document) {
  refreshCommerceMedia(root);
  root.querySelectorAll("[data-commerce-action]").forEach(slot => {
    const id = slot.dataset.commerceAction;
    slot.innerHTML = commerceActionHTML(id, slot.dataset.commerceSize || "chip");
  });
}

function catalogCard(id) {
  const p = PRODUCTS[id];
  if (!p) return "";
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const badge = p.hmis === "0-0-0"
    ? '<span class="hmis-badge">HMIS 0-0-0</span>'
    : '<span class="hmis-badge note">LOW HAZARD</span>';
  const mediaInfo = commerceMediaFor(id);
  const media = mediaInfo.src
    ? `<img src="${mediaInfo.src}" alt="${mediaInfo.alt}" loading="lazy">`
    : `<i class="ph ${p.icon}" aria-hidden="true"></i>`;
  return `
    <article class="shop-card" data-id="${id}">
      <a class="shop-card-link" href="product.html?id=${id}" aria-label="View details for ${p.name}">
        <span class="shop-card-media">${media}${badge}</span>
        <span class="shop-card-body">
          <span class="shop-card-type">${copy.job || "Industrial chemistry"}</span>
          <b class="shop-card-name">${p.name}</b>
          <span class="shop-card-replaces">${p.replaces}</span>
          <span class="shop-card-cta">View details <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
        </span>
      </a>
        ${bulkPriceHTML(id)}
        <span class="shop-card-commerce" data-commerce-action="${id}"></span>
    </article>`;
}

function initCartButtons() {
  document.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button || button.closest("#shopGrid")) return;
    e.preventDefault();
    addToCartFromButton(button);
  });
}

function swapRow(row, i) {
  const names = row.ids.map((id) => PRODUCTS[id]?.name).filter(Boolean).join(", ");
  return `
    <button type="button" class="swap-row" data-row="${i}" aria-label="Show VertKleen swap for ${row.legacy}">
      <span class="swap-legacy"><em>Replace</em>${row.legacy}</span>
      <span class="swap-job"><em>For</em>${row.job}</span>
      <span class="swap-arrow" aria-hidden="true"><i class="ph ph-arrow-right"></i></span>
      <span class="swap-vk"><em>Use</em>${names}</span>
    </button>`;
}

function initShop() {
  const grid = document.getElementById("shopGrid");
  if (!grid) return;
  const matrix = document.getElementById("swapMatrix");
  const result = document.getElementById("swapResult");
  const chipsBox = document.getElementById("shopChips");
  const sortSel = document.getElementById("shopSort");
  const countEl = document.getElementById("shopCount");
  const emptyEl = document.getElementById("shopEmpty");
  const searchEl = document.getElementById("shopSearch");

  grid.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    addToCartFromButton(button);
  });

  const groupOf = (id) => (CATALOG_GROUPS.find((g) => g.ids.includes(id)) || {}).key || "";
  const state = { group: "all", match: null, sort: "featured", search: "" };

  const chips = [{ key: "all", label: "All products" }, ...CATALOG_GROUPS.map((g) => ({ key: g.key, label: g.label }))];
  chipsBox.innerHTML = chips
    .map((c) => `<button type="button" class="shop-chip${c.key === "all" ? " active" : ""}" data-group="${c.key}" aria-pressed="${c.key === "all"}">${c.label}</button>`)
    .join("");

  if (matrix) {
    matrix.innerHTML =
      `<div class="swap-head" aria-hidden="true"><span>Replace this</span><span>For this job</span><span></span><span>Use this VertKleen</span></div>` +
      REPLACEMENT_MAP.map(swapRow).join("");
  }

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
    if (state.match) ids = ids.filter((id) => state.match.includes(id));
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
    grid.innerHTML = ids.map(catalogCard).join("");
    refreshCommerceActions(grid);
    if (countEl) countEl.textContent = `Showing ${ids.length} of ${CATALOG_ORDER.length}`;
    if (emptyEl) emptyEl.hidden = ids.length > 0;
  };

  const reset = () => {
    state.group = "all";
    state.match = null;
    state.search = "";
    if (searchEl) searchEl.value = "";
    state.sort = "featured";
    if (sortSel) sortSel.value = "featured";
    if (result) result.hidden = true;
    matrix?.querySelectorAll(".swap-row.active").forEach((r) => r.classList.remove("active"));
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

  if (matrix && result) {
    matrix.addEventListener("click", (e) => {
      const row = e.target.closest(".swap-row");
      if (!row) return;
      const data = REPLACEMENT_MAP[+row.dataset.row];
      state.match = data.ids;
      state.group = "all";
      matrix.querySelectorAll(".swap-row").forEach((r) => r.classList.toggle("active", r === row));
      syncChips();
      const links = data.ids.map((id) => `<a href="product.html?id=${id}">${PRODUCTS[id].name}</a>`).join(" · ");
      result.innerHTML =
        `<span class="swap-result-q"><em>Replace</em>${data.legacy}</span>` +
        `<i class="ph ph-arrow-right" aria-hidden="true"></i>` +
        `<span class="swap-result-a"><em>Switch to</em>${links}</span>` +
        `<button type="button" class="swap-clear" id="swapClear">Clear</button>`;
      result.hidden = false;
      apply();
      document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
    });
  }

  result?.addEventListener("click", (e) => {
    if (e.target.closest("#swapClear")) reset();
  });

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
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(apply);

  if (catHash) document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
}

function initBeforeAfter() {
  document.querySelectorAll("[data-ba]").forEach(ba => {
    const range = ba.querySelector(".ba-range");
    const handle = ba.querySelector(".ba-handle");
    if (!range) return;
    const apply = () => {
      const v = range.value;
      ba.style.setProperty("--pos", v + "%");
      if (handle) handle.style.left = v + "%";
      range.setAttribute("aria-valuenow", v);
    };
    range.addEventListener("input", apply);
    apply();
  });
}

/* ---------- Quote form ----------
   No backend yet: submission opens a prefilled email to the sales
   team (mailto handoff) and says so honestly. The form stays
   recoverable: an Edit button returns the user to their answers. */
const SALES_EMAIL = "matthew@masest.co";

function smoothPref() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

async function submitRequest(form, data) {
  const endpoint = form.dataset.endpoint;
  if (!endpoint) return { fallbackOnly: true };
  // Abort a hung endpoint so the user is never stranded on a disabled button.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: data,
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("Request failed");
    return { fallbackOnly: false };
  } finally {
    clearTimeout(timer);
  }
}

function initProofFilters() {
  const filters = [...document.querySelectorAll("[data-proof-filter]")];
  const cards = [...document.querySelectorAll("[data-proof-card]")];
  if (!filters.length || !cards.length) return;

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const kind = filter.dataset.proofFilter;
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      cards.forEach((card) => {
        const visible = kind === "all" || card.dataset.proofKind === kind;
        card.hidden = !visible;
      });
    });
  });
}

function initQuoteForm() {
  const form = document.getElementById("quoteForm");
  if (!form) return;
  const params = new URLSearchParams(location.search);

  // Prefill from URL params (?product=, ?doc=)
  const pre = params.get("product");
  if (pre) {
    const sel = form.querySelector('[name="product"]');
    if (sel) [...sel.options].forEach(o => { if (o.value === pre || o.text === pre) sel.value = o.value || o.text; });
  }
  const doc = params.get("doc");
  if (doc) {
    const msg = form.querySelector('[name="message"]');
    const type = form.querySelector('[name="type"]');
    if (msg && !msg.value) msg.value = "Please send the " + doc + (pre ? " for " + pre : "") + ".";
    if (type) type.value = "technical";
  }
  const messageParam = params.get("message");
  if (messageParam) {
    const msg = form.querySelector('[name="message"]');
    if (msg && !msg.value) msg.value = messageParam;
  }
  const emailParam = params.get("email");
  if (emailParam) {
    const email = form.querySelector('#fEmail[name="email"]');
    if (email && !email.value) email.value = emailParam;
  }
  const indParam = params.get("industry");
  if (indParam) {
    const isel = form.querySelector('[name="industry"]');
    if (isel) [...isel.options].forEach(o => { if (o.value === indParam || o.text === indParam) isel.value = o.value || o.text; });
  }

  // ── Adaptive request type: the chooser swaps which field set is required/shown ──
  const typeInput = form.querySelector('[name="type"]');
  const groups = [...form.querySelectorAll("[data-intent-group]")];
  const choices = [...form.querySelectorAll(".cta-choice")];
  const INTENTS = ["quote", "audit", "sample", "distributor"];
  function applyIntent(intent) {
    if (!INTENTS.includes(intent)) intent = "quote";
    if (typeInput) typeInput.value = intent;
    choices.forEach(b => {
      const on = b.dataset.intent === intent;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    groups.forEach(g => {
      const on = g.dataset.intentGroup === intent;
      g.hidden = !on;
      g.querySelectorAll("[data-req]").forEach(el => { el.required = on; if (!on) setErr(el, ""); });
    });
  }
  choices.forEach(b => b.addEventListener("click", () => applyIntent(b.dataset.intent)));
  // Initial intent: a chooser type (?type or a prior set value) wins; otherwise default to quote
  // while preserving non-chooser types (technical/government) on the hidden input.
  const reqType = params.get("type") || (typeInput ? typeInput.value : "");
  if (INTENTS.includes(reqType)) applyIntent(reqType);
  else { applyIntent("quote"); if (typeInput && reqType) typeInput.value = reqType; }

  // Inline validation: per-field messages instead of browser bubbles only
  form.setAttribute("novalidate", "");
  function setErr(el, text) {
    const field = el.closest(".field");
    if (!field) return;
    let err = field.querySelector(".field-err");
    if (!text) { if (err) err.remove(); el.removeAttribute("aria-invalid"); return; }
    if (!err) {
      err = document.createElement("span");
      err.className = "field-err";
      err.id = el.id + "Err";
      field.append(err);
    }
    err.textContent = text;
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", err.id);
  }
  function validate() {
    let firstBad = null;
    form.querySelectorAll("input, select, textarea").forEach(el => {
      if (el.closest("[data-intent-group][hidden]")) { setErr(el, ""); return; }
      let text = "";
      if (el.required && !el.value.trim()) text = "This field is required.";
      else if (el.type === "email" && el.value && !el.checkValidity()) text = "Enter a valid email address.";
      setErr(el, text);
      if (text && !firstBad) firstBad = el;
    });
    const sampleGroup = form.querySelector('[data-intent-group="sample"]');
    if (sampleGroup && !sampleGroup.hidden) {
      const picks = sampleGroup.querySelectorAll('input[name="samples"]:checked').length;
      const hint = document.getElementById("sampleHint");
      const okPicks = picks >= 3 && picks <= 5;
      if (hint) {
        hint.textContent = okPicks ? "3 to 5 products selected." : "Select 3 to 5 products (you have " + picks + ").";
        hint.classList.toggle("err", !okPicks);
      }
      if (!okPicks && !firstBad) firstBad = sampleGroup.querySelector('input[name="samples"]');
    }
    return firstBad;
  }
  form.addEventListener("input", e => setErr(e.target, ""));

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) { bad.focus(); bad.scrollIntoView({ behavior: smoothPref(), block: "center" }); return; }

    const data = new FormData(form);
    const labels = {
      name: "Name", company: "Company", email: "Email", phone: "Phone", type: "Request type",
      product: "Product", industry: "Industry", volume: "Volume", location: "Location",
      timeline: "Timeline", system: "System / asset", audit_timeframe: "Preferred timeframe",
      samples: "Sample products", ship_to: "Ship-to address", company_type: "Company type",
      territory: "Territory / region", message: "Notes"
    };
    const lines = [];
    for (const [k, v] of data.entries()) if (String(v).trim()) lines.push((labels[k] || k) + ": " + v);
    const reqLabel = (data.get("type") || "quote").replace(/^./, c => c.toUpperCase());
    const subject = reqLabel + " request: " + (data.get("product") || data.get("industry") || "VertKleen") + " (" + (data.get("company") || data.get("name")) + ")";
    const mailto = "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
    const fallback = document.getElementById("mailtoFallback");
    if (fallback) fallback.href = mailto;

    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit ? submit.textContent : "";
    if (submit) { submit.disabled = true; submit.textContent = "Sending…"; }

    // One outcome panel for every ending. accepted=true → the endpoint took it;
    // accepted=false → no endpoint or the request failed/timed out, so the
    // prepared email is the real path. No alert, no form-plus-panel double view.
    const showOutcome = (accepted) => {
      form.style.display = "none";
      const ok = document.getElementById("formSuccess");
      const title = document.getElementById("formSuccessTitle");
      const copy = document.getElementById("formSuccessCopy");
      const mail = document.getElementById("mailtoFallback");
      if (title) title.textContent = accepted ? "Request received." : "Almost there: send the request.";
      if (copy) {
        copy.innerHTML = accepted
          ? "MASEST has received your request. A sales or technical contact will review the details and follow up directly."
          : 'We couldn’t submit automatically. Use the prepared email link below, then hit send in your email app. If your device blocks email links, email <a href="mailto:matthew@masest.co" style="font-weight:700;color:var(--accent-ink)">matthew@masest.co</a> or call <a href="tel:+18134063852" style="font-weight:700;color:var(--accent-ink)">(813) 406-3852</a>.';
      }
      if (mail) mail.hidden = accepted;
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
      if (title) title.focus();
      const edit = document.getElementById("formEdit");
      if (edit) edit.onclick = () => {
        ok.style.display = "none";
        form.style.display = "";
        if (submit) { submit.disabled = false; submit.textContent = submitLabel; }
        form.querySelector("input, select, textarea").focus();
      };
    };

    submitRequest(form, data)
      .then((result) => showOutcome(!result.fallbackOnly))
      .catch(() => showOutcome(false));
  });
}

function initIndustryProducts() {
  document.querySelectorAll("[data-ind-products]").forEach((box) => {
    const ids = (box.dataset.indProducts || "").split(/\s+/).filter((id) => PRODUCTS[id]);
    if (!ids.length) return;
    box.innerHTML = ids.map((id) => productCard(id)).join("");
    // Industry pages live one level deep; rewrite relative product assets and
    // links to resolve from /industries/.
    box.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (h && !/^(https?:|mailto:|tel:|#|\.\.\/|\/)/.test(h)) a.setAttribute("href", "../" + h);
    });
    box.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !/^(https?:|data:|#|\.\.\/|\/)/.test(src)) img.setAttribute("src", "../" + src);
    });
  });
}

// Click any content photo to view it full-size. Document previews (.doc-link) open their
// PDF instead, and before/after sliders ([data-ba]) keep their drag behavior — both excluded.
function initLightbox() {
  const ZOOM_SCOPE = ".proof-card, .case-card, .ind-gallery, figure.photo";
  const dlg = document.createElement("dialog");
  dlg.id = "lightbox";
  dlg.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close">×</button>' +
    '<figure class="lb-fig"><img class="lb-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt=""><figcaption class="lb-cap"></figcaption></figure>';
  document.body.appendChild(dlg);
  const lbImg = dlg.querySelector(".lb-img");
  const lbCap = dlg.querySelector(".lb-cap");
  const close = () => { if (dlg.open) dlg.close(); };

  document.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img || !img.closest(ZOOM_SCOPE)) return;
    if (img.closest(".doc-link, [data-ba]")) return; // docs open PDF; sliders drag
    e.preventDefault();
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || "";
    lbCap.textContent = img.alt || "";
    if (typeof dlg.showModal === "function") dlg.showModal();
  });

  dlg.querySelector(".lb-close").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // backdrop
  dlg.addEventListener("close", () => { lbImg.removeAttribute("src"); });
}

function initImageFallbacks() {
  const frameSelector = ".catalog-shelf-media, .product-media-card, .proof-card figure, .case-card figure, .ind-gallery figure, figure.photo, .proof-thumb, .row-thumb";
  const labelFor = (img) => {
    const figcaption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
    return figcaption || img.getAttribute("alt") || "Visual reference pending";
  };
  const showFallback = (img) => {
    const frame = img.closest(frameSelector);
    if (!frame || frame.classList.contains("media-fallback")) return;
    frame.classList.add("media-fallback");
    img.hidden = true;
    const label = document.createElement("span");
    label.className = "media-fallback-label";
    label.textContent = labelFor(img);
    frame.appendChild(label);
  };
  document.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => showFallback(img), { once: true });
    if (img.complete && img.naturalWidth === 0) showFallback(img);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initIndustryProducts();
  initImageFallbacks();
  initBeforeAfter();
  initProofFilters();
  initResponsiveTables();
  initReveal();
  initLightbox();
  initCartButtons();
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(() => refreshCommerceActions(document));
  initShop();
  initServiceCatalog();
});
