// Pure reporting filter; never deletes or updates source tickets.
export function isHomologationTicket(ticket){
 if(!ticket||typeof ticket!=='object')return false;
 const subject=ticket.subject??ticket.payload?.subject;
 return String(subject??'').trim().toUpperCase()==='TM-HOMOLOG-001';
}
export function excludeHomologation(tickets,appointments){
 if(!Array.isArray(tickets)||!Array.isArray(appointments))throw Error('Snapshot inválido');
 const excluded=new Set(tickets.filter(isHomologationTicket).map(t=>String(t.ticket_id??t.id??'').trim()).filter(Boolean));
 return {tickets:tickets.filter(t=>!isHomologationTicket(t)&&!excluded.has(String(t.ticket_id??t.id??'').trim())),appointments:appointments.filter(a=>!excluded.has(String(a.ticket_id??a.ticketId??'').trim())),excludedTicketIds:[...excluded]};
}
