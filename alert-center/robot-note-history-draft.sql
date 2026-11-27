-- Draft for isolated database validation. No scheduler, email, or Movidesk calls.
begin;
create schema if not exists audit_robot_internal;
revoke all on schema audit_robot_internal from public, anon, authenticated;
grant usage on schema audit_robot_internal to service_role;
create table if not exists audit_robot_internal.note_history (
 ticket_id text not null check(ticket_id ~ '^[0-9]{1,12}$'),
 local_day date not null,
 rules text[] not null check(cardinality(rules)>0),
 note_body text not null check(length(note_body) between 1 and 3500),
 status text not null default 'reserved' check(status in ('reserved','confirmed','uncertain','blocked')),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 primary key(ticket_id,local_day)
);
alter table audit_robot_internal.note_history enable row level security;
revoke all on audit_robot_internal.note_history from public,anon,authenticated;
grant select,insert,update on audit_robot_internal.note_history to service_role;
-- The trusted server must revalidate source evidence, identity, and write authorization.
create or replace function public.audit_reserve_robot_internal_note(p_ticket_id text,p_day date,p_rules text[],p_note_body text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
 if p_day is distinct from d then return false; end if;
 -- Do not permit another day to bypass an unresolved delivery.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('robot-note:'||p_ticket_id,0));
 if exists(select 1 from audit_robot_internal.note_history where ticket_id=p_ticket_id and status in ('reserved','uncertain')) then return false; end if;
 insert into audit_robot_internal.note_history(ticket_id,local_day,rules,note_body)
 values(p_ticket_id,d,p_rules,p_note_body) on conflict(ticket_id,local_day) do nothing;
 return found;
end;
$$;
create or replace function public.audit_finish_robot_internal_note(p_ticket_id text,p_day date,p_status text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status is null or p_status not in ('confirmed','uncertain','blocked') then raise exception 'Invalid outcome'; end if;
 update audit_robot_internal.note_history set status=p_status,finished_at=now()
 where ticket_id=p_ticket_id and local_day=p_day and status='reserved';
 return found;
end;
$$;
revoke all on function public.audit_reserve_robot_internal_note(text,date,text[],text) from public,anon,authenticated;
revoke all on function public.audit_finish_robot_internal_note(text,date,text) from public,anon,authenticated;
grant execute on function public.audit_reserve_robot_internal_note(text,date,text[],text) to service_role;
grant execute on function public.audit_finish_robot_internal_note(text,date,text) to service_role;
commit;
