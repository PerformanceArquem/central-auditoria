/* Chave global de e-mails. Toda alteração é validada pelo servidor. */
(()=>{'use strict';
  const toggle=document.getElementById('emailDeliveryToggle');
  const status=document.getElementById('emailDeliveryStatus');
  const hint=document.getElementById('emailDeliveryHint');
  const refresh=document.getElementById('emailDeliveryRefresh');
  if(!toggle||!status||!hint||!refresh)return;
  let state=null,busy=false;
  function render(){
    const known=state&&typeof state.paused==='boolean';
    toggle.checked=!!known&&!state.paused;
    toggle.disabled=busy||!known;
    toggle.setAttribute('aria-checked',String(toggle.checked));
    refresh.disabled=busy;
    status.textContent=known?(state.paused?'Desligado — envios bloqueados':'Ligado — envios permitidos'):'Consultando situação dos e-mails…';
    status.dataset.paused=known?String(state.paused):'unknown';
    if(known)hint.textContent=state.paused
      ?'Relatórios, Triagem e envios manuais estão bloqueados para todos os destinatários.'
      :'Os envios seguem as permissões e os horários cadastrados. Relatórios com falha não são reenviados automaticamente.';
  }
  async function api(body){
    const client=window.tmEmailAdminClient;
    if(!client)throw Error('Faça login como administrador para usar a chave de e-mails.');
    const {data,error}=await client.functions.invoke('audit-email-dispatch',{body:{action:'email_delivery_control',...body}});
    if(error||data?.ok!==true||typeof data.paused!=='boolean')throw Error(data?.error||error?.message||'Não foi possível confirmar o estado dos e-mails.');
    return data;
  }
  async function load(){
    if(busy)return;
    busy=true;render();
    try{state=await api({});render();}
    catch(error){state=null;render();status.textContent='Controle de e-mails indisponível';hint.textContent=error.message;}
    finally{busy=false;toggle.disabled=!state;refresh.disabled=false;}
  }
  toggle.addEventListener('change',async()=>{
    if(busy||!state){render();return;}
    const paused=!toggle.checked;
    if(!paused&&!window.confirm('Ligar os e-mails para todos os destinatários e retomar os horários cadastrados? Os 22 relatórios com falha continuarão sem reenvio automático.')){render();return;}
    busy=true;render();
    status.textContent=paused?'Desligando os e-mails…':'Ligando os e-mails…';
    try{state=await api({paused,revision:state.revision,confirmResume:!paused});render();if(state.warning)hint.textContent=state.warning;}
    catch(error){state=null;render();status.textContent='Não foi possível confirmar a alteração';hint.textContent=error.message;}
    finally{busy=false;toggle.disabled=!state;refresh.disabled=false;}
  });
  refresh.addEventListener('click',load);
  document.querySelector('[data-t="email-admin"]')?.addEventListener('click',load);
  window.addEventListener('focus',()=>{if(!document.getElementById('t-email-admin')?.classList.contains('hide'))load();});
  render();
  let attempts=0;
  const wait=setInterval(()=>{if(window.tmEmailAdminClient){clearInterval(wait);load();}else if(++attempts>=60){clearInterval(wait);status.textContent='Faça login para consultar a chave';}},1000);
})();
