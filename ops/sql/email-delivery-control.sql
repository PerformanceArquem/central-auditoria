-- Global switch: initially OFF. Does not send or retry any message.
create table if not exists public.audit_email_delivery_control (
  id boolean primary key default true check (id),
  paused boolean not null default true,
  revision bigint not null default 0,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
alter table public.audit_email_delivery_control enable row level security;
revoke all on public.audit_email_delivery_control from public,anon,authenticated;
grant select,insert,update on public.audit_email_delivery_control to service_role;
insert into public.audit_email_delivery_control(id,paused) values(true,true) on conflict(id) do nothing;

create table if not exists public.audit_email_delivery_jobs (
  job_id bigint primary key,
  job_name text not null,
  enabled_on_resume boolean not null
);
alter table public.audit_email_delivery_jobs enable row level security;
revoke all on public.audit_email_delivery_jobs from public,anon,authenticated;
grant select on public.audit_email_delivery_jobs to service_role;
-- Restore only the verified pre-pause schedules. Never create new schedules.
insert into public.audit_email_delivery_jobs(job_id,job_name,enabled_on_resume)
select jobid,jobname,jobid<>11 from cron.job
where (jobid,jobname) in (
  (4,'audit-email-dispatch-9h'),(9,'audit-report-prepare-8h'),
  (11,'audit-email-partial-12h'),(12,'audit-email-management-8h'),
  (13,'audit-email-management-retry'),(14,'intelligence-triage-weekdays-09h')
) on conflict(job_id) do nothing;

create schema if not exists audit_mail_internal;
revoke all on schema audit_mail_internal from public,anon,authenticated;
grant usage on schema audit_mail_internal to service_role;
create or replace function audit_mail_internal.set_delivery_paused(
  p_paused boolean,p_expected_revision bigint,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_state public.audit_email_delivery_control%rowtype; j record;
begin
  if p_paused is null or p_actor is null or not exists(
    select 1 from public.audit_users where user_id=p_actor and role='admin' and is_active=true
  ) then raise exception 'Administrador inválido'; end if;
  select * into strict current_state from public.audit_email_delivery_control where id=true for update;
  if current_state.revision<>p_expected_revision then
    raise exception 'A chave foi alterada por outro administrador. Atualize a página.';
  end if;
  for j in select saved.* from public.audit_email_delivery_jobs saved
    join cron.job actual on actual.jobid=saved.job_id and actual.jobname=saved.job_name
    where saved.job_id in (4,9,11,12,13,14)
  loop
    perform cron.alter_job(job_id:=j.job_id,active:=(not p_paused and j.enabled_on_resume));
  end loop;
  update public.audit_email_delivery_control set paused=p_paused,revision=revision+1,
    changed_at=now(),changed_by=p_actor where id=true returning * into current_state;
  insert into public.audit_email_run_logs(action,batch_group,http_status,ok,summary)
    values('email_delivery_control','admin',200,true,jsonb_build_object(
      'paused',p_paused,'revision',current_state.revision,'changedBy',p_actor));
  return jsonb_build_object('paused',current_state.paused,'revision',current_state.revision,'changed_at',current_state.changed_at);
end;
$$;
revoke all on function audit_mail_internal.set_delivery_paused(boolean,bigint,uuid) from public,anon,authenticated;
grant execute on function audit_mail_internal.set_delivery_paused(boolean,bigint,uuid) to service_role;
-- PostgREST exposes only this invoker wrapper, restricted to the existing server role.
create or replace function public.audit_set_email_delivery_paused(
  p_paused boolean,p_expected_revision bigint,p_actor uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select audit_mail_internal.set_delivery_paused(p_paused,p_expected_revision,p_actor);
$$;
revoke all on function public.audit_set_email_delivery_paused(boolean,bigint,uuid) from public,anon,authenticated;
grant execute on function public.audit_set_email_delivery_paused(boolean,bigint,uuid) to service_role;
