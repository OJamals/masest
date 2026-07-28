import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onRequest as handleAccountDocumentRequests } from "../functions/api/account/document-requests.js";
import { onRequest as handleAdminDocumentRequests } from "../functions/api/admin/document-requests.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const user = { id: "user-1", email: "buyer@example.com" };
const staffUser = { id: "staff-1", email: "owner@example.com" };
const requestId = "11111111-1111-4111-8111-111111111111";
const documentRow = {
  document_id: "MAS-VK-HCR-SDS",
  title: "VertKlean HCR Safety Data Sheet",
  document_type: "sds",
  revision: "1.0",
  storage_path: "sds/vertkleen-hcr-sds.pdf",
  active: true,
};

function jsonRequest(url, method = "GET", body) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const requestBody = (overrides = {}) => ({
  document_id: documentRow.document_id,
  document_revision: documentRow.revision,
  ...overrides,
});

function accountDependencies(overrides = {}) {
  return {
    authenticate: async () => user,
    rate: async () => ({ ok: true }),
    sign: async () => "https://storage.example/signed",
    repository: {
      findDocument: async () => documentRow,
      findRequest: async () => null,
      createRequest: async (row) => ({ id: requestId, status: "pending", ...row }),
      reopenRequest: async () => ({ id: requestId, status: "pending" }),
      listForUser: async () => [],
    },
    ...overrides,
  };
}

function adminDependencies(overrides = {}) {
  return {
    authenticateStaff: async () => ({ user: staffUser, staff: true, role: "owner" }),
    canReview: () => true,
    repository: {
      listAdmin: async () => ({ rows: [], count: 0 }),
      decide: async (id, status, note, reviewerId) => ({
        id,
        status,
        decision_note: note,
        reviewed_by: reviewerId,
      }),
    },
    audit: async () => {},
    ...overrides,
  };
}

test("document requests require a registered session and a controlled SDS/TDS ID", async () => {
  const unauthenticated = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST", requestBody()),
    env: {},
  }, accountDependencies({ authenticate: async () => null }));
  assert.equal(unauthenticated.status, 401);

  const invalid = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST",
      requestBody({ document_id: "../docs/sds/private.pdf" })),
    env: {},
  }, accountDependencies());
  assert.equal(invalid.status, 400);

  const unavailable = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST",
      requestBody({ document_id: "MAS-VK-HCR-LABEL" })),
    env: {},
  }, accountDependencies({ repository: {
    ...accountDependencies().repository,
    findDocument: async () => null,
  } }));
  assert.equal(unavailable.status, 404);

  const stale = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST",
      requestBody({ document_revision: "0.9" })),
    env: {},
  }, accountDependencies());
  assert.equal(stale.status, 409);
});

test("registered users create one pending request and retries are idempotent", async () => {
  let createCount = 0;
  const created = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST",
      requestBody({ requested_from: "/products/hcr" })),
    env: {},
  }, accountDependencies({ repository: {
    ...accountDependencies().repository,
    createRequest: async (row) => {
      createCount += 1;
      return { id: requestId, status: "pending", ...row };
    },
  } }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).request.status, "pending");
  assert.equal(createCount, 1);

  const duplicate = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST", requestBody()),
    env: {},
  }, accountDependencies({ repository: {
    ...accountDependencies().repository,
    findRequest: async () => ({ id: requestId, status: "pending" }),
    createRequest: async () => { throw new Error("must not create duplicate"); },
  } }));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).request.status, "pending");
});

test("a concurrent denied-request reopen returns the current request state", async () => {
  let lookup = 0;
  const response = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST", requestBody()),
    env: {},
  }, accountDependencies({ repository: {
    ...accountDependencies().repository,
    findRequest: async () => {
      lookup += 1;
      return lookup === 1
        ? { id: requestId, status: "denied" }
        : { id: requestId, status: "pending" };
    },
    reopenRequest: async () => null,
  } }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.status, "pending");
  assert.equal(lookup, 2);
});

test("only an approved requester receives a short-lived private-storage URL", async () => {
  const denied = await handleAccountDocumentRequests({
    request: jsonRequest(`https://masest.test/api/account/document-requests?download=${documentRow.document_id}`),
    env: {},
  }, accountDependencies({ repository: {
    ...accountDependencies().repository,
    findRequest: async () => ({ id: requestId, status: "pending" }),
  } }));
  assert.equal(denied.status, 403);

  let signedPath = "";
  const approved = await handleAccountDocumentRequests({
    request: jsonRequest(`https://masest.test/api/account/document-requests?download=${documentRow.document_id}`),
    env: {},
  }, accountDependencies({
    repository: {
      ...accountDependencies().repository,
      findRequest: async () => ({ id: requestId, status: "approved" }),
    },
    sign: async (path) => {
      signedPath = path;
      return "https://storage.example/signed";
    },
  }));
  assert.equal(approved.status, 200);
  assert.equal(signedPath, documentRow.storage_path);
  assert.deepEqual(await approved.json(), {
    url: "https://storage.example/signed",
    expires_in: 300,
  });
});

test("document request creation is rate limited per registered user", async () => {
  const response = await handleAccountDocumentRequests({
    request: jsonRequest("https://masest.test/api/account/document-requests", "POST", requestBody()),
    env: {},
  }, accountDependencies({ rate: async () => ({ ok: false, retryAfter: 60 }) }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("staff can list requests; only content reviewers can approve or deny", async () => {
  const forbidden = await handleAdminDocumentRequests({
    request: jsonRequest("https://masest.test/api/admin/document-requests", "PATCH", {
      id: requestId,
      status: "approved",
    }),
    env: {},
  }, adminDependencies({ canReview: () => false }));
  assert.equal(forbidden.status, 403);

  let audit = null;
  const approved = await handleAdminDocumentRequests({
    request: jsonRequest("https://masest.test/api/admin/document-requests", "PATCH", {
      id: requestId,
      status: "approved",
      note: "Current revision approved for this requester.",
    }),
    env: {},
  }, adminDependencies({ audit: async (entry) => { audit = entry; } }));
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).request.status, "approved");
  assert.equal(audit.action, "technical_document_request.approved");
  assert.equal(audit.targetId, requestId);

  const listed = await handleAdminDocumentRequests({
    request: jsonRequest("https://masest.test/api/admin/document-requests?status=pending&limit=20"),
    env: {},
  }, adminDependencies({ repository: {
    ...adminDependencies().repository,
    listAdmin: async (status, limit, offset) => {
      assert.equal(status, "pending");
      assert.equal(limit, 20);
      assert.equal(offset, 0);
      return { rows: [{ id: requestId, status: "pending" }], count: 1 };
    },
  } }));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).total, 1);
});

test("request workflow is mounted in Accounts and uses the shared authenticated UI", () => {
  const admin = read("admin.html");
  const accounts = read("js/admin/companies.js");
  const chrome = read("js/main/chrome.js");
  const account = read("account.html");
  const product = read("products/hcr.html");
  const schema = read("supabase/schema-content.sql");

  assert.match(admin, /data-acct-view="document-requests"/);
  assert.match(admin, /data-acct-panel="document-requests"/);
  assert.match(admin, /Open SDS &amp; TDS requests/);
  assert.match(accounts, /data-document-request-decision/);
  assert.match(accounts, /Claim review/);
  assert.match(accounts, /<option value="approved">Approve<\/option>/);
  assert.match(accounts, /<option value="denied">Deny<\/option>/);
  assert.match(accounts, /\/api\/admin\/document-requests/);
  assert.match(accounts, /data-capability="content\.review"/);
  assert.match(accounts, /loadId !== state\.documentRequestLoadId/);

  assert.match(chrome, /data-document-request/);
  assert.match(chrome, /\/api\/account\/document-requests/);
  assert.match(chrome, /document_revision:\s*documentRevision/);
  assert.match(chrome, /mode:\s*"register"/);
  assert.match(account, /params\.get\("mode"\).+"register"/);
  assert.match(product, /data-document-request/);
  assert.match(product, /Register to request/);

  assert.match(schema, /create table if not exists public\.technical_documents/);
  assert.match(schema, /create table if not exists public\.technical_document_requests/);
  assert.match(schema, /technical_document_request_status/);
  assert.match(schema, /'technical-documents', 'technical-documents', false/);
  assert.match(schema, /unique \(requester_id, document_id, document_revision\)/);
});
