// /api/admin/content-revisions - revision history and restore for native CMS entries.
import { adminClient, requireStaff, json, readBody, internalServerError } from "../../_lib/supabase.js";
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
      return internalServerError("admin.content_revisions.list", error);
    }
  }

  if (request.method === "POST") {
    if (!staffCan(role, "content.write")) {
      return json(403, { error: "forbidden", message: "Restoring content requires owner access." });
    }
    const body = await readBody(request);
    try {
      const result = await repo.restoreRevision(
        body || {},
        user.id,
        // Restoring into a published entry keeps it live, which is a publish; only a restorer
        // who holds content.publish gets that, everyone else restores to a draft.
        { expectedVersion: body?.expected_version, canPublish: staffCan(role, "content.publish") },
      );
      if (!result.ok) {
        return json(["content_locked", "content_version_conflict"].includes(result.error) ? 409 : 400, result);
      }
      return json(200, result);
    } catch (error) {
      return internalServerError("admin.content_revisions.restore", error);
    }
  }

  return json(405, { error: "method_not_allowed" });
}
