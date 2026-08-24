import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  industryDiscoveryCtaFilter,
  industryDiscoveryCtaHref,
  industryDiscoveryMatches,
  marineProductMatches,
  prioritizeMarineProductCards,
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

test('industry discovery gives buyer role CTA precedence for combined filters', () => {
  assert.equal(
    industryDiscoveryCtaFilter({ role: 'ehs-compliance', job: 'fleet-wash' }),
    'role',
  );
  assert.equal(industryDiscoveryCtaFilter({ job: 'fleet-wash' }), 'job');
  assert.equal(industryDiscoveryCtaFilter({}), '');
});

test('marine job spotlight matches products without hiding the rest of the line', () => {
  assert.equal(marineProductMatches('scale-rust marine-hvac', 'all'), true);
  assert.equal(marineProductMatches('scale-rust marine-hvac', 'scale-rust'), true);
  assert.equal(marineProductMatches('scale-rust marine-hvac', 'grease-soot'), false);
  assert.equal(marineProductMatches('', 'scale-rust'), false);
});

test('marine job selector moves matching products first without hiding or mutating cards', () => {
  const cards = [
    { name: 'Scale Buster', dataset: { marineJobs: 'scale-rust' } },
    { name: 'SeaVap Coil Kleener', dataset: { marineJobs: 'scale-rust' } },
    { name: 'Sea Drain Kleener', dataset: { marineJobs: 'drains' } },
    { name: 'MultiWash', dataset: { marineJobs: 'wash-wax' } },
    { name: 'Marine Degreaser', dataset: { marineJobs: 'grease-soot' } },
    { name: 'AlumiBrite', dataset: { marineJobs: 'aluminum' } },
    { name: 'Marine Wash & Wax', dataset: { marineJobs: 'wash-wax' } },
    { name: 'Marine Antimicrobial', dataset: { marineJobs: 'antimicrobial' } },
  ];
  const originalOrder = cards.map((card) => card.name);

  assert.deepEqual(
    prioritizeMarineProductCards(cards, 'grease-soot').map((card) => card.name),
    [
      'Marine Degreaser',
      'Scale Buster',
      'SeaVap Coil Kleener',
      'Sea Drain Kleener',
      'MultiWash',
      'AlumiBrite',
      'Marine Wash & Wax',
      'Marine Antimicrobial',
    ],
  );
  assert.deepEqual(
    prioritizeMarineProductCards(cards, 'wash-wax').map((card) => card.name),
    [
      'MultiWash',
      'Marine Wash & Wax',
      'Scale Buster',
      'SeaVap Coil Kleener',
      'Sea Drain Kleener',
      'Marine Degreaser',
      'AlumiBrite',
      'Marine Antimicrobial',
    ],
  );
  assert.deepEqual(
    prioritizeMarineProductCards(cards, 'all').map((card) => card.name),
    originalOrder,
  );
  assert.deepEqual(cards.map((card) => card.name), originalOrder);
});

test('shared main initializes industry discovery from the engagement module', () => {
  const main = read('js/main.js');
  assert.match(main, /import \{[^}]*initIndustryDiscovery[^}]*\} from "\.\/main\/engagement\.js/);
  assert.match(main, /initIndustryDiscovery\(\);/);
  assert.match(main, /initMarineProductSelector\(\);/);
});
