const URL_FIELD_KEYS = new Set(["href", "image", "og_image"]);

export const CONTENT_TYPE_DEFINITIONS = Object.freeze({
  service: {
    label: "Services",
    snapshot: { file: "services.json", key: "services" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text", required: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
    ],
  },
  service_package: {
    label: "Service packages",
    snapshot: { file: "services.json", key: "service_packages" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text" },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
    ],
  },
  proof_card: {
    label: "Proof cards",
    snapshot: { file: "proof.json", key: "proof_cards" },
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text" },
      { key: "kind", label: "Sector key", kind: "text" },
      { key: "chips", label: "Chips", kind: "list" },
      { key: "source", label: "Source", kind: "text" },
      { key: "image", label: "Image path", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "image_w", label: "Image width", kind: "number" },
      { key: "image_h", label: "Image height", kind: "number" },
      { key: "href", label: "Doc / PDF link", kind: "text" },
      { key: "result", label: "Result", kind: "textarea", className: "full" },
      { key: "sort_order", label: "Sort order", kind: "number" },
    ],
  },
  resource_card: {
    label: "Resource cards",
    snapshot: { file: "resources.json", key: "resource_cards" },
    fields: [
      { key: "href", label: "Link", kind: "text", required: true },
      { key: "cta", label: "CTA", kind: "text" },
      { key: "icon", label: "Icon", kind: "text" },
      { key: "description", label: "Description", kind: "textarea", className: "full" },
    ],
  },
  industry_card: {
    label: "Industry cards",
    snapshot: { file: "industries.json", key: "industry_cards" },
    fields: [
      { key: "href", label: "Link", kind: "text", required: true },
      { key: "image", label: "Image path", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
    ],
  },
  industry_sector: {
    label: "Industry sectors",
    snapshot: { file: "industry-sectors.json", key: "industry_sectors" },
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
    snapshot: { file: "faqs.json", key: "faq_blocks" },
    fields: [
      { key: "category", label: "Category", kind: "text" },
      { key: "question", label: "Question", kind: "text", className: "wide", required: true },
      { key: "answer", label: "Answer", kind: "textarea", className: "full", required: true },
    ],
  },
  page_section: {
    label: "Page sections",
    snapshot: { file: "page-sections.json", key: "page_sections" },
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
    snapshot: { file: "page-meta.json", key: "page_meta" },
    fields: [
      { key: "page", label: "Page", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea", className: "full", required: true },
      { key: "og_image", label: "OG image", kind: "text" },
      { key: "jsonld_type", label: "JSON-LD type", kind: "text" },
    ],
  },
  pricing_tier: {
    label: "Pricing tiers",
    snapshot: { file: "pricing.json", key: "pricing_tiers" },
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
});

const SNAPSHOT_GROUPS = Object.freeze([
  {
    file: "services.json",
    types: Object.freeze([
      Object.freeze({ type: "service", key: "services" }),
      Object.freeze({ type: "service_package", key: "service_packages" }),
    ]),
  },
  {
    file: "page-meta.json",
    types: Object.freeze([Object.freeze({ type: "page_meta", key: "page_meta" })]),
  },
  {
    file: "proof.json",
    types: Object.freeze([Object.freeze({ type: "proof_card", key: "proof_cards" })]),
  },
  {
    file: "resources.json",
    types: Object.freeze([Object.freeze({ type: "resource_card", key: "resource_cards" })]),
  },
  {
    file: "industries.json",
    types: Object.freeze([Object.freeze({ type: "industry_card", key: "industry_cards" })]),
  },
  {
    file: "industry-sectors.json",
    types: Object.freeze([Object.freeze({ type: "industry_sector", key: "industry_sectors" })]),
  },
  {
    file: "faqs.json",
    types: Object.freeze([Object.freeze({ type: "faq_block", key: "faq_blocks" })]),
  },
  {
    file: "page-sections.json",
    types: Object.freeze([Object.freeze({ type: "page_section", key: "page_sections" })]),
  },
  {
    file: "pricing.json",
    types: Object.freeze([Object.freeze({ type: "pricing_tier", key: "pricing_tiers" })]),
  },
]);

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

export function snapshotGroups() {
  return SNAPSHOT_GROUPS.map((group) => ({
    file: group.file,
    types: group.types.map((entry) => ({ ...entry })),
  }));
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
    if (raw !== undefined && URL_FIELD_KEYS.has(field.key) && String(raw || "").trim() && !cleanUrlValue(raw)) {
      return { ok: false, error: `${field.key}_invalid_url` };
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
