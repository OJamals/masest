/* Phase 4 (SQ-18, SQ-19): the admin lists shouted every possible action at once.
   Products rendered a filled primary Save on all fifteen rows simultaneously, and
   an order card showed its state twice — once as Lifecycle, once as Status — in
   two different pill treatments. Both are pinned here so they cannot drift back. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const products = read("js/admin/products.js");
const orders = read("js/admin/orders.js");

test("SQ-18: product and variant Save render disabled until their row is edited", () => {
  for (const attr of ["data-save-product", "data-save-variant"]) {
    const button = products.match(new RegExp(`<button[^>]*${attr}=[^>]*>Save</button>`))?.[0];
    assert.ok(button, `expected a Save button carrying ${attr}`);
    assert.match(button, /\bdisabled\b/, `${attr} Save must render disabled`);
  }
});

test("SQ-18: an edit to any row control re-enables only that row's Save", () => {
  // input AND change: the Active toggle is a checkbox, which fires only change.
  assert.match(products, /delegate\(box, 'input', '\[data-field\], \[data-vfield\]'/);
  assert.match(products, /delegate\(box, 'change', '\[data-field\], \[data-vfield\]'/);
  // scope resolution puts a variant ahead of its parent product, so a variant
  // edit does not arm the whole product's Save
  assert.match(products, /closest\?\.\('\[data-variant\]'\)\s*\|\|\s*\w+\.closest\?\.\('\[data-product\]'\)/);
  assert.match(products, /function syncSaveButton/);
  // a rebuild re-renders every Save disabled; restored edits must re-arm theirs
  assert.match(products, /restoreDirty\(box, snap\);\s*\n\s*syncEditedFromDirty\(box\);/);
});

test("SQ-18: Save edit-state is tracked apart from the dirty-restore flag", () => {
  /* markDirty() in admin.js skips checkboxes and captureDirty() reads `.value`,
     so `data-dirty` cannot represent "this row changed" for the Active toggle. */
  assert.match(products, /dataset\.edited = '1'/);
  const admin = read("js/admin.js");
  assert.match(admin, /input:not\(\[type=checkbox\]\)/, "admin.js still excludes checkboxes from data-dirty");
});

test("SQ-19: the second status pill is suppressed only when it restates the lifecycle", () => {
  assert.match(orders, /function restatesLifecycle/);
  assert.match(orders, /\$\{restatesLifecycle\(order\) \? '' : `<div><span>Status<\/span>/);
  // compares rendered labels, so payment_pending vs pending_payment collapses too
  assert.match(orders, /statusWords\(lifecycleFor\(order\)\.label\)/);
  assert.match(orders, /statusWords\(order\.status\)/);
});

test("SQ-19: lifecycle and status stay separate where they carry different facts", () => {
  /* lifecycleFor() derives its stage from status AND tracking_status, so a
     "processing" order is legitimately "Unfulfilled" and both belong on screen.
     Guard the derivation so a future edit cannot collapse the two fields. */
  assert.match(orders, /const tracking = String\(order\.tracking_status \|\| 'processing'\)/);
  for (const stage of ["blocked", "shipped", "fulfilling"]) {
    assert.ok(orders.includes(`stage = '${stage}'`), `tracking-derived stage ${stage} must survive`);
  }
});

test("SQ-19: word-set comparison ignores order and separators, not content", () => {
  const statusWords = new Function(`${orders.match(/function statusWords[\s\S]*?\n  \}/)[0]}; return statusWords;`)();
  assert.equal(statusWords("Payment pending"), statusWords("pending_payment"));
  assert.equal(statusWords("Cancelled"), statusWords("cancelled"));
  assert.notEqual(statusWords("Unfulfilled"), statusWords("processing"));
  assert.notEqual(statusWords("paid"), statusWords("unpaid"));
});
