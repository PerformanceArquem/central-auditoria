-- Auditoria automática de estimativas explícitas vs horas efetivamente apontadas.
-- Somente chamados Fechados/Concluídos/Resolvidos; resultados são triagem, nunca acusação.
create table if not exists public.audit_forecast_variance_snapshots (
 ticket_id text primary key,
 subject text not null,
 client_name text not null default 'Não informado',
 sector text not null default 'Sem setor',
 status text not null,
 estimated_hours numeric(12,2) not null check (estimated_hours>0),
 actual_minutes bigint not null check(actual_minutes>=0),
 variance_percent numeric(7,2) not null,
 evidence text not null,
 evidence_origin text not null default 'Histórico Movidesk',
 confidence text not null check(confidence in ('alta','baixa')),
 action_number integer,
 updated_at timestamptz not null default now()
);
create index if not exists audit_forecast_variance_rank_idx on public.audit_forecast_variance_snapshots (variance_percent desc,ticket_id);
alter table public.audit_forecast_variance_snapshots enable row level security;
revoke all on public.audit_forecast_variance_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.audit_forecast_variance_snapshots to service_role;
CREATE OR REPLACE FUNCTION public.audit_refresh_forecast_variances()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare count_rows integer;
begin
 delete from public.audit_forecast_variance_snapshots;
 insert into public.audit_forecast_variance_snapshots
 (ticket_id,subject,client_name,sector,status,estimated_hours,actual_minutes,variance_percent,evidence,evidence_origin,confidence,action_number,updated_at)
 with candidates as (
   select t.ticket_id,
     coalesce(t.payload->>'subject','Sem assunto') subject,
     coalesce(nullif(t.payload#>>'{clients,0,organization,businessName}',''), nullif(t.payload#>>'{clients,0,businessName}',''),'Não informado') client_name,
     coalesce(nullif(t.payload->>'ownerTeam',''),'Sem setor') sector,
     t.payload->>'status' status,
     z.ordinality action_number,
     left(regexp_replace(coalesce(z.item->>'description',z.item->>'htmlDescription',''),'<[^>]*>',' ','g'),14000) description
   from public.audit_direct_tickets t
   cross join lateral jsonb_array_elements(coalesce(t.payload->'actions','[]'::jsonb)) with ordinality z(item,ordinality)
   where t.payload->>'status' ~* '^(fechad|conclu|resolvid|encerrad|finalizad)'
 ), estimates as (
   select c.*,
    regexp_match(c.description,'(estimativa|tempo total previsto|previs[aã]o)(.{0,90}?)([0-9]{1,3})([[:space:]]*)(horas|hora|h([^a-z]|$))','i') re,
    coalesce(c.description~* '(estimativa inicial|estimativa preliminar|sem confirma[cç][aã]o|caso o cliente|se fosse|caso seja|com apoio de ia|de [0-9]{1,3} a [0-9]{1,3} horas)',false) conditional
   from candidates c
 ), latest as (
  select distinct on(ticket_id) *,
   (re[3])::integer estimated,
   left(re[1]||re[2]||re[3]||re[4]||re[5],250) evidence_text
  from estimates
  where re is not null and (re[3])::integer between 1 and 500
   and re[2] !~* '(retorno|atendimento|reuni[aã]o|contato|visita|hor[aá]rio)'
  order by ticket_id,action_number desc
 ), time_totals as (
  select ticket_id,coalesce(sum(greatest(duration_minutes,0)),0)::bigint minutes
  from public.audit_direct_appointments
  group by ticket_id
 )
 select l.ticket_id,left(l.subject,300),left(l.client_name,150),left(l.sector,100),left(l.status,100),
   l.estimated,coalesce(a.minutes,0),
   round((100*(l.estimated*60.0-coalesce(a.minutes,0))/(l.estimated*60.0))::numeric,2),
   l.evidence_text,'Histórico Movidesk',case when l.conditional then 'baixa' else 'alta' end,l.action_number,now()
 from latest l
 left join time_totals a using(ticket_id)
 where coalesce(a.minutes,0)>0 and coalesce(a.minutes,0)<l.estimated*60;
 get diagnostics count_rows=row_count;
 return jsonb_build_object('ok',true,'candidates',count_rows,'computed_at',now(),
  'scope','Somente chamados encerrados; estimativas explícitas; triagem para revisão');
end $function$
;
revoke all on function public.audit_refresh_forecast_variances() from public,anon,authenticated;
grant execute on function public.audit_refresh_forecast_variances() to postgres,service_role;
select cron.schedule('audit-forecast-variance-every-30m','10,40 * * * *','select public.audit_refresh_forecast_variances();');
