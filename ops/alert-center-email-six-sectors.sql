create table if not exists public.audit_alert_email_settings(
 sector text primary key check(sector in ('Inteligência','Qualidade','Sucesso do Cliente','Testes (QA)','Treinamento','Implantação')),
 recipient_id uuid not null references public.audit_email_recipients(id),
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.audit_alert_email_settings enable row level security;
revoke all on public.audit_alert_email_settings from public,anon,authenticated;
grant select,insert,update on public.audit_alert_email_settings to service_role;
create table if not exists public.audit_alert_email_history(
 dispatch_key text primary key,
 sector text not null references public.audit_alert_email_settings(sector),
 recipient_id uuid not null references public.audit_email_recipients(id),
 recipient text not null,
 local_date date not null,
 status text not null check(status in ('sending','sent','uncertain','empty')),
 ticket_ids jsonb not null default '[]'::jsonb,
 parts integer not null default 0,
 accepted_parts integer not null default 0,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 error_summary text,
 unique(sector,local_date)
);
alter table public.audit_alert_email_history enable row level security;
revoke all on public.audit_alert_email_history from public,anon,authenticated;
grant select,insert,update on public.audit_alert_email_history to service_role;
create or replace function public.audit_alert_email_snapshot()
returns table(ticket_id text,payload jsonb,source_synced_at timestamptz,closed_at_source timestamptz,last_real_appointment jsonb)
language sql stable security invoker set search_path=public
as $$
 select t.ticket_id,
 jsonb_build_object('id',t.ticket_id,'subject',t.payload->>'subject','ownerTeam',t.payload->>'ownerTeam',
 'owner',jsonb_build_object('id',t.payload#>>'{owner,id}','businessName',t.payload#>>'{owner,businessName}'),
 'clients',(select jsonb_agg(jsonb_build_object('businessName',coalesce(c#>>'{organization,businessName}',c->>'businessName',c->>'name'))) from jsonb_array_elements(case when jsonb_typeof(t.payload->'clients')='array' then t.payload->'clients' else '[]'::jsonb end) c),
 'status',t.payload->>'status','createdDate',t.payload->>'createdDate',
 'slaSolutionDate',t.payload->>'slaSolutionDate','slaSolutionDateIsPaused',t.payload->'slaSolutionDateIsPaused'),
 t.source_synced_at,t.closed_at_source,
 (select jsonb_build_object('date',a.appointment_date,'minutes',a.duration_minutes)
 from public.audit_direct_appointments a where a.ticket_id=t.ticket_id and a.duration_minutes>0
 order by a.appointment_date desc,a.appointment_key desc limit 1)
 from public.audit_direct_tickets t
 where t.payload->>'ownerTeam' in ('Inteligência','Qualidade','Sucesso do Cliente','Testes (QA)','Treinamento','Implantação')
 and t.closed_at_source is null and coalesce(t.payload->>'closedIn','')='' and coalesce(t.payload->>'canceledIn','')=''
 and coalesce(t.payload->>'isDeleted','false')<>'true'
 and coalesce(lower(t.payload->>'status'),'') not in ('fechado','resolvido','cancelado','concluído','concluido','concluído (sem confirmação)','concluido (sem confirmacao)','encerrado','finalizado')
 and upper(btrim(t.payload->>'subject'))<>'TM-HOMOLOG-001'
 and not exists(select 1 from public.audit_homologation_ticket_ids e where e.ticket_id=t.ticket_id)
 order by t.ticket_id limit 2001
$$;
revoke all on function public.audit_alert_email_snapshot() from public,anon,authenticated;
grant execute on function public.audit_alert_email_snapshot() to service_role;
insert into public.audit_alert_email_settings(sector,recipient_id) values
 ('Inteligência','ba07a7f7-6b33-4788-8a05-a5fd6e899387'),
 ('Qualidade','8f150a28-df5f-4c53-872f-ca753556d576'),
 ('Sucesso do Cliente','2dd4813c-2b2a-42f0-ac45-4baad40a7817'),
 ('Testes (QA)','a8cce01e-27b0-419e-9ef0-3d54447c7a6b'),
 ('Treinamento','8bfd9bdb-c4a5-4d62-91e0-4e4822db3ca0'),
 ('Implantação','ae9ed56e-5a77-4cd2-985b-05a0ddff4e8c')
 on conflict(sector) do nothing;
