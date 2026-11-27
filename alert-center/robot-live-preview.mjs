import {robotAppointmentEvidence} from './robot-appointment-evidence.mjs';
import {businessDays} from './engine.mjs';
const sectors=new Set(['Suporte','Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento']);
const dayAt=now=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
export async function previewWaitingAppointment(id,{token,holidays,blocked=false,fetcher=fetch,clock=()=>new Date()}={}){
 id=String(id);
 if(!/^\d{1,12}$/.test(id)||!token||!Array.isArray(holidays))throw Error('Invalid preview configuration');
 const result=(reason,extra={})=>({ticketId:id,eligible:false,reason,simulated:true,...extra});
 if(blocked)return result('blocked-ticket');
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);url.searchParams.set('id',id);
 const response=await fetcher(url.toString(),{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return result('provider-unavailable');
 const t=await response.json();
 if(!t||String(t.id)!==id||!Array.isArray(t.actions))return result('unconfirmed-ticket');
 if(!sectors.has(t.ownerTeam)||String(t.status).trim().toLowerCase()!=='aguardando cliente'||t.closedIn||t.canceledIn||String(t.isDeleted)==='true')return result('outside-scope');
 const today=dayAt(clock());
 const evidence=robotAppointmentEvidence(t,{complete:true,today});
 if(!evidence.appointmentCoverage||!evidence.lastAppointmentDate)return result(evidence.reason||'no-verified-appointment');
 const days=businessDays(evidence.lastAppointmentDate,today,holidays);
 return {...result(days>=3?'threshold-reached':'below-threshold'),eligible:days>=3,lastAppointmentDate:evidence.lastAppointmentDate,businessDays:days,sector:t.ownerTeam,status:t.status};
}
