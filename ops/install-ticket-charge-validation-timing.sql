-- Validação humana de cobrança: início no clique; fim após aceite confirmado de e-mail.
-- Não constitui apontamento de horas de trabalho no Movidesk.
create table if not exists public.audit_ticket_charge_validations (
 request_id uuid primary key,
 validated_by uuid not null,
 ticket_ids text[] not null,
 recipient text not null,
 cc_recipients text[] not null default '{}',
 validated_at timestamptz not null default now(),
 completed_at timestamptz,
 constraint valid_charge_interval check(completed_at is null or completed_at >= validated_at),
 constraint nonempty_validated_tickets check(array_length(ticket_ids,1) between 1 and 20)
);
create index if not exists audit_charge_validation_time_idx
 on public.audit_ticket_charge_validations(validated_at desc);
alter table public.audit_ticket_charge_validations enable row level security;
revoke all on public.audit_ticket_charge_validations from anon, authenticated, public;
grant all on public.audit_ticket_charge_validations to service_role;
comment on table public.audit_ticket_charge_validations is
 'Rastreia o intervalo da validação humana até o aceite de envio de cobrança pelo serviço de e-mail; não representa jornada ou tempo trabalhado.';
