import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireDiagnosticSessions,
  collectStoryPerformanceDiagnostic,
  diagnoseStoryPerformanceFailure,
} from "../tools/story-performance-diagnostics.mjs";

test("passing performance evaluation does not run diagnostics", async () => {
  let collected = false;
  const evaluation = { pass: true, passingSamples: 3 };
  const result = await diagnoseStoryPerformanceFailure({
    evaluation,
    collect: async () => {
      collected = true;
      return {};
    },
    log: () => assert.fail("a passing gate must not emit failure diagnostics"),
  });

  assert.equal(collected, false);
  assert.strictEqual(result.evaluation, evaluation);
  assert.equal(result.diagnostic, null);
});

test("failed performance evaluation remains the exact authority after diagnostics", async () => {
  const evaluation = { pass: false, passingSamples: 1, requiredPassingSamples: 2 };
  const messages = [];
  const result = await diagnoseStoryPerformanceFailure({
    evaluation,
    collect: async () => ({ diagnosticVersion: 1, trace: { "CrRendererMain:paint": { count: 2 } } }),
    log: (...parts) => messages.push(parts.join(" ")),
  });

  assert.strictEqual(result.evaluation, evaluation);
  assert.equal(result.evaluation.pass, false);
  assert.equal(result.diagnostic.diagnosticVersion, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^story-performance-diagnostic \{"diagnosticVersion":1,/);
});

test("diagnostic failure is bounded and cannot replace the performance failure", async () => {
  const evaluation = { pass: false, failures: [{ metric: "sampleQuorum" }] };
  const messages = [];
  const result = await diagnoseStoryPerformanceFailure({
    evaluation,
    collect: async () => {
      throw new Error(`diagnostic unavailable ${"x".repeat(500)}`);
    },
    log: (...parts) => messages.push(parts.join(" ")),
  });

  assert.strictEqual(result.evaluation, evaluation);
  assert.equal(result.evaluation.pass, false);
  assert.match(result.diagnostic.error, /^diagnostic unavailable /);
  assert.ok(result.diagnostic.error.length <= 240);
  assert.equal(messages.length, 1);
});

test("diagnostic deadline cannot mask or change the performance failure", async () => {
  const evaluation = { pass: false, failures: [{ metric: "sampleQuorum" }] };
  let active = true;
  let cleaned = false;
  let ticks = 0;
  const result = await diagnoseStoryPerformanceFailure({
    evaluation,
    collect: (signal) => new Promise((_, reject) => {
      const interval = setInterval(() => { ticks += 1; }, 1);
      signal.addEventListener("abort", () => {
        clearInterval(interval);
        active = false;
        cleaned = true;
        reject(signal.reason);
      }, { once: true });
    }),
    deadlineMs: 5,
    log: () => {},
  });

  assert.strictEqual(result.evaluation, evaluation);
  assert.equal(result.evaluation.pass, false);
  assert.equal(result.diagnostic.error, "diagnostic collection timed out");
  assert.equal(active, false);
  assert.equal(cleaned, true);
  const ticksAtReturn = ticks;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ticks, ticksAtReturn, "collection must perform no work after the diagnostic returns");
});

test("partial or late session acquisition closes every acquired CDP session", async () => {
  const controller = new AbortController();
  let pageDetachCount = 0;
  let lateBrowserDetachCount = 0;
  const pageSession = { detach: async () => { pageDetachCount += 1; } };
  const lateBrowserSession = { detach: async () => { lateBrowserDetachCount += 1; } };
  const acquiring = acquireDiagnosticSessions({
    createPageSession: async () => pageSession,
    createBrowserSession: () => new Promise((resolve) => setTimeout(() => resolve(lateBrowserSession), 20)),
  }, controller.signal);
  setTimeout(() => controller.abort(new Error("acquisition deadline")), 5);

  await assert.rejects(acquiring, /acquisition deadline/);
  assert.equal(pageDetachCount, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(lateBrowserDetachCount, 1, "a session that resolves after cancellation must detach itself");
});

test("a pre-aborted collection touches no browser or CDP session", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  let pageTouched = false;

  await assert.rejects(collectStoryPerformanceDiagnostic({
    context() {
      pageTouched = true;
      throw new Error("page must not be inspected");
    },
  }, { signal: controller.signal }), /already cancelled/);
  assert.equal(pageTouched, false);
});

test("pre-aborted acquisition observes a rejected session promise", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already cancelled"));
  let rejected = false;
  const acquisition = acquireDiagnosticSessions({
    createPageSession: () => Promise.reject(new Error("late CDP rejection")).finally(() => { rejected = true; }),
    createBrowserSession: () => assert.fail("browser session must not be requested"),
  }, controller.signal);

  await assert.rejects(acquisition, /already cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rejected, true);
});

test("abort racing an in-flight trace start still ends and detaches both sessions", async () => {
  const controller = new AbortController();
  let resolveStart;
  const startPending = new Promise((resolve) => { resolveStart = resolve; });
  const pageCalls = [];
  let pageDetached = 0;
  let browserDetached = 0;
  const pageSession = {
    on() {},
    async send(method) {
      pageCalls.push(method);
      if (method === "Performance.getMetrics") return { metrics: [] };
      if (method === "Tracing.start") return startPending;
      return {};
    },
    async detach() { pageDetached += 1; },
  };
  const browserSession = {
    async send() { return {}; },
    async detach() { browserDetached += 1; },
  };
  const collecting = collectStoryPerformanceDiagnostic({}, {
    signal: controller.signal,
    timeoutMs: 2000,
    sessionFactories: {
      createPageSession: async () => pageSession,
      createBrowserSession: async () => browserSession,
    },
  });
  while (!pageCalls.includes("Tracing.start")) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort(new Error("cancel during trace start"));

  await assert.rejects(collecting, /cancel during trace start/);
  assert.ok(pageCalls.includes("Tracing.end"));
  assert.equal(pageDetached, 1);
  assert.equal(browserDetached, 1);
  resolveStart();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
