-- Durable, bounded preparation recovery for campaigns. Preparation leases protect
-- the interval before immutable delivery source/recipient rows exist.
begin;

alter table public.newsletters
  add column if not exists preparation_lease_token uuid,
  add column if not exists preparation_lease_expires_at timestamptz,
  add column if not exists preparation_attempts int not null default 0;
alter table public.newsletters add column if not exists preparation_schedule jsonb;
alter table public.newsletters add column if not exists preparation_scheduled boolean;
alter table public.newsletters add column if not exists preparation_source_id text;

create or replace function public.capture_newsletter_preparation_schedule()
returns trigger language plpgsql as $$
begin
  if new.status = 'queueing' and new.preparation_schedule is null then
    new.preparation_schedule := old.schedule;
    new.preparation_scheduled := coalesce(new.preparation_scheduled, old.status = 'scheduled');
    new.preparation_source_id := case when old.schedule->>'mode' = 'recurring'
      then old.id::text || ':' || coalesce(old.schedule->>'next_run_at', old.schedule->>'send_at', old.id::text)
      else old.id::text end;
  end if;
  return new;
end;
$$;
drop trigger if exists newsletters_capture_preparation_schedule on public.newsletters;
create trigger newsletters_capture_preparation_schedule before update on public.newsletters
for each row execute function public.capture_newsletter_preparation_schedule();

alter table public.blog_newsletter_sends
  add column if not exists preparation_lease_token uuid,
  add column if not exists preparation_lease_expires_at timestamptz,
  add column if not exists preparation_attempts int not null default 0;

create index if not exists newsletters_preparation_recovery_idx
  on public.newsletters (status, preparation_lease_expires_at)
  where status in ('queueing', 'failed');
create index if not exists blog_newsletter_preparation_recovery_idx
  on public.blog_newsletter_sends (provider_status, preparation_lease_expires_at)
  where provider_status in ('queueing', 'failed_to_queue');

-- A fresh campaign claim or an expired preparation claim is atomic. A live lease
-- cannot be stolen, and the returned token must be used to finish preparation.
create or replace function public.claim_newsletter_preparation(
  p_id uuid, p_lease_token uuid, p_lease_seconds int default 600
)
returns public.newsletters
language sql security definer set search_path = public
as $$
  update public.newsletters
  set status = 'queueing', provider_error = null,
      preparation_schedule = coalesce(preparation_schedule, schedule),
      preparation_scheduled = coalesce(preparation_scheduled, status = 'scheduled'),
      preparation_source_id = coalesce(preparation_source_id, case when schedule->>'mode' = 'recurring'
        then id::text || ':' || coalesce(schedule->>'next_run_at', schedule->>'send_at', id::text)
        else id::text end),
      preparation_lease_token = p_lease_token,
      preparation_lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 600), 30)),
      preparation_attempts = preparation_attempts + 1,
      updated_at = now()
  where id = p_id
    and (
      status in ('draft', 'scheduled')
      or (status = 'queueing' and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) <= now())
      or (status = 'failed' and provider_status = 'failed_to_queue' and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) <= now())
    )
  returning *;
$$;

create or replace function public.claim_blog_newsletter_preparation(
  p_slug text, p_lease_token uuid, p_lease_seconds int default 600
)
returns public.blog_newsletter_sends
language sql security definer set search_path = public
as $$
  update public.blog_newsletter_sends
  set provider_status = 'queueing', provider_error = null,
      preparation_lease_token = p_lease_token,
      preparation_lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 600), 30)),
      preparation_attempts = preparation_attempts + 1,
      queued_at = coalesce(queued_at, now())
  where slug = p_slug
    and (
      (provider_status is null and sent_at is null)
      or (provider_status = 'queueing' and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) <= now())
      or (provider_status = 'failed_to_queue' and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) <= now())
    )
  returning *;
$$;

revoke all on function public.claim_newsletter_preparation(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.claim_blog_newsletter_preparation(text, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_newsletter_preparation(uuid, uuid, int) to service_role;
grant execute on function public.claim_blog_newsletter_preparation(text, uuid, int) to service_role;

-- Lock the parent while materializing so an expired worker cannot create a source
-- after another worker has reclaimed the preparation lease.
create or replace function public.materialize_newsletter_deliveries_fenced(
  p_source_type text, p_source_id text, p_parent_id text, p_subject text,
  p_html text, p_category text, p_metadata jsonb, p_emails jsonb,
  p_lease_token uuid
)
returns table(created boolean, total_count int)
language plpgsql security definer set search_path = public
as $$
declare v_result record;
begin
  if not exists (select 1 from public.newsletters where id = p_parent_id::uuid
    and status = 'queueing' and preparation_lease_token = p_lease_token
    and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) > now() for update) then
    raise exception 'newsletter_preparation_lease_lost';
  end if;
  select * into v_result from public.materialize_newsletter_deliveries(
    p_source_type, p_source_id, p_parent_id, p_subject, p_html, p_category, p_metadata, p_emails);
  return query select v_result.created, v_result.total_count;
end;
$$;

revoke all on function public.materialize_newsletter_deliveries_fenced(text,text,text,text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.materialize_newsletter_deliveries_fenced(text,text,text,text,text,text,jsonb,jsonb,uuid) to service_role;

create or replace function public.materialize_blog_newsletter_deliveries_fenced(
  p_source_id text, p_subject text, p_html text, p_category text,
  p_metadata jsonb, p_emails jsonb, p_lease_token uuid
)
returns table(created boolean, total_count int)
language plpgsql security definer set search_path = public
as $$
declare v_result record;
begin
  if not exists (select 1 from public.blog_newsletter_sends where slug = p_source_id
    and provider_status = 'queueing' and preparation_lease_token = p_lease_token
    and coalesce(preparation_lease_expires_at, '-infinity'::timestamptz) > now() for update) then
    raise exception 'blog_preparation_lease_lost';
  end if;
  select * into v_result from public.materialize_newsletter_deliveries(
    'blog_post', p_source_id, p_source_id, p_subject, p_html, p_category, p_metadata, p_emails);
  return query select v_result.created, v_result.total_count;
end;
$$;

revoke all on function public.materialize_blog_newsletter_deliveries_fenced(text,text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.materialize_blog_newsletter_deliveries_fenced(text,text,text,text,jsonb,jsonb,uuid) to service_role;

commit;
