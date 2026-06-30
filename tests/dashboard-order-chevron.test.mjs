import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard order rows show a rotating expand chevron", () => {
  const js = read("js/dashboard.js");
  assert.match(js, /class="ph ph-caret-down dash-order-caret" aria-hidden="true"/, "order summary should render a decorative caret affordance");

  const html = read("dashboard.html");
  // caret is positioned out of flex flow so it survives the mobile column stack
  assert.match(html, /\.dash-order-caret \{ position: absolute/, "caret should be absolutely positioned (top-right), not a flex child");
  assert.match(html, /\.dash-order-card\[open\] \.dash-order-caret \{ transform: rotate\(180deg\)/, "caret should rotate when the order row is open");
  assert.match(html, /prefers-reduced-motion[\s\S]*\.dash-order-caret \{ transition: none/, "caret rotation should respect reduced-motion");
});
