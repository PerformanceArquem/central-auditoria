import {simulateVerifiedTicket} from './robot-source.mjs';
// Read-only batch planner. Persistent state is supplied by the authorized caller.
// Never marks a simulated notice as delivered or advances a real cycle.
export function planRobotBatch(rows,cycleRows,contextFor){
 if(!Array.isArray(rows)||!Array.isArray(cycleRows)||typeof contextFor!=='function')throw Error('Dados de simulação inválidos.');
 const active=new Map(), conflicts=new Set();
 for(const c of cycleRows){
 if(c.resolved_at)continue;
 const id=String(c.ticket_id),key=String(c.reason);
 if(!active.has(id))active.set(id,Object.create(null));
 const cycles=active.get(id);
 if(Object.hasOwn(cycles,key))conflicts.add(id);
 cycles[key]={lastLevel:Number(c.last_level),firstDate:c.first_date};
 // Reserved/uncertain writes must be reconciled before any new notice.
 if(c.pending_notice===true||![1,2,3].includes(Number(c.last_level)))conflicts.add(id);
 }
 const decisions=[],seen=new Set();
 for(const row of rows){
 const id=String(row.ticket_id??'');
 if(!/^\d{1,12}$/.test(id)||seen.has(id))throw Error('Identificação duplicada ou inválida.');
 seen.add(id);
 if(conflicts.has(id)){decisions.push({ticketId:id,review:true,reason:'cycle-review',deliveryEnabled:false,actions:[],resolved:[]});continue;}
 try{
 const ctx=contextFor(row);
 if(!ctx||ctx.cyclesVerified!==true){decisions.push({ticketId:id,review:true,reason:'history-review',deliveryEnabled:false,actions:[],resolved:[]});continue;}
 decisions.push(simulateVerifiedTicket(row,{...ctx,cycles:active.get(id)??{}}));
 }catch{decisions.push({ticketId:id,review:true,reason:'source-review',deliveryEnabled:false,actions:[],resolved:[]});}
 }
 return {mode:'dry-run',deliveryEnabled:false,total:decisions.length,withNotice:decisions.filter(d=>d.actions.length>0).length,review:decisions.filter(d=>d.review).length,decisions};
}
