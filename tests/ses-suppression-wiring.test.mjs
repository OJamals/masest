import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const newsletters = readFileSync(new URL('../functions/api/admin/newsletters.js', import.meta.url), 'utf8');
const blog = readFileSync(new URL('../functions/api/admin/blog-newsletter.js', import.meta.url), 'utf8');
const offers = readFileSync(new URL('../functions/api/admin/offers.js', import.meta.url), 'utf8');

test('newsletter sweeps refresh SES suppression before draining durable deliveries', () => {
  assert.match(newsletters, /import \{ syncSesSuppressions \} from ['"]\.\.\/\.\.\/_lib\/ses-email\.js['"]/);
  const sweep = newsletters.slice(newsletters.indexOf('async function sweepDue'), newsletters.indexOf('export async function onRequest'));
  assert.ok(sweep.indexOf('await syncSesSuppressions(env, sb)') < sweep.indexOf('await drainDeliveryQueues(env, sb)'));
  assert.match(newsletters, /queueNewsletter\(env, sb, newsletter, \{ scheduled = false, suppressionsSynced = false \} = \{\}\)/);
});

test('blog and offer fanout refresh SES suppression before loading recipients', () => {
  assert.match(blog, /await syncSesSuppressions\(env, sb\)/);
  assert.ok(blog.indexOf('await syncSesSuppressions(env, sb)') < blog.indexOf('await loadMarketingAudience(sb)'));
  assert.match(offers, /await syncSesSuppressions\(env, sb\)/);
  assert.ok(offers.indexOf('await syncSesSuppressions(env, sb)') < offers.indexOf('await memberEmails(sb, companyIds)'));
});
