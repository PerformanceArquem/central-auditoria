import {evaluateRobot} from './robot-rules.mjs';
const DAY=86400000;
const parse=v=>typeof v==='string'&&v.length>10&&/(Z|[+-]\d{2}:\d{2})$/i.test(v)?Date.parse(v):NaN;
const localDay=n=>new Date(n-3*3600000).toISOString().slice(0,10);
export function businessMinutes(start,end,holidays=[]){
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)return null;
 let total=0;
 for(let d=Date.parse(localDay(start)+'T00:00:00Z');d<=Date.parse(localDay(end)+'T00:00:00Z');d+=DAY){
 const dt=new Date(d),key=dt.toISOString().slice(0,10);
 if(dt.getUTCDay()===0||dt.getUTCDay()===6||holidays.includes(key))continue;
 total+=Math.max(0,Math.min(end,d+21*3600000)-Math.max(start,d+12*3600000))/60000;
 }
 return total;
}
// Caller supplies verified complete history and explicit mapped team and timestamps.
// Unknown data is held for review, not treated as a missing forecast or idle ticket.
export function normalizeRobotTicket(row,{now,sector,holidays=[],historyComplete=false,sourceVerified=false,verifiedHumanActionIds=[],forecastVerified=false}){
 const p=row.payload??{}, end=parse(now),created=parse(p.createdDate),due=parse(p.slaSolutionDate);
 const result={id:row.ticket_id??p.id,sector,status:p.status,sourceVerified,historyVerified:false,conditionsVerified:false,forecastState:'unknown'};
 if(!sourceVerified||!historyComplete||!forecastVerified||!Array.isArray(p.actions)||!Number.isFinite(end)||!Number.isFinite(created)||created>end||!sector)return result;
 const human=new Set(verifiedHumanActionIds.map(String));let last=created,appointment=null;
 for(const a of p.actions){
 if(a.isDeleted===true)continue;
 const automated=/ticket manager|TM-HOMOLOG-|TM-ROBOT-/i.test(String(a.description??'')+' '+String(a.htmlDescription??''));
 if(automated)continue;
 const at=parse(a.createdDate);
 if(human.has(String(a.id))){if(!Number.isFinite(at)||at>end)return result;last=Math.max(last,at);}
 if(!Array.isArray(a.timeAppointments))return result;
 for(const ap of a.timeAppointments){
 const day=String(ap.date??'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>localDay(end)||!Number.isFinite(at)||at>end)return result;
 // Require verified human author/action rather than counting unknown automation.
 if(!human.has(String(a.id)))return result;
 if(appointment===null||day>appointment)appointment=day;
 last=Math.max(last,at);
 }
 }
 if(p.slaSolutionDate==null||p.slaSolutionDate==='')result.forecastState='missing';
 else if(Number.isFinite(due)&&p.slaSolutionDateIsPaused===false)result.forecastState=due<end?'overdue':'valid';
 else return result;
 result.historyVerified=true;result.conditionsVerified=true;
 result.lastAppointmentDate=appointment??localDay(created);
 result.idleBusinessMinutes=businessMinutes(last,end,holidays);
 return result;
}
export function simulateVerifiedTicket(row,context){
 return evaluateRobot(normalizeRobotTicket(row,context),context);
}
