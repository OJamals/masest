#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const acceptanceEnvGroups = [
  {
    id: "supabase",
    label: "Supabase operator data source",
    required: [],
    alternatives: [
      ["SUPABASE_DB_URL"],
      ["CONTENT_DB_URL"],
      ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    ],
  },
  {
    id: "stripe",
    label: "Stripe live checkout and webhook",
    required: ["APP_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
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
  if (String(value).startsWith("cloudflare:")) return `set:${String(value).replace("cloudflare:", "cloudflare-")}`;
  return `set:${String(value).length}`;
}

export function cloudflarePagesEnvPresence(projectConfig = {}, { environment = "production" } = {}) {
  const envVars = projectConfig?.deployment_configs?.[environment]?.env_vars || projectConfig?.env_vars || {};
  return Object.fromEntries(
    Object.entries(envVars)
      .filter(([, meta]) => {
        if (!meta) return false;
        if (meta.type === "secret_text") return true;
        if (meta.type === "plain_text") return String(meta.value || "").trim() !== "";
        return String(meta.value || "").trim() !== "";
      })
      .map(([key, meta]) => [key, `cloudflare:${meta.type || "present"}`]),
  );
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

  let matchedAlternative = null;
  for (const options of group.alternatives || []) {
    for (const key of options) values[key] = redactValue(env[key]);
    if (options.every((key) => String(env[key] || "").trim())) {
      matchedAlternative = options;
    }
  }
  const missingAlternative = (group.alternatives || []).length > 0 && !matchedAlternative;

  const ok = missing.length === 0 && missingOneOf.length === 0 && !missingAlternative;
  const missingParts = [];
  if (missing.length) missingParts.push(`missing ${missing.join(", ")}`);
  for (const options of missingOneOf) missingParts.push(`missing one of ${options.join(" or ")}`);
  if (missingAlternative) {
    missingParts.push(`missing one complete option: ${group.alternatives.map((options) => options.join(" + ")).join("; ")}`);
  }

  return {
    ok,
    label: group.label,
    details: {
      values,
      required: group.required,
      one_of: group.oneOf || [],
      alternatives: group.alternatives || [],
      missing,
      missing_one_of: missingOneOf,
      matched_alternative: matchedAlternative,
    },
    message: ok ? "configured" : missingParts.join("; "),
  };
}

function check(ok, message, details = {}) {
  return { ok, message, details };
}

export function cloudflarePagesBuildFromCheckRuns(head, checkRunsPayload = {}) {
  const runs = Array.isArray(checkRunsPayload?.check_runs) ? checkRunsPayload.check_runs : [];
  const run = runs.find((item) => (
    String(item?.name || "").toLowerCase() === "cloudflare pages"
    && item?.status === "completed"
    && item?.conclusion === "success"
  ));
  if (!run || !head) return null;
  return {
    status: "built",
    commit: head,
    source: "cloudflare_check_run",
    created_at: run.started_at || null,
    updated_at: run.completed_at || null,
    url: run.html_url || null,
  };
}

export function buildPreflightReport({
  env = process.env,
  envSource = { type: "local_process" },
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
    env_source: envSource,
    live_mutation_boundary: "stop for explicit operator go/no-go before QA records, CMS publish, Stripe, QBO, or Crisp mutations",
    checks,
    blockers,
  };
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 1) return null;
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      })
      .filter(Boolean),
  );
}

async function collectCloudflarePagesEnv({
  accountId,
  projectName,
  token,
  environment = "production",
  fetchImpl = fetch,
} = {}) {
  if (!accountId) throw new Error("Missing Cloudflare account id for --cloudflare-env.");
  if (!projectName) throw new Error("Missing Cloudflare Pages project name for --cloudflare-env.");
  if (!token) throw new Error("Missing Cloudflare API token for --cloudflare-env.");

  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message = (body.errors || [])
      .map((error) => error.message || error.code)
      .filter(Boolean)
      .join("; ");
    throw new Error(message || `Cloudflare project lookup failed with HTTP ${response.status}`);
  }
  return {
    env: cloudflarePagesEnvPresence(body.result, { environment }),
    source: {
      type: "cloudflare_pages",
      project: projectName,
      environment,
    },
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

function collectPagesBuild({ skipPages = false, head = "" } = {}) {
  if (skipPages) return { skipped: true };
  let pagesBuild = null;
  try {
    const raw = run("gh", ["api", "repos/OJamals/masest/pages/builds/latest"]);
    const parsed = JSON.parse(raw);
    pagesBuild = {
      status: parsed.status || "unknown",
      commit: parsed.commit || null,
      created_at: parsed.created_at || null,
      updated_at: parsed.updated_at || null,
      duration: parsed.duration || null,
      error: parsed.error?.message || null,
      url: parsed.url || null,
    };
  } catch (error) {
    pagesBuild = {
      status: "unavailable",
      commit: null,
      error: error.message,
    };
  }
  if (head && pagesBuild?.commit !== head) {
    try {
      const raw = run("gh", ["api", `repos/OJamals/masest/commits/${head}/check-runs`]);
      const cloudflareBuild = cloudflarePagesBuildFromCheckRuns(head, JSON.parse(raw));
      if (cloudflareBuild) return { ...cloudflareBuild, fallback_from: pagesBuild };
    } catch {
      return pagesBuild;
    }
  }
  return pagesBuild;
}

function parseArgs(argv) {
  const options = {
    json: false,
    output: "",
    skipPages: false,
    cloudflareEnv: false,
    cloudflareAccountId: "",
    cloudflareProject: "",
    cloudflareEnvironment: "production",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--skip-pages") options.skipPages = true;
    else if (arg === "--cloudflare-env") options.cloudflareEnv = true;
    else if (arg === "--cloudflare-account-id") {
      options.cloudflareAccountId = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--cloudflare-account-id=")) {
      options.cloudflareAccountId = arg.slice("--cloudflare-account-id=".length);
    } else if (arg === "--cloudflare-project") {
      options.cloudflareProject = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--cloudflare-project=")) {
      options.cloudflareProject = arg.slice("--cloudflare-project=".length);
    } else if (arg === "--cloudflare-environment") {
      options.cloudflareEnvironment = argv[index + 1] || "production";
      index += 1;
    } else if (arg.startsWith("--cloudflare-environment=")) {
      options.cloudflareEnvironment = arg.slice("--cloudflare-environment=".length) || "production";
    } else if (arg === "--output") {
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const git = collectGit();
  let env = process.env;
  let envSource = { type: "local_process" };
  if (options.cloudflareEnv) {
    const credentialEnv = {
      ...parseEnvFile(".dev.vars"),
      ...process.env,
    };
    const cloudflare = await collectCloudflarePagesEnv({
      accountId: options.cloudflareAccountId
        || credentialEnv.CLOUDFLARE_ACCOUNT_ID
        || credentialEnv.CF_ACCOUNT_ID,
      projectName: options.cloudflareProject
        || credentialEnv.CLOUDFLARE_PAGES_PROJECT
        || credentialEnv.CF_PAGES_PROJECT
        || "masest-commerce",
      token: credentialEnv.CLOUDFLARE_API_TOKEN || credentialEnv.CF_API_TOKEN,
      environment: options.cloudflareEnvironment,
    });
    env = cloudflare.env;
    envSource = cloudflare.source;
  }
  const report = buildPreflightReport({
    env,
    envSource,
    git,
    pagesBuild: collectPagesBuild({ skipPages: options.skipPages, head: git.head }),
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
