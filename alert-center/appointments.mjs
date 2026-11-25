// Simulation only. Inputs must come from the existing authorized report pipeline.
// Expected minutes must reflect the actual roster, holidays and absences.
export function simulateAppointments({periodKey,kind,roster,appointments,enabledSectors,existingKeys=[],complete=false}) {
  if (!complete) throw new Error('Report snapshot must be verified complete');
  if (!['daily','partial'].includes(kind) || !periodKey) throw new Error('Invalid reporting period');
  const keys=new Set(existingKeys), alerts=[], rows=[], seen=new Set();
  for (const person of roster) {
    if (!person.id || seen.has(person.id)) throw new Error('Invalid or duplicate roster ID');
    seen.add(person.id);
    if (!Number.isFinite(person.expectedMinutes) || person.expectedMinutes<0) throw new Error('Missing adjusted working schedule');
    if (!enabledSectors.includes(person.sector) && person.sector!=='intelligence') continue;
    const entries=appointments.filter(a=>a.personId===person.id);
    if (entries.some(a=>!Number.isFinite(a.minutes)||a.minutes<0)) throw new Error('Invalid appointment minutes');
    const minutes=entries.reduce((s,a)=>s+a.minutes,0);
    const row={personId:person.id,sector:person.sector,expectedMinutes:person.expectedMinutes,pointedMinutes:minutes,missingMinutes:Math.max(0,person.expectedMinutes-minutes),ticketCount:new Set(entries.map(a=>a.ticketId).filter(Boolean)).size};
    rows.push(row);
    const key='appointments:individual:'+person.id+':'+periodKey;
    if(kind==='daily' && enabledSectors.includes(person.sector) && (person.expectedMinutes>0||minutes>0) && !keys.has(key)) {
      keys.add(key); alerts.push({key,recipientRole:'individual',recipientId:person.id,summary:row,simulated:true});
    }
  }
  const team=rows.filter(r=>r.sector==='intelligence');
  const key='appointments:intelligence:'+kind+':'+periodKey;
  if(team.length && !keys.has(key)){
    const expectedMinutes=team.reduce((s,r)=>s+r.expectedMinutes,0);
    const pointedMinutes=team.reduce((s,r)=>s+r.pointedMinutes,0);
    alerts.push({key,recipientRole:'intelligence-team-manager',summary:{expectedMinutes,pointedMinutes,missingMinutes:team.reduce((s,r)=>s+r.missingMinutes,0),coveragePercent:expectedMinutes?100*pointedMinutes/expectedMinutes:null,team},simulated:true});
  }
  return {alerts,simulated:true};
}
