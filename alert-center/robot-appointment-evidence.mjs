// Read-only evidence from a complete, freshly retrieved Movidesk ticket.
const localDate=value=>{
 if(typeof value!=='string')return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const minutes=value=>{
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value*60:null;
 if(typeof value!=='string')return null;
 const m=/^(\d+):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/.exec(value.trim());
 if(m)return +m[1]*60+(+m[2])+(+(m[3]||0))/60;
 return /^\d+(?:[.,]\d+)?$/.test(value.trim())?Number(value.replace(',','.'))*60:null;
};
export function robotAppointmentEvidence(ticket,{complete=false,today}={}){
 const fail=reason=>({appointmentCoverage:false,lastAppointmentDate:null,reason});
 if(!complete||!Array.isArray(ticket?.actions)||!localDate(today))return fail('unconfirmed-appointments');
 let latest=null;
 for(const a of ticket.actions){
  if(!a||!Array.isArray(a.timeAppointments))return fail('incomplete-action-appointments');
  const note=String(a.description||a.htmlDescription||'');
  if(/CENTRAL-(?:ROBOT-NOTE|AUDITORIA-COBRANCA):/.test(note))continue;
  const rows=a.timeAppointments.length?a.timeAppointments:(a.timeWorked!=null?[{workTime:a.timeWorked,date:a.createdDate,createdBy:a.createdBy}]:[]);
  for(const p of rows){
   const duration=minutes(p?.workTime??p?.accountedTime);
   if(duration===null)return fail('invalid-appointment-duration');
   if(duration===0)continue;
   const date=localDate(p.date),actor=p.createdBy??p.agent??a.createdBy;
   if(!date||date>today||!actor?.id)return fail('invalid-appointment-evidence');
   if(latest===null||date>latest)latest=date;
  }
 }
 return {appointmentCoverage:true,lastAppointmentDate:latest};
}
