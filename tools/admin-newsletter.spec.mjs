import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, expect } from "./playwright-test.mjs";
import { waitForHttpServer } from "./test-http-server.mjs";

const PORT = 4333;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
  });
  await waitForHttpServer(`${BASE_URL}/admin.html`);
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  let exited = false;
  const exitedOnce = once(server, "exit").then(() => { exited = true; }).catch(() => {});
  server.kill();
  await Promise.race([exitedOnce, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (!exited) server.kill("SIGKILL");
  await exitedOnce;
});

async function bootAsOwner(page, requests) {
  await page.addInitScript(() => {
    window.MASEST_SUPABASE_URL = "https://stub.supabase.co";
    window.MASEST_SUPABASE_ANON = "stub-anon-key";
  });
  await page.route("**/*.supabase.co/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { session: null }, session: null }),
  }));
  await page.route("**/api/admin/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      staff_context: {
        email: "owner@masest.test",
        role: "owner",
        can_write: true,
        capabilities: ["admin.write"],
      },
    }),
  }));
  await page.route("**/api/admin/recipients", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ counts: { subscribers: 1, imported: 0 }, recipients: [] }),
  }));
  await page.route("**/api/admin/newsletters**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.searchParams.get("id")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          newsletter: {
            id: "sent-1",
            subject: "Sent campaign",
            body_md: "Original body",
            source: "compose",
            status: "sent",
            audience: { populations: ["users"], recipient_tags: [] },
          },
        }),
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          newsletters: [{ id: "sent-1", subject: "Sent campaign", source: "compose", status: "sent" }],
          settings: { auto_send_latest_blog: false },
          setup_ready: true,
        }),
      });
      return;
    }

    const body = request.postDataJSON();
    requests.push(body);
    if (body.action === "save") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: body.id || "resend-2" }),
      });
      return;
    }
    if (body.action === "send_now" && body.id === "sent-1") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "already_sent" }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, queued: true, provider: "ses", total: 1, processed: 1 }),
    });
  });
}

test("sending an already-sent newsletter creates a new campaign before queueing", async ({ page }) => {
  const requests = [];
  await bootAsOwner(page, requests);
  await page.goto(`${BASE_URL}/admin.html#newsletter`);
  await page.locator('[data-nl-section="queue"]').click();
  await page.locator('[data-nl-edit="sent-1"]').click();
  await page.locator('[data-nl-action="send_now"]').click();

  await expect(page.locator("dialog.confirm-dialog")).toContainText("already sent");
  await page.locator('dialog.confirm-dialog button[value="confirm"]').click();
  await expect(page.locator("dialog.confirm-dialog")).toContainText("about 1 eligible recipient");
  await page.locator('dialog.confirm-dialog button[value="confirm"]').click();

  await expect.poll(() => requests.filter((request) => request.action === "send_now").length).toBe(1);
  const save = requests.find((request) => request.action === "save");
  const send = requests.find((request) => request.action === "send_now");
  expect(save).not.toHaveProperty("id");
  expect(send).toMatchObject({ action: "send_now", id: "resend-2" });
  await expect(page.locator("#nlStatus")).toContainText("Queued 1 recipient for Amazon SES. 1 started now.");
});
