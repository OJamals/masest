import assert from "node:assert/strict";
import test from "node:test";

import { waitForHttpServer } from "../tools/test-http-server.mjs";

test("waitForHttpServer drains every response before accepting readiness", async () => {
  const drained = [];
  const responses = [
    { ok: false, arrayBuffer: async () => { drained.push("retry"); } },
    { ok: true, arrayBuffer: async () => { drained.push("ready"); } },
  ];
  const sleeps = [];

  await waitForHttpServer("http://127.0.0.1:4333/admin.html", {
    attempts: 2,
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (delayMs) => { sleeps.push(delayMs); },
  });

  assert.deepEqual(drained, ["retry", "ready"]);
  assert.deepEqual(sleeps, [125]);
});

test("waitForHttpServer retries fetch and body-read failures before failing closed", async () => {
  let calls = 0;
  const sleeps = [];

  await assert.rejects(
    waitForHttpServer("http://127.0.0.1:4333/admin.html", {
      attempts: 3,
      delayMs: 10,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection refused");
        return { ok: true, arrayBuffer: async () => { throw new Error("truncated body"); } };
      },
      sleepImpl: async (delayMs) => { sleeps.push(delayMs); },
    }),
    /static server did not start/,
  );

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 10]);
});
