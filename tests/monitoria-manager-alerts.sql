\set ON_ERROR_STOP on
begin;
create schema if not exists auth;
create table auth.users(id uuid primary key);
create role service_role;
create role anon;
create role authenticated;
create table public.audit_users(user_id uuid primary key,role text,is_active boolean);
insert into auth.users(id) values
 ('123e4567-e89b-42d3-a456-426614174000'),
 ('123e4567-e89b-42d3-a456-426614174002');
insert into public.audit_users values
 ('123e4567-e89b-42d3-a456-426614174000','admin',true),
 ('123e4567-e89b-42d3-a456-426614174002','user',true);
\i supabase/migrations/20261117170000_monitoria_reviews_and_internal_alerts.sql
insert into public.audit_monitoria_manager_routes(sector,manager_user_id)
values('Suporte','123e4567-e89b-42d3-a456-426614174002');
insert into public.audit_monitoria_reviews(
 client_request_id,created_by,channel,source_id,sector,collaborator_name,reviewer_name,monitored_at,ruleset_version,
 score_suggested,critical_suspected,critical_findings)
values
 ('123e4567-e89b-42d3-a456-426614174011','123e4567-e89b-42d3-a456-426614174000',
  'chat','102205','Suporte','Colaborador Teste','Analista Teste','2026-11-17','monitoria-suporte-2026-11-17',0,true,
  '[{"code":"Z1","suspected":true,"evidence":"Trecho de teste"}]'::jsonb),
 ('123e4567-e89b-42d3-a456-426614174012','123e4567-e89b-42d3-a456-426614174000',
  'voice','1883','Não Mapeado','Colaborador Teste','Analista Teste','2026-11-17','monitoria-suporte-2026-11-17',0,true,
  '[{"code":"Z3","suspected":true,"evidence":"Trecho de teste"}]'::jsonb),
 ('123e4567-e89b-42d3-a456-426614174013','123e4567-e89b-42d3-a456-426614174000',
  'chat','102206','Suporte','Colaborador Teste','monitoria-suporte-2026-11-17',100,false,'[]');
do $$
declare route_alert record;unassigned_alert record;count_alert integer;
begin
 select count(*) into count_alert from public.audit_monitoria_alerts;
 if count_alert<>2 then raise exception 'Expected two critical alerts, got %',count_alert;end if;
 select * into route_alert from public.audit_monitoria_alerts where sector='Suporte';
 if route_alert.status<>'unread' or route_alert.manager_user_id<>'123e4567-e89b-42d3-a456-426614174002'::uuid
 then raise exception 'Manager route not notified';end if;
 select * into unassigned_alert from public.audit_monitoria_alerts where sector='Não Mapeado';
 if unassigned_alert.status<>'routing_pending' or unassigned_alert.manager_user_id is not null
 then raise exception 'Unmapped sector falsely marked as delivered';end if;
end $$;
update public.audit_monitoria_reviews
set review_status='approved',score_approved=0,critical_confirmed=true,
 approved_by='123e4567-e89b-42d3-a456-426614174000',approved_at=now()
where source_id='102205';
do $$
begin
 if not exists(select 1 from public.audit_monitoria_reviews where source_id='102205' and review_status='approved' and score_approved=0)
 then raise exception 'Critical approval did not persist';end if;
end $$;
rollback;
