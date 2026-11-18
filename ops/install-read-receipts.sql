-- Additive installation. No changes to recipients, schedules, delivery flags or prior dispatches.
create table public.audit_email_read_receipts (
  dispatch_key text primary key,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('sector','triage','ticket_charge','test')),
  recipient_id uuid references public.audit_email_recipients(id) on delete set null,
  recipient_name text not null,
  recipient_email text not null,
  subject text not null,
  period_from date,
  period_to date,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  confirmed_at timestamptz,
  constraint read_receipt_period check (period_from is null or period_to is null or period_from <= period_to),
  constraint read_receipt_expiry check (expires_at > created_at),
  constraint read_receipt_confirmed_delivery check (confirmed_at is null or delivered_at is not null)
);
create index audit_email_read_receipts_created_idx on public.audit_email_read_receipts(created_at desc);
alter table public.audit_email_read_receipts enable row level security;
revoke all on public.audit_email_read_receipts from public, anon, authenticated;
grant all on public.audit_email_read_receipts to service_role;
-- Tokens and their hashes are never exposed to the administration browser or anonymous clients.
grant select(dispatch_key,source,recipient_id,recipient_name,recipient_email,subject,period_from,period_to,created_at,expires_at,delivered_at,confirmed_at)
  on public.audit_email_read_receipts to authenticated;
create policy read_receipts_admin_select on public.audit_email_read_receipts for select to authenticated
  using ((select public.audit_is_email_admin()));
comment on table public.audit_email_read_receipts is 'Explicit acknowledgement by holder of the individual delivery link; does not certify identity or automatic opening.';
