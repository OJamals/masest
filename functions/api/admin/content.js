// /api/admin/content - staff-managed CMS entries for non-commerce public content.
import { adminClient, requireStaff, json, readBody } from "../../_lib/supabase.js";
import { staffCan } from "../../_lib/authz.js";
import { createContentRepository, triggerContentPublishBuild } from "../../_lib/content.js";

export async function onRequest({ request, env }) {
  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const repo = createContentRepository(adminClient(env));

  if (request.method === "GET") {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const slug = url.searchParams.get("slug") || undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "all" ? undefined : (statusParam || "published");
    const locale = url.searchParams.get("locale") || "en";
    try {
      if (type && slug) {
        const entry = await repo.get({ type, slug, locale });
        return json(200, { entry });
      }
      const entries = await repo.list({ type, status, locale });
      return json(200, { entries });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "POST") {
    const body = await readBody(request);
    const action = body.action || (body.publish ? "publish" : "save_draft");
    const entry = body.entry || body;
    try {
      let result;
      if (action === "submit_review") {
        if (!staffCan(role, "content.write")) {
          return json(403, { error: "forbidden", message: "Submitting content requires owner access." });
        }
        result = await repo.transition(entry, user.id, "in_review", "Submitted for review");
      } else if (action === "request_changes") {
        if (!staffCan(role, "content.review")) {
          return json(403, { error: "forbidden", message: "Requesting changes requires owner access." });
        }
        result = await repo.transition(entry, user.id, "changes_requested", body.note || "Changes requested");
      } else if (action === "schedule") {
        if (!staffCan(role, "content.publish")) {
          return json(403, { error: "forbidden", message: "Scheduling content requires owner access." });
        }
        const scheduledAt = new Date(entry.scheduled_at || "");
        if (!entry.scheduled_at || Number.isNaN(scheduledAt.getTime())) {
          return json(400, {
            error: "scheduled_at_required",
            message: "Choose a publish date before scheduling.",
          });
        }
        entry.scheduled_at = scheduledAt.toISOString();
        result = await repo.transition(entry, user.id, "scheduled", "Scheduled publish");
      } else if (action === "publish") {
        if (!staffCan(role, "content.publish")) {
          return json(403, { error: "forbidden", message: "Publishing content requires owner access." });
        }
        result = await repo.publish(entry, user.id);
        if (result.ok) {
          result.publish_hook = await triggerContentPublishBuild(env, result.entry);
        }
      } else {
        if (!staffCan(role, "content.write")) {
          return json(403, { error: "forbidden", message: "Editing content requires owner access." });
        }
        result = await repo.saveDraft(entry, user.id);
      }
      if (!result.ok) return json(400, { error: result.error });
      return json(200, result);
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "DELETE") {
    if (!staffCan(role, "content.write")) {
      return json(403, { error: "forbidden", message: "Archiving content requires owner access." });
    }
    const body = await readBody(request);
    try {
      const result = await repo.archive(body, user.id);
      return json(200, result);
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  return json(405, { error: "method_not_allowed" });
}
