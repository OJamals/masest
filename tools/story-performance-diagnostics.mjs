import { readFile } from "node:fs/promises";
import os from "node:os";

const TRACE_FAMILIES = Object.freeze([
  ["task", /(?:^|::)RunTask$/],
  ["function", /^FunctionCall$/],
  ["style", /^(?:UpdateLayoutTree|RecalculateStyles)$/],
  ["layout", /^Layout$/],
  ["prepaint", /^PrePaint$/],
  ["paint", /^(?:Paint|PaintImage)$/],
  ["raster", /RasterTask/],
  ["composite", /(?:CompositeLayers|Layerize)/],
  ["frame", /(?:DrawFrame|BeginFrame|RequestMainThreadFrame|BeginMainThreadFrame)$/],
  ["gpu", /GPUTask/],
]);

const PERFORMANCE_METRICS = new Set([
  "Frames",
  "LayoutCount",
  "LayoutDuration",
  "RecalcStyleCount",
  "RecalcStyleDuration",
  "ScriptDuration",
  "TaskDuration",
  "JSHeapUsedSize",
]);

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function cpuSnapshot() {
  return os.cpus().map(({ times }) => ({ ...times }));
}

function cpuBusyPercent(before, after) {
  let busy = 0;
  let total = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const first = before[index];
    const last = after[index];
    const idle = last.idle - first.idle;
    const elapsed = Object.keys(last).reduce((sum, key) => sum + last[key] - first[key], 0);
    busy += elapsed - idle;
    total += elapsed;
  }
  return total > 0 ? round((busy / total) * 100, 1) : null;
}

const CGROUP_CPU_FIELDS = new Set([
  "usage_usec",
  "user_usec",
  "system_usec",
  "nr_periods",
  "nr_throttled",
  "throttled_usec",
]);

async function cgroupCpuSnapshot() {
  try {
    const [statText, maxText] = await Promise.all([
      readFile("/sys/fs/cgroup/cpu.stat", "utf8"),
      readFile("/sys/fs/cgroup/cpu.max", "utf8"),
    ]);
    const stat = Object.fromEntries(statText.trim().split("\n").flatMap((line) => {
      const [name, rawValue] = line.trim().split(/\s+/, 2);
      const value = Number(rawValue);
      return CGROUP_CPU_FIELDS.has(name) && Number.isFinite(value) ? [[name, value]] : [];
    }));
    const [quotaRaw, periodRaw] = maxText.trim().split(/\s+/, 2);
    return {
      available: true,
      stat,
      max: {
        quotaUsec: quotaRaw === "max" ? "max" : finite(Number(quotaRaw)),
        periodUsec: finite(Number(periodRaw)),
      },
    };
  } catch {
    return { available: false };
  }
}

function cgroupCpuDelta(before, after) {
  if (!before.available || !after.available) return { available: false };
  return {
    available: true,
    max: after.max,
    statDelta: Object.fromEntries([...CGROUP_CPU_FIELDS].map((name) => [
      name,
      Number.isFinite(before.stat[name]) && Number.isFinite(after.stat[name])
        ? after.stat[name] - before.stat[name]
        : null,
    ])),
  };
}

function metricMap(metrics = []) {
  return new Map(metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after) {
  const first = metricMap(before);
  const last = metricMap(after);
  return Object.fromEntries([...PERFORMANCE_METRICS].map((name) => {
    const start = first.get(name);
    const end = last.get(name);
    return [name, Number.isFinite(start) && Number.isFinite(end) ? round(end - start, 6) : null];
  }));
}

function traceFamily(name) {
  return TRACE_FAMILIES.find(([, pattern]) => pattern.test(name))?.[0] || null;
}

function summarizeTrace(aggregates, threadNames) {
  const families = {};
  for (const aggregate of aggregates.values()) {
    const family = traceFamily(aggregate.name);
    if (!family) continue;
    const thread = threadNames.get(`${aggregate.pid}:${aggregate.tid}`) || "unknown";
    const key = `${thread}:${family}`;
    const current = families[key] || { count: 0, durationMs: 0, maxMs: 0 };
    current.count += aggregate.count;
    current.durationMs += aggregate.durationUs / 1000;
    current.maxMs = Math.max(current.maxMs, aggregate.maxUs / 1000);
    families[key] = current;
  }
  return Object.fromEntries(Object.entries(families)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 40)
    .map(([key, value]) => [key, {
      count: value.count,
      durationMs: round(value.durationMs),
      maxMs: round(value.maxMs),
    }]));
}

function boundedError(error) {
  return String(error?.message || error || "unknown diagnostic error").replace(/\s+/g, " ").slice(0, 240);
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error("diagnostic collection aborted");
}

function withAbort(promise, signal) {
  const observed = Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      callback(value);
    };
    const aborted = () => finish(reject, abortError(signal));
    signal.addEventListener("abort", aborted, { once: true });
    observed.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal.aborted) aborted();
  });
}

async function settleWithin(promise, timeoutMs = 500) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("diagnostic cleanup timed out")), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function optional(send) {
  try {
    return await send();
  } catch {
    return null;
  }
}

async function acquireSession(create, signal) {
  let accepted = false;
  const pending = Promise.resolve().then(create).then(async (session) => {
    if (signal.aborted && !accepted) {
      await settleWithin(session.detach(), 500);
      throw abortError(signal);
    }
    return session;
  });
  const session = await withAbort(pending, signal);
  accepted = true;
  return session;
}

export async function acquireDiagnosticSessions({ createPageSession, createBrowserSession }, signal) {
  let pageSession = null;
  let browserSession = null;
  try {
    pageSession = await acquireSession(createPageSession, signal);
    browserSession = await acquireSession(createBrowserSession, signal);
    return { pageSession, browserSession };
  } catch (error) {
    await settleWithin(pageSession?.detach(), 500);
    await settleWithin(browserSession?.detach(), 500);
    throw error;
  }
}

export async function collectStoryPerformanceDiagnostic(page, {
  durationMs = 3000,
  timeoutMs = 12_000,
  signal: upstreamSignal = null,
  sessionFactories = null,
} = {}) {
  if (upstreamSignal?.aborted) throw abortError(upstreamSignal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("diagnostic collection timed out")), timeoutMs);
  const forwardAbort = () => controller.abort(abortError(upstreamSignal));
  upstreamSignal?.addEventListener("abort", forwardAbort, { once: true });
  const signal = controller.signal;
  let pageSession = null;
  let browserSession = null;
  const aggregates = new Map();
  const threadNames = new Map();
  let matchingTraceEvents = 0;
  let droppedAggregateKeys = 0;
  let traceDataLoss = false;
  let traceComplete = () => {};
  const traceDone = new Promise((resolve) => {
    traceComplete = resolve;
  });
  // Attach a handler immediately so a future protocol failure cannot become an
  // unhandled rejection while the representative scroll is still in progress.
  traceDone.catch(() => {});
  let tracingStarted = false;
  let termination = null;
  const terminateExecution = () => {
    if (!pageSession || termination) return;
    termination = (async () => {
      await settleWithin(pageSession.send("Runtime.evaluate", {
        expression: "globalThis.__masestStoryDiagnosticCancelled = true",
        returnByValue: true,
      }), 250);
      await settleWithin(pageSession.send("Runtime.terminateExecution"), 250);
    })();
  };
  signal.addEventListener("abort", terminateExecution, { once: true });

  try {
    ({ pageSession, browserSession } = await acquireDiagnosticSessions({
      createPageSession: sessionFactories?.createPageSession
        || (() => page.context().newCDPSession(page)),
      createBrowserSession: sessionFactories?.createBrowserSession
        || (() => page.context().browser().newBrowserCDPSession()),
    }, signal));

    pageSession.on("Tracing.dataCollected", ({ value = [] }) => {
      for (const event of value) {
        if (event.ph === "M" && event.name === "thread_name" && event.args?.name) {
          const threadKey = `${event.pid}:${event.tid}`;
          if (threadNames.size < 100 || threadNames.has(threadKey)) {
            threadNames.set(threadKey, String(event.args.name).slice(0, 80));
          }
          continue;
        }
        if (!traceFamily(event.name || "")) continue;
        matchingTraceEvents += 1;
        const key = `${event.pid}:${event.tid}:${event.name}`;
        if (aggregates.size >= 200 && !aggregates.has(key)) {
          droppedAggregateKeys += 1;
          continue;
        }
        const aggregate = aggregates.get(key) || {
          pid: event.pid,
          tid: event.tid,
          name: event.name,
          count: 0,
          durationUs: 0,
          maxUs: 0,
        };
        aggregate.count += 1;
        if (event.ph === "X" && Number.isFinite(event.dur)) {
          aggregate.durationUs += event.dur;
          aggregate.maxUs = Math.max(aggregate.maxUs, event.dur);
        }
        aggregates.set(key, aggregate);
      }
    });
    pageSession.on("Tracing.tracingComplete", (details) => {
      traceDataLoss = details?.dataLossOccurred === true;
      traceComplete();
    });

    const hostBefore = cpuSnapshot();
    const loadBefore = os.loadavg();
    const cgroupBefore = await withAbort(cgroupCpuSnapshot(), signal);
    await withAbort(pageSession.send("Performance.enable", { timeDomain: "timeTicks" }), signal);
    const metricsBefore = await withAbort(pageSession.send("Performance.getMetrics"), signal);
    const browserVersion = await optional(() => withAbort(browserSession.send("Browser.getVersion"), signal));
    const systemInfo = await optional(() => withAbort(browserSession.send("SystemInfo.getInfo"), signal));
    const processBefore = await optional(() => withAbort(browserSession.send("SystemInfo.getProcessInfo"), signal));

    tracingStarted = true;
    await withAbort(pageSession.send("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        recordMode: "recordAsMuchAsPossible",
        traceBufferSizeInKb: 8192,
        includedCategories: [
          "devtools.timeline",
          "disabled-by-default-devtools.timeline",
          "benchmark",
          "cc",
          "gpu",
        ],
      },
    }), signal);
    const expression = `(async () => {
      globalThis.__masestStoryDiagnosticCancelled = false;
      const story = document.getElementById("story");
      const startY = story.offsetTop;
      const endY = startY + story.offsetHeight - innerHeight;
      await new Promise((resolve) => {
        let startedAt = 0;
        function frame(now) {
          if (globalThis.__masestStoryDiagnosticCancelled) {
            delete globalThis.__masestStoryDiagnosticCancelled;
            resolve();
            return;
          }
          if (!startedAt) startedAt = now;
          const progress = Math.min(1, (now - startedAt) / ${JSON.stringify(durationMs)});
          scrollTo(0, startY + (endY - startY) * progress);
          if (progress < 1) requestAnimationFrame(frame);
          else {
            delete globalThis.__masestStoryDiagnosticCancelled;
            resolve();
          }
        }
        requestAnimationFrame(frame);
      });
    })()`;
    await withAbort(pageSession.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }), signal);

    await withAbort(pageSession.send("Tracing.end"), signal);
    await withAbort(traceDone, signal);
    tracingStarted = false;

    const metricsAfter = await withAbort(pageSession.send("Performance.getMetrics"), signal);
    const processAfter = await optional(() => withAbort(browserSession.send("SystemInfo.getProcessInfo"), signal));
    const hostAfter = cpuSnapshot();
    const cgroupAfter = await withAbort(cgroupCpuSnapshot(), signal);
    const processCpuBefore = new Map((processBefore?.processInfo || []).map((item) => [item.id, item.cpuTime]));
    const processes = {};
    for (const item of processAfter?.processInfo || []) {
      const cpuStart = processCpuBefore.get(item.id);
      const entry = processes[item.type] || { count: 0, cpuSeconds: 0 };
      entry.count += 1;
      if (Number.isFinite(cpuStart) && Number.isFinite(item.cpuTime)) entry.cpuSeconds += item.cpuTime - cpuStart;
      processes[item.type] = entry;
    }

    const gpu = systemInfo?.gpu || {};
    return {
      diagnosticVersion: 1,
      durationMs,
      host: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model?.slice(0, 120) || null,
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        loadBefore: loadBefore.map((value) => round(value, 2)),
        loadAfter: os.loadavg().map((value) => round(value, 2)),
        cpuBusyPercent: cpuBusyPercent(hostBefore, hostAfter),
        cgroupCpu: cgroupCpuDelta(cgroupBefore, cgroupAfter),
      },
      browser: {
        product: browserVersion?.product || browser.version(),
        jsVersion: browserVersion?.jsVersion || null,
        userAgent: browserVersion?.userAgent?.slice(0, 180) || null,
      },
      gpu: {
        devices: (gpu.devices || []).slice(0, 4).map((device) => ({
          vendorId: finite(device.vendorId),
          deviceId: finite(device.deviceId),
          vendorString: device.vendorString?.slice(0, 100) || null,
          deviceString: device.deviceString?.slice(0, 120) || null,
        })),
        glRenderer: gpu.auxAttributes?.glRenderer?.slice(0, 160) || null,
        glVendor: gpu.auxAttributes?.glVendor?.slice(0, 120) || null,
        sandboxed: gpu.auxAttributes?.sandboxed ?? null,
      },
      performanceMetricDelta: metricDelta(metricsBefore.metrics, metricsAfter.metrics),
      processes: Object.fromEntries(Object.entries(processes).sort(([left], [right]) => left.localeCompare(right))
        .map(([type, value]) => [type, { count: value.count, cpuSeconds: round(value.cpuSeconds, 4) }])),
      trace: summarizeTrace(aggregates, threadNames),
      traceRetention: {
        bufferKb: 8192,
        maxAggregateKeys: 200,
        aggregateKeys: aggregates.size,
        matchingEvents: matchingTraceEvents,
        droppedAggregateKeys,
        dataLossOccurred: traceDataLoss,
      },
    };
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
    signal.removeEventListener("abort", terminateExecution);
    if (signal.aborted) terminateExecution();
    await termination;
    await Promise.all([
      tracingStarted ? settleWithin(pageSession?.send("Tracing.end"), 250) : null,
      settleWithin(pageSession?.send("Performance.disable"), 250),
    ]);
    await Promise.all([
      settleWithin(pageSession?.detach(), 250),
      settleWithin(browserSession?.detach(), 250),
    ]);
  }
}

export async function diagnoseStoryPerformanceFailure({
  evaluation,
  collect,
  log = console.log,
  deadlineMs = null,
}) {
  if (evaluation?.pass) return { evaluation, diagnostic: null };
  const controller = new AbortController();
  const deadline = Number.isFinite(deadlineMs) && deadlineMs > 0
    ? setTimeout(() => controller.abort(new Error("diagnostic collection timed out")), deadlineMs)
    : null;
  try {
    const diagnostic = await collect(controller.signal);
    log("story-performance-diagnostic", JSON.stringify(diagnostic));
    return { evaluation, diagnostic };
  } catch (error) {
    const diagnostic = { diagnosticVersion: 1, error: boundedError(error) };
    log("story-performance-diagnostic", JSON.stringify(diagnostic));
    return { evaluation, diagnostic };
  } finally {
    clearTimeout(deadline);
  }
}
