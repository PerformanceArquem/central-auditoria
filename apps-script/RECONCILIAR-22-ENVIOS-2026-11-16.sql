-- Auditoria SOMENTE LEITURA para a recuperação dos 22 relatórios setoriais.
-- Usar no SQL Editor do Supabase dvaaicqajlppuigeyejr.
-- Não altera status, não desbloqueia envio, não chama o provedor.
-- Períodos: daily 2026-11-13..15; weekly 2026-11-09..15.
-- Registros com status failed podem representar falha após aceite pelo provedor;
-- mesmo sem provider_id/sent_at é obrigatória conciliação com a conta remetente correta.

-- 0. Inventário sem divulgar endereços: auditar por data do RELATÓRIO,
-- não por created_at (uma tentativa ou reserva pode ser criada em outro dia).
select
  count(*) as reservas,
  count(distinct d.dispatch_key) as chaves_distintas,
  count(distinct d.recipient_id) as perfis,
  count(distinct lower(trim(r.email))) as emails_distintos,
  count(*) filter (where d.provider_id is not null or d.sent_at is not null) as com_indicio_de_entrega,
  count(*) filter (where d.reviewed_at is not null or d.review_note is not null) as com_revisao
from public.audit_email_sector_dispatches d
join public.audit_email_recipients r on r.id=d.recipient_id
where d.period_to=date '2026-11-15'
  and d.report_kind in ('daily','weekly')
  and d.dispatch_key not like 'preliminary:%';

-- 0b. Perfis que compartilham e-mail: sem retornar o endereço.
-- Mesma caixa NÃO significa relatório repetido: comparar escopo e setores.
select
  array_agg(r.name order by r.name) as perfis,
  array_agg(distinct r.scope) as escopos,
  count(distinct d.recipient_id) as quantidade_perfis,
  count(*) as reservas
from public.audit_email_sector_dispatches d
join public.audit_email_recipients r on r.id=d.recipient_id
where d.period_to=date '2026-11-15'
  and d.report_kind in ('daily','weekly')
  and d.dispatch_key not like 'preliminary:%'
group by lower(trim(r.email))
having count(distinct d.recipient_id)>1
order by quantidade_perfis desc;

-- 1. Resumo das reservas e carimbos de entrega por período.
select
  d.report_kind, d.period_from, d.period_to, d.status,
  count(*) as registros,
  count(*) filter (where d.provider_id is not null) as com_provedor,
  count(*) filter (where d.sent_at is not null) as com_data_envio,
  min(d.created_at) as primeira_reserva,
  max(d.created_at) as ultima_reserva
from public.audit_email_sector_dispatches d
where d.period_to=date '2026-11-15'
  and d.report_kind in ('daily','weekly')
  and d.dispatch_key not like 'preliminary:%'
group by d.report_kind,d.period_from,d.period_to,d.status
order by d.report_kind,d.period_from,d.status;

-- 2. Lista individual para cruzar com o Gmail (acesso restrito):
-- a saída contém e-mail corporativo; não publicar logs ou CSV publicamente.
select
  d.dispatch_key,
  r.name as destinatario,
  r.email as email_corporativo,
  r.sector as setor,
  d.report_kind,
  d.period_from,
  d.period_to,
  d.status,
  d.attempt_count,
  d.created_at,
  d.last_attempt_at,
  d.sent_at,
  d.provider_id,
  d.error_message
from public.audit_email_sector_dispatches d
join public.audit_email_recipients r on r.id=d.recipient_id
where d.period_to=date '2026-11-15'
  and d.report_kind in ('daily','weekly')
  and d.dispatch_key not like 'preliminary:%'
  and d.status='failed'
order by d.report_kind,r.name,d.period_from;

-- 3. Duplicações lógicas indevidas nos registros de envio.
select
  recipient_id,report_kind,period_from,period_to,
  count(*) as reservas,
  array_agg(status order by created_at) as status_encontrados
from public.audit_email_sector_dispatches
where period_to='2026-11-15'::date
  and report_kind in ('daily','weekly')
  and dispatch_key not like 'preliminary:%'
group by recipient_id,report_kind,period_from,period_to
having count(*)>1;

-- 4. Identificar logs do cron que obtiveram HTTP 200 mas ok=false.
-- HTTP 200 do endpoint NÃO é comprovante de entrega Gmail.
select created_at,action,batch_group,http_status,ok,
       left(summary::text,1500) as resumo
from public.audit_email_run_logs
where created_at >= timestamptz '2026-11-16 00:00:00+00'
  and created_at < timestamptz '2026-11-17 00:00:00+00'
  and action='dispatch'
order by created_at desc;

-- AÇÃO POSTERIOR (NÃO automatizada por este script):
-- (a) conferir inbox/Enviados e IDs do provedor no remetente usado pelo Apps Script;
-- (b) homologar PDF e XLSX reais, garantindo postCloseAdjustmentsSupported=true
--     no endpoint /exec instalado;
-- (c) implementar mecanismo de reprocessamento com autorização administrativa,
--     lock transacional por dispatch_key, lote unitário e auditoria;
-- (d) nunca fazer UPDATE failed->sent sem comprovante do provedor, nem DELETE
--     para contornar idempotência, nem repetir cron 09h em massa.
