import assert from "node:assert/strict";
import test from "node:test";

import { shouldReplaceCandidate } from "../tools/optimize-site-images.mjs";

test("image optimizer accepts only meaningful, high-quality byte savings", () => {
  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 80_000,
    ssimDb: 18.4,
  }), true);

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 99_000,
    ssimDb: 24,
  }), false, "sub-2% savings do not justify generation loss");

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 80_000,
    ssimDb: 17.9,
  }), false, "low-SSIM candidates retain the source");

  assert.equal(shouldReplaceCandidate({
    originalBytes: 100_000,
    optimizedBytes: 110_000,
    ssimDb: 30,
  }), false, "larger candidates retain the source");
});
