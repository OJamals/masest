import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const webhookPath = new URL("../functions/api/crisp/webhook.js", import.meta.url);
const WEBHOOK = existsSync(webhookPath) ? read("../functions/api/crisp/webhook.js") : "";
const ADMIN_MESSAGES = read("../functions/api/admin/messages.js");
const ADMIN_JS = read("../js/admin.js");
const SCHEMA = read("../supabase/schema-phase5.sql");

test("Crisp webhook verifies signed raw payloads before processing", () => {
  assert.ok(existsSync(webhookPath), "crisp webhook route should exist");
  assert.match(WEBHOOK, /CRISP_WEBHOOK_SECRET/);
  assert.match(WEBHOOK, /CRISP_WEBHOOK_KEY/);
  assert.match(WEBHOOK, /searchParams\.get\('key'\)/);
  assert.match(WEBHOOK, /X-Crisp-Request-Timestamp/i);
  assert.match(WEBHOOK, /X-Crisp-Signature/i);
  assert.match(WEBHOOK, /request\.text\(\)/);
  assert.match(WEBHOOK, /\[\$\{timestamp\};\$\{raw\}\]/);
  assert.match(WEBHOOK, /HMAC/);
  assert.match(WEBHOOK, /SHA-256/);
  assert.match(WEBHOOK, /invalid_signature/);
  assert.match(WEBHOOK, /invalid_key/);
});

test("Crisp webhook maps sessions and messages into app records", () => {
  assert.match(WEBHOOK, /session:set_data/);
  assert.match(WEBHOOK, /session:set_email/);
  assert.match(WEBHOOK, /\.from\('crisp_sessions'\)\.upsert/);
  assert.match(WEBHOOK, /account_company_id/);
  assert.match(WEBHOOK, /message:send/);
  assert.match(WEBHOOK, /message:received/);
  assert.match(WEBHOOK, /\.from\('messages'\)\.insert/);
  assert.match(WEBHOOK, /source:\s*'crisp'/);
  assert.match(WEBHOOK, /external_thread_id/);
  assert.match(WEBHOOK, /sender_role:\s*'buyer'/);
  assert.match(WEBHOOK, /sender_role:\s*'staff'/);
  assert.match(WEBHOOK, /\.from\('notifications'\)\.insert/);
  assert.match(WEBHOOK, /New Crisp chat response/);
});

test("schema and admin message UI carry Crisp source metadata", () => {
  assert.match(SCHEMA, /create table if not exists public\.crisp_sessions/);
  assert.match(SCHEMA, /grant all privileges on public\.messages, public\.notifications, public\.crisp_sessions/);
  assert.match(SCHEMA, /alter table public\.messages add column if not exists source text/);
  assert.match(SCHEMA, /external_thread_id/);
  assert.match(SCHEMA, /external_message_id/);
  assert.match(ADMIN_MESSAGES, /source,external_thread_id,external_message_id/);
  assert.match(ADMIN_JS, /sourceLabel/);
  assert.match(ADMIN_JS, /Crisp chat/);
});

test("verifyCrispSignature accepts only Crisp HMAC format", async () => {
  const { verifyCrispSignature } = await import("../functions/api/crisp/webhook.js");
  const raw = JSON.stringify({ event: "message:send", data: { session_id: "session_1" } });
  const timestamp = "1710000000000";
  const signature = createHmac("sha256", "secret").update(`[${timestamp};${raw}]`).digest("hex");

  assert.equal(await verifyCrispSignature("secret", { timestamp, signature, raw }), true);
  assert.equal(await verifyCrispSignature("secret", { timestamp, signature: "bad", raw }), false);
});

test("Website Hook key is accepted even when plugin secret env also exists", async () => {
  const { onRequestPost } = await import("../functions/api/crisp/webhook.js");
  const raw = JSON.stringify({
    website_id: "bc6be1cf-f005-40b6-ad3e-24fe68ee9b2a",
    event: "session:set_email",
    data: {
      website_id: "bc6be1cf-f005-40b6-ad3e-24fe68ee9b2a",
      session_id: "session_1",
      email: "buyer@example.com",
    },
  });
  const response = await onRequestPost({
    request: new Request("https://masest.co/api/crisp/webhook?key=website-key", { method: "POST", body: raw }),
    env: {
      CRISP_WEBHOOK_KEY: "website-key",
      CRISP_WEBHOOK_SECRET: "unused-plugin-secret",
      MASEST_CRISP_ID: "bc6be1cf-f005-40b6-ad3e-24fe68ee9b2a",
    },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("handleCrispEvent writes operator replies as staff messages and buyer notifications", async () => {
  const { handleCrispEvent } = await import("../functions/api/crisp/webhook.js");
  const writes = [];
  const chain = (table) => ({
    select: () => chain(table),
    eq: () => chain(table),
    is: () => chain(table),
    gte: () => chain(table),
    order: () => chain(table),
    limit: () => chain(table),
    update: () => ({ eq: () => ({}) }),
    maybeSingle: async () => ({ data: table === "crisp_sessions" ? null : null }),
    upsert: (row) => {
      writes.push({ table, op: "upsert", row });
      return { select: () => ({ maybeSingle: async () => ({ data: row }) }) };
    },
    insert: (row) => {
      writes.push({ table, op: "insert", row });
      return { select: () => ({ single: async () => ({ data: { id: "msg_1", created_at: "now" }, error: null }) }) };
    },
  });
  const sb = { from: (table) => chain(table) };
  const companyId = "11111111-1111-4111-8111-111111111111";

  const result = await handleCrispEvent(sb, {}, {
    website_id: "site",
    event: "message:received",
    data: {
      website_id: "site",
      session_id: "session_1",
      from: "operator",
      type: "text",
      content: "We can help with that.",
      fingerprint: 12345,
      data: { account_company_id: companyId },
    },
  });

  assert.equal(result.routed, true);
  assert.deepEqual(writes.find((w) => w.table === "messages")?.row, {
    company_id: companyId,
    user_id: null,
    sender_role: "staff",
    body: "We can help with that.",
    order_id: null,
    read_by_user: false,
    read_by_staff: true,
    source: "crisp",
    external_thread_id: "session_1",
    external_message_id: "12345",
  });
  assert.equal(writes.find((w) => w.table === "notifications")?.row.title, "New Crisp chat response");
});

test("handleCrispEvent reports Crisp session write failures", async () => {
  const { handleCrispEvent } = await import("../functions/api/crisp/webhook.js");
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      upsert: () => {
        throw new Error("schema cache missing");
      },
    }),
  };

  const result = await handleCrispEvent(sb, {}, {
    website_id: "site",
    event: "session:set_email",
    data: {
      website_id: "site",
      session_id: "session_1",
      email: "buyer@example.com",
    },
  });

  assert.equal(result.routed, false);
  assert.equal(result.error, "crisp_session_upsert_failed");
});

test("handleCrispEvent reports Supabase returned session write errors", async () => {
  const { handleCrispEvent } = await import("../functions/api/crisp/webhook.js");
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      upsert: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: null, error: { message: "Could not find table crisp_sessions" } }),
        }),
      }),
    }),
  };

  const result = await handleCrispEvent(sb, {}, {
    website_id: "site",
    event: "session:set_email",
    data: {
      website_id: "site",
      session_id: "session_1",
      email: "buyer@example.com",
    },
  });

  assert.equal(result.routed, false);
  assert.equal(result.error, "crisp_session_upsert_failed");
});
