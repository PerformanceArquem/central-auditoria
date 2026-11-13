-- Job isolado; permanece inativo até validar o Web App e seus anexos.
begin;
select cron.schedule('intelligence-triage-weekdays-09h','0 12 * * 1-5',$job$
 select net.http_post(
  url:='https://dvaaicqajlppuigeyejr.supabase.co/functions/v1/intelligence-triage-report',
  headers:=jsonb_build_object('Content-Type','application/json',
   'x-report-secret',(select decrypted_secret from vault.decrypted_secrets where name='report_cron_secret')),
  body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=120000
 );
$job$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='intelligence-triage-weekdays-09h';
commit;

