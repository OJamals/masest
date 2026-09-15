import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_EVENT_TYPES = Object.freeze([
  'SEND',
  'REJECT',
  'BOUNCE',
  'COMPLAINT',
  'DELIVERY',
  'DELIVERY_DELAY',
  'RENDERING_FAILURE',
  'SUBSCRIPTION',
]);

const EXPECTED = Object.freeze({
  accountId: '791359098991',
  region: 'us-east-1',
  identity: 'marketing.masest.co',
  mailFromDomain: 'bounce.marketing.masest.co',
  configurationSet: 'masest-marketing',
  contactList: 'masest-marketing',
  contactTopic: 'marketing',
  topicArn: 'arn:aws:sns:us-east-1:791359098991:masest-ses-events',
  endpoint: 'https://masest-marketing-email.jolly-credit-0ea1.workers.dev/v1/ses/events',
});

function includesAll(actual = [], expected = []) {
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

function topicPolicyReady(policyValue) {
  let policy;
  try {
    policy = typeof policyValue === 'string' ? JSON.parse(policyValue) : policyValue;
  } catch {
    return false;
  }
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [];
  const owner = statements.find((statement) => statement.Sid === 'AccountAdministration');
  const publisher = statements.find((statement) => statement.Sid === 'AllowSesConfigurationSetPublish');
  return owner?.Principal?.AWS === `arn:aws:iam::${EXPECTED.accountId}:root`
    && publisher?.Principal?.Service === 'ses.amazonaws.com'
    && publisher?.Action === 'SNS:Publish'
    && publisher?.Resource === EXPECTED.topicArn
    && publisher?.Condition?.StringEquals?.['AWS:SourceAccount'] === EXPECTED.accountId
    && publisher?.Condition?.StringEquals?.['AWS:SourceArn']
      === `arn:aws:ses:${EXPECTED.region}:${EXPECTED.accountId}:configuration-set/${EXPECTED.configurationSet}`;
}

export function evaluateSesProductionSnapshot(snapshot = {}) {
  const failures = [];
  const fail = (condition, code) => { if (!condition) failures.push(code); };
  const maxSendRate = Number(snapshot.account?.SendQuota?.MaxSendRate) || 0;
  const max24HourSend = Number(snapshot.account?.SendQuota?.Max24HourSend) || 0;
  const recommendedConcurrency = Math.max(1, Math.min(25, Math.floor(maxSendRate * 0.8)));

  fail(snapshot.caller?.Account === EXPECTED.accountId, 'aws_account_mismatch');
  fail(snapshot.account?.ProductionAccessEnabled === true, 'ses_production_access_required');
  fail(snapshot.account?.SendingEnabled === true, 'ses_account_sending_disabled');
  fail(snapshot.account?.EnforcementStatus === 'HEALTHY', 'ses_account_not_healthy');
  fail(maxSendRate > 0 && max24HourSend > 0, 'ses_send_quota_unavailable');
  fail(snapshot.identity?.VerifiedForSendingStatus === true
    && snapshot.identity?.VerificationStatus === 'SUCCESS', 'ses_identity_not_verified');
  fail(snapshot.identity?.DkimAttributes?.Status === 'SUCCESS', 'ses_dkim_not_ready');
  fail(snapshot.identity?.MailFromAttributes?.MailFromDomain === EXPECTED.mailFromDomain
    && snapshot.identity?.MailFromAttributes?.MailFromDomainStatus === 'SUCCESS'
    && snapshot.identity?.MailFromAttributes?.BehaviorOnMxFailure === 'REJECT_MESSAGE',
  'ses_mail_from_not_ready');
  fail(snapshot.configurationSet?.SendingOptions?.SendingEnabled === true,
    'ses_configuration_set_sending_disabled');
  fail(snapshot.configurationSet?.ReputationOptions?.ReputationMetricsEnabled === true,
    'ses_reputation_metrics_disabled');
  fail(includesAll(snapshot.configurationSet?.SuppressionOptions?.SuppressedReasons,
    ['BOUNCE', 'COMPLAINT']), 'ses_account_suppression_incomplete');

  const destination = snapshot.eventDestinations?.find(
    (item) => item?.SnsDestination?.TopicArn === EXPECTED.topicArn,
  );
  fail(destination?.Enabled === true && destination?.SnsDestination?.TopicArn === EXPECTED.topicArn,
    'ses_sns_event_destination_missing');
  fail(includesAll(destination?.MatchingEventTypes, REQUIRED_EVENT_TYPES),
    'ses_event_types_incomplete');

  const contactTopic = snapshot.contactList?.Topics?.find(
    (item) => item.TopicName === EXPECTED.contactTopic,
  );
  fail(contactTopic?.DefaultSubscriptionStatus === 'OPT_OUT',
    'ses_contact_topic_must_default_opt_out');
  fail(snapshot.topic?.Attributes?.TopicArn === EXPECTED.topicArn
    && topicPolicyReady(snapshot.topic?.Attributes?.Policy), 'sns_topic_policy_drift');
  const subscription = snapshot.subscriptions?.Subscriptions?.find(
    (item) => item.Protocol === 'https' && item.Endpoint === EXPECTED.endpoint,
  );
  fail(Boolean(subscription) && subscription.SubscriptionArn !== 'PendingConfirmation',
    'sns_subscription_not_confirmed');

  const batchSize = Number(snapshot.worker?.batchSize) || 0;
  const concurrency = Number(snapshot.worker?.concurrency) || 0;
  const continuationDelaySeconds = Number(snapshot.worker?.continuationDelaySeconds) || 0;
  fail(batchSize >= 1 && batchSize <= 500, 'worker_batch_size_invalid');
  fail(concurrency >= 1 && concurrency <= 25, 'worker_concurrency_invalid');
  fail(concurrency <= maxSendRate, 'worker_concurrency_exceeds_ses_rate');
  fail(batchSize >= concurrency, 'worker_batch_smaller_than_concurrency');
  fail(continuationDelaySeconds >= 1 && continuationDelaySeconds <= 60,
    'worker_continuation_delay_invalid');
  const deployedWorker = snapshot.deployedWorker;
  fail(Boolean(deployedWorker?.versionId), 'worker_deployment_unverified');
  fail(Boolean(deployedWorker?.versionId)
    && deployedWorker.batchSize === batchSize
    && deployedWorker.concurrency === concurrency
    && deployedWorker.continuationDelaySeconds === continuationDelaySeconds,
  'worker_deployment_drift');
  fail(deployedWorker?.queueName === 'masest-marketing-email', 'worker_queue_binding_drift');

  return {
    ok: failures.length === 0,
    failures,
    quota: {
      max24HourSend,
      maxSendRate,
      sentLast24Hours: Number(snapshot.account?.SendQuota?.SentLast24Hours) || 0,
    },
    worker: { batchSize, concurrency, continuationDelaySeconds, versionId: deployedWorker?.versionId || null },
    recommendedConcurrency,
  };
}

function aws(profile, service, operation, args = []) {
  const result = spawnSync('aws', [
    '--profile', profile,
    '--region', EXPECTED.region,
    service,
    operation,
    ...args,
    '--output', 'json',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || 'aws_cli_failed').trim().split('\n').at(-1);
    throw new Error(`${service}_${operation}_failed:${message}`);
  }
  return JSON.parse(result.stdout || '{}');
}

function workerSettings() {
  const config = JSON.parse(readFileSync(
    new URL('../workers/marketing-email/wrangler.jsonc', import.meta.url),
    'utf8',
  ));
  return {
    batchSize: Number(config.vars?.MARKETING_DELIVERY_BATCH_SIZE),
    concurrency: Number(config.vars?.MARKETING_DELIVERY_CONCURRENCY),
    continuationDelaySeconds: Number(config.vars?.MARKETING_DELIVERY_CONTINUATION_DELAY_SECONDS),
  };
}

function wrangler(args) {
  const result = spawnSync(
    fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url)),
    args,
    { cwd: fileURLToPath(new URL('../workers/marketing-email/', import.meta.url)), encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || 'wrangler_failed').trim().split('\n').at(-1);
    throw new Error(`wrangler_${args[0]}_failed:${message}`);
  }
  return JSON.parse(result.stdout || '{}');
}

function deployedWorkerSettings() {
  const deployments = wrangler(['deployments', 'list', '--json']);
  const active = [...deployments].sort((a, b) =>
    String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  const versions = active?.versions || [];
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
    throw new Error('worker_deployment_not_single_version');
  }
  const versionId = versions[0].version_id;
  if (!versionId) throw new Error('worker_deployment_unverified');
  const version = wrangler(['versions', 'view', versionId, '--json']);
  if (version.id !== versionId) throw new Error('worker_version_mismatch');
  const bindings = version.resources?.bindings || [];
  const variable = (name) => Number(bindings.find((item) =>
    item.type === 'plain_text' && item.name === name)?.text);
  return {
    versionId,
    batchSize: variable('MARKETING_DELIVERY_BATCH_SIZE'),
    concurrency: variable('MARKETING_DELIVERY_CONCURRENCY'),
    continuationDelaySeconds: variable('MARKETING_DELIVERY_CONTINUATION_DELAY_SECONDS'),
    queueName: bindings.find((item) =>
      item.type === 'queue' && item.name === 'MARKETING_EMAIL_QUEUE')?.queue_name || null,
  };
}

export function loadSesProductionSnapshot(profile = 'masest') {
  return {
    caller: aws(profile, 'sts', 'get-caller-identity'),
    account: aws(profile, 'sesv2', 'get-account'),
    identity: aws(profile, 'sesv2', 'get-email-identity', [
      '--email-identity', EXPECTED.identity,
    ]),
    configurationSet: aws(profile, 'sesv2', 'get-configuration-set', [
      '--configuration-set-name', EXPECTED.configurationSet,
    ]),
    eventDestinations: aws(profile, 'sesv2', 'get-configuration-set-event-destinations', [
      '--configuration-set-name', EXPECTED.configurationSet,
    ]).EventDestinations || [],
    contactList: aws(profile, 'sesv2', 'get-contact-list', [
      '--contact-list-name', EXPECTED.contactList,
    ]),
    topic: aws(profile, 'sns', 'get-topic-attributes', ['--topic-arn', EXPECTED.topicArn]),
    subscriptions: aws(profile, 'sns', 'list-subscriptions-by-topic', [
      '--topic-arn', EXPECTED.topicArn,
    ]),
    worker: workerSettings(),
    deployedWorker: deployedWorkerSettings(),
  };
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name.slice(2)}_required`);
  return value;
}

function main() {
  const profile = argValue('--profile', 'masest');
  const result = evaluateSesProductionSnapshot(loadSesProductionSnapshot(profile));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`SES production: ${result.ok ? 'ready' : 'blocked'}`);
    console.log(`Quota: ${result.quota.max24HourSend}/24h, ${result.quota.maxSendRate}/sec`);
    console.log(`Worker: batch ${result.worker.batchSize}, concurrency ${result.worker.concurrency}, delay ${result.worker.continuationDelaySeconds}s`);
    console.log(`Active Worker version: ${result.worker.versionId || 'unverified'}`);
    console.log(`Warm-up ceiling: ${result.recommendedConcurrency} concurrent sends (80% of current rate, max 25)`);
    for (const failure of result.failures) console.error(`- ${failure}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
