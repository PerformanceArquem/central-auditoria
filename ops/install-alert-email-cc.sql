-- Optional corporate CC recipients in manual alert email history; does not alter existing sends.
alter table public.audit_ticket_charge_history
  add column if not exists cc_recipients text[] not null default '{}'::text[];

comment on column public.audit_ticket_charge_history.cc_recipients
  is 'Contatos corporativos selecionados em cópia (CC) no envio manual de alertas. A abertura por pixel é da mensagem, não individual por contato.';
