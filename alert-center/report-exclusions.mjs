// Pure reporting filter. Never deletes or updates source tickets.
const idOf=t=>String(t?.ticket_id??t?.ticketId??t?.id??'').trim();
const subjectOf=t=>String(t?.subject??t?.payload?.subject??'').trim().toUpperCase();
export function isHomologationTicket(ticket,knownIds=[]){
 if(!ticket||typeof ticket!=='object')return false;
 return subjectOf(ticket)==='TM-HOMOLOG-001'||new Set(knownIds.map(id=>String(id).trim()).filter(Boolean)).has(idOf(ticket));
}
export function excludeHomologation(tickets,appointments,knownIds=[]){
 if(!Array.isArray(tickets)||!Array.isArray(appointments)||!Array.isArray(knownIds))throw Error('Snapshot inválido');
 const excluded=new Set(knownIds.map(id=>String(id).trim()).filter(Boolean));
 for(const t of tickets)if(isHomologationTicket(t,knownIds)&&idOf(t))excluded.add(idOf(t));
 return {tickets:tickets.filter(t=>subjectOf(t)!=='TM-HOMOLOG-001'&&!excluded.has(idOf(t))),appointments:appointments.filter(a=>!excluded.has(String(a?.ticket_id??a?.ticketId??'').trim())),excludedTicketIds:[...excluded]};
}
