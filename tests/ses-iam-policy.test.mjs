import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = JSON.parse(readFileSync(
  new URL('../aws/iam/masest-ses-runtime-policy.json', import.meta.url),
  'utf8',
));
const topicPolicy = JSON.parse(readFileSync(
  new URL('../aws/sns/masest-ses-events-policy.json', import.meta.url),
  'utf8',
));

test('SES runtime policy locks sender while permitting the verified sandbox recipient identity', () => {
  const send = policy.Statement.find((statement) => statement.Action === 'ses:SendEmail');
  assert.ok(send);
  assert.deepEqual(send.Resource, [
    'arn:aws:ses:us-east-1:791359098991:identity/marketing.masest.co',
    'arn:aws:ses:us-east-1:791359098991:identity/masest.co',
    'arn:aws:ses:us-east-1:791359098991:configuration-set/masest-marketing',
    'arn:aws:ses:us-east-1:791359098991:contact-list/masest-marketing',
  ]);
  assert.equal(send.Condition.StringEquals['ses:FromAddress'], 'news@marketing.masest.co');
  const consent = policy.Statement.find((statement) => statement.Sid === 'SyncCanonicalMarketingConsent');
  assert.deepEqual(consent.Action, ['ses:CreateContact', 'ses:UpdateContact']);
  assert.equal(consent.Resource, 'arn:aws:ses:us-east-1:791359098991:contact-list/masest-marketing');
});

test('SES event topic permits only account administration and the exact SES configuration set', () => {
  const owner = topicPolicy.Statement.find((statement) => statement.Sid === 'AccountAdministration');
  const ses = topicPolicy.Statement.find((statement) => statement.Sid === 'AllowSesConfigurationSetPublish');
  assert.equal(owner.Principal.AWS, 'arn:aws:iam::791359098991:root');
  assert.equal(ses.Principal.Service, 'ses.amazonaws.com');
  assert.equal(ses.Action, 'SNS:Publish');
  assert.equal(ses.Resource, 'arn:aws:sns:us-east-1:791359098991:masest-ses-events');
  assert.deepEqual(ses.Condition.StringEquals, {
    'AWS:SourceAccount': '791359098991',
    'AWS:SourceArn': 'arn:aws:ses:us-east-1:791359098991:configuration-set/masest-marketing',
  });
  assert.equal(topicPolicy.Statement.some((statement) => statement.Principal?.AWS === '*'), false);
});
