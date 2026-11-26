-- Review and test in isolation; do not apply automatically.
begin;
create schema if not exists alert_center_test;
revoke all on schema alert_center_test from public, anon, authenticated;
create table alert_center_test.delivery_requests (
 id uuid primary key default gen_random_uuid(),
 request_key uuid not null unique,
 recipient_id text not null check (length(trim(recipient_id)) > 0),
 actor_id uuid not null,
 ticket_id text not null check (ticket_id ~ '^[0-9]+$'),
 subject text not null default 'TM-HOMOLOG-002' check (subject = 'TM-HOMOLOG-002'),
 status text not null default 'reserved' check (status in ('reserved','accepted','uncertain')),
 provider_delivery_id text unique,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 check ((status = 'accepted') = (provider_delivery_id is not null)),
 check ((status = 'reserved') = (finished_at is null))
);
alter table alert_center_test.delivery_requests enable row level security;
revoke all on alert_center_test.delivery_requests from public, anon, authenticated;
-- No public endpoint or grants. Implement and review service-only atomic reservation
-- and finalization RPCs before enabling delivery. Never recycle uncertain reservations.
commit;
