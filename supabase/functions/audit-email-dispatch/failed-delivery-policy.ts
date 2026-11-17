type Row=Record<string,unknown>;
export const RETRY_POLICY='failed-reports-20261117-v1';
// Only this verified pre-provider failure is safe to retry. Network errors,
// refused messages and missing attachment acknowledgements require reconciliation.
export function assertFailedRetry(row:Row,rec:Row,today:string){
 if(row.status!=='failed'||row.sent_at)throw Error('Este registro não é uma falha sem envio confirmado.');
 if(row.error_message!=='Gerador ainda não homologado para observações de ajustes posteriores ao fechamento')
  throw Error('Confirme a situação no serviço de e-mail antes de reenviar esta falha.');
 if(rec.active!==true||!['sector','management'].includes(String(rec.scope)))
  throw Error('Destinatário inativo ou escopo não permitido. Monitoria permanece bloqueada.');
 if(rec.allowed_report_types!=null&&(!Array.isArray(rec.allowed_report_types)||!rec.allowed_report_types.includes('general')))
  throw Error('O destinatário não tem liberação para este relatório.');
 const kind=String(row.report_kind),from=String(row.period_from),to=String(row.period_to);
 if(!['daily','weekly'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||to>=today||
  row.dispatch_key!==`${rec.id}:${kind}:${from}:${to}`||row.recipient_id!==rec.id)
  throw Error('Somente relatórios oficiais diários e semanais encerrados podem ser reenviados aqui.');
 if(rec[kind+'_enabled']!==true)throw Error('Periodicidade desativada no cadastro atual.');
}
