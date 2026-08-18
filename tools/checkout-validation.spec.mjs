import { test, expect } from "@playwright/test";
import { startStaticTestServer } from "./test-static-server.mjs";

// Guard for checkout error recovery on a blank/partial submit.
//
// The regression this pins: revealIncompleteAddress() returned early whenever any address
// part was missing, so `form.reportValidity()` never ran. On a blank form that meant the
// buyer got a focus jump, one global line at the bottom of the page, and no indication that
// First name, Last name, Email, and Phone were also required — every missing requirement had
// to be inferred. The form carries `novalidate`, so nothing else was going to report them.
//
// The contract now: every unmet required field states its own requirement, the message is
// wired to the control through aria-describedby, the control is marked aria-invalid, and
// focus lands on the first offender.
let BASE_URL = "";
let staticSite;

test.beforeAll(async () => {
  staticSite = await startStaticTestServer(new URL("..", import.meta.url));
  BASE_URL = staticSite.baseUrl;
});

test.afterAll(async () => {
  await staticSite?.close();
});

const CONTACT_IDS = ["firstName", "lastName", "checkoutEmail", "phone"];
const SHIPPING_IDS = ["shippingAddress1", "shippingCity", "shippingState", "shippingPostalCode"];

async function openCheckoutWithCart(page) {
  await page.route("**/api/products", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [
        { sku: "crhd", name: "VertKleen CR-HD", mode: "buy", active: true, price: 12.5, currency: "usd" },
      ],
    }),
  }));
  await page.goto(`${BASE_URL}/checkout.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("masest_cart", JSON.stringify({ crhd: 1 })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#calculateShipping")).toBeVisible();
}

// The message element is created next to the control, and the control points at it. Asserting
// the wiring rather than the text placement is what keeps this meaningful for screen readers.
async function expectDescribedError(page, id) {
  const field = page.locator(`#${id}`);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const described = await field.getAttribute("aria-describedby");
  expect(described, `${id} must point at its error message`).toContain(`${id}Error`);
  await expect(page.locator(`#${id}Error`)).toBeVisible();
  await expect(page.locator(`#${id}Error`)).not.toBeEmpty();
}

async function fillValidCheckout(page, postalCode = "33601") {
  await page.locator("#firstName").fill("Pat");
  await page.locator("#lastName").fill("Buyer");
  await page.locator("#checkoutEmail").fill("pat@example.test");
  await page.locator("#phone").fill("8135550142");
  const manual = page.locator("#shippingManualToggle");
  if (await manual.isVisible()) await manual.click();
  await page.locator("#shippingAddress1").fill("500 Industrial Way");
  await page.locator("#shippingCity").fill("Tampa");
  await page.locator("#shippingState").fill("FL");
  await page.locator("#shippingPostalCode").fill(postalCode);
}

function shippingQuote(postalCode, amountMinor) {
  const address = {
    name: "Pat Buyer", company: "", phone: "8135550142",
    address1: "500 Industrial Way", address2: "", city: "Tampa", state: "FL",
    postal_code: postalCode, country: "US", residential: false,
  };
  return {
    address,
    billing_address: address,
    billing_same_as_shipping: true,
    address_validation: { corrected: false, possible_next_action: "ACCEPT" },
    package_count: 1,
    fulfillment: { ship_date: "2026-08-18" },
    rates: [{
      rate_id: `rate-${postalCode}`, carrier_name: "UPS", service_type: "Ground",
      service_code: "ups_ground", amount_minor: amountMinor, currency: "usd", token: `token-${postalCode}`,
    }],
  };
}

test("blank checkout submit reports every required field, not just the address", async ({ page }) => {
  let ratesCalled = false;
  await page.route("**/api/shipping-rates", (route) => {
    ratesCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await openCheckoutWithCart(page);
  await page.locator("#calculateShipping").click();

  // Nothing may be sent to the carrier from an empty form.
  expect(ratesCalled).toBe(false);

  for (const id of [...CONTACT_IDS, ...SHIPPING_IDS]) {
    await expectDescribedError(page, id);
  }

  // The address parts must be on screen before they can be reported against.
  for (const id of SHIPPING_IDS) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }

  // Focus goes to the first offender so keyboard users start where the work is.
  await expect(page.locator("#firstName")).toBeFocused();

  const status = page.locator("#checkoutStatus");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-state", "err");
  await expect(status).toContainText("8 fields");
});

test("checkout field errors clear as the buyer fixes them", async ({ page }) => {
  await openCheckoutWithCart(page);
  await page.locator("#calculateShipping").click();
  await expectDescribedError(page, "firstName");

  await page.locator("#firstName").fill("Pat");
  await expect(page.locator("#firstNameError")).toHaveCount(0);
  await expect(page.locator("#firstName")).not.toHaveAttribute("aria-invalid", "true");
  // Clearing the message must also unhook it, or the control keeps pointing at a dead id.
  const described = await page.locator("#firstName").getAttribute("aria-describedby");
  expect(described || "").not.toContain("firstNameError");

  // The hint a field already carries has to survive the error being attached and removed.
  await expect(page.locator("#phone")).toHaveAttribute("aria-describedby", /phoneHint/);
});

test("checkout reports a malformed email rather than accepting it", async ({ page }) => {
  await openCheckoutWithCart(page);
  await page.locator("#firstName").fill("Pat");
  await page.locator("#lastName").fill("Buyer");
  await page.locator("#checkoutEmail").fill("not-an-email");
  await page.locator("#phone").fill("8135550142");

  const manual = page.locator("#shippingManualToggle");
  if (await manual.isVisible()) await manual.click();
  await page.locator("#shippingAddress1").fill("500 Industrial Way");
  await page.locator("#shippingCity").fill("Tampa");
  await page.locator("#shippingState").fill("FL");
  await page.locator("#shippingPostalCode").fill("33601");

  await page.locator("#calculateShipping").click();
  await expectDescribedError(page, "checkoutEmail");
  await expect(page.locator("#checkoutEmailError")).toContainText("valid email");
  await expect(page.locator("#checkoutEmail")).toBeFocused();

  // Editing one invalid non-empty value into another must not make the field look fixed.
  await page.locator("#checkoutEmail").fill("still-not-an-email");
  await page.locator("#phone").click();
  await expectDescribedError(page, "checkoutEmail");
  await expect(page.locator("#checkoutEmailError")).toContainText("valid email");
});

// The checkbox sits under a decorative .checkout-switch span, so a direct .uncheck() is
// intercepted. Clicking the label is both what works and what a buyer actually does.
async function toggleSameBilling(page, same) {
  const box = page.locator("#billingSameAsShipping");
  if (await box.isChecked() === same) return;
  await page.getByText("Billing address is same as shipping").click();
  await expect(box).toBeChecked({ checked: same });
}

test("separate billing address is validated, and its errors clear when it is switched off", async ({ page }) => {
  await openCheckoutWithCart(page);
  await toggleSameBilling(page, false);
  await page.locator("#calculateShipping").click();

  for (const id of ["billingAddress1", "billingCity", "billingState", "billingPostalCode"]) {
    await expectDescribedError(page, id);
  }

  // Re-checking "same as shipping" drops billing from the requirement set, so its messages
  // must go with it rather than linger against now-irrelevant controls.
  await toggleSameBilling(page, true);
  for (const id of ["billingAddress1", "billingCity", "billingState", "billingPostalCode"]) {
    await expect(page.locator(`#${id}Error`)).toHaveCount(0);
  }
});

test("a delayed old address response cannot re-enable payment after the Buyer edits and rerates", async ({ page }) => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  await page.route("**/api/shipping-rates", async (route) => {
    const body = route.request().postDataJSON();
    const postalCode = body.address.postal_code;
    calls.push(postalCode);
    if (postalCode === "33601") await firstGate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(shippingQuote(postalCode, postalCode === "33601" ? 1111 : 2222)),
      });
    } catch {
      // The old browser request is expected to be aborted before this route is released.
    }
  });

  await openCheckoutWithCart(page);
  await fillValidCheckout(page, "33601");
  await page.locator("#calculateShipping").click();
  await expect.poll(() => calls.length).toBe(1);

  await page.locator("#shippingPostalCode").fill("33602");
  await expect(page.locator("#checkoutPay")).toBeDisabled();
  await expect(page.locator("#calculateShipping")).toBeEnabled();
  await page.locator("#calculateShipping").click();

  await expect(page.locator("#checkoutPay")).toBeEnabled();
  await expect(page.locator("#shippingRates")).toContainText("$22.22");
  releaseFirst();
  await page.waitForTimeout(100);
  await expect(page.locator("#shippingRates")).toContainText("$22.22");
  await expect(page.locator("#shippingRates")).not.toContainText("$11.11");
  expect(calls).toEqual(["33601", "33602"]);
});
