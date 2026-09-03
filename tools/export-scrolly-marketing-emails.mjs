#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  renderAllNurtureFlowEmails,
  renderAllScrollyMarketingEmails,
} from '../functions/_lib/scrolly-marketing-emails.js';

const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const seriesArg = process.argv.find((arg) => arg.startsWith('--series='));
const series = seriesArg ? seriesArg.slice('--series='.length) : 'proof';
if (!['proof', 'nurture'].includes(series)) throw new Error('unknown_marketing_email_series');
const defaultDir = series === 'nurture' ? 'dist/ses-nurture-series' : 'dist/ses-proof-series';
const outputDir = path.resolve(outputArg ? outputArg.slice('--out='.length) : defaultDir);
const campaigns = series === 'nurture'
  ? renderAllNurtureFlowEmails()
  : renderAllScrollyMarketingEmails();

await mkdir(outputDir, { recursive: true });
for (const campaign of campaigns) {
  const prefix = String(campaign.sequence ?? campaign.flowSlot).padStart(2, '0');
  await Promise.all([
    writeFile(path.join(outputDir, `${prefix}-${campaign.id}.html`), campaign.html),
    writeFile(path.join(outputDir, `${prefix}-${campaign.id}.txt`), campaign.text),
  ]);
}
await writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(campaigns.map(({ html, text, ...metadata }) => metadata), null, 2)}\n`,
);

process.stdout.write(`Exported ${campaigns.length} SES ${series}-series emails to ${outputDir}\n`);
