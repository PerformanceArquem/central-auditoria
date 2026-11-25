// Simulation only. Inputs must come from the existing authorized report pipeline.
// Expected minutes must reflect the actual roster, holidays and absences.
export function simulateAppointments({periodKey,kind,roster,appointments,enabledSectors,existingKeys=[],complete=false}) {
  if (!complete) throw new Error('Report snapshot must be verified complete');
  if (!['daily','partial'].includes(kind) || !periodKey) throw new Error('Invalid reporting period');
  const rows=[], seen=new Set();
  for (const person of roster) {
    if (!person.id || seen.has(person.id)) throw new Error('Invalid or duplicate roster ID');
    seen.add(person.id);
    if (person.expectedMinutes !== null && (!Number.isFinite(person.expectedMinutes) || person.expectedMinutes<0)) throw new Error('Missing adjusted working schedule');
    if (!enabledSectors.includes(person.sector) && person.sector!=='intelligence') continue;
    const entries=appointments.filter(a=>a.personId===person.id);
    if (entries.some(a=>!Number.isFinite(a.minutes)||a.minutes<0)) throw new Error('Invalid appointment minutes');
    const minutes=entries.reduce((s,a)=>s+a.minutes,0);
    const row={personId:person.id,sector:person.sector,expectedMinutes:person.expectedMinutes,pointedMinutes:minutes,missingMinutes:person.expectedMinutes===null?null:Math.max(0,person.expectedMinutes-minutes),comparisonEnabled:person.expectedMinutes!==null,ticketCount:new Set(entries.map(a=>a.ticketId).filter(Boolean)).size};
    rows.push(row);
  }
  return simulateAppointmentRows({periodKey,kind,rows,enabledSectors,existingKeys,complete});
}

// Dispatch already aggregated rows without reconstructing or duplicating appointments.
export function simulateAppointmentRows({periodKey,kind,rows,enabledSectors,existingKeys=[],complete=false}) {
  if (!complete || !['daily','partial'].includes(kind) || !periodKey) throw new Error('Verified reporting period required');
  const keys=new Set(existingKeys), alerts=[], seen=new Set();
  for (const row of rows) {
    if (!row.personId || seen.has(row.personId)) throw new Error('Duplicate or invalid person');
    seen.add(row.personId);
    if (!Number.isSafeInteger(row.pointedMinutes) || row.pointedMinutes<0 || !Number.isSafeInteger(row.ticketCount) || row.ticketCount<0 || (row.expectedMinutes!==null && (!Number.isSafeInteger(row.expectedMinutes)||row.expectedMinutes<0))) throw new Error('Invalid summary');
    const key='appointments:individual:'+row.personId+':'+periodKey;
    if(kind==='daily' && enabledSectors.includes(row.sector) && (row.expectedMinutes===null||row.expectedMinutes>0||row.pointedMinutes>0) && !keys.has(key)) {
      keys.add(key); alerts.push({key,recipientRole:'individual',recipientId:row.personId,summary:row,simulated:true});
    }
  }
  const team=rows.filter(r=>r.sector==='intelligence');
  const key='appointments:intelligence:'+kind+':'+periodKey;
  if(team.length && !keys.has(key)){
    const comparable=team.filter(r=>r.comparisonEnabled);
    const expectedMinutes=comparable.length===team.length?comparable.reduce((s,r)=>s+r.expectedMinutes,0):null;
    const comparableExpectedMinutes=comparable.reduce((s,r)=>s+r.expectedMinutes,0);
    const comparablePointedMinutes=comparable.reduce((s,r)=>s+r.pointedMinutes,0);
    const pointedMinutes=team.reduce((s,r)=>s+r.pointedMinutes,0);
    alerts.push({key,recipientRole:'intelligence-team-manager',summary:{expectedMinutes,pointedMinutes,missingMinutes:expectedMinutes===null?null:team.reduce((s,r)=>s+r.missingMinutes,0),coveragePercent:expectedMinutes?100*pointedMinutes/expectedMinutes:null,comparableCount:comparable.length,teamCount:team.length,comparableExpectedMinutes,comparablePointedMinutes,comparableCoveragePercent:comparableExpectedMinutes?100*comparablePointedMinutes/comparableExpectedMinutes:null,team},simulated:true});
  }
  return {alerts,simulated:true};
}
