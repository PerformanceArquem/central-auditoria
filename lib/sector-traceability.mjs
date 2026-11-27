// Elapsed calendar hours, not productive time or proof of responsibility for delay.
export function summarizeSectorTraceability(rows){
 const sectors=new Map(),routes=new Map();let missing=0,unknownHours=0;
 for(const row of rows){
  const timeline=Array.isArray(row.timeline)?row.timeline:[];
  if(!timeline.length){missing++;continue;}
  const seen=new Set();
  let previous=null;
  for(const entry of timeline){
   if(!Number.isFinite(entry.hours)||entry.hours<0||!Number.isFinite(entry.at)||!Number.isFinite(entry.until)||entry.until<entry.at){previous=null;continue;}
   const name=String(entry.sector||'').trim();
   if(!name){unknownHours+=entry.hours;previous=null;continue;}
   const item=sectors.get(name)||{sector:name,hours:0,tickets:0,currentTickets:0,currentHours:0,knownCurrentTickets:0};
   item.hours+=entry.hours;
   if(!seen.has(name)){item.tickets++;seen.add(name);}
   sectors.set(name,item);
   if(previous&&previous.name!==name&&previous.until===entry.at){
    const key=JSON.stringify([previous.name,name]);
    const route=routes.get(key)||{from:previous.name,to:name,count:0};route.count++;routes.set(key,route);
   }
   previous={name,until:entry.until};
  }
  const current=sectors.get(row.sector);
  if(current){current.currentTickets++;if(Number.isFinite(row.queueDays)&&row.queueDays>=0){current.currentHours+=row.queueDays*24;current.knownCurrentTickets++;}}
 }
 return {total:rows.length,missing,unknownHours,sectors:[...sectors.values()].sort((a,b)=>b.hours-a.hours||a.sector.localeCompare(b.sector)),routes:[...routes.values()].sort((a,b)=>b.count-a.count||a.from.localeCompare(b.from)||a.to.localeCompare(b.to))};
}
