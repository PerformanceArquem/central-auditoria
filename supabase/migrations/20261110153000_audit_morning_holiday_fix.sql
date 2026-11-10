-- Respeitar feriados cadastrados ao escolher o ultimo dia util do relatorio diario.
CREATE OR REPLACE FUNCTION public.audit_prepare_morning_summaries()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
  previous_business date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  sunday date;
  monday date;
  kind text;
  from_day date;
  to_day date;
  r public.audit_recent_reconcile_state%rowtype;
  history_ready boolean;
  reconciled boolean;
  count_appointments bigint;
  sum_minutes bigint;
  synced_at timestamptz;
  by_sector jsonb;
  output jsonb := '[]'::jsonb;
begin
  while extract(isodow from previous_business) in (6, 7)
     or exists (
       select 1 from public.audit_email_holidays h
       where h.holiday_date=previous_business and h.affects_delivery is distinct from false
     ) loop
    previous_business := previous_business - 1;
  end loop;
  sunday := local_day - extract(isodow from local_day)::integer;
  monday := sunday - 6;

  select * into r from public.audit_recent_reconcile_state
    where job_name = 'movidesk_recent_reconcile';
  select coalesce(completed,false) and last_error is null
    into history_ready from public.audit_direct_sync_state
    where job_name = 'movidesk_backfill';

  for kind in select unnest(array['daily','weekly']) loop
    if kind='daily' then
      from_day := previous_business;
      to_day := previous_business;
    else
      from_day := monday;
      to_day := sunday;
    end if;

    reconciled :=
       r.job_name is not null
       and r.completed is true
       and r.last_error is null
       and r.period_start <= from_day
       and r.period_end > to_day
       and r.last_success_at >= now() - interval '12 hours'
       and coalesce(history_ready,false);

    select count(*), coalesce(sum(duration_minutes),0), max(source_synced_at)
      into count_appointments,sum_minutes,synced_at
    from public.audit_direct_appointments
    where appointment_date between from_day and to_day;

    select coalesce(jsonb_agg(jsonb_build_object('sector',sector,'appointments',n,'minutes',minutes)
                              order by minutes desc),'[]'::jsonb)
      into by_sector
    from (
      select coalesce(nullif(btrim(sector),''),'Sem setor') sector,
             count(*) n,coalesce(sum(duration_minutes),0) minutes
      from public.audit_direct_appointments
      where appointment_date between from_day and to_day
      group by 1
    ) grouped;

    insert into public.audit_report_morning_preparations(
      preparation_date,report_kind,period_start,period_end,prepared_at,status,
      appointments_count,total_minutes,last_source_sync,sector_totals,reconciliation)
    values(local_day,kind,from_day,to_day,now(),
      case when reconciled then 'ready' else 'waiting_reconciliation' end,
      count_appointments,sum_minutes,synced_at,by_sector,
      jsonb_build_object('recent_completed',r.completed,'recent_period_start',r.period_start,
        'recent_period_end',r.period_end,'recent_last_success',r.last_success_at,
        'recent_last_error',r.last_error,'history_complete',history_ready))
    on conflict (preparation_date,report_kind) do update
      set period_start=excluded.period_start,period_end=excluded.period_end,
          prepared_at=excluded.prepared_at,status=excluded.status,
          appointments_count=excluded.appointments_count,total_minutes=excluded.total_minutes,
          last_source_sync=excluded.last_source_sync,sector_totals=excluded.sector_totals,
          reconciliation=excluded.reconciliation;
    output := output || jsonb_build_array(jsonb_build_object(
       'kind',kind,'status',case when reconciled then 'ready' else 'waiting_reconciliation' end,
       'period_start',from_day,'period_end',to_day,
       'appointments',count_appointments,'minutes',sum_minutes));
  end loop;
  return jsonb_build_object('preparation_date',local_day,'results',output);
end
$function$
;
