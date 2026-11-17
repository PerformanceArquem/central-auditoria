import {buildKeilaProductionFlow,keilaProductionReport} from "./production-flow-keila.ts";

const records=[{
 ticket_id:"101191",subject:"Ajuste de produção",
 clients:[{organization:{businessName:"Loja Exemplo"}}],
 ownerHistories:[
  {ownerTeam:"Suporte",changedDate:"2026-11-15T14:00:00Z",owner:{name:"Analista Suporte"}},
  {ownerTeam:"Produção - CPO",changedDate:"2026-11-16T12:00:00Z",owner:{name:"Analista Produção"}},
  {ownerTeam:"Suporte",changedDate:"2026-11-16T15:00:00Z",owner:{name:"Analista Suporte"}},
  {ownerTeam:"Produção - CPO",changedDate:"2026-11-16T16:00:00Z",owner:{name:"Analista Produção"}}
 ]
}];

Deno.test("keila flow counts distinct tickets separately from movement events",()=>{
 const flow=buildKeilaProductionFlow(records,"2026-11-16","2026-11-16");
 if(flow.entered!==1||flow.exited!==1)
  throw Error("Expected one unique ticket in each direction");
 if(flow.entryMovements!==2||flow.exitMovements!==1)
  throw Error("Expected three distinct transitions");
});

Deno.test("keila packet retains ticket traceability for authorized attachments",()=>{
 const flow=buildKeilaProductionFlow(records,"2026-11-16","2026-11-16");
 const report=keilaProductionReport(flow,"daily");
 if(!report.packet.productionFlow||report.packet.productionFlow.movements.length!==3)
  throw Error("Missing individual movements in packet");
 if(!report.packet.productionFlow.movements.every(m=>m.url==="https://arquem.movidesk.com/Ticket/Edit/101191"))
  throw Error("Missing Movidesk ticket link");
 if(report.packet.productionFlow.entryMovements!==2)
  throw Error("Missing movement totals");
 if(report.text.includes("101191")||report.html.includes("101191"))
  throw Error("Restricted detail leaked into aggregate email body");
});
