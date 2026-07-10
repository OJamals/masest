import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('industry generator separates representative context imagery from field proof', () => {
  const src = read('tools/gen_industries.mjs');
  assert.match(src, /const INDUSTRY_SCENES = \{/);
  assert.match(src, /function introMediaFor\(ind\)/);
  assert.match(src, /Representative \$\{ind\.name\} operating environment\./);
});

test('industry intros use sector-specific representative scenes while proof stays factual', () => {
  const dataCenters = read('industries/data-centers.html');
  assert.match(dataCenters, /img\/industries\/samples\/data-centers\.webp/);
  assert.match(dataCenters, /Representative Data Centers operating environment\./);

  const proof = read('proof.html');
  assert.match(proof, /img\/before-after\/moss-after\.webp/);
  assert.doesNotMatch(proof, /Representative .* operating environment/);
});
