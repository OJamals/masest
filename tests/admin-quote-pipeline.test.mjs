import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const ADMIN_QUOTES = read("../functions/api/admin/quotes.js");
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

test("admin quotes API reads and updates pipeline fields", () => {
  assert.match(ADMIN_QUOTES, /priority,next_step,due_at,lead_score/);
  assert.match(ADMIN_QUOTES, /assigned_to,assigned_at/);
  assert.match(ADMIN_QUOTES, /PRIORITIES\s*=\s*\[/);
  assert.match(ADMIN_QUOTES, /body\.priority/);
  assert.match(ADMIN_QUOTES, /body\.assigned_to/);
  assert.match(ADMIN_QUOTES, /assigned_at:\s*assignedTo\s*\?\s*new Date\(\)\.toISOString\(\)\s*:\s*null/);
  assert.match(ADMIN_QUOTES, /body\.next_step/);
  assert.match(ADMIN_QUOTES, /body\.due_at/);
});

test("admin quote inbox supports lead owner assignment", () => {
  assert.match(ADMIN_HTML, /id="qOwner"/);
  assert.match(QUOTES_JS, /const ownerFilter = \$\('qOwner'\)\?\.value/);
  assert.match(QUOTES_JS, /ownerMatch/);
  assert.match(QUOTES_JS, /data-quote-owner/);
  assert.match(QUOTES_JS, /assigned_to:\s*box\.querySelector/);
  assert.match(QUOTES_JS, /quote\.assigned_to/);
});

test("admin quotes API can send a lead follow-up email", () => {
  assert.match(ADMIN_QUOTES, /action\s*===\s*'followup'/);
  assert.match(ADMIN_QUOTES, /sendEmail/);
  assert.match(ADMIN_QUOTES, /emailLayout/);
  assert.match(ADMIN_QUOTES, /\.from\('quotes'\)\.select\('id,name,email,company,status,priority,next_step,due_at,notes'\)/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup'/);
  assert.match(ADMIN_QUOTES, /next_step:\s*'Follow-up sent'/);
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
  assert.match(ADMIN_QUOTES, /\.from\('quotes'\)[\s\S]*\.lte\('due_at',\s*nowIso\)/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup_reminder'/);
  assert.match(ADMIN_QUOTES, /category:\s*'lead_followup_alert'/);
  assert.match(ADMIN_QUOTES, /logEmailEvent/);
  assert.match(ADMIN_QUOTES, /resend_not_configured|no_recipients/);
  assert.match(ADMIN_QUOTES, /Automated due follow-up/);
  assert.match(ADMIN_QUOTES, /Automated reminder sent/);
  assert.match(ADMIN_QUOTES, /x-quote-crm-secret/i);
});

test("admin quote inbox exposes pipeline controls", () => {
  assert.match(ADMIN_HTML, /id="qPriority"/);
  assert.match(ADMIN_HTML, /id="qDue"/);
  assert.match(QUOTES_JS, /data-quote-priority/);
  assert.match(QUOTES_JS, /data-quote-next-step/);
  assert.match(QUOTES_JS, /data-quote-due-at/);
  assert.match(QUOTES_JS, /const dueFilter = \$\('qDue'\)\?\.value \|\| ''/);
  assert.match(QUOTES_JS, /dueFilter === 'overdue'/);
  assert.match(QUOTES_JS, /dueFilter === 'upcoming'/);
  assert.match(QUOTES_JS, /dueFilter === 'unscheduled'/);
  assert.match(QUOTES_JS, /priority:\s*box\.querySelector/);
  assert.match(QUOTES_JS, /next_step:\s*box\.querySelector/);
  assert.match(QUOTES_JS, /due_at:\s*box\.querySelector/);
  assert.match(QUOTES_JS, /data-followup/);
  assert.match(QUOTES_JS, /action:\s*'followup'/);
  assert.match(QUOTES_JS, /function quoteDueInDays/);
  assert.match(QUOTES_JS, /data-snooze-quote/);
  assert.match(QUOTES_JS, /due_at:\s*quoteDueInDays\(2\)/);
  assert.match(QUOTES_JS, /next_step:\s*'Snoozed for two days'/);
});

test("admin overview surfaces due quote follow-ups", () => {
  assert.match(ADMIN_STATS, /quotes_due/);
  assert.match(ADMIN_STATS, /count\('quotes'.*\.lte\('due_at'/s);
  assert.match(ADMIN_STATS, /status',\s*'closed'\)/);
  assert.match(ADMIN_JS, /stats\.quotes_due\?\.overdue/);
  assert.match(ADMIN_JS, /Quote follow-ups/);
});
