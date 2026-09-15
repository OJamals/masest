import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_EVENT_TYPES,
  evaluateSesProductionSnapshot,
} from '../tools/verify-ses-production.mjs';

const topicArn = 'arn:aws:sns:us-east-1:791359098991:masest-ses-events';
const endpoint = 'https://masest-marketing-email.jolly-credit-0ea1.workers.dev/v1/ses/events';

function healthySnapshot() {
  return {
    caller: { Account: '791359098991' },
    account: {
      ProductionAccessEnabled: true,
      SendingEnabled: true,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 50_000, MaxSendRate: 14, SentLast24Hours: 0 },
    },
    identity: {
      VerifiedForSendingStatus: true,
      VerificationStatus: 'SUCCESS',
      DkimAttributes: { Status: 'SUCCESS' },
      MailFromAttributes: {
        MailFromDomain: 'bounce.marketing.masest.co',
        MailFromDomainStatus: 'SUCCESS',
        BehaviorOnMxFailure: 'REJECT_MESSAGE',
      },
    },
    configurationSet: {
      SendingOptions: { SendingEnabled: true },
      ReputationOptions: { ReputationMetricsEnabled: true },
      SuppressionOptions: { SuppressedReasons: ['BOUNCE', 'COMPLAINT'] },
    },
    eventDestinations: [{
      Name: 'ses-lifecycle',
      Enabled: true,
      MatchingEventTypes: [...REQUIRED_EVENT_TYPES],
      SnsDestination: { TopicArn: topicArn },
    }],
    contactList: {
      Topics: [{ TopicName: 'marketing', DefaultSubscriptionStatus: 'OPT_OUT' }],
    },
    topic: {
      Attributes: {
        TopicArn: topicArn,
        Policy: JSON.stringify({ Statement: [
          {
            Sid: 'AccountAdministration',
            Principal: { AWS: 'arn:aws:iam::791359098991:root' },
          },
          {
            Sid: 'AllowSesConfigurationSetPublish',
            Principal: { Service: 'ses.amazonaws.com' },
            Action: 'SNS:Publish',
            Resource: topicArn,
            Condition: { StringEquals: {
              'AWS:SourceAccount': '791359098991',
              'AWS:SourceArn': 'arn:aws:ses:us-east-1:791359098991:configuration-set/masest-marketing',
            } },
          },
        ] }),
      },
    },
    subscriptions: {
      Subscriptions: [{ Protocol: 'https', Endpoint: endpoint, SubscriptionArn: 'arn:confirmed' }],
    },
    worker: { batchSize: 10, concurrency: 4, continuationDelaySeconds: 1 },
    deployedWorker: {
      versionId: '7d457e90-5b54-45e1-b1f9-b456e819f94a',
      batchSize: 10,
      concurrency: 4,
      continuationDelaySeconds: 1,
      queueName: 'masest-marketing-email',
    },
  };
}

test('production verifier accepts complete SES sending and SNS routing apparatus', () => {
  const result = evaluateSesProductionSnapshot(healthySnapshot());
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.quota.maxSendRate, 14);
  assert.equal(result.recommendedConcurrency, 11);
});

test('production verifier fails closed when active Worker cannot be proved or drifts', () => {
  const missing = healthySnapshot();
  delete missing.deployedWorker;
  assert.ok(evaluateSesProductionSnapshot(missing).failures.includes('worker_deployment_unverified'));

  const drifted = healthySnapshot();
  drifted.deployedWorker.batchSize = 1;
  drifted.deployedWorker.queueName = 'wrong-queue';
  const failures = evaluateSesProductionSnapshot(drifted).failures;
  assert.ok(failures.includes('worker_deployment_drift'));
  assert.ok(failures.includes('worker_queue_binding_drift'));
});

test('production verifier fails closed on sandbox, routing drift, and unsafe concurrency', () => {
  const snapshot = healthySnapshot();
  snapshot.account.ProductionAccessEnabled = false;
  snapshot.identity.MailFromAttributes.MailFromDomainStatus = 'PENDING';
  snapshot.eventDestinations[0].MatchingEventTypes = ['SEND'];
  snapshot.contactList.Topics[0].DefaultSubscriptionStatus = 'OPT_IN';
  snapshot.subscriptions.Subscriptions[0].SubscriptionArn = 'PendingConfirmation';
  snapshot.worker.concurrency = 20;

  const result = evaluateSesProductionSnapshot(snapshot);
  assert.equal(result.ok, false);
  for (const failure of [
    'ses_production_access_required',
    'ses_mail_from_not_ready',
    'ses_event_types_incomplete',
    'ses_contact_topic_must_default_opt_out',
    'sns_subscription_not_confirmed',
    'worker_concurrency_exceeds_ses_rate',
  ]) {
    assert.ok(result.failures.includes(failure), `${failure} missing`);
  }
});
