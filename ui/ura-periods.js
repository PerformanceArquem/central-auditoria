(function(root){
 'use strict';
 const DAY=86400000;
 function validDay(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
 function windows(from,to){
  if(!validDay(from)||!validDay(to)||from>to||(Date.parse(to)-Date.parse(from))/DAY>364)throw Error('Selecione um intervalo de até 365 dias corridos.');
  const parts=[];let start=from;
  while(start<=to){
   const d=new Date(start+'T12:00:00Z');
   const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).toISOString().slice(0,10);
   const end=last<to?last:to;parts.push({start,end,month:start.slice(0,7)});
   start=new Date(Date.parse(end+'T12:00:00Z')+DAY).toISOString().slice(0,10);
  }
  return parts;
 }
 const month=r=>{const time=Date.parse(r.startedAt||'');return Number.isFinite(time)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(time):'Não informado';};
 const label=key=>/^\d{4}-\d{2}$/.test(key)?key.slice(5)+'/'+key.slice(0,4):key;
 function monthly(data){
  const groups=new Map((data.months||windows(data.from,data.to).map(x=>x.month)).map(key=>[key,{month:key,total:0,confirmed:0,possible:0,ambiguous:0,unlinked:0,recorded:0,canceled:0}]));
  for(const r of data.records||[]){const key=month(r);if(!groups.has(key))groups.set(key,{month:key,total:0,confirmed:0,possible:0,ambiguous:0,unlinked:0,recorded:0,canceled:0});const g=groups.get(key);g.total++;
   if(['vinculado','vinculado_gravacao'].includes(r.reconciliation))g.confirmed++;
   if(r.reconciliation==='possivel_vinculo')g.possible++;
   if(r.reconciliation==='ambiguo')g.ambiguous++;
   if(r.reconciliation==='sem_vinculo_identificado')g.unlinked++;
   if(r.recordingState==='informada')g.recorded++;
   if(r.status==='abandonada_ou_cancelada')g.canceled++;
  }
  return [...groups.values()].sort((a,b)=>a.month.localeCompare(b.month));
 }
 function combine(parts,from,to){
  const records=[],seen=new Map(),coverage={};let ticketsExamined=0;
  for(const p of parts){
   ticketsExamined+=p.metadata?.ticketsExamined||0;
   for(const [k,v] of Object.entries(p.coverage||{}))coverage[k]=(coverage[k]||0)+(Number(v)||0);
   for(const r of p.records||[]){const key=r.callId?'id:'+r.callId:JSON.stringify([r.startedAt,r.phoneMasked,r.status]);
    if(!seen.has(key)){const copy={...r};seen.set(key,copy);records.push(copy);}
   }
  }
  // A ticket matched in different monthly batches must not be attributed twice.
  const owners=new Map();for(const r of records)if(r.ticketId){const key=String(r.ticketId);owners.set(key,[...(owners.get(key)||[]),r]);}
  for(const list of owners.values())if(list.length>1)for(const r of list){r.reconciliation='ambiguo';r.ticketId=null;r.matchMethod=null;r.deltaSeconds=null;r.sector='';r.employee='';r.movideskTelephonyOrigins=[];}
  records.sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt))||String(a.callId).localeCompare(String(b.callId)));
  const stats={total:records.length,vinculado:0,vinculado_gravacao:0,possivel_vinculo:0,sem_vinculo_identificado:0,ambiguo:0,dados_insuficientes:0,ticket_ja_utilizado:0,atendida:0,nao_atendida:0,abandonada_ou_cancelada:0,em_andamento:0,indeterminada:0};
  for(const r of records){if(r.reconciliation in stats)stats[r.reconciliation]++;if(r.status in stats)stats[r.status]++;}
  return {ok:true,from,to,records,stats,coverage,months:windows(from,to).map(x=>x.month),metadata:{ticketsExamined,batches:parts.length,ticketCountsAreMonthlyReads:true}};
 }
 root.UraPeriods=Object.freeze({windows,month,label,monthly,combine});
})(typeof window==='undefined'?globalThis:window);
