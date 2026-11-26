import {triageEntry} from './triage-history.mjs';
import {businessDays} from './engine.mjs';
const localDate=(value)=>{
 if(typeof value!=='string'||!value)return '';
 const utc=/(Z|[+-]\d{2}:\d{2})$/i.test(value)?value:value+'Z';
 const date=new Date(utc);
 if(!Number.isFinite(+date))return '';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
export function evaluateImportedTriage(current,stored,{now,holidays=[],threshold=3}){
 if(!Number.isInteger(threshold)||threshold<1||threshold>365)throw Error('Limite inválido');
 const payload=stored?.payload||{};
 const snapshot=current.payload||{};
 const normalize=(events,field)=>Array.isArray(events)?events.map(e=>({date:localDate(e.changedDate),[field]:field==='team'?(e.ownerTeam??'(sem setor)'):e.status})):[];
 const result=triageEntry({
 team:snapshot.ownerTeam,status:snapshot.status,
 closed:!!current.closed_at_source,syncedAt:stored?.source_synced_at,
 historyComplete:Array.isArray(payload.ownerHistories)&&Array.isArray(payload.statusHistories),
 teamHistory:normalize(payload.ownerHistories,'team'),
 statusHistory:normalize(payload.statusHistories,'status')
 },{now,localDate:localDate(now)});
 const base={ticketId:String(current.ticket_id),subject:String(snapshot.subject||'').slice(0,240),syncedAt:stored?.source_synced_at||null};
 if(!result.eligible)return {...base,eligible:false,reason:result.reason,businessDays:null,enteredDate:null};
 const days=businessDays(result.enteredDate,localDate(now),holidays);
 return {...base,eligible:days>=threshold,reason:days>=threshold?'threshold-reached':'below-threshold',businessDays:days,enteredDate:result.enteredDate};
}
