import {
  adminClient,
  json,
  requireStaff,
} from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { recordAudit } from "../../_lib/audit.js";
import {
  createDocumentRequestRepository,
  readDocumentRequestBody,
} from "../../_lib/document-requests.js";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "approved", "denied", "all"]);
const DECISIONS = new Set(["approved", "denied"]);

function page(searchParams) {
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "25", 10) || 25));
  const offset = Math.max(0, Number.parseInt(searchParams.get("offset") || "0", 10) || 0);
  return { limit, offset };
}

export async function onRequest({ request, env }, dependencies = {}) {
  const authenticateStaff = dependencies.authenticateStaff || (() => requireStaff(request, env));
  const { user, staff, role } = await authenticateStaff();
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const sb = dependencies.repository ? null : adminClient(env);
  const repository = dependencies.repository || createDocumentRequestRepository(sb);
  const canReview = dependencies.canReview || ((role) => staffCan(role, "content.review"));
  const audit = dependencies.audit || ((entry) => recordAudit(sb, {
    user,
    ...entry,
  }));

  try {
    if (request.method === "GET") {
      const search = new URL(request.url).searchParams;
      const status = search.get("status") || "pending";
      if (!STATUSES.has(status)) return json(400, { error: "invalid_status" });
      const { limit, offset } = page(search);
      const { rows, count } = await repository.listAdmin(status, limit, offset);
      return json(200, {
        requests: rows,
        total: count,
        limit,
        offset,
        has_more: offset + rows.length < count,
      });
    }

    if (request.method !== "PATCH") return json(405, { error: "method_not_allowed" });
    if (!canReview(role)) return json(403, { error: "insufficient_role" });
    const parsed = await readDocumentRequestBody(request);
    if (parsed.error) return json(parsed.status, { error: parsed.error });
    const id = String(parsed.body.id || "").trim();
    const status = String(parsed.body.status || "").trim();
    const note = String(parsed.body.note || "").trim();
    if (!REQUEST_ID.test(id) || !DECISIONS.has(status) || note.length > 500) {
      return json(400, { error: "invalid_decision" });
    }
    const row = await repository.decide(id, status, note, user.id);
    if (!row) return json(409, { error: "request_not_pending" });
    await audit({
      action: `technical_document_request.${status}`,
      targetType: "technical_document_request",
      targetId: id,
      detail: { document_id: row.document_id, note: note || null },
    });
    return json(200, { request: row });
  } catch {
    return json(500, { error: "server_error" });
  }
}
