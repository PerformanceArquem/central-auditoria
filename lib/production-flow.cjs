// Históricos Movidesk são UTC, inclusive quando a API omite o sufixo Z.
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const production=v=>/\bproducao\b|\bcpo\b/.test(norm(v));
const terminal=v=>/^(fechad|resolvid|encerrad|concluid|finalizad|cancelad)/.test(norm(v));
const person=v=>({id:String(v?.id||''),name:String(v?.businessName||v?.name||'Não identificado').slice(0,160)});
function utc(v){
 let s=String(v||'');if(!/^\d{4}-\d\d-\d\dT/.test(s))return null;
 s=s.replace(/(\.\d{3})\d+/, '$1');if(!/(Z|[+-]\d\d:\d\d)$/i.test(s))s+='Z';
 return Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
}
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'});
const day=v=>calendar.format(new Date(v));
const sorted=xs=>(Array.isArray(xs)?xs:[]).map((x,i)=>({...x,at:utc(x.changedDate),seq:i})).filter(x=>x.at).sort((a,b)=>a.at.localeCompare(b.at)||a.seq-b.seq);
function buildProductionFlow(records,{from,to,people=[]}={}){
 const roster=new Map(people.map(p=>[String(p.id),{...person(p),teams:p.teams||[]} ]));
 const events=[],tickets=[],daily=new Map();let missing=0,ambiguous=0;
 const inPeriod=at=>at&&day(at)>=from&&day(at)<=to;
 for(const row of records){
  const p=row.payload||row,id=String(row.ticket_id||p.id||'');if(!/^\d{1,12}$/.test(id))continue;
  const owners=sorted(p.ownerHistories),statuses=sorted(p.statusHistories),creator=person(p.createdBy),created=utc(p.createdDate||row.created_at_source);
  const originPerson=roster.get(creator.id);
  const relevant=owners.some(h=>production(h.ownerTeam))||production(p.ownerTeam)||originPerson?.teams.some(production);if(!relevant)continue;
  const issues=[];if(!owners.length||!statuses.length){missing++;issues.push('Histórico incompleto');}
  const first=owners[0];
  const creatorProduction=originPerson?originPerson.teams.some(production):people.length&&creator.id?false:
    (first&&production(first.ownerTeam)&&person(first.owner).id===creator.id&&created&&Math.abs(Date.parse(first.at)-Date.parse(created))<2000?true:null);
  const origin=creatorProduction===true?'production':creatorProduction===false?'external':'unknown';
  const client=p.clients?.[0];
  const ticket={id,subject:String(p.subject||'Sem assunto').slice(0,300),client:String(client?.organization?.businessName||client?.businessName||'Não informado').slice(0,160),creator:creator.name,creatorId:creator.id,origin,status:String(p.status||'Não informado'),currentTeam:String(p.ownerTeam||''),currentOwner:person(p.owner).name,created,events:[],issues};
  const add=(type,at,actor,extra={})=>{const event={ticketId:id,type,at,actor:person(actor).name,actorId:person(actor).id,...extra};ticket.events.push(event);if(inPeriod(at))events.push(event);return event;};
  if(created)add('opened',created,p.createdBy,{owner:creator.name,origin});
  let prev=null,lastEntry=null;
  for(const h of owners){
   if(production(h.ownerTeam)&&!production(prev?.ownerTeam)){
    lastEntry=h.at;add('entry',h.at,h.changedBy,{fromTeam:prev?.ownerTeam||'Abertura / origem não registrada',toTeam:h.ownerTeam,owner:person(h.owner).name,ownerId:person(h.owner).id});
   }else if(prev&&production(prev.ownerTeam)&&!production(h.ownerTeam)){
    const returned=!!creator.id&&person(h.owner).id===creator.id;
    add(returned?'returned':'exit_other',h.at,h.changedBy,{fromTeam:prev.ownerTeam,toTeam:h.ownerTeam||'Sem equipe',owner:person(h.owner).name,ownerId:person(h.owner).id});
   }else if(prev&&production(h.ownerTeam)&&person(prev.owner).id!==person(h.owner).id){
    add('assignment',h.at,h.changedBy,{fromTeam:prev.ownerTeam,toTeam:h.ownerTeam,owner:person(h.owner).name});
   }
   prev=h;
  }
  let wasTerminal=false;
  for(const h of statuses){
   if(terminal(h.status)&&!wasTerminal){
    const ownership=owners.filter(o=>o.at<=h.at).at(-1);
    const ties=owners.filter(o=>o.at===h.at);
    const prior=owners.filter(o=>o.at<h.at).at(-1);
    const tiedBoundary=ties.length&&prior&&production(prior.ownerTeam)!==production(ownership?.ownerTeam);
    const actor=person(h.changedBy),actorRoster=roster.get(actor.id);
    const actorProduction=actorRoster?actorRoster.teams.some(production):
      (ownership&&production(ownership.ownerTeam)&&actor.id&&actor.id===person(ownership.owner).id?true:null);
    const entry=ticket.events.filter(e=>e.type==='entry'&&e.at<=h.at).at(-1);
    if(entry||origin==='production'){
     const returned=!!entry&&ticket.events.some(e=>e.type==='returned'&&e.at>=entry.at&&e.at<h.at);
     const stillProduction=ownership&&production(ownership.ownerTeam);
     const direct=origin!=='production'&&!!entry&&!returned;
     const alert=direct&&!tiedBoundary&&actorProduction===true;
     const uncertain=direct&&(!alert||origin==='unknown');
     if(tiedBoundary){ambiguous++;issues.push('Transferência e finalização simultâneas');}
     add('closure',h.at,h.changedBy,{status:h.status,team:ownership?.ownerTeam||'Não identificada',actorProduction,returned,alert:alert&&origin==='external',review:uncertain||tiedBoundary,ownClosed:origin==='production'&&actorProduction===true,selfClosed:creator.id&&creator.id===actor.id,teamAtClose:!!stillProduction});
    }
   }
   if(!terminal(h.status)&&ticket.events.some(e=>e.type==='entry'&&e.at<=h.at))add('status',h.at,h.changedBy,{status:h.status});
   wasTerminal=terminal(h.status);
  }
  const pastOwners=owners.filter(o=>day(o.at)<=to),pastStatus=statuses.filter(s=>day(s.at)<=to);
  const ownerAtEnd=pastOwners.at(-1),statusAtEnd=pastStatus.at(-1);
  ticket.inProductionAtEnd=!!ownerAtEnd&&production(ownerAtEnd.ownerTeam)&&!!statusAtEnd&&!terminal(statusAtEnd.status);
  ticket.timeline=[...ticket.events].sort((a,b)=>a.at.localeCompare(b.at));
  ticket.events=ticket.events.filter(e=>inPeriod(e.at));
  if(ticket.events.length||ticket.inProductionAtEnd)tickets.push(ticket);
 }
 events.sort((a,b)=>a.at.localeCompare(b.at)||a.ticketId.localeCompare(b.ticketId));
 const unique=xs=>new Set(xs.map(x=>x.ticketId)).size;
 const entries=events.filter(e=>e.type==='entry'),exits=events.filter(e=>e.type==='returned'||e.type==='exit_other'),closures=events.filter(e=>e.type==='closure');
 for(const e of events){const d=day(e.at),r=daily.get(d)||{date:d,entries:0,exits:0,closures:0,alerts:0};if(e.type==='entry')r.entries++;if(e.type==='returned'||e.type==='exit_other')r.exits++;if(e.type==='closure'){r.closures++;if(e.alert)r.alerts++;}daily.set(d,r);}
 const createdTickets=tickets.filter(t=>t.created&&inPeriod(t.created));
 return {from,to,summary:{entered:unique(entries),entryMovements:entries.length,exited:unique(exits),exitMovements:exits.length,returned:unique(exits.filter(e=>e.type==='returned')),closed:unique(closures),closedInProduction:unique(closures.filter(e=>e.teamAtClose)),closedByProduction:unique(closures.filter(e=>e.actorProduction===true)),alerts:unique(closures.filter(e=>e.alert)),review:unique(closures.filter(e=>e.review)),openedByProduction:createdTickets.filter(t=>t.origin==='production').length,ownClosed:unique(closures.filter(e=>e.ownClosed)),samePersonClosed:unique(closures.filter(e=>e.ownClosed&&e.selfClosed)),backlog:tickets.filter(t=>t.inProductionAtEnd).length,unknownOrigin:tickets.filter(t=>t.origin==='unknown').length},daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),tickets:tickets.sort((a,b)=>Number(b.events.some(e=>e.alert))-Number(a.events.some(e=>e.alert))||Number(b.id)-Number(a.id)),events,coverage:{scanned:records.length,relevant:tickets.length,missingHistories:missing,simultaneousTransitions:ambiguous,rosterAvailable:people.length>0},generatedAt:new Date().toISOString()};
}
exports.norm=norm;
exports.production=production;
exports.utc=utc;
exports.buildProductionFlow=buildProductionFlow;

