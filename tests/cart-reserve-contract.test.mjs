import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* Pin the cart's pre-paint reserve.
 *
 * cart.html ships #cartLines empty and .cart-summary hidden, so before this reserve
 * existed the page painted a short "Loading cart details..." card and then, when
 * /api/products resolved at ~1.44s, swapped in N full cart lines AND revealed the
 * summary in one step. That single swap moved FOOTER from y:453 off-screen and was
 * essentially the page's whole CLS: 0.4967 on iPad Mini, 0.4796 on Pixel 7, 0.5578
 * at three lines, against 0.0001 on an empty cart.
 *
 * The CLS outcome is gated in tools/homepage-vitals.spec.mjs. These assertions are the
 * deterministic half: they fail the moment the mechanism is removed, even if a fast CI
 * runner happens to produce a passing CLS number anyway. A gate that only measures an
 * outcome goes quietly green when the thing it guards stops running.
 */

const cartHtml = readFileSync(new URL("../cart.html", import.meta.url), "utf8");
const cartJs = readFileSync(new URL("../js/cart.js", import.meta.url), "utf8");
const components = readFileSync(new URL("../css/components.css", import.meta.url), "utf8");

// The reserve script runs before any module and so cannot import from js/cart.js. It
// therefore repeats the storage key as a literal, and a silent drift between the two
// would leave the cart reserving nothing while every test still passed.
test("the pre-paint reserve reads the same storage key as the cart module", () => {
  const declared = cartJs.match(/const KEY\s*=\s*"([^"]+)"/);
  assert.ok(declared, "js/cart.js no longer declares KEY as a double-quoted literal");
  const key = declared[1];
  assert.ok(
    cartHtml.includes(`localStorage.getItem("${key}")`),
    `cart.html's reserve script must read localStorage key "${key}" to match js/cart.js`,
  );
});

test("the reserve script is synchronous, not a module", () => {
  // A module is deferred and would run after first paint, which puts the reserved
  // geometry one frame behind the thing it exists to prevent.
  const reserve = cartHtml.slice(0, cartHtml.indexOf('<script type="module">'));
  assert.match(
    reserve,
    /<script>\s*\(function \(\) \{/,
    "the reserve must be a bare synchronous <script> that runs during parse",
  );
});

test("skeleton rows carry the live cart-line class", () => {
  // Measured line heights run 132px (iPad Mini) to 241px (iPhone SE) and differ by 19px
  // within one viewport when a product name wraps. Reusing .cart-line is what makes the
  // reserve track the real height instead of guessing it.
  assert.ok(
    cartHtml.includes('class="cart-line cart-line-skeleton"'),
    "skeleton rows must carry both .cart-line and .cart-line-skeleton",
  );
  assert.ok(
    cartHtml.includes('<figure class="cart-line-media"></figure>'),
    ".cart-line-media is a fixed box, so an empty figure reserves it exactly",
  );
});

test("skeleton rows expose nothing focusable and nothing to a screen reader", () => {
  const skeleton = cartHtml.slice(cartHtml.indexOf("cart-line-skeleton"));
  const row = skeleton.slice(0, skeleton.indexOf("</article>"));
  assert.ok(row.includes('aria-hidden="true"'), "skeleton rows must be aria-hidden");
  assert.ok(row.includes("disabled"), "skeleton controls must be disabled");
  assert.ok(row.includes('tabindex="-1"'), "skeleton controls must be out of the tab order");
});

test("the loading branch yields to a standing skeleton", () => {
  // Without this the module's !catalogReady branch replaces the reserved rows with the
  // short loading card and re-hides the summary, which is the original shift exactly.
  assert.match(
    cartHtml,
    /if \(lines\.querySelector\("\.cart-line-skeleton"\)\) return;/,
    "render()'s !catalogReady branch must return early while a skeleton is standing",
  );
});

test("skeleton bars are sized so they wrap like words", () => {
  // Two inline-block bars separated by a space break at the same points a two-word
  // product name does; a single bar could not wrap and would under-reserve on phones.
  assert.match(components, /\.cart-sk\s*\{[^}]*display:\s*inline-block/);
  for (const cls of ["cart-sk-lg", "cart-sk-md", "cart-sk-sm"]) {
    assert.match(components, new RegExp(`\\.${cls}\\s*\\{[^}]*width:`), `.${cls} needs a width`);
  }
  // Height under 1em keeps the h2 and p line boxes set by their own line-height; at 1em
  // the bar drives the line box taller and the reserve overshoots.
  const bar = components.match(/\.cart-sk\s*\{([^}]*)\}/);
  assert.ok(bar, ".cart-sk rule missing");
  const height = bar[1].match(/height:\s*([\d.]+)em/);
  assert.ok(height && Number(height[1]) < 1, ".cart-sk height must stay below 1em");
});
