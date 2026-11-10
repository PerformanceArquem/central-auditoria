-- Histórico durável de cobranças manuais. Nunca interpretamos aceite do Gmail como leitura/entrega.
create table if not exists public.audit_ticket_charge_history (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 recipient text not null,
 subject text not null,
 ticket_ids text[] not null,
 ticket_snapshot jsonb not null default '[]'::jsonb,
 status text not null default 'sending' check(status in ('sending','sent','uncertain')),
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 updated_at timestamptz not null default now(),
 error_summary text,
 sent_by uuid
);
create index if not exists audit_ticket_charge_history_created_idx on public.audit_ticket_charge_history (created_at desc);
create index if not exists audit_ticket_charge_history_ticket_ids_gin on public.audit_ticket_charge_history using gin(ticket_ids);
alter table public.audit_ticket_charge_history enable row level security;
revoke all on public.audit_ticket_charge_history from public,anon,authenticated;
grant select,insert,update on public.audit_ticket_charge_history to service_role;
comment on table public.audit_ticket_charge_history is 'Registros de cobranças manuais. Status sent significa aceite pelo serviço Gmail, não confirmação de entrega.';