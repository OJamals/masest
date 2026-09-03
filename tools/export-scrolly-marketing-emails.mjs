#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderAllScrollyMarketingEmails } from '../functions/_lib/scrolly-marketing-emails.js';

const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const outputDir = path.resolve(outputArg ? outputArg.slice('--out='.length) : 'dist/klaviyo-proof-series');
const campaigns = renderAllScrollyMarketingEmails();

await mkdir(outputDir, { recursive: true });
for (const campaign of campaigns) {
  const prefix = String(campaign.sequence).padStart(2, '0');
  await Promise.all([
    writeFile(path.join(outputDir, `${prefix}-${campaign.id}.html`), campaign.html),
    writeFile(path.join(outputDir, `${prefix}-${campaign.id}.txt`), campaign.text),
  ]);
}
await writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(campaigns.map(({ html, text, ...metadata }) => metadata), null, 2)}\n`,
);

process.stdout.write(`Exported ${campaigns.length} Klaviyo proof-series emails to ${outputDir}\n`);
