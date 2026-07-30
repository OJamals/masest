import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requestDetailsHtml } from "../js/admin/quotes.js";
import { QUOTE_TASK_DETAILS } from "../js/quote-task-details.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const ADMIN_QUOTES = read("../functions/api/admin/quotes.js");
const QUOTE_LEADS = read("../functions/_lib/quote-leads.js");
const ADMIN_STATS = read("../functions/api/admin/stats.js");
const QUOTE_INTAKE = read("../functions/api/quote.js");
const ADMIN_JS = read("../js/admin.js");
const QUOTES_JS = read("../js/admin/quotes.js"); // quotes pipeline tab moved in #36
const ADMIN_HTML = read("../admin.html");
const QUOTE_SCHEMA = read("../supabase/schema-quotes.sql");

test("quote schema supports CRM pipeline fields", () => {
  assert.match(QUOTE_SCHEMA, /add column if not exists priority\s+text/i);
  assert.match(QUOTE_SCHEMA, /add column if not exists next_step\s+text/i);
  assert.match(QUOTE_SCHEMA, /add column if not exists due_at\s+timestamptz/i);
  assert.match(QUOTE_SCHEMA, /add column if not exists lead_score\s+integer/i);
  assert.match(QUOTE_SCHEMA, /add column if not exists assigned_to\s+text/i);
  assert.match(QUOTE_SCHEMA, /add column if not exists assigned_at\s+timestamptz/i);
  assert.match(QUOTE_SCHEMA, /quotes_status_priority_due_idx/i);
});

test("public quote intake assigns score and default priority", () => {
  assert.match(QUOTE_INTAKE, /function\s+scoreLead/);
  assert.match(QUOTE_INTAKE, /function\s+priorityForScore/);
  assert.match(QUOTE_INTAKE, /lead_score:\s*leadScore/);
  assert.match(QUOTE_INTAKE, /priority:\s*priorityForScore\(leadScore\)/);
});

test("public sample intake defaults to the Sample / Audit CRM stage", () => {
  assert.match(QUOTE_INTAKE, /function\s+pipelineStageForType/);
  assert.match(QUOTE_INTAKE, /type\s*===\s*'sample'\s*\?\s*'sample_audit'\s*:\s*'new'/);
  assert.match(QUOTE_INTAKE, /pipeline_stage:\s*pipelineStage/);
  assert.match(QUOTE_INTAKE, /next_step:\s*nextStep/);
  assert.match(QUOTE_INTAKE, /Confirm sample fit, ship-to address, and trial follow-up\./);
  assert.match(QUOTE_INTAKE, /fields\.samples/, "sample choices should contribute to lead scoring and email display");
});

test("admin quotes API reads and updates pipeline fields", () => {
  assert.match(ADMIN_QUOTES, /priority,next_step,due_at,lead_score/);
  assert.match(ADMIN_QUOTES, /assigned_to,assigned_at/);
  assert.match(QUOTE_LEADS, /PRIORITIES\s*=\s*\[/);
  assert.match(QUOTE_LEADS, /changes\.priority/);
  assert.match(QUOTE_LEADS, /changes\.assigned_to/);
  assert.match(QUOTE_LEADS, /assigned_at:\s*assignedTo\s*\?\s*now\.toISOString\(\)\s*:\s*null/);
  assert.match(QUOTE_LEADS, /changes\.next_step/);
  assert.match(QUOTE_LEADS, /changes\.due_at/);
});

test("admin quote inbox supports lead owner assignment", () => {
  assert.match(ADMIN_HTML, /id="qOwner"/);
  assert.match(QUOTES_JS, /const ownerFilter = \$\('qOwner'\)\?\.value/);
  assert.match(QUOTES_JS, /ownerMatch/);
  // S3: owner editing moved off the list rows into the deal drawer.
  assert.match(QUOTES_JS, /data-d-owner/);
  assert.match(QUOTES_JS, /assigned_to:\s*v\('\[data-d-owner\]'\)/);
  assert.match(QUOTES_JS, /quote\.assigned_to/);
});

test("admin quote inbox and drawer surface shared request details", () => {
  assert.match(QUOTES_JS, /function\s+requestDetailsHtml/);
  assert.match(QUOTES_JS, /payloadValues\(quote\.payload\?\.\[key\]\)/);
  assert.match(QUOTES_JS, /quote-request-summary/);
  assert.match(QUOTES_JS, /QUOTE_TASK_DETAILS\.map/);
  assert.deepEqual(
    QUOTE_TASK_DETAILS.map(({ label }) => label),
    [
      "Current chemical",
      "Current dilution",
      "Labor per completed task",
      "Water per completed task",
      "Downtime per completed task",
      "Disposal per completed task",
      "Asset life context",
      "Wastewater route",
      "Reopening / return-to-service criteria",
    ],
  );
  assert.match(QUOTES_JS, /requestDetailsHtml\(quote\)/, "list rows should render request payload details");
  assert.match(QUOTES_JS, /requestDetailsHtml\(q\)/, "drawer details should render request payload details");
  assert.match(ADMIN_HTML, /\.quote-request-summary/, "request summary should have explicit admin styling");
  assert.doesNotMatch(QUOTES_JS, /sampleDetailsHtml/, "sample-only renderer should be removed");

  const html = requestDetailsHtml({
    payload: {
      samples: ["VertKleen CR", "VertKleen HCR"],
      current_chemical: "<script>alert(1)</script>",
      wastewater_route: "Contained and recovered",
      reopening_criteria: "Supervisor release",
    },
  });
  assert.match(html, /VertKleen CR, VertKleen HCR/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Contained and recovered/);
  assert.match(html, /Supervisor release/);
});

test("admin quotes API can send a lead follow-up email", () => {
  assert.match(ADMIN_QUOTES, /action\s*===\s*'followup'/);
  assert.match(ADMIN_QUOTES, /leadLifecycle\.followUp\(/);
  assert.match(ADMIN_QUOTES, /sendEmail/);
  assert.match(ADMIN_QUOTES, /emailLayout/);
  assert.match(QUOTE_LEADS, /\.from\('quotes'\)[\s\S]*\.select\('id,name,email,company,status,priority,next_step,due_at,notes'\)/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup'/);
  assert.match(QUOTE_LEADS, /next_step:\s*'Follow-up sent'/);
});

test("admin quote follow-up can hand off to buyer message thread", () => {
  assert.match(ADMIN_QUOTES, /async function companyIdForQuote/);
  assert.match(ADMIN_QUOTES, /sb\.auth\.admin\.listUsers/);
  assert.match(ADMIN_QUOTES, /\.from\('messages'\)\.insert/);
  assert.match(ADMIN_QUOTES, /sender_role:\s*'staff'/);
  assert.match(ADMIN_QUOTES, /read_by_user:\s*false/);
  assert.match(ADMIN_QUOTES, /\.from\('notifications'\)\.insert/);
  assert.match(ADMIN_QUOTES, /Quote follow-up posted/);
  assert.match(ADMIN_QUOTES, /dashboard\.html#messages/);
});

test("admin quotes API sweeps stale due leads with email and notes", () => {
  assert.match(ADMIN_QUOTES, /action\s*===\s*'sweep_due'/);
  assert.match(ADMIN_QUOTES, /\.sweepDue\(/);
  assert.match(QUOTE_LEADS, /\.from\('quotes'\)[\s\S]*\.lte\('due_at',\s*nowIso\)/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup_reminder'/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup_alert'/);
  assert.match(ADMIN_QUOTES, /logEmailEvent/);
  assert.match(ADMIN_QUOTES, /resend_not_configured|no_recipients/);
  assert.match(QUOTE_LEADS, /Automated due follow-up/);
  assert.match(QUOTE_LEADS, /Automated reminder sent/);
  assert.match(ADMIN_QUOTES, /x-quote-crm-secret/i);
});

test("admin quote inbox exposes pipeline controls", () => {
  assert.match(ADMIN_HTML, /id="qPriority"/);
  assert.match(ADMIN_HTML, /id="qDue"/);
  // S3: rows collapsed to summary + stage select + Open deal; the drawer is the
  // single editing surface for priority / next step / due date / snooze / follow-up.
  assert.match(QUOTES_JS, /data-d-priority/);
  assert.match(QUOTES_JS, /data-d-next/);
  assert.match(QUOTES_JS, /data-d-due/);
  assert.match(QUOTES_JS, /const dueFilter = \$\('qDue'\)\?\.value \|\| ''/);
  assert.match(QUOTES_JS, /dueFilter === 'overdue'/);
  assert.match(QUOTES_JS, /dueFilter === 'upcoming'/);
  assert.match(QUOTES_JS, /dueFilter === 'unscheduled'/);
  assert.match(QUOTES_JS, /priority:\s*v\('\[data-d-priority\]'\)/);
  assert.match(QUOTES_JS, /next_step:\s*v\('\[data-d-next\]'\)/);
  assert.match(QUOTES_JS, /due_at:\s*v\('\[data-d-due\]'\)/);
  assert.match(QUOTES_JS, /data-drawer-followup/);
  assert.match(QUOTES_JS, /action:\s*'followup'/);
  assert.match(QUOTES_JS, /function quoteDueInDays/);
  assert.match(QUOTES_JS, /data-drawer-snooze/);
  assert.match(QUOTES_JS, /due_at:\s*quoteDueInDays\(2\)/);
  assert.match(QUOTES_JS, /next_step:\s*'Snoozed for two days'/);
  // List rows keep only the immediate stage move + drawer door.
  assert.match(QUOTES_JS, /data-quote-stage/);
  assert.match(QUOTES_JS, /data-open-quote/);
  assert.doesNotMatch(QUOTES_JS, /data-save-quote/);
  assert.doesNotMatch(QUOTES_JS, /data-quote-notes/);
});

test("admin overview surfaces due quote follow-ups", () => {
  assert.match(ADMIN_STATS, /quotes_due/);
  assert.match(ADMIN_STATS, /count\('quotes'.*\.lte\('due_at'/s);
  assert.match(ADMIN_STATS, /status',\s*'closed'\)/);
  assert.match(ADMIN_JS, /stats\.quotes_due\?\.overdue/);
  assert.match(ADMIN_JS, /Quote follow-ups/);
});
