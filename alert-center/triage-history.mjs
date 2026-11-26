// Calendar dates must already be normalized to America/Sao_Paulo by the importer.
// This module only evaluates imported history; it never sends notifications.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDate=value=>typeof value==='string'&&DAY.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function periodStart(events,field,current,today){
 if(!Array.isArray(events)||!events.length)return {reason:'missing-history'};
 let start=null,previousDate=null,previousValue=null;
 for(const event of events){
  if(!validDate(event.date)||event.date>today||typeof event[field]!=='string'||!event[field].trim())return {reason:'invalid-history'};
  if(previousDate&&event.date<previousDate)return {reason:'unordered-history'};
  if(event[field]!==previousValue)start=event.date;
  previousDate=event.date;previousValue=event[field];
 }
 return previousValue===current?{date:start}:{reason:'history-does-not-match-current-state'};
}
export function triageEntry(ticket,{now,localDate,maxAgeHours=24}){
 const blocked=reason=>({eligible:false,reason});
 if(!validDate(localDate)||!Number.isFinite(Date.parse(now))||!Number.isFinite(maxAgeHours)||maxAgeHours<=0)throw Error('Invalid history evaluation context');
 if(ticket.team!=='Inteligência'||ticket.status!=='Em Análise'||ticket.closed)return blocked('outside-triage');
 if(ticket.historyComplete!==true)return blocked('history-coverage-unconfirmed');
 // Freshness timestamps must have an explicit UTC offset.
 if(typeof ticket.syncedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(ticket.syncedAt))return blocked('invalid-sync-time');
 const age=Date.parse(now)-Date.parse(ticket.syncedAt);
 if(!Number.isFinite(age)||age<0||age>maxAgeHours*3600000)return blocked('stale-history');
 const team=periodStart(ticket.teamHistory,'team',ticket.team,localDate);
 const status=periodStart(ticket.statusHistory,'status',ticket.status,localDate);
 if(team.reason||status.reason)return blocked(team.reason||status.reason);
 return {eligible:true,enteredDate:team.date>status.date?team.date:status.date,teamEnteredDate:team.date,statusEnteredDate:status.date};
}
