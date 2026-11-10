-- Cache privado de relatorios oficiais preparados antes das 09h.
-- Apenas service_role acessa o conteudo, pois ele inclui dados operacionais e de colaboradores.
create table if not exists public.audit_email_prepared_reports (
  dispatch_key text primary key,
  recipient_id uuid not null references public.audit_email_recipients(id),
  report_kind text not null check (report_kind in ('daily','weekly')),
  period_from date not null,
  period_to date not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  report_data jsonb not null,
  reconciliation_success_at timestamptz not null,
  prepared_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ready' check (status in ('ready','expired'))
);
create index if not exists audit_email_prepared_reports_expiry_idx on public.audit_email_prepared_reports(expires_at);
alter table public.audit_email_prepared_reports enable row level security;
revoke all on public.audit_email_prepared_reports from public, anon, authenticated;
grant select,insert,update,delete on public.audit_email_prepared_reports to service_role;

-- Execute este agendamento APOS o deploy da Edge Function que aceita action=prepare.
-- Reutiliza o comando autenticado do Cron existente; nao registra segredos no repositorio.
-- 11:00-11:55 UTC equivale a 08:00-08:55 America/Sao_Paulo.
do $$
declare source_command text;
begin
  select command into strict source_command from cron.job
    where jobname='audit-email-dispatch-9h' and active;
  if position('"action":"dispatch"' in source_command)=0 then
    raise exception 'Cron de envio alterado; nao foi possivel construir preparo autenticado';
  end if;
  perform cron.schedule(
    'audit-report-prepare-8h',
    '*/5 11 * * *',
    replace(source_command,'"action":"dispatch"','"action":"prepare"')
  );
end $$;
