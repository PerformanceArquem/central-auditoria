import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const policy=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/audit-email-dispatch/failed-delivery-policy.ts',import.meta.url),'utf8'));
const {assertFailedRetry,RETRY_POLICY}=await import('data:text/javascript;base64,'+Buffer.from(policy).toString('base64'));
const source=readFileSync(new URL('../supabase/functions/audit-email-dispatch/index.ts',import.meta.url),'utf8');
const recipient={id:'recipient',active:true,scope:'sector',daily_enabled:true};
const failed={dispatch_key:'recipient:daily:2026-11-16:2026-11-16',recipient_id:'recipient',report_kind:'daily',period_from:'2026-11-16',period_to:'2026-11-16',status:'failed',sent_at:null,error_message:'Gerador ainda não homologado para observações de ajustes posteriores ao fechamento'};
test('only verified pre-provider failures with current permission can retry',()=>{
 assert.doesNotThrow(()=>assertFailedRetry(failed,recipient,'2026-11-17'));
 assert.doesNotThrow(()=>assertFailedRetry({...failed,error_message:'Métricas de voz indisponíveis (HTTP 502: Não foi possível consolidar os dados de voz); relatório completo não liberado'},recipient,'2026-11-17'));
 for(const row of [{...failed,status:'sent'},{...failed,status:'processing'},{...failed,sent_at:'date'},{...failed,error_message:'timeout'},{...failed,error_message:'Entrega de PDF/XLSX não confirmada'},{...failed,dispatch_key:'monitoria:individual'},{...failed,period_to:'2026-11-17'}])assert.throws(()=>assertFailedRetry(row,recipient,'2026-11-17'));
 for(const rec of [{...recipient,scope:'monitoria'},{...recipient,active:false},{...recipient,daily_enabled:false},{...recipient,allowed_report_types:[]},{...recipient,allowed_report_types:['production_flow']}])assert.throws(()=>assertFailedRetry(failed,rec,'2026-11-17'));
});
function harness({failSuccessWrite=false}={}){
 let row={...failed},sends=0,previews=0;
 const db=async(_path,options)=>{
  if(!options)return [{...row}];
  const patch=JSON.parse(options.body);
  if(options.headers){if(row.status!=='failed')return [];row={...row,...patch};return [{...row}];}
  if(patch.status==='sent'&&failSuccessWrite)throw Error('write unavailable');
  row={...row,...patch};return null;
 };
 const mocks={receiptContext:()=>({dispatchKey:failed.dispatch_key}),db,recipientList:async()=>[{...recipient}],assertFailedRetry,RETRY_POLICY,dateBR:()=> '2026-11-17',recentCoverage:async()=>({ready:true}),holidays:async()=>new Set(),source:async()=>[],ticketSource:async()=>[],clientSource:async()=>[],buildReport:()=>({metrics:{appointments:1},text:'report'}),ticketAlerts:()=>({text:'',activeTickets:[]}),supportRatingCache:()=>async()=>({text:''}),directionOverviewCache:()=>async()=>({text:''}),optionalForecast:async()=>({text:'',rows:[]}),reportSubject:()=> 'Relatório',reportEmailHtml:()=> '<html>Relatório</html>',reportPacket:()=>({}),REPORT_LABEL:{daily:'Diário'},crypto,sendMail:async(...args)=>{if(args[5]){previews++;return {subject:'Relatório',html:'<html>Relatório</html>'};}sends++;},assertEmailDeliveryEnabled:async()=>{},E:()=> 'true',err:e=>e.message,json:(body,status=200)=>({body,status})};
 const code=stripTypeScriptTypes(source.slice(source.indexOf('async function failedReportAction('),source.indexOf('async function handleRequest(')));
 const run=new Function(...Object.keys(mocks),code+';return failedReportAction;')(...Object.values(mocks));
 return {run,row:()=>row,sends:()=>sends,previews:()=>previews};
}
test('review is read-only; changed review and concurrent clicks cannot double send',async()=>{
 const h=harness(),base={dispatchKey:failed.dispatch_key};
 const preview=await h.run({...base,action:'failed_report_review'});
 assert.equal(h.sends(),0);assert.equal(h.row().status,'failed');assert.equal(h.previews(),1);
 assert.equal((await h.run({...base,action:'failed_report_send',reviewToken:'old',confirmSend:true})).status,409);
 const results=await Promise.allSettled([1,2].map(()=>h.run({...base,action:'failed_report_send',reviewToken:preview.body.reviewToken,confirmSend:true})));
 assert.equal(h.sends(),1);assert.equal(h.row().status,'sent');assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.body.ok));
});
test('accepted delivery with failed audit write stays processing and cannot be retried',async()=>{
 const h=harness({failSuccessWrite:true}),base={dispatchKey:failed.dispatch_key};
 const preview=await h.run({...base,action:'failed_report_review'});
 await assert.rejects(()=>h.run({...base,action:'failed_report_send',reviewToken:preview.body.reviewToken,confirmSend:true}));
 assert.equal(h.sends(),1);assert.equal(h.row().status,'processing');
 await assert.rejects(()=>h.run({...base,action:'failed_report_review'}));
});
