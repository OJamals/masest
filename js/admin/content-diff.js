// Pure, DOM-free helpers for the CMS revision diff view. Compares a prior
// revision against the current saved entry so an editor can see exactly what
// restoring would change BEFORE clicking restore (the list previously showed
// only version/status/note). Kept isolated for unit testing; the admin module
// renders the returned rows.

// Render a stored field value as a short human string for the diff table.
export function formatFieldValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map((v) => String(v)).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function stableKeys(...objects) {
  const seen = new Set();
  const keys = [];
  for (const obj of objects) {
    for (const key of Object.keys(obj || {})) {
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
  }
  return keys.sort();
}

function changed(a, b) {
  return formatFieldValue(a) !== formatFieldValue(b);
}

// Diff a content revision against the current entry. Both are entry-shaped
// ({ status, payload, seo }). Returns one row per field across status + every
// payload key + every seo key (prefixed "seo:"), each flagged `changed`.
export function diffContentFields(current = {}, revision = {}) {
  const fields = [];
  fields.push({
    key: "status",
    from: current.status ?? "",
    to: revision.status ?? "",
    changed: changed(current.status, revision.status),
  });
  const cp = current.payload || {};
  const rp = revision.payload || {};
  for (const key of stableKeys(cp, rp)) {
    fields.push({ key, from: cp[key], to: rp[key], changed: changed(cp[key], rp[key]) });
  }
  const cs = current.seo || {};
  const rs = revision.seo || {};
  for (const key of stableKeys(cs, rs)) {
    fields.push({ key: `seo:${key}`, from: cs[key], to: rs[key], changed: changed(cs[key], rs[key]) });
  }
  return { fields, changedCount: fields.filter((f) => f.changed).length };
}
