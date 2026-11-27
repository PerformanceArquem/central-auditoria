-- Prepared for review; do not apply to production before integration tests.
create table if not exists public.audit_triage_lookup_review (
 ticket_id text primary key check (ticket_id ~ '^[0-9]+$'),
 reason text not null check (reason in ('not-found-by-api','not-returned-by-api')),
 first_seen_at timestamptz not null default now(),
 last_checked_at timestamptz not null default now(),
 resolved_at timestamptz
);
alter table public.audit_triage_lookup_review enable row level security;
revoke all on public.audit_triage_lookup_review from anon, authenticated;
grant select, insert, update on public.audit_triage_lookup_review to service_role;
-- Keep initial cases in review; a 404 is not proof of deletion.
insert into public.audit_triage_lookup_review(ticket_id,reason)
values ('81901','not-found-by-api'),('91853','not-found-by-api'),('92989','not-found-by-api')
on conflict (ticket_id) do nothing;
