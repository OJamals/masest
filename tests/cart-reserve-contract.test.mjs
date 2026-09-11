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

/* The summary half of the reserve.
 *
 * Reserving the lines left one shift: #cartEstimate and the ZIP-estimate form un-hiding
 * together once prices arrived, which moved .cart-path-primary - the block holding
 * Continue to checkout - down +347px on iPad Mini and +477px on iPhone SE at ~1.47s, and
 * was all of the page's remaining 0.1271 / 0.0808 in the field.
 */

// Everything above the module script. The module renders the same totals from the
// catalog, so searching the whole file would match either copy and prove nothing.
const reserveScript = cartHtml.slice(0, cartHtml.indexOf('<script type="module">'));

test("the reserve rebuilds the totals with the rows the module renders", () => {
  // Measured per-element delta on hydration is 0px at five viewports and four cart
  // shapes - but only because the reserved rows are the real ones. Drop a row here, or
  // change a constant cell in the module without changing it here, and the reserve is
  // a different height than the thing it reserves for.
  for (const row of ["<dt>Shipping</dt>", "<dt>Tax</dt>", "Estimated subtotal"]) {
    assert.ok(reserveScript.includes(row), `the reserve must lay out the ${row} row`);
  }
  assert.ok(
    reserveScript.includes("Calculated next") && reserveScript.includes("Calculated at checkout"),
    "both constant cells must be reserved with their real text, not a bar",
  );
  assert.ok(
    reserveScript.includes("Final product pricing and discounts are confirmed at checkout"),
    "the note under the totals is part of the reserved height",
  );
  assert.ok(
    reserveScript.includes('class="cart-total-count"'),
    "the item count is a block-level line inside the total row and must be reserved",
  );
});

test("the reserve prints no figure and no verdict it has not earned", () => {
  // tests/cart-page.test.mjs pins that "Pending review" must not appear before the
  // catalog answers: a cart is not under review until something says so. The subtotal
  // is also the only cell here that needs prices, so a bar is both the honest and the
  // only available filler.
  assert.ok(
    !reserveScript.includes("Pending review"),
    "the reserve must not decide a cart needs review before the catalog has answered",
  );
  assert.match(
    reserveScript,
    /<dd>&#8203;<span class="cart-sk cart-sk-md"><\/span><\/dd>/,
    "the subtotal cell must be a bar behind a zero-width space, which holds the "
      + "line-height:1 line box at the height the real figure sets",
  );
});

test("the reserve and the cart page agree on the estimable record", () => {
  // Same drift hazard as the storage key above, one level up: the reserve replays a
  // verdict the page wrote, and a rename on either side would leave the form reserving
  // nothing while every other assertion still passed.
  const written = cartHtml.match(/localStorage\.setItem\("(masest_cart_estimable[^"]*)"/);
  assert.ok(written, "cart.html no longer records an estimable verdict for the reserve");
  assert.ok(
    reserveScript.includes(`localStorage.getItem("${written[1]}")`),
    `the reserve must read the same record the page writes ("${written[1]}")`,
  );
});

test("the form reserve replays a matching verdict rather than guessing one", () => {
  // The form is offered only when every line is a priced, buyable variant. Reserving it
  // on anything weaker - a truthy record, a stale sku set - would un-hide it for carts
  // that will not get it and turn a removed shift into an added one.
  assert.match(
    reserveScript,
    /hint\.estimable === true/,
    "only an explicit true may un-hide the form; a truthy or missing record must not",
  );
  assert.match(
    reserveScript,
    /hint\.skus\.length === skus\.length/,
    "a recorded set of a different size cannot describe this cart",
  );
  assert.match(
    reserveScript,
    /if \(sorted\[s\] !== recorded\[s\]\) same = false/,
    "the recorded sku set must match the cart being reserved, order-independently",
  );
});

test("the reserve counts quantities the way the cart module does", () => {
  // items() normalises with Math.floor and drops anything <= 0; the reserve used to
  // clamp at 9999, so a cart above that reserved a narrower count string than it
  // rendered. The line set and the item count both come from this one rule.
  assert.ok(
    !/Math\.min\(9999/.test(reserveScript),
    "the reserve must not clamp quantities the real render does not clamp",
  );
  assert.match(reserveScript, /qtys\[sku\] = Math\.floor\(qty\)/);
});
