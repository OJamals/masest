import assert from "node:assert/strict";
import test from "node:test";
import { createContentPublicationLifecycle } from "../functions/_lib/content.js";

function publicationRepository(overrides = {}) {
  const calls = [];
  return {
    calls,
    async saveDraft(entry, userId, options) {
      calls.push(["saveDraft", entry, userId, options]);
      return { ok: true, entry: { ...entry, status: "draft" } };
    },
    async publish(entry, userId, options) {
      calls.push(["publish", entry, userId, options]);
      return { ok: true, entry: { ...entry, status: "published" } };
    },
    async publishScheduledDue(filter, userId) {
      calls.push(["publishScheduledDue", filter, userId]);
      return {
        ok: true,
        count: 2,
        entries: [
          { type: "page_section", slug: "home" },
          { type: "blog_post", slug: "news" },
        ],
        skipped: [],
      };
    },
    async lock(entry, userId, options) {
      calls.push(["lock", entry, userId, options]);
      return { ok: true, entry };
    },
    async unlock(entry, userId, options) {
      calls.push(["unlock", entry, userId, options]);
      return { ok: true, entry };
    },
    async unarchive(entry, userId, options) {
      calls.push(["unarchive", entry, userId, options]);
      return { ok: true, entry: { ...entry, status: "draft" } };
    },
    async transition(entry, userId, status, note, options) {
      calls.push(["transition", entry, userId, status, note, options]);
      return { ok: true, entry: { ...entry, status } };
    },
    async archive(entry, userId, options) {
      calls.push(["archive", entry, userId, options]);
      return { ok: true, entry: { ...entry, status: "archived" } };
    },
    ...overrides,
  };
}

test("publication lifecycle keeps permissions beside workflow actions", async () => {
  const repository = publicationRepository();
  const lifecycle = createContentPublicationLifecycle({ repository });

  assert.deepEqual(await lifecycle.execute({
    action: "publish",
    entry: { type: "page_section", slug: "home" },
    role: "finance",
    userId: "u1",
  }), {
    status: 403,
    result: {
      error: "forbidden",
      message: "Publishing content requires owner access.",
    },
  });
  assert.deepEqual(repository.calls, []);
});

test("publication lifecycle routes a blog publish only to its commit workflow", async () => {
  const repository = publicationRepository();
  const effects = [];
  const lifecycle = createContentPublicationLifecycle({
    repository,
    publishHook: async (entry) => {
      effects.push(["publishHook", entry]);
      return { ok: true, status: 202 };
    },
    blogWorkflow: async (entry) => {
      effects.push(["blogWorkflow", entry]);
      return { ok: true, status: 204 };
    },
  });

  const response = await lifecycle.execute({
    action: "publish",
    entry: { type: "blog_post", slug: "news" },
    role: "owner",
    userId: "u1",
  });

  assert.equal(response.status, 200);
  assert.equal(response.result.publish_hook, undefined);
  assert.deepEqual(response.result.blog_workflow, { ok: true, status: 204 });
  assert.deepEqual(effects.map(([name]) => name), ["blogWorkflow"]);
});

test("publication lifecycle validates and normalizes scheduled transitions", async () => {
  const repository = publicationRepository();
  const lifecycle = createContentPublicationLifecycle({ repository });
  const entry = {
    type: "page_section",
    slug: "home",
    scheduled_at: "2026-08-01T09:00:00-04:00",
  };

  const response = await lifecycle.execute({
    action: "schedule",
    entry,
    body: { note: "Launch" },
    role: "owner",
    userId: "u1",
  });

  assert.equal(response.status, 200);
  const call = repository.calls[0];
  assert.equal(call[0], "transition");
  assert.equal(call[1].scheduled_at, "2026-08-01T13:00:00.000Z");
  assert.equal(call[3], "scheduled");
  assert.equal(call[4], "Launch");
});

test("scheduled publisher shares hooks across staff and cron adapters", async () => {
  const repository = publicationRepository();
  const effects = [];
  const lifecycle = createContentPublicationLifecycle({
    repository,
    publishHook: async (entry) => {
      effects.push(["publishHook", entry]);
      return { ok: true };
    },
    blogWorkflow: async (entry) => {
      effects.push(["blogWorkflow", entry]);
      return { ok: true };
    },
  });

  const response = await lifecycle.publishScheduled({
    type: "",
    userId: null,
    system: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.result.count, 2);
  assert.deepEqual(effects.map(([name]) => name), ["publishHook", "blogWorkflow"]);
});

test("archive shares conflict mapping and rebuild outcome policy", async () => {
  const repository = publicationRepository();
  const lifecycle = createContentPublicationLifecycle({
    repository,
    publishHook: async () => ({ ok: true, status: 202 }),
  });

  const response = await lifecycle.archive({
    entry: { type: "faq_block", slug: "shipping" },
    role: "owner",
    userId: "u1",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.result.publish_hook, { ok: true, status: 202 });
});

test("archiving a blog routes only to the blog commit workflow", async () => {
  const repository = publicationRepository();
  const effects = [];
  const lifecycle = createContentPublicationLifecycle({
    repository,
    publishHook: async (entry) => {
      effects.push(["publishHook", entry]);
      return { ok: true, status: 202 };
    },
    blogWorkflow: async (entry) => {
      effects.push(["blogWorkflow", entry]);
      return { ok: true, status: 204 };
    },
  });

  const response = await lifecycle.archive({
    entry: { type: "blog_post", slug: "news" },
    role: "owner",
    userId: "u1",
  });

  assert.equal(response.status, 200);
  assert.equal(response.result.publish_hook, undefined);
  assert.deepEqual(response.result.blog_workflow, { ok: true, status: 204 });
  assert.deepEqual(effects.map(([name]) => name), ["blogWorkflow"]);
});

test("publication lifecycle forwards the editor version to every entry mutation", async () => {
  const repository = publicationRepository();
  const lifecycle = createContentPublicationLifecycle({ repository });
  const entry = { type: "page_section", slug: "home", version: 7 };

  for (const action of ["save_draft", "publish", "lock", "unlock", "unarchive", "submit_review"]) {
    await lifecycle.execute({ action, entry: { ...entry }, body: { note: "Ready" }, role: "owner", userId: "u1" });
  }
  await lifecycle.archive({ entry: { ...entry }, role: "owner", userId: "u1" });

  const optionsByAction = Object.fromEntries(repository.calls.map((call) => [call[0], call.at(-1)]));
  for (const action of ["saveDraft", "publish", "lock", "unlock", "unarchive", "transition", "archive"]) {
    assert.deepEqual(optionsByAction[action], { expectedVersion: 7 }, `${action} must receive expectedVersion`);
  }
});

test("publication lifecycle maps stale editor versions to HTTP 409", async () => {
  const repository = publicationRepository({
    async saveDraft() {
      return {
        ok: false,
        error: "content_version_conflict",
        expected_version: 3,
        current_version: 4,
      };
    },
  });
  const lifecycle = createContentPublicationLifecycle({ repository });

  const response = await lifecycle.execute({
    action: "save_draft",
    entry: { type: "page_section", slug: "home", version: 3 },
    role: "owner",
    userId: "u1",
  });

  assert.equal(response.status, 409);
  assert.equal(response.result.error, "content_version_conflict");
});
