// Inline-edit dirty tracking for the admin lists (#28).
//
// Problem: any sibling save (or a cache re-render on tab switch) rebuilds the whole
// list's innerHTML, discarding every other in-progress inline edit. These helpers let
// a renderer snapshot the user's unsaved edits before the rebuild and restore them after.
//
// Identity is the hard part: products' `data-field` and pricing's `data-price-tier` repeat
// once per row, so they're scoped by their row ancestor; every other editable control
// already carries the row id in its attr value and is unique on its own.

const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(s)) : String(s));

// Stable key for one editable control, or null if it isn't an identifiable edit target.
export function editKey(el) {
  if (el.dataset?.field) {
    const row = el.closest?.('[data-product]');
    return row ? `f:${row.dataset.product}:${el.dataset.field}` : null;
  }
  if (el.dataset?.priceTier) {
    const row = el.closest?.('[data-vsku]');
    return row ? `p:${row.dataset.vsku}:${el.dataset.priceTier}` : null;
  }
  if (el.dataset?.vfield) {
    const row = el.closest?.('[data-variant]');
    return row ? `v:${row.dataset.variant}:${el.dataset.vfield}` : null;
  }
  for (const a of el.attributes || []) {
    if (a.name.startsWith('data-') && a.name !== 'data-dirty' && a.value) return `a:${a.name}:${a.value}`;
  }
  return null;
}

// Inverse of editKey: a selector that finds the control again in the rebuilt DOM.
export function editSelector(key) {
  if (key.startsWith('f:')) {
    const [, sku, field] = key.split(':');
    return `[data-product="${cssEsc(sku)}"] [data-field="${cssEsc(field)}"]`;
  }
  if (key.startsWith('p:')) {
    const [, vsku, tier] = key.split(':');
    return `[data-vsku="${cssEsc(vsku)}"] [data-price-tier="${cssEsc(tier)}"]`;
  }
  if (key.startsWith('v:')) {
    const [, vsku, field] = key.split(':');
    return `[data-variant="${cssEsc(vsku)}"] [data-vfield="${cssEsc(field)}"]`;
  }
  const idx = key.indexOf(':', 2); // a:<attr>:<value>
  return `[${key.slice(2, idx)}="${cssEsc(key.slice(idx + 1))}"]`;
}

// Snapshot { key: value } for every control the user has touched (data-dirty="1").
export function captureDirty(box) {
  const snap = {};
  box?.querySelectorAll?.('[data-dirty="1"]').forEach((el) => {
    const k = editKey(el);
    if (k != null) snap[k] = el.value;
  });
  return snap;
}

// Re-apply a snapshot to the freshly rebuilt list, re-marking restored controls dirty.
// A control whose value already matches (e.g. the just-saved row) is left untouched.
export function restoreDirty(box, snap) {
  for (const k in (snap || {})) {
    const el = box?.querySelector?.(editSelector(k));
    if (el && el.value !== snap[k]) {
      el.value = snap[k];
      el.dataset.dirty = '1';
    }
  }
}
