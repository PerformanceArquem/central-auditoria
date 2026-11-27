import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {composeTriageDraft} from './triage-message.mjs';
import {triageRobotSnapshot} from './robot-triage.mjs';
import {createTriageAuthGuard} from './triage-auth.mjs';

const html=readFileSync(new URL('./preview.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('let liveTriageLastRows='),html.indexOf('</script>',html.indexOf('let liveTriageLastRows=')));
class Element{
 constructor(){this.children=[];this.dataset={};this.value='';this.disabled=false;this.listeners=new Map();}
 addEventListener(event,fn){this.listeners.set(event,fn);}
 replaceChildren(...children){this.children=children;}
 append(...children){this.children.push(...children);}
 querySelectorAll(){return [];}
 scrollIntoView(){}
}
function screen(responses,authEvents=[]){
 let authChange=()=>{};
 const elements=new Map(),calls=[],snapshots=[];
 const get=key=>{if(!elements.has(key))elements.set(key,new Element());return elements.get(key);};
 get('#live-triage-limit').value='3';get('#live-triage-filter').value='all';
 const context=vm.createContext({document:{querySelector:get,createElement:()=>new Element()},composeTriageDraft,triageRobotSnapshot,robotDashboard:{setData:data=>snapshots.push(data),clearTriage:()=>snapshots.splice(0)},formatReportDate:value=>value,
 channelClient:async()=>{for(const [event,session] of authEvents.splice(0))authChange(event,session);return {functions:{invoke:async(name,request)=>{calls.push(request.body);const next=responses.shift();if(!next)throw Error('Unexpected request');return next;}}};}});
 vm.runInContext(source,context);
 authChange=createTriageAuthGuard(()=>context.resetLiveTriageResults());
 return {get,calls,snapshots,auth:(...args)=>authChange(...args),load:(...args)=>context.loadLiveTriage(...args),read:expression=>vm.runInContext(expression,context)};
}
const now=new Date().toISOString();
const old=new Date(Date.now()-2*3600000).toISOString();
const row=(id,subject='Fixture')=>({ticketId:id,subject,eligible:true,reason:'threshold-reached',businessDays:5,enteredDate:'2026-11-01',syncedAt:now,sector:'Inteligência',ownerName:'Responsável'});
const result=(rows,reference=now)=>({data:{ok:true,mode:'read-only',deliveryEnabled:false,complete:true,threshold:3,rows,now:reference},error:null});
test('individual check preserves the original reference and updates only its ticket',async()=>{
 const ui=screen([result([row('1'),row('2')],old),result([row('2','Updated')])]);
 await ui.load();await ui.load(true,'2');
 assert.equal(ui.read('liveTriageLastReference'),old);
 assert.equal(ui.read('liveTriageLastRows.length'),2);
 assert.equal(ui.read('liveTriageLastRows.find(row=>row.ticketId==="2").subject'),'Updated');
 assert.throws(()=>ui.read('composeTriageDraft({rows:liveTriageLastRows,threshold:3,referenceTime:liveTriageLastReference,now:new Date().toISOString()})'),/Consulte a triagem novamente/);
});
test('failed full reload clears prior results and blocks individual reuse',async()=>{
 const ui=screen([result([row('1')]),{data:null,error:{}}]);
 await ui.load();await ui.load();
 assert.equal(ui.read('liveTriageLastRows.length'),0);assert.equal(ui.read('liveTriageLastReference'),null);
 assert.equal(ui.get('#live-triage-draft').disabled,true);
 assert.equal(ui.get('#live-triage-filter').disabled,true);
 assert.equal(ui.get('#live-triage-search').disabled,true);
 await ui.load(true,'1');assert.equal(ui.calls.length,2);
});
test('failed individual check clears the previous preview and result selection',async()=>{
 const ui=screen([result([row('1'),row('2')]),{data:null,error:{}}]);
 await ui.load();await ui.load(true,'2');
 assert.equal(ui.read('liveTriageLastRows.length'),0);assert.equal(ui.read('liveTriageLastReference'),null);
 assert.equal(ui.get('#live-triage-draft').disabled,true);
 assert.equal(ui.get('#live-triage-draft-text').value,'');
});
test('successful full reload replaces the previous selection and reference',async()=>{
 const ui=screen([result([row('1')],old),result([row('2')])]);
 await ui.load();await ui.load();
 assert.equal(ui.read('liveTriageLastRows.length'),1);assert.equal(ui.read('liveTriageLastRows[0].ticketId'),'2');
 assert.equal(ui.read('liveTriageLastReference'),now);
 assert.equal(ui.get('#live-triage-draft').disabled,false);
});
test('changing the threshold invalidates the existing query',async()=>{
 const ui=screen([result([row('1')])]);await ui.load();
 ui.get('#live-triage-limit').value='5';ui.get('#live-triage-limit').listeners.get('input')();
 assert.equal(ui.read('liveTriageLastRows.length'),0);
 assert.equal(ui.read('liveTriageLastReference'),null);
 assert.equal(ui.get('#live-triage-draft').disabled,true);
});

test('displaying the robot snapshot reuses the query without another API request',async()=>{
 const ui=screen([result([row('1'),{...row('2'),eligible:false,reason:'stale-history'}])]);
 await ui.load();
 await ui.get('#live-triage-panel').listeners.get('click')();
 assert.equal(ui.calls.length,1);assert.equal(ui.snapshots.length,1);
 assert.equal(ui.snapshots[0].source,'triage-read-only');
 assert.deepEqual(ui.snapshots[0].alerts.map(r=>r.ticketId),['1']);
 assert.deepEqual(ui.snapshots[0].review.map(r=>r.ticketId),['2']);
 ui.get('#live-triage-limit').listeners.get('input')();
 assert.equal(ui.snapshots.length,0);assert.equal(ui.get('#live-triage-panel').disabled,true);
});

test('expired query cannot populate the robot panel',async()=>{
 const ui=screen([result([row('1')],old)]);await ui.load();
 await ui.get('#live-triage-panel').listeners.get('click')();
 assert.equal(ui.snapshots.length,0);
 assert.match(ui.get('#live-triage-draft-status').textContent,/Consulte a triagem novamente/);
});

test('in-flight query cannot restore data after session invalidation',async()=>{
 let resolve;
 const pending=new Promise(done=>{resolve=done;});
 const ui=screen([pending]),loading=ui.load();
 await new Promise(done=>setImmediate(done));
 ui.read('resetLiveTriageResults()');
 resolve(result([row('1')]));await loading;
 assert.equal(ui.read('liveTriageLastRows.length'),0);
 assert.equal(ui.get('#live-triage-panel').disabled,true);
 assert.equal(ui.snapshots.length,0);
 assert.match(ui.get('#live-triage-status').textContent,/Consulte novamente a triagem/);
});

test('initial same-user sign-in during authorization does not require a second click',async()=>{
 const session={user:{id:'a'}};
 const ui=screen([result([row('1')])],[['INITIAL_SESSION',session],['SIGNED_IN',session]]);
 await ui.load();
 assert.equal(ui.calls.length,1);assert.equal(ui.read('liveTriageLastRows.length'),1);
 assert.equal(ui.get('#live-triage-panel').disabled,false);
 assert.doesNotMatch(ui.get('#live-triage-status').textContent,/Consulte novamente|Consultando/);
});

test('sign-out still discards an in-flight response through the auth guard',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});
 const ui=screen([pending],[['INITIAL_SESSION',{user:{id:'a'}}]]),loading=ui.load();
 await new Promise(done=>setImmediate(done));ui.auth('SIGNED_OUT',null);
 resolve(result([row('1')]));await loading;
 assert.equal(ui.read('liveTriageLastRows.length'),0);assert.equal(ui.get('#live-triage-panel').disabled,true);
});
