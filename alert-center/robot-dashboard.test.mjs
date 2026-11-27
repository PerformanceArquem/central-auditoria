import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateRobot,filterRobot,summarizeRobot,GROUPS,mountRobotDashboard} from './robot-dashboard.mjs';
import {simulate} from './engine.mjs';

test('three management groups and Intelligence subsectors preserve their sector',()=>{
  assert.deepEqual(GROUPS,['Inteligência','Produção','Suporte']);
  const sectors=['Qualidade','Testes (QA)','Sucesso do Cliente','Implantação','Treinamento','Produção','Suporte'];
  const tickets=sectors.map((sector,index)=>({id:String(index),sector,ownerName:'Pessoa '+index}));
  const rows=consolidateRobot({tickets,alerts:tickets.map(t=>({ticketId:t.id,rule:'overdue'}))});
  for(const ticket of tickets) {
    const row=rows.find(r=>r.ticketId===ticket.id);
    assert.equal(row.sector,ticket.sector);
    assert.equal(row.group,['Produção','Suporte'].includes(ticket.sector)?ticket.sector:'Inteligência');
  }
});
test('combined filters are exact and do not alter the input or overall totals',()=>{
  const rows=consolidateRobot({tickets:[{id:'1',sector:'Qualidade',ownerName:'Ana'},{id:'2',sector:'Suporte',ownerName:'Ana'}],alerts:[{ticketId:'1',rule:'overdue'},{ticketId:'1',rule:'escalation'},{ticketId:'2',rule:'overdue'}]});
  const before=JSON.stringify(rows);
  assert.deepEqual(summarizeRobot(rows),{tickets:2,occurrences:3,review:0});
  const filters={sector:'Qualidade',owner:'Ana',level:'management',reason:'Escalonamento'};
  assert.deepEqual(filterRobot(rows,filters).map(r=>r.ticketId),['1']);
  assert.equal(filterRobot(rows,{...filters,owner:'Outra pessoa'}).length,0);
  assert.equal(JSON.stringify(rows),before);
});
test('review takes precedence over charges and summaries are not treated as tickets',()=>{
  const rows=consolidateRobot({tickets:[{id:'1',sector:'Suporte'}],alerts:[{ticketId:'1',rule:'overdue'},{summary:{pointedMinutes:60}}],review:[{ticketId:'1',reason:'stale-history'}]});
  assert.equal(rows.length,1);assert.equal(rows[0].level,'review');
  assert.deepEqual(summarizeRobot(rows),{tickets:0,occurrences:0,review:1});
});
test('triage goes to Production management while keeping the source sector and owner',()=>{
  const rows=consolidateRobot({tickets:[{id:'1',sector:'intelligence',ownerName:'Pessoa A'}],alerts:[{rule:'aged-triage',tickets:[{ticketId:'1'}]},{rule:'aged-triage',tickets:[{ticketId:'1'}]}]});
  assert.equal(rows.length,1);assert.equal(rows[0].group,'Produção');
  assert.equal(rows[0].sector,'Inteligência');assert.equal(rows[0].owner,'Pessoa A');assert.equal(rows[0].level,'management');
});

test('responsible person keeps an available ID and marks missing identity explicitly',()=>{
  const tickets=[{id:'1',sector:'Inteligência',ownerName:null,ownerId:'007'},{id:'2',sector:'Inteligência',owner:null},{id:'3',sector:'Inteligência',owner:{id:'008',businessName:' '}}];
  const rows=consolidateRobot({tickets,alerts:tickets.map(t=>({ticketId:t.id,rule:'overdue'}))});
  assert.equal(rows.find(r=>r.ticketId==='1').owner,'ID 007');
  assert.equal(rows.find(r=>r.ticketId==='2').owner,'Responsável não informado na consulta');
  assert.equal(rows.find(r=>r.ticketId==='3').owner,'ID 008');
  assert.equal(filterRobot(rows,{owner:'ID 007'}).length,1);
});
test('engine results support missing history and regularization without writes',()=>{
  const context={now:'2026-11-25T11:30:00Z',localDate:'2026-11-25'};
  const tickets=[{id:'1',sector:'intelligence',dueAt:'2026-11-23T11:30:00Z'},{id:'2',sector:'intelligence',history:{team:'Inteligência',status:'Em Análise',historyComplete:false}}];
  const result=simulate(tickets,context);
  const rows=consolidateRobot({alerts:result.alerts,review:result.triageReview,tickets});
  assert.deepEqual(summarizeRobot(rows),{tickets:1,occurrences:2,review:1});
  const closed=simulate(tickets.map(t=>({...t,closed:true})),context);
  assert.deepEqual(consolidateRobot({alerts:closed.alerts,review:closed.triageReview,tickets}),[]);
});

// Small DOM double exercises filter/reset/reload state, not browser layout.
class Element {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.value='';this.listeners={};this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(event,callback){this.listeners[event]=callback;}
}
test('interface combines filters, clears them, and drops unavailable selections on reload',()=>{
  const doc={createElement:tag=>new Element(tag,doc)},root=doc.createElement('section');
  const panel=mountRobotDashboard(root);
  const flatten=node=>[node,...node.children.flatMap(flatten)];
  const find=id=>flatten(root).find(node=>node.id===id);
  const button=flatten(root).find(node=>node.tagName==='button');
  assert.equal(button.disabled,true);
  const data={tickets:[{id:'1',sector:'Qualidade',ownerName:'<img src=x onerror=alert(1)>'},{id:'2',sector:'Suporte',ownerName:'Bruno'}],alerts:[{ticketId:'1',rule:'overdue'},{ticketId:'2',rule:'preventive'}]};
  panel.setData(data);
  const sector=find('robot-filter-sector'),owner=find('robot-filter-owner');
  sector.value='Qualidade';owner.value='Bruno';sector.listeners.change();
  assert.ok(flatten(root).some(node=>node.textContent==='Nenhum resultado para os filtros atuais.'));
  button.listeners.click();assert.equal(sector.value,'');assert.equal(owner.value,'');
  assert.ok(flatten(root).some(node=>node.textContent==='<img src=x onerror=alert(1)>'));
  owner.value='Bruno';panel.setData({tickets:[data.tickets[0]],alerts:[data.alerts[0]]});assert.equal(owner.value,'');
  panel.setData({alerts:[],review:[],tickets:[]});
  assert.ok(flatten(root).some(node=>node.textContent==='Nenhuma ocorrência de cobrança neste cenário.'));
  assert.ok(flatten(root).some(node=>node.textContent==='Nenhum chamado para revisão neste cenário.'));
  const regions=flatten(root).filter(node=>node.attributes.role==='region');
  assert.equal(regions.length,2);assert.ok(regions.every(node=>node.tabIndex===0&&node.attributes['aria-label']));
  panel.setData({});assert.equal(sector.disabled,true);assert.equal(button.disabled,true);
  assert.ok(flatten(root).some(node=>node.textContent==='Execute “Simular alertas” para preencher este painel.'));
  panel.setData(data);sector.value='Suporte';
  panel.setData({...data,source:'triage-read-only',referenceTime:'2026-11-27T12:00:00Z',threshold:3,waiting:2,outside:1});
  assert.equal(sector.value,'');
  assert.ok(flatten(root).some(node=>node.textContent==='Robô Fiscalizador · triagem consultada'));
  assert.ok(flatten(root).some(node=>String(node.textContent).includes('27/11/2026, 09:00:00')));
  assert.ok(flatten(root).some(node=>String(node.textContent).includes('Escopo: triagem consultada, sem varredura geral dos setores.')));
  panel.clearTriage();assert.equal(sector.disabled,true);
  panel.setData(data);panel.clearTriage();assert.equal(sector.disabled,false);
});
