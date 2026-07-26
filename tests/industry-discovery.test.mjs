import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  industryDiscoveryCtaHref,
  industryDiscoveryMatches,
} from '../js/main/engagement.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('industry discovery intersects optional role and job filters', () => {
  const route = {
    roles: 'facility-operations procurement',
    jobs: 'degrease descale',
  };

  assert.equal(industryDiscoveryMatches(route, {}), false);
  assert.equal(industryDiscoveryMatches(route, { role: 'facility-operations' }), true);
  assert.equal(industryDiscoveryMatches(route, { job: 'descale' }), true);
  assert.equal(
    industryDiscoveryMatches(route, { role: 'facility-operations', job: 'descale' }),
    true,
  );
  assert.equal(
    industryDiscoveryMatches(route, { role: 'ehs-compliance', job: 'descale' }),
    false,
  );
  assert.equal(
    industryDiscoveryMatches(route, { role: 'facility-operations', job: 'cip' }),
    false,
  );
});

test('industry discovery switches one prefilled CTA between audit and quote', () => {
  const href = 'contact?industry=Manufacturing&type=audit&message=Asset%3A+press';
  assert.equal(
    industryDiscoveryCtaHref(href, 'quote', 'http://127.0.0.1:4195/industries'),
    '/contact?industry=Manufacturing&type=quote&message=Asset%3A+press',
  );
  assert.equal(
    industryDiscoveryCtaHref(href, 'audit', 'http://127.0.0.1:4195/industries'),
    '/contact?industry=Manufacturing&type=audit&message=Asset%3A+press',
  );
});

test('shared main initializes industry discovery from the engagement module', () => {
  const main = read('js/main.js');
  assert.match(main, /import \{[^}]*initIndustryDiscovery[^}]*\} from "\.\/main\/engagement\.js/);
  assert.match(main, /initIndustryDiscovery\(\);/);
});
