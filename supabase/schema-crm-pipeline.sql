-- schema-crm-pipeline.sql — CRM slice 2: deal pipeline fields on quotes.
-- Additive + idempotent. quotes already grants service_role (schema-quotes.sql), so no new grants.
-- Apply once via the pooler (psql) or the Supabase SQL editor.

alter table public.quotes add column if not exists pipeline_stage   text not null default 'new';
alter table public.quotes add column if not exists deal_value       numeric(12,2);
alter table public.quotes add column if not exists expected_close   date;
alter table public.quotes add column if not exists stage_changed_at timestamptz;
alter table public.quotes add column if not exists lost_reason      text;

do $$ begin
  alter table public.quotes add constraint quotes_pipeline_stage_chk
    check (pipeline_stage in ('new','qualified','sample_audit','proposal','won','lost'));
exception when duplicate_object then null; end $$;

create index if not exists quotes_pipeline_stage_idx
  on public.quotes (pipeline_stage, stage_changed_at desc);

-- Optional backfill (owner-run, not automatic): map historical closed quotes.
-- update public.quotes set pipeline_stage='won'  where status='closed' and next_step ilike '%converted%';
-- update public.quotes set pipeline_stage='lost' where status='closed' and pipeline_stage='new';
