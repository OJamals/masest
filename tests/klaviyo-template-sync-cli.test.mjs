import assert from 'node:assert/strict';
import test from 'node:test';

import {
  klaviyoTemplateContentHash,
  parseKlaviyoTemplateSyncArgs,
} from '../tools/sync-klaviyo-marketing-templates.mjs';

test('Klaviyo template sync CLI defaults to read-only proof planning', () => {
  assert.deepEqual(parseKlaviyoTemplateSyncArgs([]), {
    apply: false,
    bindings: '',
    envFile: '.dev.vars',
    help: false,
    out: '',
    series: 'proof',
  });
});

test('Klaviyo template sync CLI requires an explicit apply flag for writes', () => {
  const args = parseKlaviyoTemplateSyncArgs([
    '--series=nurture',
    '--bindings=/tmp/bindings.json',
    '--env-file=/tmp/provider.env',
    '--out=/tmp/result.json',
    '--apply',
  ]);
  assert.equal(args.apply, true);
  assert.equal(args.series, 'nurture');
  assert.equal(args.bindings, '/tmp/bindings.json');
  assert.equal(args.envFile, '/tmp/provider.env');
  assert.equal(args.out, '/tmp/result.json');
  assert.throws(() => parseKlaviyoTemplateSyncArgs(['--series=send']), /unknown_klaviyo_template_series/);
  assert.throws(() => parseKlaviyoTemplateSyncArgs(['--execute']), /unknown_klaviyo_template_sync_argument/);
});

test('template content hash covers HTML, plain text, subject, and preview text', () => {
  const base = {
    html: '<p>Hello</p>',
    text: 'Hello',
    subject: 'Subject',
    previewText: 'Preview',
  };
  assert.match(klaviyoTemplateContentHash(base), /^[a-f0-9]{64}$/);
  assert.notEqual(
    klaviyoTemplateContentHash(base),
    klaviyoTemplateContentHash({ ...base, text: 'Changed' }),
  );
  assert.notEqual(
    klaviyoTemplateContentHash(base),
    klaviyoTemplateContentHash({ ...base, subject: 'Changed' }),
  );
  assert.notEqual(
    klaviyoTemplateContentHash(base),
    klaviyoTemplateContentHash({ ...base, previewText: 'Changed' }),
  );
});
