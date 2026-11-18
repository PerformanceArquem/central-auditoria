-- Queue for internal Movidesk notes after independently confirmed manual charge e-mail.
-- A note is not a time appointment, an actual treatment or a customer-facing message.
create table if not exists public.audit_ticket_charge_internal_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.audit_ticket_charge_history(request_id),
  ticket_id text not null check(ticket_id ~ '^[0-9]{1,12}$'),
  note_body text not null check(length(note_body) between 30 and 3500),
  status text not null default 'held' check(status in ('held','pending','processing','sent','uncertain','blocked')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 6),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(request_id,ticket_id)
);
create index if not exists charge_internal_notes_pending_idx
  on public.audit_ticket_charge_internal_notes(status,created_at) where status='pending';

alter table public.audit_ticket_charge_internal_notes enable row level security;
revoke all on public.audit_ticket_charge_internal_notes from anon,authenticated,public;
grant all on public.audit_ticket_charge_internal_notes to service_role;
-- No direct client access: show read-only history via the admin-guarded dispatch endpoint.
create or replace function public.audit_claim_ticket_charge_note()
returns setof public.audit_ticket_charge_internal_notes
language sql security definer set search_path=public
as $$
  with picked as (
    select id from public.audit_ticket_charge_internal_notes
    where status='pending' and attempt_count < 6
    order by created_at,id
    for update skip locked limit 1
  )
  update public.audit_ticket_charge_internal_notes q
  set status='processing',attempt_count=q.attempt_count+1,updated_at=now()
  from picked where q.id=picked.id
  returning q.*;
$$;
revoke all on function public.audit_claim_ticket_charge_note() from public, anon, authenticated;
grant execute on function public.audit_claim_ticket_charge_note() to service_role;
comment on table public.audit_ticket_charge_internal_notes
  is 'Registro interno de cobrança associado a envio de e-mail confirmado; reprocessamentos incertos exigem inspeção para impedir duplicidade.';
