/**
 * Source-contract test: companies.js receives setTab via DI, not a free variable.
 * Mirrors the no-drift style of quote-sweep-cron.test.mjs.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { describe, it } from 'node:test';

const __dir = dirname(fileURLToPath(import.meta.url));
const companiesSrc = readFileSync(join(__dir, '../js/admin/companies.js'), 'utf8');
const adminSrc = readFileSync(join(__dir, '../js/admin.js'), 'utf8');

describe('admin-companies setTab injection contract', () => {
  it('companies.js factory signature destructures setTab', () => {
    // The factory arg-list must include setTab so the call on line ~129 resolves.
    assert.match(
      companiesSrc,
      /export function createCompaniesTab\(\{[^}]*\bsetTab\b/,
      'companies.js createCompaniesTab must destructure setTab in its arg list'
    );
  });

  it('admin.js passes setTab into createCompaniesTab call', () => {
    // The construction site in admin.js must forward the in-scope setTab function.
    assert.match(
      adminSrc,
      /createCompaniesTab\(\{[^}]*\bsetTab\b/,
      'admin.js must pass setTab into createCompaniesTab({ ... })'
    );
  });

  it('companies.js does not define its own local setTab (must come from args)', () => {
    // Strip the factory signature line itself, then check no local definition exists.
    const withoutSignature = companiesSrc.replace(
      /export function createCompaniesTab\([^)]*\)/,
      ''
    );
    assert.doesNotMatch(
      withoutSignature,
      /\bfunction setTab\b|\bconst setTab\b|\blet setTab\b|\bvar setTab\b/,
      'companies.js must not define its own setTab — it must come from injected args'
    );
  });
});
