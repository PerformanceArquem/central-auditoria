import {adaptDaily} from './daily-adapter.mjs';
import {excludeHomologation} from './report-exclusions.mjs';
import {simulateAppointmentRows} from './appointments.mjs';
const sectorKey = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const aliases = new Map([['inteligencia','intelligence'],['intelligence','intelligence'],['suporte','support'],['support','support'],['producao','production'],['production','production'],['implantacao','implementation'],['implementation','implementation']]);
const canonical = value => aliases.get(sectorKey(value)) || sectorKey(value);
export function simulateDailySnapshot({date, roster, appointments, approvedTargets=[], enabledSectors=[], existingKeys=[], complete=false, tickets=[], homologationTicketIds=[]}) {
  const filtered=excludeHomologation(tickets,appointments,homologationTicketIds);
  const rows=adaptDaily({date,roster:roster.map(p=>({...p,sector:canonical(p.sector)})),appointments:filtered.appointments.map(a=>({...a,sector:canonical(a.sector)})),approvedTargets,complete});
  return simulateAppointmentRows({periodKey:date,kind:'daily',rows,enabledSectors:enabledSectors.map(canonical),existingKeys,complete});
}
