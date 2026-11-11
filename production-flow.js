(()=>{'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={opened:'Abertura',entry:'Entrada na Produção',returned:'Devolução ao autor da abertura',exit_other:'Saída para outro responsável',closure:'Finalização',assignment:'Troca de responsável na Produção',status:'Alteração de status'};
 const origins={production:'Própria Produção',external:'Fora da Produção',unknown:'A conferir'};
 const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}):'—';
 const link=id=>/^\d+$/.test(id)?'<a target="_blank" rel="noopener noreferrer" href="https://arquem.movidesk.com/Ticket/Edit/'+id+'">#'+esc(id)+'</a>':esc(id);
 let report=null,busy=false,started=false,page=0;
 function say(s){$('pfStatus').textContent=s;}
 function match(t){const f=$('pfFilter').value,q=$('pfSearch').value.trim().toLocaleLowerCase('pt-BR'),e=t.events||[];
  const passes=f==='all'||f==='alert'&&e.some(x=>x.alert)||f==='review'&&(e.some(x=>x.review)||t.issues.length||t.origin==='unknown')||f==='own'&&t.origin==='production'||f==='ownClosed'&&e.some(x=>x.ownClosed)||f==='returned'&&e.some(x=>x.type==='returned')||f==='entry'&&e.some(x=>x.type==='entry')||f==='exit'&&e.some(x=>['returned','exit_other'].includes(x.type))||f==='backlog'&&t.inProductionAtEnd;
  return passes&&(!q||[t.id,t.subject,t.client,t.creator,t.currentOwner,...(t.timeline||[]).map(x=>x.actor)].join(' ').toLocaleLowerCase('pt-BR').includes(q));
 }
 const filtered=()=>report?.tickets.filter(match)||[];
 function renderRows(){const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,pages-1);
  $('pfCount').textContent=rows.length+' chamado(s) no filtro. Exportações incluem todos os chamados filtrados, não apenas esta página.';
  $('pfTickets').querySelector('tbody').innerHTML=rows.slice(page*50,page*50+50).map(t=>{
   const closed=t.events.filter(x=>x.type==='closure').at(-1),alert=t.events.some(x=>x.alert),review=t.events.some(x=>x.review)||t.issues.length||t.origin==='unknown';
   const timeline=(t.timeline||[]).map(e=>'<li><b>'+esc(date(e.at))+' · '+esc(labels[e.type])+'</b><br>'+esc(e.actor)+(e.fromTeam?' · '+esc(e.fromTeam)+' → '+esc(e.toTeam):'')+(e.owner?' · Responsável: '+esc(e.owner):'')+(e.status?' · '+esc(e.status):'')+(e.alert?' · FINALIZADO SEM DEVOLUÇÃO':'')+'</li>').join('');
   return '<tr><td>'+link(t.id)+'<details><summary>Ver histórico</summary><p class="subtle">Histórico disponível, inclusive fora do período selecionado.</p><ol style="min-width:280px;padding-left:18px">'+timeline+'</ol></details></td><td>'+esc(t.subject)+'<br><span class="subtle">'+esc(t.client)+'</span></td><td>'+esc(t.creator)+'</td><td>'+esc(origins[t.origin])+'</td><td>'+(closed?esc(date(closed.at))+'<br>'+esc(closed.actor)+'<br>'+esc(closed.status):'—')+'</td><td>'+esc(t.currentOwner)+'<br>'+esc(t.currentTeam)+'<br>'+esc(t.status)+'</td><td>'+(alert?'<strong style="color:#a52231">Revisar: finalizado sem devolução</strong>':review?'A conferir':t.events.some(e=>e.ownClosed)?'Origem interna — contagem separada':t.events.some(e=>e.type==='returned')?'Devolução registrada':'Sem ocorrência confirmada')+(t.issues.length?'<br>'+esc(t.issues.join('; ')):'')+'</td></tr>';
  }).join('')||'<tr><td colspan="7">Nenhum chamado para este filtro.</td></tr>';
  $('pfPage').textContent='Página '+(page+1)+' de '+pages;$('pfPrevious').disabled=page===0;$('pfNext').disabled=page>=pages-1;
 }
 function render(){const s=report.summary;
  const cards=[['Chamados que entraram',s.entered],['Movimentações de entrada',s.entryMovements],['Chamados que saíram por transferência',s.exited],['Devolvidos ao autor',s.returned],['Chamados finalizados',s.closed],['Finalizados enquanto na Produção',s.closedInProduction],['Finalizados por membros da Produção',s.closedByProduction],['Sem devolução — alertas',s.alerts],['Abertos pela Produção no período',s.openedByProduction],['Origem interna e finalizados pela Produção',s.ownClosed],['Abertos e finalizados pela mesma pessoa da Produção',s.samePersonClosed],['Em Produção ao final do período',s.backlog],['Finalizações a conferir',s.review]];
  $('pfKpis').innerHTML=cards.map(([label,value])=>'<div class="card"><div class="subtle">'+esc(label)+'</div><h3>'+esc(value)+'</h3></div>').join('');
  const series=[['entries','Entradas','#2765dc'],['exits','Saídas','#16866c'],['closures','Finalizações','#63758b'],['alerts','Alertas','#b92535']],max=Math.max(1,...report.daily.flatMap(r=>series.map(([k])=>r[k])));
  $('pfChart').innerHTML=report.daily.map(r=>'<div style="display:grid;grid-template-columns:85px 1fr;gap:8px"><b>'+esc(r.date.split('-').reverse().join('/'))+'</b><div>'+series.map(([k,label,color])=>'<div style="display:grid;grid-template-columns:85px 1fr 36px;gap:8px;align-items:center;font-size:12px;margin-bottom:3px"><span>'+label+'</span><div style="background:#edf1f7;height:10px;border-radius:3px"><div style="background:'+color+';height:100%;width:'+r[k]/max*100+'%"></div></div><b>'+esc(r[k])+'</b></div>').join('')+'</div></div>').join('')||'<p>Sem movimentações no período.</p>';
  $('pfDaily').querySelector('tbody').innerHTML=report.daily.map(r=>'<tr>'+[r.date,r.entries,r.exits,r.closures,r.alerts].map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('');
  $('pfWarnings').innerHTML='<p><b>Cobertura:</b> '+esc(report.coverage.scanned)+' chamados consultados. Última sincronização de chamado: '+esc(date(report.coverage.latestSync))+'.</p>'+report.warnings.map(w=>'<p>'+esc(w)+'</p>').join('');
  page=0;renderRows();$('pfExport').disabled=false;$('pfEventsExport').disabled=false;
 }
 async function load(){if(busy)return;busy=true;$('pfLoad').disabled=true;
  report=null;$('pfExport').disabled=true;$('pfEventsExport').disabled=true;$('pfTickets').querySelector('tbody').innerHTML='';$('pfKpis').innerHTML='';$('pfChart').innerHTML='';$('pfDaily').querySelector('tbody').innerHTML='';$('pfWarnings').textContent='';$('pfCount').textContent='';$('pfPrevious').disabled=true;$('pfNext').disabled=true;
  say('Consultando o histórico dos chamados e conferindo autores e equipes...');
  try{const session=await window.tmAuth?.getSession?.();if(!session?.access_token)throw Error('Entre novamente no sistema.');
   const query=new URLSearchParams({from:$('pfFrom').value,to:$('pfTo').value});
   const response=await fetch('/api/audit-production-flow?'+query,{cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}}),data=await response.json();
   if(!response.ok||!data.ok)throw Error(data.error||'Consulta indisponível.');report=data;render();
   say((data.partial?'Cobertura parcial. ':'Consulta concluída. ')+data.from+' a '+data.to+' · '+data.tickets.length+' chamados no relatório. Atualizado às '+date(data.generatedAt)+'.');
  }catch(e){say('Não foi possível atualizar: '+e.message);}finally{busy=false;$('pfLoad').disabled=false;}
 }
 function download(events){if(!report)return;const rows=filtered();let cells;
  if(events)cells=[['Chamado','Evento','Data e hora','Autor da movimentação','Origem','Destino','Responsável','Status','Alerta sem devolução'],...rows.flatMap(t=>t.events.map(e=>[t.id,labels[e.type],date(e.at),e.actor,e.fromTeam||'',e.toTeam||'',e.owner||'',e.status||'',e.alert?'Sim':'Não']))];
  else cells=[['Chamado','Assunto','Cliente','Quem abriu','Origem','Status atual','Responsável atual','Equipe atual','Entradas no período','Saídas por transferência','Devoluções ao autor','Quem finalizou no período','Alerta sem devolução','A conferir'],...rows.map(t=>[t.id,t.subject,t.client,t.creator,origins[t.origin],t.status,t.currentOwner,t.currentTeam,t.events.filter(e=>e.type==='entry').length,t.events.filter(e=>['returned','exit_other'].includes(e.type)).length,t.events.filter(e=>e.type==='returned').length,t.events.filter(e=>e.type==='closure').map(e=>e.actor+' ('+date(e.at)+')').join('; '),t.events.some(e=>e.alert)?'Sim':'Não',t.events.some(e=>e.review)||t.origin==='unknown'||t.issues.length?'Sim':'Não'])];
  const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const url=URL.createObjectURL(new Blob(['\ufeff'+cells.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ARQUEM_Producao_'+(events?'movimentacoes_':'chamados_')+report.from+'_'+report.to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 window.productionFlowInit=()=>{if(started)return;started=true;const now=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('pfFrom').value=now.slice(0,7)+'-01';$('pfTo').value=now;$('pfTo').max=now;
  $('pfLoad').addEventListener('click',load);$('pfFilter').addEventListener('change',()=>{page=0;renderRows()});$('pfSearch').addEventListener('input',()=>{page=0;renderRows()});$('pfPrevious').addEventListener('click',()=>{page--;renderRows()});$('pfNext').addEventListener('click',()=>{page++;renderRows()});$('pfExport').addEventListener('click',()=>download(false));$('pfEventsExport').addEventListener('click',()=>download(true));load();
 };
})();

