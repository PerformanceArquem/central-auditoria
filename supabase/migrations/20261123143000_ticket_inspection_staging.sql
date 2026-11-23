-- Prepared for a SEPARATE staging project. Do not apply to production.
create table if not exists public.audit_ticket_inspection_snapshots (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  ticket_id text not null check(ticket_id ~ '^[0-9]{1,12}$'),
  source_synced_at timestamptz not null,
  observed_at timestamptz not null default clock_timestamp(),
  actor uuid not null,
  findings jsonb not null check(jsonb_typeof(findings)='array'),
  evaluated_codes jsonb not null check(jsonb_typeof(evaluated_codes)='array'),
  score integer not null check(score between 0 and 100)
);
create index if not exists audit_ticket_inspection_history_idx
on public.audit_ticket_inspection_snapshots(ticket_id,observed_at desc,id desc);
alter table public.audit_ticket_inspection_snapshots enable row level security;
revoke all on public.audit_ticket_inspection_snapshots from public,anon,authenticated;
grant select on public.audit_ticket_inspection_snapshots to service_role;

create or replace function public.audit_record_ticket_inspection(
  p_request_id uuid,p_ticket_id text,p_source_synced_at timestamptz,p_actor uuid,
  p_findings jsonb,p_evaluated_codes jsonb,p_score integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.audit_ticket_inspection_snapshots%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('ticket-inspection:'||p_ticket_id,0));
  select * into previous from public.audit_ticket_inspection_snapshots where request_id=p_request_id;
  if found then
    if previous.ticket_id<>p_ticket_id then raise exception 'Request identifier already used'; end if;
    return jsonb_build_object('saved',true,'duplicate',true);
  end if;
  if exists(select 1 from public.audit_ticket_inspection_snapshots where ticket_id=p_ticket_id and source_synced_at>p_source_synced_at)
  then return jsonb_build_object('stale',true); end if;
  insert into public.audit_ticket_inspection_snapshots(request_id,ticket_id,source_synced_at,actor,findings,evaluated_codes,score)
  values(p_request_id,p_ticket_id,p_source_synced_at,p_actor,p_findings,p_evaluated_codes,p_score);
  return jsonb_build_object('saved',true,'duplicate',false);
end;
$$;
revoke all on function public.audit_record_ticket_inspection(uuid,text,timestamptz,uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.audit_record_ticket_inspection(uuid,text,timestamptz,uuid,jsonb,jsonb,integer) to service_role;
