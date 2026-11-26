-- Draft only. Not applied. Read-only reporting views; original data retained.
-- Known test IDs are maintained by authorized administrators, not hardcoded here.
create table if not exists public.audit_homologation_ticket_ids (
 ticket_id text primary key,
 registered_at timestamptz not null default now()
);
alter table public.audit_homologation_ticket_ids enable row level security;
revoke all on public.audit_homologation_ticket_ids from public, anon, authenticated;
grant select, insert on public.audit_homologation_ticket_ids to service_role;
create or replace view public.audit_reporting_excluded_ticket_ids
with (security_invoker=true) as
select ticket_id from public.audit_homologation_ticket_ids
union
select ticket_id::text from public.audit_direct_tickets
where upper(btrim(payload->>'subject')) = 'TM-HOMOLOG-001';
create or replace view public.audit_reporting_tickets
with (security_invoker=true) as
select t.* from public.audit_direct_tickets t
where not exists (select 1 from public.audit_reporting_excluded_ticket_ids e where e.ticket_id=t.ticket_id::text);
create or replace view public.audit_reporting_appointments
with (security_invoker=true) as
select a.* from public.audit_direct_appointments a
where not exists (select 1 from public.audit_reporting_excluded_ticket_ids e where e.ticket_id=a.ticket_id::text);
revoke all on public.audit_reporting_excluded_ticket_ids, public.audit_reporting_tickets, public.audit_reporting_appointments from public, anon, authenticated;
grant select on public.audit_reporting_excluded_ticket_ids, public.audit_reporting_tickets, public.audit_reporting_appointments to service_role;
