#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncKlaviyoTemplateSet } from '../functions/_lib/klaviyo-template-sync.js';
import {
  renderAllNurtureFlowEmails,
  renderAllScrollyMarketingEmails,
} from '../functions/_lib/scrolly-marketing-emails.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseKlaviyoTemplateSyncArgs(argv) {
  const parsed = {
    apply: false,
    bindings: '',
    envFile: '.dev.vars',
    help: false,
    out: '',
    series: 'proof',
  };
  for (const arg of argv) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg.startsWith('--bindings=')) parsed.bindings = arg.slice('--bindings='.length);
    else if (arg.startsWith('--env-file=')) parsed.envFile = arg.slice('--env-file='.length);
    else if (arg.startsWith('--out=')) parsed.out = arg.slice('--out='.length);
    else if (arg.startsWith('--series=')) parsed.series = arg.slice('--series='.length);
    else throw new Error(`unknown_klaviyo_template_sync_argument:${arg}`);
  }
  if (!['proof', 'nurture', 'all'].includes(parsed.series)) {
    throw new Error(`unknown_klaviyo_template_series:${parsed.series}`);
  }
  return parsed;
}

export function klaviyoTemplateContentHash({
  html = '',
  text = '',
  subject = '',
  previewText = '',
} = {}) {
  return createHash('sha256')
    .update(String(html))
    .update('\0')
    .update(String(text))
    .update('\0')
    .update(String(subject))
    .update('\0')
    .update(String(previewText))
    .digest('hex');
}

function parseEnv(source) {
  const parsed = {};
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

async function environmentFrom(path) {
  let local = {};
  try {
    local = parseEnv(await readFile(resolve(ROOT, path), 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { ...local, ...process.env };
}

function checkedBindings(value) {
  if (!value) return {};
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('klaviyo_flow_bindings_invalid');
  }
  return parsed;
}

async function loadBindings(args, env) {
  if (args.bindings) {
    return checkedBindings(await readFile(resolve(args.bindings), 'utf8'));
  }
  return checkedBindings(env.KLAVIYO_NURTURE_FLOW_BINDINGS_JSON || '');
}

function selectedTemplates(series) {
  if (series === 'proof') return renderAllScrollyMarketingEmails();
  if (series === 'nurture') return renderAllNurtureFlowEmails();
  return [...renderAllScrollyMarketingEmails(), ...renderAllNurtureFlowEmails()];
}

function usage() {
  return [
    'Usage: node tools/sync-klaviyo-marketing-templates.mjs [options]',
    '',
    'Default is read-only provider inspection. No campaign or email is sent.',
    '  --series=proof|nurture|all',
    '  --bindings=/path/to/flow-message-bindings.json',
    '  --env-file=.dev.vars',
    '  --out=/path/to/sync-manifest.json',
    '  --apply  Update templates and bound subject/preheader, then read back and verify',
  ].join('\n');
}

async function main() {
  const args = parseKlaviyoTemplateSyncArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const env = await environmentFrom(args.envFile);
  const bindings = await loadBindings(args, env);
  const templates = selectedTemplates(args.series);
  const result = await syncKlaviyoTemplateSet(env, templates, {
    bindings,
    apply: args.apply,
  });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    series: args.series,
    sendsEmail: false,
    templates: templates.map((template) => ({
      id: template.id,
      templateName: template.templateName,
      ...(template.flowSlot == null ? {} : { flowSlot: template.flowSlot }),
      contentHash: klaviyoTemplateContentHash(template),
    })),
    result,
  };
  const outputPath = resolve(args.out || `dist/klaviyo-${args.series}-template-sync.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${args.apply ? 'Applied' : 'Planned'} Klaviyo ${args.series} templates: ${JSON.stringify(result.counts)}\n`);
  process.stdout.write(`Manifest: ${outputPath}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
