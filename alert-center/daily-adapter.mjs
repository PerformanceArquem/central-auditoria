// Read-only adapter for a verified daily report snapshot. No database or network access.
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function adaptDaily({date, roster, appointments, approvedTargets=[], complete=false}) {
  if (!complete || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Verified daily snapshot required');
  const index = new Map(), ids = new Set(), totals = new Map(), keys = new Set();
  const identity = (sector,name) => JSON.stringify([normalize(sector),normalize(name)]);
  for (const p of roster) {
    const key=identity(p.sector,p.name);
    if (!p.id || !normalize(p.name) || !normalize(p.sector) || index.has(key) || ids.has(p.id)) throw new Error('Ambiguous roster');
    index.set(key,p); ids.add(p.id); totals.set(p.id,{minutes:0,tickets:new Set()});
  }
  for (const a of appointments) {
    if (a.appointment_date!==date) continue;
    if (!a.appointment_key || keys.has(a.appointment_key)) throw new Error('Missing or duplicate appointment key');
    keys.add(a.appointment_key);
    if (!Number.isSafeInteger(a.duration_minutes)||a.duration_minutes<0) throw new Error('Invalid duration');
    const p=index.get(identity(a.sector,a.collaborator_name));
    if (!p) throw new Error('Unmatched appointment identity');
    const t=totals.get(p.id); t.minutes+=a.duration_minutes;
    if (a.ticket_id) t.tickets.add(a.ticket_id);
  }
  const targets=new Map();
  for (const t of approvedTargets) {
    if (!ids.has(t.personId)||targets.has(t.personId)||!Number.isSafeInteger(t.expectedMinutes)||t.expectedMinutes<0) throw new Error('Invalid approved target');
    targets.set(t.personId,t.expectedMinutes);
  }
  return roster.map(p=>{
    const t=totals.get(p.id), expected=targets.get(p.id)??null;
    return {personId:p.id,sector:p.sector,pointedMinutes:t.minutes,ticketCount:t.tickets.size,expectedMinutes:expected,missingMinutes:expected===null?null:Math.max(0,expected-t.minutes),comparisonEnabled:expected!==null};
  });
}
