// /api/admin/content - staff-managed CMS entries for non-commerce public content.
import { adminClient, requireStaff, json, readBody } from "../../_lib/supabase.js";
import {
  createContentPublicationLifecycle,
  createContentRepository,
  triggerBlogPublishWorkflow,
  triggerContentPublishBuild,
} from "../../_lib/content.js";
import { timingSafeEqual } from "../../_lib/secret.js";
import { recordAutomationRun } from '../../_lib/automation-runs.js';

function contentPublication(repository, env) {
  return createContentPublicationLifecycle({
    repository,
    publishHook: (entry) => triggerContentPublishBuild(env, entry),
    blogWorkflow: (entry) => triggerBlogPublishWorkflow(env, entry),
  });
}

export async function onRequest({ request, env }) {
  const body = request.method === "POST" ? await readBody(request) : {};
  const cronHeader = request.headers.get("x-content-publish-cron-secret");
  if (body.action === "publish_scheduled" && cronHeader !== null) {
    if (!env.CONTENT_PUBLISH_CRON_SECRET
      || !timingSafeEqual(cronHeader, env.CONTENT_PUBLISH_CRON_SECRET)) {
      return json(401, { error: "unauthorized" });
    }
    const sb = adminClient(env);
    const repository = createContentRepository(sb);
    const response = await recordAutomationRun(sb, 'content_publish', async (run) => {
      const outcome = await contentPublication(repository, env).publishScheduled({ userId: null, system: true });
      run.processed = Number(outcome?.result?.count ?? 0) || 0;
      // ok is carried explicitly: the outcome is a {status, result} envelope, not
      // a Response, so the recorder cannot infer success from it.
      return { ...outcome, ok: outcome.status < 400, error: outcome.result?.error };
    });
    return json(response.status, response.result);
  }

  const { user, staff, role } = await requireStaff(request, env);
  if (!user) return json(401, { error: "unauthenticated" });
  if (!staff) return json(403, { error: "forbidden" });

  const repository = createContentRepository(adminClient(env));
  const publication = contentPublication(repository, env);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || undefined;
    const slug = url.searchParams.get("slug") || undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "all" ? null : (statusParam || "published");
    const locale = url.searchParams.get("locale") || "en";
    try {
      if (type && slug) {
        const entry = await repository.get({ type, slug, locale });
        return json(200, { entry });
      }
      const entries = await repository.list({ type, status, locale });
      return json(200, { entries });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  if (request.method === "POST") {
    const response = await publication.execute({
      action: body.action || (body.publish ? "publish" : "save_draft"),
      entry: body.entry || body,
      body,
      userId: user.id,
      role,
    });
    return json(response.status, response.result);
  }

  if (request.method === "DELETE") {
    const response = await publication.archive({
      entry: await readBody(request),
      userId: user.id,
      role,
    });
    return json(response.status, response.result);
  }

  return json(405, { error: "method_not_allowed" });
}
