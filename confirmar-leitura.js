(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
  // Keep the bearer link out of the address bar/history after loading. Never log it.
  if(location.hash)history.replaceState(null,'',location.pathname);
  const endpoint='https://dvaaicqajlppuigeyejr.supabase.co/functions/v1/audit-read-receipt';
  const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'—';
  const stamp=value=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(new Date(value));
  let busy=false;
  async function request(action) {
    if(busy)return;
    busy=true;$('receiptConfirm').disabled=true;$('receiptRetry').hidden=true;
    try {
      if(!/^[a-f0-9]{64}$/.test(token))throw Error('Link inválido. Abra o botão no e-mail recebido para confirmar o relatório.');
      const response=await fetch(endpoint,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...(action==='confirm'?{accepted:true}:{})}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();
      if(!response.ok||!result.ok){const error=new Error(result.error||'Não foi possível consultar este relatório.');error.retryable=response.status>=500;throw error;}
      $('receiptDetails').hidden=false;
      $('receiptRecipient').textContent=result.recipient;
      $('receiptSubject').textContent=result.subject;
      $('receiptPeriod').textContent=result.from&&result.to?date(result.from)+' a '+date(result.to):'Conforme relatório recebido';
      const confirmed=result.status==='confirmed';
      $('receiptTitle').textContent=confirmed?'Leitura confirmada':'Você leu este relatório?';
      $('receiptStatus').textContent=confirmed?'Sua confirmação de leitura está registrada.':'Confirme após ler o relatório e seus anexos.';
      $('receiptConfirm').hidden=confirmed;$('receiptNotice').hidden=confirmed;
      $('receiptTime').textContent=confirmed?'Confirmado em '+stamp(result.confirmedAt):'';
    } catch(error) {
      $('receiptStatus').textContent=error.message||'Serviço indisponível. Tente novamente.';
      // Retry only inspects. A failed confirmation is never silently repeated.
      $('receiptConfirm').hidden=true;$('receiptRetry').hidden=error.retryable===false||/Link inválido|expirou|envio deste/.test(error.message);
    } finally {busy=false;$('receiptConfirm').disabled=false;}
  }
  $('receiptConfirm').addEventListener('click',()=>request('confirm'));
  $('receiptRetry').addEventListener('click',()=>request('inspect'));
  request('inspect');
})();
