import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../supabase/migrate-marketing-queue-sns-2026-09-03.sql', import.meta.url),
  'utf8',
);
const sesMigration = readFileSync(
  new URL('../supabase/migrate-ses-marketing-2026-09-03.sql', import.meta.url),
  'utf8',
);
const newsletterSchema = readFileSync(
  new URL('../supabase/schema-newsletters.sql', import.meta.url),
  'utf8',
);

test('marketing Queue migration supports every campaign source and fail-closed leases', () => {
  assert.match(sql, /source_type in \('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test'\)/);
  assert.match(sql, /create or replace function public\.materialize_newsletter_deliveries/);
  const materialize = sql.slice(
    sql.indexOf('create or replace function public.materialize_newsletter_deliveries'),
    sql.indexOf('drop function if exists public.claim_newsletter_deliveries'),
  );
  assert.match(materialize, /p_source_type not in \('newsletter', 'blog_post', 'nurture', 'offer', 'review', 'test'\)/);
  assert.match(sql, /ambiguous_processing_timeout/);
  assert.match(sql, /for update of delivery skip locked/i);
  assert.match(sql, /public\.email_suppressions/);
  assert.match(sql, /recipient\.subscribed = false/);
  assert.doesNotMatch(sql, /or \(delivery\.state = 'processing' and delivery\.lease_expires_at <= now\(\)\)/);
});

test('delivery materialization rejects malformed UUID parents before any send is queued', () => {
  for (const source of [sql, sesMigration, newsletterSchema]) {
    const materialize = source.slice(
      source.indexOf('create or replace function public.materialize_newsletter_deliveries'),
      source.indexOf('drop function if exists public.claim_newsletter_deliveries'),
    );
    assert.match(materialize, /p_source_type in \('newsletter', 'offer'\)/);
    assert.match(materialize, /invalid_delivery_parent_id/);
  }
});

test('marketing Queue migration persists SES lifecycle and consent idempotently', () => {
  assert.match(sql, /provider_status = p_status/);
  assert.match(sql, /provider_event_id = p_event_id/);
  assert.match(sql, /v_next_rank > v_current_rank\s+or\s+\(v_next_rank = v_current_rank/i);
  assert.match(sql, /with delivery_candidate as[\s\S]+v_next_rank > delivery_candidate\.current_rank/i);
  assert.match(sql, /with ranked_email_delivery_events as[\s\S]+update public\.newsletter_deliveries/i);
  assert.match(sql, /create table if not exists public\.marketing_consent_events/);
  assert.match(sql, /create or replace function public\.apply_ses_subscription_event/);
  assert.match(sql, /on conflict \(event_id\) do nothing/);
  assert.match(sql, /update public\.profiles profile[\s\S]+marketing_email_enabled = p_enabled/);
  assert.match(sql, /grant execute on function public\.apply_ses_subscription_event/);
  assert.match(sql, /provider_sync_state[^;]+pending/i);
  assert.match(sql, /create or replace function public\.claim_marketing_consent_sync_events/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /create or replace function public\.finish_marketing_consent_sync_event/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/i);
  assert.match(sql, /jsonb_build_object\('applied', false, 'stale', true\)/i);
});

test('SES bootstrap never creates a newer event for an already-tracked recipient', () => {
  const bootstrap = sesMigration.slice(
    sesMigration.indexOf("'ses-bootstrap:'"),
    sesMigration.indexOf('-- Provider-neutral quote nurture'),
  );
  assert.match(bootstrap, /where not exists \([\s\S]+marketing_consent_events event[\s\S]+event\.recipient = recipient\.email/i);
  assert.match(bootstrap, /on conflict \(event_id\) do nothing/i);
});

test('delivery claims fail closed on missing consent and never bypass global suppression', () => {
  for (const source of [sql, newsletterSchema]) {
    const claim = source.slice(
      source.indexOf('function public.claim_newsletter_deliveries'),
      source.indexOf('function public.finish_newsletter_delivery'),
    );
    assert.match(claim, /suppression\.stream = 'all'[\s\S]+delivery\.source_type <> 'test'[\s\S]+suppression\.stream = 'marketing'/i);
    assert.match(claim, /delivery\.source_type = 'test'[\s\S]+coalesce\([\s\S]+, 'pending'\) in \('not_required', 'synced', 'superseded'\)/i);
    assert.doesNotMatch(claim, /coalesce\([\s\S]+, 'synced'\) in \('not_required', 'synced', 'superseded'\)/i);
    assert.match(claim, /p_source_type is null[\s\S]+delivery\.source_type <> 'test'/i);
  }
});
