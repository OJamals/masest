import assert from "node:assert/strict";
import test from "node:test";

import {
  STORY_PERFORMANCE_BUDGET,
  STORY_PERFORMANCE_SAMPLE_COUNT,
  evaluateStoryPerformanceSamples,
} from "../tools/story-performance-budget.mjs";

const passingSample = (overrides = {}) => ({
  frameCoverage: 0.75,
  p95BaselineMultiple: 2,
  p99BaselineMultiple: 3,
  longTasks: 0,
  ...overrides,
});

test("story performance policy preserves budgets and requires a majority of three samples", () => {
  assert.deepEqual(STORY_PERFORMANCE_BUDGET, {
    frameCoverage: 2 / 3,
    p95BaselineMultiple: 2.05,
    p99BaselineMultiple: 3.05,
    longTasks: 1,
  });
  assert.equal(STORY_PERFORMANCE_SAMPLE_COUNT, 3);

  const result = evaluateStoryPerformanceSamples([
    passingSample(),
    passingSample(),
    passingSample(),
  ]);

  assert.equal(result.pass, true);
  assert.equal(result.passingSamples, 3);
  assert.equal(result.requiredPassingSamples, 2);
  assert.deepEqual(result.failures, []);
});

test("one cadence outlier is tolerated without weakening any sample budget", () => {
  const result = evaluateStoryPerformanceSamples([
    passingSample(),
    passingSample({ frameCoverage: 0.6, p95BaselineMultiple: 2.4 }),
    passingSample(),
  ]);

  assert.equal(result.pass, true);
  assert.equal(result.passingSamples, 2);
  assert.deepEqual(
    result.sampleResults[1].failures.map(({ metric }) => metric),
    ["frameCoverage", "p95BaselineMultiple"],
  );
});

test("two cadence regressions fail the sample quorum", () => {
  const result = evaluateStoryPerformanceSamples([
    passingSample({ frameCoverage: 0.6 }),
    passingSample({ p99BaselineMultiple: 3.2 }),
    passingSample(),
  ]);

  assert.equal(result.pass, false);
  assert.equal(result.passingSamples, 1);
  assert.deepEqual(result.failures, [{
    metric: "sampleQuorum",
    actual: 1,
    budget: 2,
    direction: "minimum",
  }]);
});

test("missing cadence metrics fail closed", () => {
  const result = evaluateStoryPerformanceSamples([
    passingSample(),
    { longTasks: 0 },
    { longTasks: 0 },
  ]);

  assert.equal(result.pass, false);
  assert.equal(result.passingSamples, 1);
  assert.deepEqual(
    result.sampleResults[1].failures.map(({ metric }) => metric),
    ["frameCoverage", "p95BaselineMultiple", "p99BaselineMultiple"],
  );
});

test("sample count is fixed for comparable gate evidence", () => {
  assert.throws(
    () => evaluateStoryPerformanceSamples([passingSample(), passingSample()]),
    /expected 3 story performance samples/,
  );
});

test("long-task budget fails closed in every sample", () => {
  const result = evaluateStoryPerformanceSamples([
    passingSample(),
    passingSample({ longTasks: 2 }),
    passingSample(),
  ]);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    metric: "longTasks",
    actual: 2,
    budget: 1,
    direction: "maximum",
    sample: 1,
  }]);
});
