import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('newsletter signup writes canonical local consent', () => {
  const source = read('functions/api/newsletter.js');
  assert.match(source, /from\s+['"]\.\.\/_lib\/marketing-subscribers\.js['"]/);
  assert.match(source, /setMarketingPreference\(/);
  assert.match(source, /source: properties\.source \|\| 'footer_newsletter'/);
  assert.doesNotMatch(source, /klaviyo/i);
});

test('quote nurture is consent-gated and starts only after durable intake', () => {
  const source = read('functions/api/quote.js');
  assert.match(source, /from\s+['"]\.\.\/_lib\/marketing-nurture\.js['"]/);
  assert.match(source, /if \(marketingConsent\)/);
  const durable = source.indexOf('durable = await persistIntake');
  const consent = source.indexOf('if (marketingConsent)');
  const enroll = source.indexOf('enrollLead(env');
  const response = source.lastIndexOf('return json(durable.duplicate');
  assert.ok(durable > -1 && consent > durable && enroll > consent && response > enroll);
});

test('newsletter.html is wired to shared signup', () => {
  const html = read('newsletter.html');
  assert.match(html, /<input[^>]*type="email"/);
  assert.match(html, /subscribeNewsletter\(/);
  assert.match(html, /js\/main\.js/);
  assert.match(html, /name="company"/);
  assert.match(html, /rel="canonical" href="https:\/\/masest\.co\/newsletter"/);
});

test('sitemap lists newsletter page', () => {
  assert.match(read('sitemap.xml'), /<loc>https:\/\/masest\.co\/newsletter<\/loc>/);
});
