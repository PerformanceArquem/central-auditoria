-- Separate and explicitly label automatic image-load signals from deliberate read acknowledgements.
-- Additive only: no dispatch schedule, email, or prior status changes.
alter table public.audit_email_read_receipts
  add column if not exists open_token_hash text unique,
  add column if not exists first_opened_at timestamptz;
alter table public.audit_email_read_receipts
  add constraint audit_open_hash_format check (open_token_hash is null or open_token_hash ~ '^[a-f0-9]{64}$');
create index if not exists audit_email_open_signal_hash_idx
  on public.audit_email_read_receipts(open_token_hash) where open_token_hash is not null;
-- No IP address, device fingerprint, location, click-through, or raw token is collected.
revoke select on public.audit_email_read_receipts from authenticated;
grant select(dispatch_key,source,recipient_id,recipient_name,recipient_email,subject,period_from,period_to,created_at,expires_at,delivered_at,confirmed_at,first_opened_at)
  on public.audit_email_read_receipts to authenticated;
comment on column public.audit_email_read_receipts.first_opened_at is
  'First detectable remote image fetch, not verified human open, receipt, or reading. May result from provider proxy or scanner.';
