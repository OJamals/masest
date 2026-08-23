import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "@playwright/test";

const PORT = 4320;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

const json = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${BASE_URL}/admin.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => {});
});

async function bootAsStaff(page, payoutResponse) {
  await page.route("**/js/auth.js*", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `
      export const supabase = {};
      export async function getToken() { return "staff-token"; }
      export async function login() {}
      export async function logout() {}
      export async function api(path, options = {}) {
        const response = await fetch(path, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || "request_failed"), { status: response.status, data });
        return data;
      }
      export async function apiBlob() { return new Blob(); }
    `,
  }));
  await page.route("**/api/admin/**", (route) => route.fulfill(json({})));
  await page.route("**/api/admin/stats", (route) => route.fulfill(json({})));
  await page.route("**/api/admin/stripe**", (route) => route.fulfill(json(payoutResponse)));
}

test("Finance treats zero Stripe payouts as a normal empty state and explains QuickBooks setup", async ({ page }) => {
  await bootAsStaff(page, {
    limit: 3,
    payouts_has_more: false,
    payouts: [],
    qbo_mapping: {
      posting_ready: false,
      mappings: {
        products_income: "present",
        shipping_income: "missing",
        merchant_fees: "missing",
        postage_expense: "missing",
        stripe_clearing: "missing",
        bank: "missing",
        tax: "missing",
        discounts: "missing",
        refunds: "missing",
        disputes: "missing",
      },
      missing: [
        "QBO_SHIPPING_INCOME_ACCOUNT_ID",
        "QBO_MERCHANT_FEES_ACCOUNT_ID",
        "QBO_POSTAGE_EXPENSE_ACCOUNT_ID",
        "QBO_STRIPE_CLEARING_ACCOUNT_ID",
        "QBO_BANK_ACCOUNT_ID",
        "QBO_TAX_LIABILITY_ACCOUNT_ID",
        "QBO_DISCOUNTS_ACCOUNT_ID",
        "QBO_REFUNDS_ACCOUNT_ID",
        "QBO_DISPUTES_ACCOUNT_ID",
      ],
    },
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/admin.html#finance`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Stripe bank deposits" })).toBeVisible();
  await expect(page.locator("#stripePayoutStatus")).toHaveText("No payouts found.");
  await expect(page.locator("#stripePayoutStatus")).not.toHaveAttribute("data-state", "ok");
  await expect(page.locator("#stripePayoutList")).toContainText("No Stripe bank deposits yet");

  const setup = page.locator("#stripePayoutMappings");
  await expect(setup).toContainText("QuickBooks payout setup");
  await expect(setup).toContainText("1 of 10 accounts matched");
  await expect(setup).toContainText("9 still need an account");
  await expect(setup).toContainText("does not affect Stripe payments or bank deposits");
  await expect(setup).not.toContainText("QBO_");

  await page.setViewportSize({ width: 390, height: 844 });
  const refreshBox = await page.locator("#stripePayoutRefresh").boundingBox();
  expect(refreshBox?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
