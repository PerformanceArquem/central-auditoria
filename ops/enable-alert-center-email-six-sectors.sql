-- Authorized sectors only. 11:30-11:35 UTC = 08:30-08:35 America/Fortaleza / Sao_Paulo.
-- Each minute selects exactly one sector in EMAIL_SECTORS. The endpoint checks holidays and a daily unique reservation.
do $enable$
begin
 if (select count(*) from public.audit_alert_email_settings s join public.audit_email_recipients r on r.id=s.recipient_id
 where r.active=true and r.daily_enabled=true and r.email ~* '^[^@[:space:]]+@arquem[.]com[.]br$'
 and s.sector=any(coalesce(nullif(r.sectors,array[]::text[]),array[r.sector])))<>6 then
 raise exception 'Six registered recipients were not confirmed';
 end if;
 if not exists(select 1 from public.audit_email_delivery_control where id=true and paused=false) then
 raise exception 'Global email delivery remains paused';
 end if;
 if (select count(*) from vault.secrets where name in ('sync_cron_anon_key','report_cron_secret'))<>2 then
 raise exception 'Scheduler credentials unavailable';
 end if;
 perform cron.schedule('audit-alert-email-six-sectors','30-35 11 * * 1-5',$job$
 select net.http_post(
  url:='https://dvaaicqajlppuigeyejr.supabase.co/functions/v1/alert-center-email-dispatch',
  headers:=jsonb_build_object(
   'Content-Type','application/json',
   'apikey',(select decrypted_secret from vault.decrypted_secrets where name='sync_cron_anon_key'),
   'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='sync_cron_anon_key'),
   'x-report-secret',(select decrypted_secret from vault.decrypted_secrets where name='report_cron_secret')
  ),
  body:=jsonb_build_object('action','dispatch','sectorIndex',extract(minute from timezone('UTC',now()))::int-30),
  timeout_milliseconds:=120000
 );
 $job$);
 update public.audit_alert_email_settings set enabled=true,updated_at=now()
 where sector in ('Inteligência','Qualidade','Sucesso do Cliente','Testes (QA)','Treinamento','Implantação');
end;
$enable$;
