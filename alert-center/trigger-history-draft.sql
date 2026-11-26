-- Draft only: review and test in an isolated database before applying.
-- Never treat a dry-run as a reservation for real delivery.
begin;
create schema if not exists alert_center_test;
revoke all on schema alert_center_test from public, anon, authenticated;
create table alert_center_test.trigger_requests (
 id uuid primary key default gen_random_uuid(),
 request_key uuid not null unique,
 recipient_id text not null check (length(trim(recipient_id)) > 0),
 actor_id uuid not null,
 subject text not null default 'TM-HOMOLOG-001' check (subject = 'TM-HOMOLOG-001'),
 created_at timestamptz not null default now(),
 status text not null default 'simulated' check (status = 'simulated'),
 delivery_enabled boolean not null default false check (delivery_enabled = false),
 ticket_created boolean not null default false check (ticket_created = false)
);
alter table alert_center_test.trigger_requests enable row level security;
revoke all on alert_center_test.trigger_requests from public, anon, authenticated;
-- A trusted server must derive actor and recipient from validated authorization.
-- Reserve a stable request key using INSERT ... ON CONFLICT (request_key) DO NOTHING
-- and compare the existing recipient/actor before returning a duplicate result.
-- Separate real-delivery ledger, atomic reservation, upstream reconciliation,
-- and reporting exclusions are mandatory before any actual ticket creation.
commit;
