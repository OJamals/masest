-- supabase/schema-conversion.sql — funnel events + UTM attribution on page_views.
-- Additive; safe to re-run. page_views is already granted to service_role (schema-phase5.sql).

alter table public.page_views add column if not exists event        text default 'pageview';
alter table public.page_views add column if not exists utm_source   text;
alter table public.page_views add column if not exists utm_medium   text;
alter table public.page_views add column if not exists utm_campaign text;

create index if not exists page_views_event_idx on public.page_views(event);
