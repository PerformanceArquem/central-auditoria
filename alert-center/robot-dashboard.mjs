import {mapRobotSector,robotGroup,robotSchedule} from './robot-sectors.mjs';
// Dashboard is read-only. Never represent a simulated decision as delivered.
const groups=['Inteligência','Suporte','Produção'];
export function summarizeRobotDashboard(rows,decisions){
 if(!Array.isArray(rows)||!Array.isArray(decisions))throw Error('Dados inválidos');
 const byId=new Map();
 for(const row of rows){const id=String(row.ticket_id??'');if(!id||byId.has(id))throw Error('Chamado duplicado ou inválido');byId.set(id,row);}
 const result={mode:'dry-run',deliveryEnabled:false,groups:groups.map(group=>({group,total:0,review:0,withoutNotice:0,withNotice:0,levels:{1:0,2:0,3:0},sectors:{}})),excluded:0,tickets:[]};
 const seen=new Set();
 for(const d of decisions){
 const id=String(d.ticketId);if(seen.has(id)||!byId.has(id)||d.deliveryEnabled!==false)throw Error('Decisão inválida');seen.add(id);
 const row=byId.get(id),sector=mapRobotSector(row.payload?.ownerTeam),group=robotGroup(sector);
 if(!group){result.excluded++;continue;}
 const g=result.groups.find(x=>x.group===group);
 const actions=Array.isArray(d.actions)?d.actions:[];
 const level=d.review===true?0:Math.max(0,...actions.map(a=>Number(a.level)));
 if(![0,1,2,3].includes(level))throw Error('Nível inválido');
 const status=d.review===true?'review':level?'withNotice':'withoutNotice';
 if(!g.sectors[sector])g.sectors[sector]={total:0,review:0,withoutNotice:0,withNotice:0,levels:{1:0,2:0,3:0}};
 for(const counter of [g,g.sectors[sector]]){counter.total++;counter[status]++;if(level)counter.levels[level]++;}
 result.tickets.push({ticketId:id,sector,group,clock:robotSchedule(row.payload.ownerTeam).clock,status,level,reasons:d.review===true?[]:actions.map(a=>a.key),message:level?String(d.message??''):null});
 }
 return result;
}
