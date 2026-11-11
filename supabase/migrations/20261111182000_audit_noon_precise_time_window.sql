-- Parcial das 12h: recorte exato de 09h00 a 11h50 do dia corrente.
-- Somente o backend (service_role) pode executar; não expõe histórico pela API pública.
CREATE OR REPLACE FUNCTION public.audit_noon_window_rows(p_day date)
 RETURNS TABLE(appointment_key text, ticket_id text, collaborator_name text, sector text, minutes integer, source_synced_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with items as (
 select t.ticket_id, t.source_synced_at,
        tm->>'id' as appointment_id,
        coalesce(nullif(tm->'createdBy'->>'businessName',''),nullif(a->'createdBy'->>'businessName',''),'Não identificado') as who,
        coalesce(nullif(tm->'createdByTeam'->>'name',''),nullif(t.payload->'ownerTeam'->>'name',''),'Não identificado') as team,
        tm->>'periodStart' as start_string, tm->>'periodEnd' as end_string,
        tm->>'date' as item_day,
        tm->>'workTime' as work_time
 from public.audit_direct_tickets t
 cross join lateral jsonb_array_elements(case when jsonb_typeof(t.payload->'actions')='array' then t.payload->'actions' else '[]'::jsonb end) a
 cross join lateral jsonb_array_elements(case when jsonb_typeof(a->'timeAppointments')='array' then a->'timeAppointments' else '[]'::jsonb end) tm
 where left(tm->>'date',10)=p_day::text and tm->>'periodStart' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
  and tm->>'periodEnd' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
), clipped as (
 select *,
    greatest(0, extract(epoch from least(end_string::time,'11:50:00'::time)-greatest(start_string::time,'09:00:00'::time))/60)::integer as overlap_minutes
 from items
 where end_string::time>start_string::time
), dedup as (
 select distinct on(ticket_id,coalesce(appointment_id,''),who,team,start_string,end_string)
  coalesce(nullif(appointment_id,''), ticket_id||':'||start_string||':'||who) as ap_key,
  ticket_id,who,team,overlap_minutes,source_synced_at
 from clipped where overlap_minutes>0
 order by ticket_id,coalesce(appointment_id,''),who,team,start_string,end_string,source_synced_at desc
)
select ap_key,ticket_id,who,team,overlap_minutes,source_synced_at from dedup;
$function$

revoke all on function public.audit_noon_window_rows(date) from public,anon,authenticated;
grant execute on function public.audit_noon_window_rows(date) to service_role;
