alter table public.audit_email_recipients
  add column monthly_enabled boolean not null default false,
  add column annual_enabled boolean not null default false;

alter table public.audit_email_sector_dispatches
  drop constraint audit_email_sector_dispatches_report_kind_check,
  add constraint audit_email_sector_dispatches_report_kind_check
    check (report_kind in ('daily', 'weekly', 'monthly', 'annual', 'combined'));

-- Ajuste apenas os gestores ativos. Os cadastros setoriais/individuais
-- preservam as frequências de diário e semanal já autorizadas.
update public.audit_email_recipients
set daily_enabled = true, weekly_enabled = true, monthly_enabled = true,
    updated_at = now()
where active and scope = 'management'
  and (cardinality(sectors) > 0 or nullif(btrim(sector), '') is not null)
  and id <> '1b8168c6-bec0-4f6d-a3f9-feaec63ed147';

do $$
declare
  director_count integer;
  dispatch_job bigint;
begin
  update public.audit_email_recipients
  set daily_enabled = false, weekly_enabled = true,
      monthly_enabled = true, annual_enabled = true, updated_at = now()
  where id = '1b8168c6-bec0-4f6d-a3f9-feaec63ed147'
    and lower(btrim(email)) = 'canestraro@arquem.com.br'
    and active and scope = 'management' and cardinality(sectors) > 0;
  get diagnostics director_count = row_count;
  if director_count <> 1 then
    raise exception 'Cadastro executivo esperado não encontrado';
  end if;

  -- Preserva o comando, a autenticação e a hora inicial (12 UTC = 9h Brasília).
  -- O serviço filtra diário/semanal e permite fechamentos em fins de semana.
  select jobid into strict dispatch_job
  from cron.job
  where jobname = 'audit-email-dispatch-9h' and active
    and schedule = '0 12-21 * * 1-5';
  perform cron.alter_job(dispatch_job, schedule => '0 12-21 * * *');
end
$$;
