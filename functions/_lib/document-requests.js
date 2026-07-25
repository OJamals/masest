import {
  RequestBodyTooLargeError,
  readBoundedJson,
} from "./request-body.js";

const BODY_LIMIT = 4096;
const REQUEST_SELECT = [
  "id",
  "requester_id",
  "requester_email",
  "document_id",
  "document_revision",
  "status",
  "requested_from",
  "decision_note",
  "reviewed_by",
  "reviewed_at",
  "created_at",
  "updated_at",
].join(",");

const ADMIN_REQUEST_SELECT = `${REQUEST_SELECT},technical_documents(title,document_type,claim_status)`;

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function readDocumentRequestBody(request) {
  try {
    const body = await readBoundedJson(request, BODY_LIMIT);
    return { body: body && typeof body === "object" && !Array.isArray(body) ? body : {} };
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? { status: 413, error: "request_too_large" }
      : { status: 400, error: "bad_request" };
  }
}

export function createDocumentRequestRepository(sb) {
  return {
    async findDocument(documentId) {
      return dataOrThrow(await sb
        .from("technical_documents")
        .select("document_id,title,document_type,revision,storage_path,active")
        .eq("document_id", documentId)
        .eq("active", true)
        .maybeSingle());
    },

    async findRequest(requesterId, documentId, revision) {
      return dataOrThrow(await sb
        .from("technical_document_requests")
        .select(REQUEST_SELECT)
        .eq("requester_id", requesterId)
        .eq("document_id", documentId)
        .eq("document_revision", revision)
        .maybeSingle());
    },

    async createRequest(row) {
      return dataOrThrow(await sb
        .from("technical_document_requests")
        .insert(row)
        .select(REQUEST_SELECT)
        .single());
    },

    async reopenRequest(id, requestedFrom) {
      return dataOrThrow(await sb
        .from("technical_document_requests")
        .update({
          status: "pending",
          requested_from: requestedFrom,
          decision_note: null,
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "denied")
        .select(REQUEST_SELECT)
        .maybeSingle());
    },

    async listForUser(requesterId) {
      return dataOrThrow(await sb
        .from("technical_document_requests")
        .select(`${REQUEST_SELECT},technical_documents(title,document_type)`)
        .eq("requester_id", requesterId)
        .order("created_at", { ascending: false }));
    },

    async listAdmin(status, limit, offset) {
      let query = sb
        .from("technical_document_requests")
        .select(ADMIN_REQUEST_SELECT, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status !== "all") query = query.eq("status", status);
      const result = await query;
      if (result.error) throw result.error;
      return { rows: result.data || [], count: result.count || 0 };
    },

    async decide(id, status, note, reviewerId) {
      return dataOrThrow(await sb
        .from("technical_document_requests")
        .update({
          status,
          decision_note: note || null,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending")
        .select(ADMIN_REQUEST_SELECT)
        .maybeSingle());
    },
  };
}

export async function signTechnicalDocumentUrl(env, path, expiresIn = 300) {
  const encoded = String(path || "").split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/technical-documents/${encoded}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
    },
  );
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.signedURL ? `${env.SUPABASE_URL}/storage/v1${body.signedURL}` : null;
}
