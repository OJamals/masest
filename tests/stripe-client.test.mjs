import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import Stripe from "stripe";
import { STRIPE_API_VERSION, createStripeClient } from "../functions/_lib/stripe-client.js";

const root = new URL("../", import.meta.url);

// Judge only what the build would ship: tracked files plus untracked-but-not-ignored ones.
function shippedFunctionFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "functions"],
    { cwd: root, encoding: "utf8" },
  ).split("\n").filter((file) => file.endsWith(".js"));
}

test("the pinned Stripe API version is the one the installed SDK was generated for", () => {
  // Fails after a stripe package upgrade until someone reads the Stripe changelog for the
  // new version and moves STRIPE_API_VERSION on purpose.
  assert.equal(STRIPE_API_VERSION, Stripe.API_VERSION);
});

test("createStripeClient pins that version and the Workers fetch transport explicitly", () => {
  const client = createStripeClient("sk_test_version_probe");
  assert.equal(client.getApiField("version"), STRIPE_API_VERSION);
  // The SDK default currently equals the pin, so only the source shows the pin is explicit.
  const source = readFileSync(new URL("functions/_lib/stripe-client.js", root), "utf8");
  assert.match(source, /apiVersion:\s*STRIPE_API_VERSION/);
  assert.match(source, /httpClient:\s*Stripe\.createFetchHttpClient\(\)/);
});

test("Pages Functions build Stripe clients only through createStripeClient", () => {
  const offenders = shippedFunctionFiles()
    .filter((file) => file !== "functions/_lib/stripe-client.js")
    .filter((file) => /\bnew\s+Stripe\s*\(/.test(readFileSync(new URL(file, root), "utf8")));
  assert.deepEqual(offenders, []);
});
