import {businessDays} from './engine.mjs';
// Input evidence must be normalized by the server from complete Movidesk action history.
// Contact classification is explicit; generic internal notes do not prove customer contact.
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function robotRecordFacts({today,opened,records,coverageConfirmed=false,holidays=[],idleThreshold=3,contactThreshold=5,waitingSince=null,lastAppointmentDate=null,appointmentCoverage=false}={}){
 const fail=reason=>({verified:false,reason,facts:{}});
 if(!coverageConfirmed||!Array.isArray(records)||!valid(today)||!valid(opened)||opened>today||![idleThreshold,contactThreshold].every(n=>Number.isSafeInteger(n)&&n>0&&n<=365))return fail('unconfirmed-history');
 if(waitingSince!==null&&(!valid(waitingSince)||waitingSince<opened||waitingSince>today))return fail('invalid-waiting-history');
 const ids=new Set(),human=[];
 for(const r of records){
  if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||!valid(r.date)||r.date<opened||r.date>today||!['robot','human-followup','human-contact','other'].includes(r.kind))return fail('invalid-record-history');
  ids.add(r.id);
  if(r.kind==='human-followup'||r.kind==='human-contact')human.push(r);
 }
 const latest=rows=>rows.reduce((d,r)=>d===null||r.date>d?r.date:d,null);
 const last=latest(human),idle=businessDays(last||opened,today,holidays),facts={};
 if(idle>=idleThreshold){
  facts.dias_sem_registro=idle;
  if(last)facts.data_ultimo_registro=last;
  else {facts.sem_registro=true;facts.data_abertura=opened;}
 }
 if(waitingSince){
  facts.aguardando_cliente=true;
  facts.dias_aguardando_cliente=businessDays(waitingSince,today,holidays);
  if(appointmentCoverage===true && valid(lastAppointmentDate) && lastAppointmentDate>=opened && lastAppointmentDate<=today){
   const elapsed=businessDays(lastAppointmentDate,today,holidays);
   if(elapsed>=contactThreshold){facts.dias_sem_apontamento=elapsed;facts.data_ultimo_apontamento=lastAppointmentDate;}
  }
  // Contact evidence remains available for diagnostics, not the waiting-customer trigger.
  const contact=latest(human.filter(r=>r.kind==='human-contact'&&r.date>=waitingSince));
  const elapsed=businessDays(contact||waitingSince,today,holidays);
  if(elapsed>=contactThreshold){
   facts.dias_sem_contato=elapsed;facts.dias_contato_uteis=true;
   if(contact)facts.data_ultimo_contato=contact;
  }
 }
 return {verified:true,facts};
}
