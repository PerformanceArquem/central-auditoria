import {businessDays} from './engine.mjs';
const sectors = new Set(['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']);
const date = value => {
 if(typeof value!=='string'||!value)return null;
 const d=new Date(/(Z|[+-]\d{2}:\d{2})$/i.test(value)?value:value+'Z');
 return Number.isFinite(+d)?d:null;
};
const local = d => {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
export function robotQueueFacts(ticket,{now,syncedAt,historyComplete=false,holidays=[],thresholds={},blocked=false}={}){
 const sector=ticket?.ownerTeam, clock=date(now), synced=date(syncedAt);
 const review=reason=>({eligible:false,reason,facts:{}});
 if(blocked||!sectors.has(sector)||ticket.closedIn||ticket.canceledIn||String(ticket.isDeleted)==='true'||/^(fechado|resolvido|cancelado|conclu[ií]do(?: \(sem confirma[cç][aã]o\))?|encerrado|finalizado)$/i.test(String(ticket.status||'').trim()))return review('excluded');
 if(!clock||!synced||+synced>+clock||+clock-+synced>86400000)return review('stale-history');
 if(historyComplete!==true||!Array.isArray(ticket.ownerHistories)||!ticket.ownerHistories.length)return review('missing-history');
 const threshold=thresholds[sector];
 if(!Number.isSafeInteger(threshold)||threshold<1||threshold>365)return review('missing-sector-threshold');
 let previous=null,start=null,lastTime=-Infinity;
 for(const event of ticket.ownerHistories){
  const at=date(event.changedDate), team=event.ownerTeam;
  if(!at||+at<lastTime||+at>+clock||!(team===null||typeof team==='string'&&team.trim()))return review('invalid-history');
  if(team!==previous||start===null)start=at;
  previous=team;lastTime=+at;
 }
 if(previous!==sector)return review('history-mismatch');
 const entered=local(start),days=businessDays(entered,local(clock),holidays);
 if(days<threshold)return review('below-threshold');
 return {eligible:true,reason:'aged-queue',facts:{dias_na_fila:days,data_entrada_fila:entered,dias_fila_uteis:true}};
}
