import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../email-report-catalog.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map(),updates=[],calls=[],filters=[];const node=()=>({value:'',textContent:'',innerHTML:'',disabled:false,handlers:{},addEventListener(k,fn){this.handlers[k]=fn}});
 for(const id of ['emailCatalogRows','emailCatalogStatus','emailCatalogSearch','emailCatalogCadence','emailCatalogRefresh'])nodes.set(id,node());
 const records=[{id:'rec',name:'Keila',email:'inteligencia.gerencia@arquem.com.br',scope:'management',sectors:['Inteligência'],collaborator_names:[],active:true,daily_enabled:true,weekly_enabled:true,monthly_enabled:true,annual_enabled:true,updated_at:'revision'}];
 const client={rpc:async()=>({data:true}),functions:{invoke:()=>{throw Error('must never send')}},from:table=>{
  calls.push(table);let patch=null;
  const query={select(){return this},order(){return this},limit(){return Promise.resolve({data:[]})},update(value){patch=value;updates.push(value);return this},eq(k,v){filters.push([k,v]);return this},maybeSingle:async()=>({data:{id:'rec'}}),then(resolve){resolve({data:table==='audit_email_recipients'?records:[]})}};return query;
 }};
 const ctx=vm.createContext({document:{getElementById:id=>nodes.get(id)},window:{tmEmailAdminClient:client},Intl,Date,console});vm.runInContext(source,ctx);
 return {nodes,updates,calls,records,filters};
}
test('catalog lists recipients, sector and cadences without invoking delivery',async()=>{
 const h=harness();await h.nodes.get('emailCatalogRefresh').handlers.click();
 const html=h.nodes.get('emailCatalogRows').innerHTML;assert.match(html,/Keila/);assert.match(html,/Inteligência/);assert.match(html,/data-catalog-kind="annual"/);assert.equal(h.updates.length,0);
 h.nodes.get('emailCatalogSearch').value='Suporte';h.nodes.get('emailCatalogSearch').handlers.input();assert.match(h.nodes.get('emailCatalogRows').innerHTML,/Nenhum relatório/);
});
test('saving changes only cadence fields and uses optimistic concurrency',async()=>{
 const h=harness();await h.nodes.get('emailCatalogRefresh').handlers.click();
 const row={querySelector:selector=>({checked:selector.includes('weekly')})};
 const button={dataset:{catalogSave:'rec'},closest:()=>row,disabled:false};
 await h.nodes.get('emailCatalogRows').handlers.click({target:{closest:()=>button}});
 assert.equal(h.updates.length,1);const patch=h.updates[0];assert.equal(patch.weekly_enabled,true);assert.equal(patch.daily_enabled,false);
 assert.deepEqual(Object.keys(patch).sort(),['annual_enabled','daily_enabled','monthly_enabled','updated_at','weekly_enabled']);
 assert.ok(h.filters.some(([key,value])=>key==='updated_at'&&value==='revision'));
});
