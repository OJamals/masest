import { canonicalPublicImageUrl } from "./image-url.js";

const IMAGE_FIELD_KEYS = new Set(["hero", "image", "image_after", "og_image"]);
const URL_FIELD_KEYS = new Set(["href", ...IMAGE_FIELD_KEYS]);

export const CONTENT_TYPE_DEFINITIONS = Object.freeze({
  service: {
    label: "Services",
    snapshot: { file: "services.json", key: "services", order: 0 },
    delivery: { generator: "service_catalog" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text", required: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
      { key: "sort_order", label: "Display order", kind: "number" },
      { key: "lifecycle_stage", label: "WMP lifecycle stage", kind: "text" },
    ],
  },
  service_package: {
    label: "Service packages",
    snapshot: { file: "services.json", key: "service_packages", order: 0 },
    delivery: { generator: "service_catalog" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text" },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
      { key: "sort_order", label: "Display order", kind: "number" },
      { key: "lifecycle_stage", label: "WMP lifecycle stage", kind: "text" },
    ],
  },
  proof_card: {
    label: "Proof cards",
    snapshot: { file: "proof.json", key: "proof_cards", order: 2 },
    delivery: { browser: { renderer: "proof_card" } },
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text" },
      { key: "kind", label: "Sector key", kind: "text" },
      { key: "chips", label: "Chips", kind: "list" },
      { key: "source", label: "Source", kind: "text" },
      {
        key: "publication_scope",
        label: "Public record label",
        kind: "select",
        options: ["Published result summary", "Published product record"],
        required: true,
      },
      { key: "result", label: "Result", kind: "textarea", className: "full", required: true },
      {
        key: "narrative",
        label: "Case narrative",
        kind: "textarea",
        className: "full",
        required: true,
      },
      { key: "image", label: "Image path (before, when paired)", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "image_w", label: "Image width", kind: "number" },
      { key: "image_h", label: "Image height", kind: "number" },
      { key: "image_after", label: "After image path (renders a before/after pair)", kind: "text" },
      { key: "image_after_alt", label: "After image alt", kind: "text" },
      { key: "image_after_w", label: "After image width", kind: "number" },
      { key: "image_after_h", label: "After image height", kind: "number" },
      { key: "sort_order", label: "Sort order", kind: "number" },
    ],
  },
  resource_card: {
    label: "Resource cards",
    snapshot: { file: "resources.json", key: "resource_cards", order: 3 },
    delivery: { browser: { renderer: "resource_card" } },
    fields: [
      { key: "href", label: "Link", kind: "text", required: true },
      { key: "cta", label: "CTA", kind: "text" },
      { key: "icon", label: "Icon", kind: "text" },
      { key: "description", label: "Description", kind: "textarea", className: "full" },
    ],
  },
  industry_sector: {
    label: "Industry sectors",
    snapshot: { file: "industry-sectors.json", key: "industry_sectors", order: 4 },
    delivery: { browser: { renderer: "industry_sector" } },
    fields: [
      { key: "icon", label: "Icon (phosphor class)", kind: "text" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full", required: true },
      { key: "image", label: "Photo path", kind: "text" },
      { key: "image_alt", label: "Photo alt", kind: "text" },
      { key: "image_w", label: "Photo width", kind: "number" },
      { key: "image_h", label: "Photo height", kind: "number" },
      { key: "href", label: "Photo link", kind: "text" },
      { key: "image_label", label: "Photo aria-label", kind: "text" },
      { key: "sort_order", label: "Sort order", kind: "number" },
    ],
  },
  faq_block: {
    label: "FAQ blocks",
    snapshot: { file: "faqs.json", key: "faq_blocks", order: 5 },
    delivery: { browser: { renderer: "faq_block" } },
    fields: [
      { key: "category", label: "Category", kind: "text" },
      { key: "question", label: "Question", kind: "text", className: "wide", required: true },
      { key: "answer", label: "Answer", kind: "textarea", className: "full", required: true },
    ],
  },
  page_section: {
    label: "Page sections",
    snapshot: { file: "page-sections.json", key: "page_sections", order: 6 },
    delivery: { browser: { renderer: "page_section" } },
    fields: [
      { key: "page", label: "Page", kind: "text", required: true },
      { key: "region", label: "Region", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text" },
      { key: "eyebrow", label: "Eyebrow", kind: "text" },
      { key: "headline", label: "Headline", kind: "text", className: "wide", required: true },
      { key: "body", label: "Body", kind: "textarea", className: "full" },
      { key: "cta", label: "CTA label", kind: "text" },
      { key: "href", label: "CTA link", kind: "text" },
      { key: "image", label: "Image path", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "sort_order", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  page_meta: {
    label: "Page metadata",
    snapshot: { file: "page-meta.json", key: "page_meta", order: 1 },
    delivery: { generator: "page_metadata" },
    fields: [
      { key: "page", label: "Page", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea", className: "full", required: true },
      { key: "og_image", label: "OG image", kind: "text" },
      { key: "jsonld_type", label: "JSON-LD type", kind: "text" },
    ],
  },
  pricing_tier: {
    label: "Pricing tiers",
    runtime: { endpoint: "/api/pricing", key: "pricing_tiers", order: 7 },
    delivery: { browser: { renderer: "pricing_tier" } },
    fields: [
      { key: "badge", label: "Badge", kind: "text" },
      { key: "name", label: "Tier name", kind: "text", className: "wide", required: true },
      { key: "audience", label: "Audience", kind: "text", className: "wide" },
      { key: "price", label: "Price", kind: "text" },
      { key: "price_unit", label: "Price unit", kind: "text" },
      { key: "annual", label: "Annual range", kind: "text" },
      { key: "features", label: "Features", kind: "list", className: "full" },
      { key: "replaces", label: "Replaces", kind: "text", className: "wide" },
      { key: "cta", label: "CTA label", kind: "text" },
      { key: "href", label: "CTA link", kind: "text" },
      { key: "featured", label: "Featured", kind: "checkbox" },
      { key: "sort_order", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  shipping_rate: {
    label: "Shipping rates",
    fields: [
      {
        key: "stripe_rate_id",
        label: "Stripe shipping rate ID",
        kind: "text",
        required: true,
        pattern: "^shr_[A-Za-z0-9]+$",
      },
      { key: "sort_order", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  blog_post: {
    label: "Blog posts",
    snapshot: { file: "blog.json", key: "blog_posts", order: 8 },
    delivery: { generator: "blog_pages" },
    fields: [
      { key: "title", label: "Title", kind: "text", className: "wide", required: true },
      { key: "category", label: "Category", kind: "select", options: ["marketing", "technical", "news"], required: true },
      { key: "tags", label: "Tags", kind: "list", widget: "chips" },
      { key: "author", label: "Author", kind: "text" },
      { key: "date", label: "Publish date", kind: "date", required: true },
      { key: "hero", label: "Hero image path (img/blog/…)", kind: "text" },
      { key: "hero_alt", label: "Hero image alt", kind: "text" },
      { key: "excerpt", label: "Excerpt (card + meta description)", kind: "textarea", className: "full", required: true },
      { key: "body", label: "Body (Markdown)", kind: "textarea", className: "full", required: true, preview: "markdown" },
      { key: "sort_order", label: "Sort order (tiebreak)", kind: "number" },
    ],
  },
});

export function contentPayloadFields(type) {
  return [...(CONTENT_TYPE_DEFINITIONS[type]?.fields || [])].map((field) => ({ ...field }));
}

export function contentTypeOptions() {
  return Object.entries(CONTENT_TYPE_DEFINITIONS).map(([key, definition]) => [key, definition.label]);
}

export function structuredPayloadKeys() {
  return new Set(Object.values(CONTENT_TYPE_DEFINITIONS).flatMap((definition) => (
    definition.fields.map((field) => field.key)
  )));
}

export function contentDeliveryRegistry() {
  return Object.entries(CONTENT_TYPE_DEFINITIONS)
    .flatMap(([type, definition]) => {
      const source = definition.snapshot || definition.runtime;
      if (!source) return [];
      return [{
        type,
        file: source.file || null,
        endpoint: source.endpoint || null,
        key: source.key,
        order: source.order,
        snapshot: Boolean(definition.snapshot),
        browser: definition.delivery?.browser
          ? { ...definition.delivery.browser }
          : null,
        generator: definition.delivery?.generator || null,
      }];
    })
    .sort((a, b) => a.order - b.order);
}

export function browserContentDeliveries() {
  return contentDeliveryRegistry()
    .filter((delivery) => delivery.browser)
    .map(({ type, file, endpoint, key, browser }) => ({
      type,
      file,
      endpoint,
      key,
      renderer: browser.renderer,
    }));
}

export function specializedContentDeliveries() {
  return contentDeliveryRegistry()
    .filter((delivery) => delivery.snapshot && delivery.generator)
    .map(({ type, file, key, generator }) => ({
      type,
      file,
      key,
      generator,
    }));
}

export function snapshotGroups() {
  const groups = new Map();
  for (const delivery of contentDeliveryRegistry().filter(({ snapshot }) => snapshot)) {
    const group = groups.get(delivery.file)
      || { file: delivery.file, order: delivery.order, types: [] };
    group.types.push({ type: delivery.type, key: delivery.key });
    groups.set(delivery.file, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ file, types }) => ({ file, types }));
}

export function normalizeContentPageKey(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  let path = input;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    try {
      const url = new URL(input);
      if (url.protocol !== "https:" || !/^(?:www\.)?masest\.co$/i.test(url.hostname)) return "";
      path = url.pathname;
    } catch {
      return "";
    }
  } else {
    path = path.split(/[?#]/, 1)[0];
  }
  if (/^\.\.?(?:\/|$)/.test(path)) return "";
  const key = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/(?:\/index)?\.html$/i, "")
    .toLowerCase();
  if (!key || key === "index") return "home";
  return /^[a-z0-9][a-z0-9/_-]*$/.test(key) ? key : "";
}

export function contentPageOptionsFromSitemap(xml) {
  const seen = new Set();
  return [...String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .map((match) => normalizeContentPageKey(match[1]))
    .filter((page) => page && (page === "blog" || !page.startsWith("blog/")))
    .filter((page) => !seen.has(page) && seen.add(page));
}

export function contentPageMount(page) {
  const key = normalizeContentPageKey(page);
  return key ? `<div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="${key}" data-cms-region="body"></div>` : "";
}

export function ensureContentPageMount(html, page) {
  const source = String(html || "");
  const mount = contentPageMount(page);
  if (!mount || source.includes('data-cms-content="page_sections"')) return source;
  return source.replace(/<\/main>/i, `${mount}\n</main>`);
}

function parseList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanUrlValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const schemeProbe = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (/^(?:javascript|data|vbscript):/i.test(schemeProbe)) return "";
  return trimmed;
}

function normalizedFieldValue(field, raw) {
  if (raw === undefined) return undefined;
  if (field.kind === "checkbox") return raw === true || raw === "true" || raw === "on" || raw === "1";
  if (field.kind === "number") {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  if (field.kind === "list") {
    const list = parseList(raw);
    return list.length ? list : undefined;
  }
  const trimmed = URL_FIELD_KEYS.has(field.key) ? cleanUrlValue(raw) : String(raw || "").trim();
  if (field.key === "page") return normalizeContentPageKey(trimmed) || undefined;
  if (trimmed && IMAGE_FIELD_KEYS.has(field.key)) return canonicalPublicImageUrl(trimmed);
  return trimmed || undefined;
}

export function normalizeStructuredPayload(type, values = {}) {
  const payload = {};
  for (const field of contentPayloadFields(type)) {
    const value = normalizedFieldValue(field, values[field.key]);
    if (value !== undefined) payload[field.key] = value;
  }
  return payload;
}

export function validateStructuredPayload(type, values = {}) {
  if (!CONTENT_TYPE_DEFINITIONS[type]) return { ok: false, error: `Unsupported content type: ${type}` };
  for (const field of contentPayloadFields(type)) {
    const raw = values[field.key];
    const val = String(raw ?? "").trim();
    if (raw !== undefined && URL_FIELD_KEYS.has(field.key) && val && !cleanUrlValue(raw)) {
      return { ok: false, error: `${field.key}_invalid_url` };
    }
    if (val && Array.isArray(field.options) && !field.options.includes(val)) {
      return { ok: false, error: `${field.key}_invalid_option` };
    }
    if (val && field.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(val) || Number.isNaN(Date.parse(`${val}T00:00:00Z`)))) {
      return { ok: false, error: `${field.key}_invalid_date` };
    }
    if (val && field.pattern && !(new RegExp(field.pattern)).test(val)) {
      return { ok: false, error: `${field.key}_invalid_format` };
    }
  }
  const payload = normalizeStructuredPayload(type, values);
  for (const field of contentPayloadFields(type)) {
    if (field.required && (payload[field.key] === undefined || payload[field.key] === "")) {
      return { ok: false, error: `${field.key}_required` };
    }
  }
  return { ok: true, payload };
}
