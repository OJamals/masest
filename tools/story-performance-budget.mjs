export const STORY_PERFORMANCE_BUDGET = Object.freeze({
  frameCoverage: 2 / 3,
  p95BaselineMultiple: 2.05,
  p99BaselineMultiple: 3.05,
  longTasks: 1,
});

export const STORY_PERFORMANCE_SAMPLE_COUNT = 3;

const CADENCE_METRICS = Object.freeze([
  ["frameCoverage", "minimum"],
  ["p95BaselineMultiple", "maximum"],
  ["p99BaselineMultiple", "maximum"],
]);

function cadenceFailures(sample) {
  return CADENCE_METRICS.flatMap(([metric, direction]) => {
    const actual = sample?.[metric];
    const budget = STORY_PERFORMANCE_BUDGET[metric];
    const passes = Number.isFinite(actual)
      && (direction === "minimum" ? actual >= budget : actual <= budget);
    return passes ? [] : [{ metric, actual, budget, direction }];
  });
}

export function evaluateStoryPerformanceSamples(samples) {
  if (!Array.isArray(samples) || samples.length !== STORY_PERFORMANCE_SAMPLE_COUNT) {
    throw new TypeError(`expected ${STORY_PERFORMANCE_SAMPLE_COUNT} story performance samples`);
  }

  const requiredPassingSamples = Math.floor(samples.length / 2) + 1;
  const sampleResults = samples.map((sample, index) => {
    const failures = cadenceFailures(sample);
    return { index, pass: failures.length === 0, failures };
  });
  const passingSamples = sampleResults.filter(({ pass }) => pass).length;
  const failures = [];

  samples.forEach((sample, index) => {
    const actual = sample?.longTasks;
    if (Number.isFinite(actual) && actual <= STORY_PERFORMANCE_BUDGET.longTasks) return;
    failures.push({
      metric: "longTasks",
      actual,
      budget: STORY_PERFORMANCE_BUDGET.longTasks,
      direction: "maximum",
      sample: index,
    });
  });

  if (passingSamples < requiredPassingSamples) {
    failures.push({
      metric: "sampleQuorum",
      actual: passingSamples,
      budget: requiredPassingSamples,
      direction: "minimum",
    });
  }

  return {
    pass: failures.length === 0,
    passingSamples,
    requiredPassingSamples,
    sampleResults,
    failures,
  };
}
