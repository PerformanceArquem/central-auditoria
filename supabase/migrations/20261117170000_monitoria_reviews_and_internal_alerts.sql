-- Mini Central de Monitoria: persistent reviews and internal critical alerts.
-- REVIEWED MIGRATION ONLY: do not apply to production before approval and staging tests.
-- Service-role-only API access. No emails, webhooks, cron or external dispatches.
create table if not exists public.audit_monitoria_manager_routes (
 sector text primary key check (length(trim(sector)) between 1 and 100),
 manager_user_id uuid not null references auth.users(id),
 active boolean not null default true,
 configured_at timestamptz not null default now()
);
create table if not exists public.audit_monitoria_reviews (
 id uuid primary key default gen_random_uuid(),
 client_request_id uuid not null unique,
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 channel text not null check (channel in ('chat','voice')),
 source_id text not null check (length(trim(source_id)) between 1 and 80),
 sector text not null check (length(trim(sector)) between 1 and 100),
 collaborator_name text not null check (length(trim(collaborator_name)) between 1 and 160),
 reviewer_name text not null check (length(trim(reviewer_name)) between 1 and 160),
 monitored_at date not null,
 recording_kind text check (recording_kind in ('inbound','outbound')),
 evidence_reference text,
 check (evidence_reference is null or length(evidence_reference)<=120),
 ruleset_version text not null check (length(ruleset_version) between 1 and 80),
 score_suggested numeric(5,2) not null check (score_suggested between 0 and 100),
 score_approved numeric(5,2) check (score_approved between 0 and 100),
 critical_suspected boolean not null default false,
 critical_confirmed boolean,
 critical_findings jsonb not null default '[]'::jsonb,
 criteria jsonb not null default '[]'::jsonb,
 review_status text not null default 'provisional' check (review_status in ('provisional','approved')),
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 reviewer_notes text,
 check (jsonb_typeof(criteria)='array'),
 check (jsonb_typeof(critical_findings)='array'),
 check ((review_status='provisional' and score_approved is null and approved_at is null and approved_by is null)
     or (review_status='approved' and score_approved is not null and approved_at is not null and approved_by is not null))
);
create index if not exists audit_monitoria_reviews_created_idx on public.audit_monitoria_reviews(created_at desc);
create index if not exists audit_monitoria_reviews_sector_idx on public.audit_monitoria_reviews(sector,created_at desc);
create table if not exists public.audit_monitoria_alerts (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null unique references public.audit_monitoria_reviews(id) on delete restrict,
 created_at timestamptz not null default now(),
 manager_user_id uuid references auth.users(id),
 sector text not null,
 status text not null default 'routing_pending' check (status in ('routing_pending','unread','acknowledged','dismissed')),
 acknowledged_at timestamptz,
 acknowledged_by uuid references auth.users(id),
 manager_feedback text,
 check (status not in ('unread','acknowledged') or manager_user_id is not null)
);
create index if not exists audit_monitoria_alerts_manager_idx
 on public.audit_monitoria_alerts(manager_user_id,status,created_at desc);
-- Raise internal alerts at INSERT transaction time. A manager is notified *inside the app*
-- when an authorized manager session polls for new alerts; never imply an email was sent.
create or replace function public.audit_monitoria_create_alert()
returns trigger
language plpgsql
set search_path=''
as $$
declare recipient uuid;
begin
 if new.critical_suspected is not true then return new; end if;
 select m.manager_user_id into recipient
   from public.audit_monitoria_manager_routes m
   join public.audit_users a on a.user_id=m.manager_user_id
   where m.sector=new.sector and m.active and a.is_active is true
   limit 1;
 insert into public.audit_monitoria_alerts(review_id,manager_user_id,sector,status)
 values(new.id,recipient,new.sector,case when recipient is null then 'routing_pending' else 'unread' end);
 return new;
end $$;
drop trigger if exists audit_monitoria_alert_on_create on public.audit_monitoria_reviews;
create trigger audit_monitoria_alert_on_create
 after insert on public.audit_monitoria_reviews
 for each row execute function public.audit_monitoria_create_alert();
alter table public.audit_monitoria_reviews enable row level security;
alter table public.audit_monitoria_alerts enable row level security;
alter table public.audit_monitoria_manager_routes enable row level security;
revoke all on public.audit_monitoria_reviews,public.audit_monitoria_alerts,public.audit_monitoria_manager_routes from anon,authenticated;
grant select,insert,update on public.audit_monitoria_reviews,public.audit_monitoria_alerts,public.audit_monitoria_manager_routes to service_role;
-- No browser-exposed RLS policies; guarded Vercel backend reads/writes via service-role.
