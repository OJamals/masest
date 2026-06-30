#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const acceptanceEnvGroups = [
  {
    id: "supabase",
    label: "Supabase app data",
    required: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    id: "stripe",
    label: "Stripe live checkout and webhook",
    required: ["APP_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"],
  },
  {
    id: "qbo",
    label: "QuickBooks Online sync",
    required: [
      "QBO_CLIENT_ID",
      "QBO_CLIENT_SECRET",
      "QBO_REDIRECT_URI",
      "QBO_OAUTH_STATE_SECRET",
      "QBO_SYNC_SECRET",
      "QBO_INCOME_ACCOUNT_ID",
      "QBO_ENVIRONMENT",
    ],
  },
  {
    id: "crisp",
    label: "Crisp chat, identity, and webhook",
    required: ["MASEST_CRISP_ID", "CRISP_TOKEN_ID", "CRISP_TOKEN_KEY", "CRISP_IDENTITY_SECRET"],
    oneOf: [["CRISP_WEBHOOK_SECRET", "CRISP_WEBHOOK_KEY"]],
  },
  {
    id: "cms_publish",
    label: "CMS publish trigger",
    required: [],
    oneOf: [["CONTENT_PUBLISH_HOOK_URL", "CF_PAGES_DEPLOY_HOOK_URL"]],
  },
];

export function redactValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "missing";
  return `set:${String(value).length}`;
}

function checkEnvGroup(env, group) {
  const missing = group.required.filter((key) => !String(env[key] || "").trim());
  const values = {};
  for (const key of group.required) values[key] = redactValue(env[key]);

  const missingOneOf = [];
  for (const options of group.oneOf || []) {
    for (const key of options) values[key] = redactValue(env[key]);
    if (!options.some((key) => String(env[key] || "").trim())) {
      missingOneOf.push(options);
    }
  }

  const ok = missing.length === 0 && missingOneOf.length === 0;
  const missingParts = [];
  if (missing.length) missingParts.push(`missing ${missing.join(", ")}`);
  for (const options of missingOneOf) missingParts.push(`missing one of ${options.join(" or ")}`);

  return {
    ok,
    label: group.label,
    details: {
      values,
      required: group.required,
      one_of: group.oneOf || [],
      missing,
      missing_one_of: missingOneOf,
    },
    message: ok ? "configured" : missingParts.join("; "),
  };
}

function check(ok, message, details = {}) {
  return { ok, message, details };
}

export function buildPreflightReport({
  env = process.env,
  git,
  pagesBuild,
  now = new Date().toISOString(),
} = {}) {
  const checks = {};
  const dirtyFiles = Array.isArray(git?.dirtyFiles) ? git.dirtyFiles : [];

  checks.git_branch = check(git?.branch === "main", `branch is ${git?.branch || "unknown"}`, {
    expected: "main",
    actual: git?.branch || null,
  });
  checks.git_clean = check(dirtyFiles.length === 0, dirtyFiles.length ? "worktree has uncommitted or untracked files" : "clean", {
    dirty_files: dirtyFiles,
  });
  checks.git_origin = check(Boolean(git?.head && git?.originHead && git.head === git.originHead), "HEAD matches origin/main", {
    head: git?.head || null,
    origin_head: git?.originHead || null,
  });

  const pagesSkipped = pagesBuild?.skipped === true;
  checks.pages_status = check(
    pagesSkipped || pagesBuild?.status === "built",
    pagesSkipped ? "skipped by operator" : `Pages status is ${pagesBuild?.status || "unknown"}`,
    pagesBuild || {},
  );
  checks.pages_commit = check(
    pagesSkipped || Boolean(git?.head && pagesBuild?.commit && pagesBuild.commit === git.head),
    pagesSkipped ? "skipped by operator" : "latest Pages build commit matches HEAD",
    {
      head: git?.head || null,
      pages_commit: pagesBuild?.commit || null,
    },
  );

  for (const group of acceptanceEnvGroups) {
    checks[`env_${group.id}`] = checkEnvGroup(env, group);
  }

  const blockers = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([id, result]) => `${id}: ${result.message}`);

  return {
    generated_at: now,
    ready: blockers.length === 0,
    mode: "non_mutating_preflight",
    live_mutation_boundary: "stop for explicit operator go/no-go before QA records, CMS publish, Stripe, QBO, or Crisp mutations",
    checks,
    blockers,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return String(result.stdout || "").trim();
}

function collectGit() {
  return {
    head: run("git", ["rev-parse", "HEAD"]),
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    originHead: run("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0] || "",
    dirtyFiles: run("git", ["status", "--short"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function collectPagesBuild({ skipPages = false } = {}) {
  if (skipPages) return { skipped: true };
  try {
    const raw = run("gh", ["api", "repos/OJamals/masest/pages/builds/latest"]);
    const parsed = JSON.parse(raw);
    return {
      status: parsed.status || "unknown",
      commit: parsed.commit || null,
      created_at: parsed.created_at || null,
      updated_at: parsed.updated_at || null,
      duration: parsed.duration || null,
      error: parsed.error?.message || null,
      url: parsed.url || null,
    };
  } catch (error) {
    return {
      status: "unavailable",
      commit: null,
      error: error.message,
    };
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
    output: "",
    skipPages: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--skip-pages") options.skipPages = true;
    else if (arg === "--output") {
      options.output = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildPreflightReport({
    env: process.env,
    git: collectGit(),
    pagesBuild: collectPagesBuild({ skipPages: options.skipPages }),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, json);
  }
  if (options.json) {
    process.stdout.write(json);
  } else {
    const status = report.ready ? "READY" : "BLOCKED";
    process.stdout.write(`Production acceptance preflight: ${status}\n`);
    for (const blocker of report.blockers) process.stdout.write(`- ${blocker}\n`);
    if (options.output) process.stdout.write(`Report: ${options.output}\n`);
  }
  process.exit(report.ready ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
