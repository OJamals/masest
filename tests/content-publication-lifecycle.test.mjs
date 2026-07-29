import assert from "node:assert/strict";
import test from "node:test";
import { createContentPublicationLifecycle } from "../functions/_lib/content.js";

function publicationRepository(overrides = {}) {
  const calls = [];
  return {
    calls,
    async saveDraft(entry, userId) {
      calls.push(["saveDraft", entry, userId]);
      return { ok: true, entry: { ...entry, status: "draft" } };
    },
    async publish(entry, userId) {
      calls.push(["publish", entry, userId]);
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
    async lock(entry, userId) {
      calls.push(["lock", entry, userId]);
      return { ok: true, entry };
    },
    async unlock(entry, userId, options) {
      calls.push(["unlock", entry, userId, options]);
      return { ok: true, entry };
    },
    async unarchive(entry, userId) {
      calls.push(["unarchive", entry, userId]);
      return { ok: true, entry: { ...entry, status: "draft" } };
    },
    async transition(entry, userId, status, note) {
      calls.push(["transition", entry, userId, status, note]);
      return { ok: true, entry: { ...entry, status } };
    },
    async archive(entry, userId) {
      calls.push(["archive", entry, userId]);
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

test("publication lifecycle publishes and records rebuild outcomes", async () => {
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
  assert.deepEqual(response.result.publish_hook, { ok: true, status: 202 });
  assert.deepEqual(response.result.blog_workflow, { ok: true, status: 204 });
  assert.deepEqual(effects.map(([name]) => name), ["publishHook", "blogWorkflow"]);
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
