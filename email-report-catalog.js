/* Catálogo administrativo. Nenhum envio é invocado por este módulo. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),rows=$('emailCatalogRows');if(!rows)return;
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const kinds=['daily','weekly','monthly','annual'],labels={daily:'Diário',weekly:'Semanal',monthly:'Mensal',annual:'Anual'};let records=[],logs=[],busy=false;
 const say=t=>{$('emailCatalogStatus').textContent=t};
 const localDate=v=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
 const restricted=(r,kind)=>String(r.email).trim().toLowerCase()==='canestraro@arquem.com.br'&&(kind==='daily'||r.id!=='1b8168c6-bec0-4f6d-a3f9-feaec63ed147');
 function render(){
  const search=$('emailCatalogSearch').value.trim().toLocaleLowerCase('pt-BR'),cadence=$('emailCatalogCadence').value,today=localDate(Date.now());
  rows.innerHTML=records.filter(r=>(!cadence||r[cadence+'_enabled'])&&(!search||[r.name,r.email,r.sector,...(r.sectors||[]),r.collaborator_name,...(r.collaborator_names||[])].join(' ').toLocaleLowerCase('pt-BR').includes(search))).map(r=>{
   const sectors=(r.sectors?.length?r.sectors:[r.sector]).filter(Boolean).join(' · ')||(r.scope==='management'?'Todos os setores':'Sem setor');
   const people=r.collaborator_names?.length?r.collaborator_names.join(', '):r.collaborator_name||'Equipe dos setores vinculados';
   const category=r.allowed_report_types==null?'Relatórios gerenciais / setoriais':r.allowed_report_types.map(k=>({general:'Gerencial / setorial',production_flow:'Fluxo da Produção',ticket_followup:'Cobranças manuais'}[k]||k)).join(' · ')||'Sem categoria liberada';
   const sent=logs.filter(l=>l.recipient_id===r.id&&localDate(l.sent_at||l.created_at)===today);
   const todayLabel=sent.length?sent.map(l=>({sent:'Enviado',failed:'Falha',processing:'Em processo'}[l.status]||l.status)+' · '+({daily:'diário',weekly:'semanal',monthly:'mensal',annual:'anual'}[l.report_kind]||l.report_kind)).join('; '):'Sem registro nos 150 mais recentes';
   const sectorHtml=r.sectors?.length>3?'<details><summary>'+r.sectors.length+' setores vinculados</summary>'+escape(sectors)+'</details>':escape(sectors);
   const peopleHtml=r.collaborator_names?.length>3?'<details><summary>'+r.collaborator_names.length+' colaboradores selecionados</summary>'+escape(people)+'</details>':escape(people);
   return '<tr data-catalog-recipient="'+escape(r.id)+'"><td><strong>'+escape(r.name)+'</strong><br>'+escape(r.email)+'<small style="display:block">'+escape(category)+(r.active?'':' · Inativo')+'</small></td><td>'+sectorHtml+'<small style="display:block">'+peopleHtml+'</small></td>'+kinds.map(k=>'<td><input type="checkbox" data-catalog-kind="'+k+'" aria-label="'+escape(labels[k]+' — '+r.name)+'" '+(r[k+'_enabled']?'checked ':'')+(!r.active||restricted(r,k)?'disabled':'')+'></td>').join('')+'<td>'+escape(todayLabel)+'</td><td><button type="button" class="s" data-catalog-save="'+escape(r.id)+'" '+(!r.active?'disabled':'')+'>Salvar</button></td></tr>';
  }).join('')||'<tr><td colspan="8">Nenhum relatório corresponde ao filtro.</td></tr>';
 }
 async function verify(){
  const client=window.tmEmailAdminClient;if(!client)throw Error('Faça login como administrador.');
  const result=await client.rpc('audit_is_email_admin');if(result.error||result.data!==true)throw Error('Acesso reservado ao administrador ativo.');return client;
 }
 async function load(){
  if(busy)return;busy=true;$('emailCatalogRefresh').disabled=true;
  try{
   const client=await verify();say('Consultando configurações e histórico...');
   const [rec,history]=await Promise.all([client.from('audit_email_recipients').select('*').order('name'),client.from('audit_email_sector_dispatches').select('recipient_id,report_kind,status,created_at,sent_at').order('created_at',{ascending:false}).limit(150)]);
   if(rec.error||history.error)throw rec.error||history.error;
   records=rec.data||[];logs=history.data||[];render();say(records.length+' cadastros consultados. Frequências são permissões; não garantem envio antes da conciliação.');
  }catch(error){say('Não foi possível consultar: '+error.message)}finally{busy=false;$('emailCatalogRefresh').disabled=false}
 }
 $('emailCatalogRefresh').addEventListener('click',load);
 $('emailCatalogSearch').addEventListener('input',render);$('emailCatalogCadence').addEventListener('change',render);
 rows.addEventListener('click',async event=>{
  const button=event.target.closest('[data-catalog-save]');if(!button||busy)return;
  const row=button.closest('[data-catalog-recipient]'),rec=records.find(r=>r.id===button.dataset.catalogSave);if(!rec||!rec.active)return;
  busy=true;button.disabled=true;
  try{
   const client=await verify(),patch={updated_at:new Date().toISOString()};
   kinds.forEach(k=>{patch[k+'_enabled']=restricted(rec,k)?false:row.querySelector('[data-catalog-kind="'+k+'"]').checked});
   let request=client.from('audit_email_recipients').update(patch).eq('id',rec.id).eq('active',true);
   if(rec.updated_at)request=request.eq('updated_at',rec.updated_at);
   const result=await request.select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw Error('Cadastro alterado em outra sessão; consulte novamente.');
   say('Frequências salvas para '+rec.email+'. Nenhum e-mail disparado.');
   Object.assign(rec,patch);render();
  }catch(error){say('Não foi possível salvar: '+error.message)}finally{busy=false;button.disabled=false}
 });
})();
