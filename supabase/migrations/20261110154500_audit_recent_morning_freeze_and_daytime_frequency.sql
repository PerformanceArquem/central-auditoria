-- Sincronização mais frequente durante o dia e preservação de janela conciliada pela manhã.
-- Evita bloquear os relatórios das 08h-09h por reabertura de varredura de 6 horas.
CREATE OR REPLACE FUNCTION public.audit_recent_claim()
 RETURNS TABLE(claimed_token uuid, claimed_start date, claimed_end date, claimed_offset integer, already_completed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.audit_recent_reconcile_state%rowtype;
  new_day date := (now() at time zone 'America/Sao_Paulo')::date;
  token uuid := gen_random_uuid();
begin
  select * into v
  from public.audit_recent_reconcile_state
  where job_name = 'movidesk_recent_reconcile'
  for update;
  if not found then
    raise exception 'Checkpoint da conciliacao ausente';
  end if;
  if v.lease_until is not null and v.lease_until > now() then
    return;
  end if;

  -- Ao mudar o dia, recomecar a janela de 14 dias.
  -- Depois de uma conclusao, repetir no maximo a cada 6 horas,
  -- para capturar apontamentos tardios sem consultar a API a cada cron.
  if v.period_end is distinct from new_day + 1
     or v.period_start is distinct from new_day - 14
     or (v.completed
         -- Evitar reabrir uma janela JA concluida no horario de preparar/enviar relatorios.
         -- A mudanca de dia continua a abrir a nova janela normalmente.
         and (now() at time zone 'America/Sao_Paulo')::time >= time '09:15'
         and (v.last_success_at is null or v.last_success_at <= now() - interval '6 hours')) then
    update public.audit_recent_reconcile_state
       set period_start = new_day - 14,
           period_end = new_day + 1,
           next_offset = 0,
           completed = false,
           lease_token = null,
           lease_until = null,
           last_error = null,
           updated_at = now()
     where job_name = 'movidesk_recent_reconcile';
    v.period_start := new_day - 14;
    v.period_end := new_day + 1;
    v.next_offset := 0;
    v.completed := false;
  end if;
  if v.completed then
    return query select null::uuid, v.period_start, v.period_end, v.next_offset, true;
    return;
  end if;
  update public.audit_recent_reconcile_state
     set lease_token = token,
         lease_until = now() + interval '4 minutes',
         updated_at = now()
   where job_name = 'movidesk_recent_reconcile';
  return query select token, v.period_start, v.period_end, v.next_offset, false;
end
$function$
;
do $$
declare job_id bigint;
begin
 select jobid into strict job_id from cron.job
  where jobname='movidesk-recent-daytime-5min';
 perform cron.alter_job(job_id:=job_id,schedule:='*/2 0-2,12-23 * * *');
end $$;
