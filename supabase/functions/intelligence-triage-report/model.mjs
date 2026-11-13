export const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const instant=x=>Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(String(x))?x:String(x)+'Z');
export function classify(t,reference){
 const type=/^\s*(T[1-4])(?=\D|$)/i.exec(t.subject||'')?.[1]?.toUpperCase();
 if(!type||norm(t.ownerTeam)!=='inteligencia'||norm(t.serviceFirstLevel)!=='triagem'||t.isDeleted||/^(closed|resolved|canceled|cancelled)$/.test(norm(t.baseStatus))||/fechad|cancelad|concluid|resolvid|encerrad|finalizad/.test(norm(t.status)))return null;
 const h=(t.ownerHistories||[]).map(x=>({...x,at:instant(x.changedDate)})).sort((a,b)=>a.at-b.at);
 if(!h.length||h.some(x=>!Number.isFinite(x.at)||x.at>reference)||norm(h.at(-1).ownerTeam)!=='inteligencia')throw Error('Histórico de equipe inconsistente: '+t.id);
 let i=h.length-1;while(i>0&&norm(h[i-1].ownerTeam)==='inteligencia')i--;
 const elapsed=(reference-h[i].at)/86400000;
 if(elapsed<=15)return null;
 if(!/^\d+$/.test(String(t.id)))throw Error('ID inválido');
 const person=x=>x?.businessName||x?.name||'Não atribuído';
 return {id:String(t.id),type,subject:t.subject,client:person(t.clients?.[0]),owner:person(t.owner),status:t.status,queueSince:new Date(h[i].at).toISOString(),queueDays:Math.floor(elapsed),elapsedDays:Number(elapsed.toFixed(4)),opened:t.createdDate,forecast:t.slaSolutionDate||null,lastUpdate:t.lastUpdate,url:'https://arquem.movidesk.com/Ticket/Edit/'+t.id,history:h.map(x=>({team:x.ownerTeam,changedDate:x.changedDate,owner:person(x.owner)}))};
}
export function summarize(items){return {total:items.length,withoutForecast:items.filter(x=>!x.forecast).length,maxQueueDays:items.length?Math.max(...items.map(x=>x.queueDays)):0,averageQueueDays:items.length?Number((items.reduce((n,x)=>n+x.elapsedDays,0)/items.length).toFixed(1)):0,types:Object.fromEntries([1,2,3,4].map(n=>['T'+n,items.filter(x=>x.type==='T'+n).length]))};}

