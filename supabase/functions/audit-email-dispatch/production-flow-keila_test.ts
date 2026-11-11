import {buildKeilaProductionFlow,keilaProductionReport} from './production-flow-keila.ts';
function ok(value:boolean,message:string){if(!value)throw new Error(message);}
Deno.test('Keila sees hours and flow but no scores in email or attachments',()=>{
 const data=buildKeilaProductionFlow([], '2026-11-02','2026-11-08');
 const report=keilaProductionReport(data,'weekly',[{name:'Exemplo A',hoursMinutes:480,appointments:3}]);
 const all=[report.text,report.html,JSON.stringify(report.packet)].join(' ').toLowerCase();
 for(const forbidden of ['csat','índice de qualidade','notas excelentes','avaliações','productionquality','ratings','excellent','average','qualityhtml']){
   ok(!all.includes(forbidden),'Keila contains forbidden quality field: '+forbidden);
 }
 ok(report.text.includes('Exemplo A')&&report.text.includes('08:00'),'Workload summary absent');
 ok(Array.isArray(report.packet.productionWorkload),'Staff hours missing in attachment');
 ok(!Object.hasOwn(report.packet,'productionQuality'),'Ratings must not be in attachment packet');
});
