import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cached } from "../functions/_lib/cache.js";

test("cached computes live when no KV binding is present", async () => {
  let calls = 0;
  const value = await cached({}, "k", 60, async () => {
    calls++;
    return { n: 1 };
  });
  assert.deepEqual(value, { n: 1 });
  assert.equal(calls, 1);
});

test("cached serves the stored value on a hit without recomputing", async () => {
  const store = new Map();
  const env = {
    RATE_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, v); },
    },
  };
  let calls = 0;
  const compute = async () => { calls++; return { n: calls }; };
  const first = await cached(env, "k", 60, compute);
  const second = await cached(env, "k", 60, compute);
  assert.deepEqual(first, { n: 1 });
  assert.deepEqual(second, { n: 1 }); // served from cache, not recomputed
  assert.equal(calls, 1);
});

test("cached falls back to live compute when KV throws", async () => {
  const env = {
    RATE_KV: {
      get: async () => { throw new Error("kv down"); },
      put: async () => { throw new Error("kv down"); },
    },
  };
  let calls = 0;
  const value = await cached(env, "k", 60, async () => {
    calls++;
    return { ok: true };
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 1);
});

test("stats and traffic endpoints wrap their compute in the read-through cache", () => {
  const root = new URL("../", import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), "utf8");
  for (const f of ["functions/api/admin/stats.js", "functions/api/admin/traffic.js"]) {
    const src = read(f);
    assert.match(src, /from ['"]\.\.\/\.\.\/_lib\/cache\.js['"]/, `${f} should import the cache helper`);
    assert.match(src, /cached\(/, `${f} should wrap its compute in cached()`);
  }
});
