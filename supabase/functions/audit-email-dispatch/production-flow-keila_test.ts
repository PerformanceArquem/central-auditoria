import {buildKeilaProductionFlow,keilaProductionReport} from './production-flow-keila.ts';
function check(value:boolean,message:string){if(!value)throw new Error(message);}

Deno.test('Keila: somente rastreabilidade de entradas e saídas',()=>{
  const data=buildKeilaProductionFlow([], '2026-11-02','2026-11-08');
  const report=keilaProductionReport({...data,entered:14,exited:9},'weekly');
  const text=report.text.toLowerCase();
  const html=report.html.toLowerCase();
  const packet=JSON.stringify(report.packet).toLowerCase();
  check(text.includes('entradas: 14')&&text.includes('saídas: 9'),'Text must include both counts');
  check(html.includes('entradas')&&html.includes('saídas'),'Email must include chart labels');
  check(report.packet.productionFlow.entered===14 && report.packet.productionFlow.exited===9,'Packet counts must match');
  for(const forbidden of ['horas','apontamentos','colaborador','qualidade','csat','avaliaç','média','notas','responsável','origem','destino','movimentaç','productionworkload','productionquality','tickets":[{']){
    check(![text,html,packet].some(p=>p.includes(forbidden)),'Disallowed Keila content: '+forbidden);
  }
  check(Array.isArray(report.packet.tickets) && report.packet.tickets.length===0,'No tickets in Keila email attachment');
  check(!('movements' in report.packet.productionFlow),'No detailed movements in exported packet');
  check(Object.keys(report.packet.productionFlow).sort().join(',')==='entered,exited','Only the authorized metrics in productionFlow');
  const fixture=keilaProductionReport({...data,entered:0,exited:0},'daily');
  check(JSON.stringify(fixture.packet.productionFlow)==='{"entered":0,"exited":0}','Empty day must remain safe');
});
