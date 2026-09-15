import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import marketingWorker from '../workers/marketing-email/src/index.js';

const newsletters = readFileSync(new URL('../functions/api/admin/newsletters.js', import.meta.url), 'utf8');
const blog = readFileSync(new URL('../functions/api/admin/blog-newsletter.js', import.meta.url), 'utf8');
const offers = readFileSync(new URL('../functions/api/admin/offers.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../workers/marketing-email/src/index.js', import.meta.url), 'utf8');

test('marketing worker owns six-hour SES suppression reconciliation', () => {
  assert.match(worker, /import \{ syncSesSuppressions \} from ['"]\.\.\/\.\.\/\.\.\/functions\/_lib\/ses-email\.js['"]/);
  assert.match(worker, /export async function runMarketingSchedule/);
  assert.match(worker, /controller\?\.cron === '0 \*\/6 \* \* \*'[\s\S]+await syncSuppressions\(env, createClient\(env\)\)/);
  assert.match(worker, /async scheduled\(controller, env\) \{[\s\S]+await runMarketingSchedule\(controller, env\)/);
});

test('marketing worker exposes only health and SES event ingress', async () => {
  const health = await marketingWorker.fetch(new Request('https://worker.test/health'), {});
  const removed = await marketingWorker.fetch(new Request('https://worker.test/v1/emailoctopus/events'), {});
  const ses = await marketingWorker.fetch(new Request('https://worker.test/v1/ses/events'), {});
  assert.equal(health.status, 200);
  assert.equal(removed.status, 404);
  assert.equal(ses.status, 405);
});

test('Pages fanout endpoints leave SES suppression sync to the worker', () => {
  for (const source of [newsletters, blog, offers]) {
    assert.doesNotMatch(source, /syncSesSuppressions/);
  }
});
