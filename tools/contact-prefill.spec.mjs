import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const PORT = 4195;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });

  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${BASE_URL}/contact.html`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  throw new Error("static server did not start");
});

test.afterAll(async () => {
  if (!server) return;
  if (server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([
    exitedOnce,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

test("contact form pre-fills quote message from cart handoff", async ({ page }) => {
  const message = "Cart quote request: VertKlean CR-HD x 1; VertKlean LAM3 x 1.";
  await page.goto(`${BASE_URL}/contact.html?type=quote&email=buyer%40example.com&message=${encodeURIComponent(message)}`, {
    waitUntil: "networkidle",
  });

  await expect(page.locator('[name="type"]')).toHaveValue("quote");
  await expect(page.locator("#fEmail")).toHaveValue("buyer@example.com");
  await expect(page.locator('[name="message"]')).toHaveValue(message);
});

test("product quote handoff lands on the visible prefilled product", async ({ page }) => {
  await page.goto(`${BASE_URL}/products/descaler.html`, { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: "Request a quote" })).toHaveAttribute("href", /#quoteForm$/);
  await expect(page.getByRole("link", { name: "Request free sample" })).toHaveAttribute("href", /#quoteForm$/);

  await page.goto(
    `${BASE_URL}/contact.html?type=quote&product=VertKlean%20Descaler#quoteForm`,
    { waitUntil: "networkidle" },
  );

  await expect(page.locator("#fProduct")).toBeVisible();
  await expect(page.locator("#fProduct")).toHaveValue("VertKlean Descaler");
  await expect(page.locator(".quote-advanced-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#quoteContextSummary")).toBeVisible();
  await expect(page.locator("#quoteContextSummary")).toContainText("Quote request for VertKlean Descaler.");

  const formTop = await page.locator("#quoteForm").evaluate((form) => form.getBoundingClientRect().top);
  expect(formTop).toBeGreaterThanOrEqual(0);
  expect(formTop).toBeLessThan(900);
});

test("customer chat context stays visible, editable, and submits only its allowed source", async ({ page }) => {
  let submittedBody = "";
  await page.route("**/api/quote", async (route) => {
    submittedBody = route.request().postData() || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  const params = new URLSearchParams([
    ["type", "quote"],
    ["source", "customer_chat"],
    ["product", "hcr"],
    ["path", "/products/hcr"],
    ["cart", "VK-HCR-1G:2"],
    ["cart", "VK-LAM3-5G:1"],
    ["email", "should-not-prefill@example.com"],
    ["message", "private history must not prefill"],
  ]);
  await page.goto(`${BASE_URL}/contact.html?${params}`, { waitUntil: "networkidle" });

  await expect(page.locator("#quoteContextSummary")).toBeVisible();
  await expect(page.locator("#quoteContextSummary")).toContainText("Product, cart volume, and notes are prefilled");
  await expect(page.locator("#fProduct")).toBeVisible();
  await expect(page.locator("#fProduct")).toHaveValue("hcr");
  await expect(page.locator("#fVolume")).toHaveValue("3 units across 2 cart items");
  await expect(page.locator("#fMessage")).toHaveValue([
    "Request context from customer chat.",
    "Page: /products/hcr",
    "Product / SKU: hcr",
    "Cart:",
    "- VK-HCR-1G x 2",
    "- VK-LAM3-5G x 1",
  ].join("\n"));
  await expect(page.locator("#fEmail")).toHaveValue("");

  await page.locator("#fProduct").selectOption({ label: "VertKlean HCR" });
  await page.locator("#fVolume").selectOption({ label: "1-10 pails" });
  await page.locator("#fMessage").fill("Edited buyer notes.");
  await page.locator("#fName").fill("Test Buyer");
  await page.locator("#fCompany").fill("Example Co");
  await page.locator("#fEmail").fill("buyer@example.com");
  await page.locator('#quoteForm [type="submit"]').click();
  await expect(page.locator("#formSuccess")).toBeVisible();

  expect(submittedBody).toContain('name="source"');
  expect(submittedBody).toContain("customer_chat");
  expect(submittedBody).toContain("VertKlean HCR");
  expect(submittedBody).toContain("1-10 pails");
  expect(submittedBody).toContain("Edited buyer notes.");
  expect(submittedBody).not.toContain("private history must not prefill");
  expect(submittedBody).not.toContain("should-not-prefill@example.com");
});

test("invalid customer chat query context is rejected without personal prefill", async ({ page }) => {
  const params = new URLSearchParams([
    ["type", "quote"],
    ["source", "customer_chat"],
    ["product", "<script>alert(1)</script>"],
    ["path", "https://evil.example/account?token=secret"],
    ["cart", "<script>:4"],
    ["email", "attacker@example.com"],
    ["message", "copied private history"],
  ]);
  await page.goto(`${BASE_URL}/contact.html?${params}`, { waitUntil: "networkidle" });

  await expect(page.locator("#quoteContextSummary")).toBeHidden();
  await expect(page.locator("#fProduct")).toHaveValue("");
  await expect(page.locator("#fVolume")).toHaveValue("");
  await expect(page.locator("#fMessage")).toHaveValue("");
  await expect(page.locator("#fEmail")).toHaveValue("");
  await expect(page.locator("#fSource")).toBeDisabled();
});
