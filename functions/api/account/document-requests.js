import {
  adminClient,
  json,
  userFromRequest,
} from "../../_lib/supabase.js";
import { rateLimit } from "../../_lib/ratelimit.js";
import {
  createDocumentRequestRepository,
  readDocumentRequestBody,
  signTechnicalDocumentUrl,
} from "../../_lib/document-requests.js";

const DOCUMENT_ID = /^MAS-[A-Z0-9-]+$/;
const DOCUMENT_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const EXPIRES_IN = 300;

function publicRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    document_id: row.document_id,
    document_revision: row.document_revision,
    status: row.status,
    requested_from: row.requested_from || null,
    decision_note: row.decision_note || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    document: row.technical_documents || null,
  };
}

function sourcePath(value) {
  const source = String(value || "").trim();
  if (!source || source.length > 500 || !source.startsWith("/") || source.includes("\\")) return null;
  return source;
}

export async function onRequest({ request, env }, dependencies = {}) {
  const authenticate = dependencies.authenticate
    || (async () => (await userFromRequest(request, env)).user);
  const user = await authenticate();
  if (!user) return json(401, { error: "registration_required" });

  const sb = dependencies.repository ? null : adminClient(env);
  const repository = dependencies.repository || createDocumentRequestRepository(sb);
  const sign = dependencies.sign || ((path) => signTechnicalDocumentUrl(env, path, EXPIRES_IN));
  const rate = dependencies.rate
    || (() => rateLimit(env, "technical-document-request", user.id, { limit: 12, windowSec: 60 }));
  let submittedDocumentId = "";
  let submittedRevision = "";

  try {
    if (request.method === "GET") {
      const downloadId = new URL(request.url).searchParams.get("download");
      if (!downloadId) {
        const rows = await repository.listForUser(user.id);
        return json(200, { requests: (rows || []).map(publicRequest) });
      }
      if (!DOCUMENT_ID.test(downloadId)) return json(400, { error: "invalid_document_id" });
      const document = await repository.findDocument(downloadId);
      if (!document || !["sds", "tds"].includes(document.document_type)) {
        return json(404, { error: "document_not_found" });
      }
      const existing = await repository.findRequest(user.id, document.document_id, document.revision);
      if (existing?.status !== "approved") return json(403, { error: "approval_required" });
      const url = await sign(document.storage_path);
      if (!url) return json(503, { error: "document_delivery_unavailable" });
      return json(200, { url, expires_in: EXPIRES_IN });
    }

    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const parsed = await readDocumentRequestBody(request);
    if (parsed.error) return json(parsed.status, { error: parsed.error });
    submittedDocumentId = String(parsed.body.document_id || "").trim();
    submittedRevision = String(parsed.body.document_revision || "").trim();
    if (!DOCUMENT_ID.test(submittedDocumentId)) return json(400, { error: "invalid_document_id" });
    if (!DOCUMENT_REVISION.test(submittedRevision)) return json(400, { error: "invalid_document_revision" });
    const limited = await rate();
    if (!limited.ok) {
      return json(429, { error: "rate_limited" }, {
        "Retry-After": String(limited.retryAfter || 60),
      });
    }

    const document = await repository.findDocument(submittedDocumentId);
    if (!document || !["sds", "tds"].includes(document.document_type)) {
      return json(404, { error: "document_not_found" });
    }
    if (document.revision !== submittedRevision) {
      return json(409, { error: "document_revision_changed" });
    }
    const existing = await repository.findRequest(user.id, document.document_id, document.revision);
    if (["pending", "approved"].includes(existing?.status)) {
      return json(200, { request: publicRequest(existing) });
    }

    const requestedFrom = sourcePath(parsed.body.requested_from);
    let row = existing?.status === "denied"
      ? await repository.reopenRequest(existing.id, requestedFrom)
      : await repository.createRequest({
        requester_id: user.id,
        requester_email: String(user.email || "").trim().toLowerCase() || null,
        document_id: document.document_id,
        document_revision: document.revision,
        requested_from: requestedFrom,
      });
    if (!row && existing?.status === "denied") {
      row = await repository.findRequest(user.id, document.document_id, document.revision);
      if (!["pending", "approved"].includes(row?.status)) {
        return json(409, { error: "request_state_changed" });
      }
    }
    return json(existing ? 200 : 201, { request: publicRequest(row) });
  } catch (error) {
    if (error?.code === "23505" && request.method === "POST") {
      const document = await repository.findDocument(submittedDocumentId);
      const existing = document
        ? await repository.findRequest(user.id, document.document_id, document.revision)
        : null;
      if (existing) return json(200, { request: publicRequest(existing) });
    }
    return json(500, { error: "server_error" });
  }
}
