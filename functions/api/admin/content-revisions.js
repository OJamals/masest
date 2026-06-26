// /api/admin/content-revisions - revision history and restore for native CMS entries.
import { adminClient, requireStaff, json, readBody } from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { createContentRepository } from "../../_lib/content.js";

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const repo = createContentRepository(adminClient(env));

  if (request.method === "GET") {
    const url = new URL(request.url);
    try {
      const revisions = await repo.listRevisions({
        type: url.searchParams.get("type") || undefined,
        slug: url.searchParams.get("slug") || undefined,
        locale: url.searchParams.get("locale") || "en",
      });
      return json(200, { revisions });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "POST") {
    if (!staffCan(role, "content.write")) {
      return json(403, { error: "forbidden", message: "Restoring content requires owner access." });
    }
    const body = await readBody(request);
    try {
      const result = await repo.restoreRevision(body || {}, user.id);
      if (!result.ok) return json(400, { error: result.error });
      return json(200, result);
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  return json(405, { error: "method_not_allowed" });
}
