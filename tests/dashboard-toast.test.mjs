import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("util exposes a non-blocking toast helper that replaces alert()", () => {
  const js = read("js/util.js");

  assert.match(js, /export const toast = /, "toast should be an exported helper");
  assert.match(js, /\.textContent = message/, "the toast message must be set via textContent, never innerHTML (no injection)");
  assert.match(js, /setAttribute\('aria-live'/, "toasts should land in a shared aria-live region so screen readers announce them");
  assert.match(js, /variant === 'error' \? 'alert' : 'status'/, "error toasts announce assertively (role=alert), others politely (role=status)");
  assert.match(js, /setTimeout\(dismiss/, "toasts should auto-dismiss after a timeout");
  assert.match(js, /aria-label', 'Dismiss/, "toasts should carry a labelled dismiss control");
});

test("dashboard reorder/receipt flows use toast instead of blocking alert()", () => {
  const js = read("js/dashboard.js");

  assert.doesNotMatch(js, /\balert\(/, "the dashboard should not call window.alert()");
  assert.match(js, /import \{[^}]*\btoast\b[^}]*\} from '\.\/util\.js'/, "dashboard should import toast from util");
  assert.match(js, /toast\('None of these items are available to reorder\.',\s*\{ variant: 'error' \}\)/, "the empty-reorder path should raise an error toast");
  assert.match(js, /toast\('Some items changed since your last order/, "the changed-items notice should become a toast");
  assert.match(js, /toast\('No receipt is available for this order yet\.'\)/, "the missing-receipt notice should become a toast");
});

test("toast styles are tokenized in components.css", () => {
  const css = read("css/components.css");

  assert.match(css, /\.toast-region\s*\{/, "a positioned toast region should exist");
  assert.match(css, /\.toast-msg\s*\{[\s\S]*white-space:\s*pre-line/, "multi-line toast copy should preserve newlines");
  assert.match(css, /\.toast-error\s*\{[\s\S]*var\(--status-danger/, "error toast should use the danger status tokens");
  assert.match(css, /prefers-reduced-motion/, "toast motion should respect reduced-motion");
});
