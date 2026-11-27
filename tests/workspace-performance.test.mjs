import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const slice=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a);return html.slice(a,b)};
const renderSource=slice('function render(){','function renderEntries(');
const names=['renderEntries','renderDiag','renderLiveDaily','generateManagerReport','renderProj','renderBudget','renderForecastAudit','renderBot','renderOcc','renderMgmt','renderVip','renderCharts','renderComparisons','renderPivot','renderAlerts','enhanceTables'];
for(const [tab,expected] of Object.entries({mgmt:['renderMgmt'],charts:['renderCharts','renderComparisons'],entries:['renderEntries'],proj:['renderProj','renderBudget','renderForecastAudit'],cfg:['renderBot'],live:['renderLiveDaily','generateManagerReport'],'email-admin':[]})){
  test('opening '+tab+' does not render closed modules and retains global counts',()=>{
    const calls=[],nodes={};
    const render=new Function('ACT','rows','R','mk','$','H','window',...names,renderSource+'return render;')(
      tab,[{ticket_id:'1',hours:2,owner_name:'A',client_name:'B'},{ticket_id:'1',hours:1,owner_name:'A',client_name:'B'}],()=>({}),()=>({}),id=>nodes[id]??={},n=>String(n),{},...names.map(name=>()=>calls.push(name)));
    render();assert.deepEqual(calls,[...expected,'renderAlerts','enhanceTables']);
    assert.equal(nodes.kT.textContent,1);assert.equal(nodes.kH.textContent,'3');assert.equal(nodes.kA.textContent,1);
  });
}
test('global idle alarm remains current without rendering its closed tables',()=>{
  const source=slice('function renderAlerts(){','async function scanHistorical(');
  const nodes=Object.fromEntries(['t-alerts','navAlarmCount','executiveAlarmText'].map(id=>[id,{classList:{toggle(){}},textContent:''}]));
  const fn=new Function('ACT','$','alarmList','alarmThreshold','TK','alarmSetTeamOptions',source+'return renderAlerts;')('mgmt',id=>{assert.ok(id in nodes,'unexpected hidden DOM access '+id);return nodes[id]},()=>[{id:2,idle:18,team:'Suporte'},{id:3,idle:2,team:'Produção'}],()=>7,new Map([['2',{}]]),()=>assert.fail('closed alert tables rendered'));
  fn();assert.equal(nodes.navAlarmCount.textContent,'1');assert.match(nodes.executiveAlarmText.textContent,/#2, 18 dias/);
});
test('chart update reuses a matching instance; type change destroys the old one',()=>{
  const source=slice('const mkc=(id,cfg)=>{','const rangeDays=');
  let constructed=0,destroyed=0,updated=0;
  const canvas={},CH={};
  class Chart{constructor(node,cfg){constructed++;this.canvas=node;this.config=cfg;this.data=cfg.data;}update(mode){assert.equal(mode,'none');updated++;}destroy(){destroyed++;}}
  const mkc=new Function('CH','window','Chart','$','HOUR_CHARTS','H',source+'return mkc;')(CH,{Chart,matchMedia:()=>({matches:true})},Chart,()=>canvas,new Set(),n=>n);
  mkc('graph',{type:'bar',data:{labels:['A']}});const instance=CH.graph;
  mkc('graph',{type:'bar',data:{labels:['B']}});
  assert.equal(CH.graph,instance);assert.equal(constructed,1);assert.equal(updated,1);assert.equal(destroyed,0);assert.equal(instance.options.animation,false);
  mkc('graph',{type:'line',data:{labels:['B']}});assert.equal(constructed,2);assert.equal(destroyed,1);
});

test('concurrent identical authenticated reads share only pending network requests',async()=>{
 const source=slice('const cloudPendingReads=new Map();','function cloudStateSnapshot()');
 let requests=0,token='one',release;
 const fetch=async()=>{requests++;await new Promise(r=>release=r);return {ok:true,json:async()=>({ok:true})}};
 const api=new Function('window','location','fetch',source+'return cloudApi;')({tmAuth:{getSession:async()=>({access_token:token})}},{origin:'https://test.invalid'},fetch);
 const a=api('loadTickets','GET',null,{offset:0,limit:150}),b=api('loadTickets','GET',null,{limit:150,offset:0});
 await Promise.resolve();assert.equal(requests,1);release();await Promise.all([a,b]);
 const c=api('loadTickets','GET',null,{offset:0,limit:150});await Promise.resolve();assert.equal(requests,2);release();await c;
});
test('table sorting extracts each key once and preserves numeric order',()=>{
 const source=slice('function sortTable(t,c,d){','function enhanceTables(){');
 let reads=0;const row=n=>({cells:[{dataset:{},querySelector:()=>null,get textContent(){reads++;return String(n)}}]});
 const rows=[row(10),row(2),row(7)],ordered=[];
 const table={tBodies:[{rows,appendChild:r=>ordered.push(r)}],tHead:{rows:[{cells:[{}]}]}};
 new Function(source+'return sortTable;')()(table,0,1);
 assert.equal(reads,3);assert.deepEqual(ordered,[rows[1],rows[2],rows[0]]);
});
test('inactive modules avoid calendar calculations and global KPIs traverse each row once',()=>{
 let config=0,calendar=0,reads=0;const nodes={};
 const rows=Array.from({length:10000},(_,i)=>({ticket_id:String(i%500),owner_name:'A',client_name:'B',get hours(){reads++;return 1}}));
 const render=new Function('ACT','rows','R','mk','$','H','window',...names,renderSource+'return render;')('email-admin',rows,()=>{config++;return {}},()=>{calendar++;return {}},id=>nodes[id]??={},String,{},...names.map(()=>()=>{}));
 render();assert.equal(config,0);assert.equal(calendar,0);assert.equal(reads,10000);assert.equal(nodes.kT.textContent,500);assert.equal(nodes.kH.textContent,'10000');
});
