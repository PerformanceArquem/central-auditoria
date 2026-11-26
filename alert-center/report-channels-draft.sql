-- Isolated draft. Does not modify existing email recipients, schedules or dispatch.
create table if not exists public.audit_movidesk_report_channels (
 report_key text primary key check (report_key in ('individual','intelligence_team','intelligence_partial','intelligence_triage','production_flow','support_management','direction_consolidated')),
 simulation_selected boolean not null default false,
 delivery_enabled boolean not null default false check (delivery_enabled = false),
 updated_at timestamptz not null default now()
);
alter table public.audit_movidesk_report_channels enable row level security;
revoke all on public.audit_movidesk_report_channels from public, anon, authenticated;
grant select,insert,update on public.audit_movidesk_report_channels to service_role;
insert into public.audit_movidesk_report_channels(report_key)
select unnest(array['individual','intelligence_team','intelligence_partial','intelligence_triage','production_flow','support_management','direction_consolidated'])
on conflict (report_key) do nothing;
