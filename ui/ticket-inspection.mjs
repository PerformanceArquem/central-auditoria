import {RADAR_CATEGORIES,summarizeRadar,filterRadar,preventiveGuidance} from '/lib/preventive-risk-radar.mjs';
import {inspectTickets,filterInspections,recordOccurrences} from '/lib/ticket-inspection.mjs';
const panel=document.getElementById('ticketInspection');
let history=[], report=[],clientCriticality={};
const date=n=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(n);
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
function paragraph(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);}
function riskDetails(parent,risk){
  if(!risk)return;
  paragraph(parent,risk.state+' · Índice: '+(risk.score===null?'indeterminado':risk.score+'/100')+' · Cobertura dos fatores: '+risk.coverage+'% ('+risk.coverageLabel+')');
  for(const c of risk.components){
    let value=c.value;
    if(c.key==='similar')value=value.samples+' semelhantes, '+value.late+' concluídos após o prazo';
    else if(typeof value==='number')value=['deadline','appointment','queue'].includes(c.key)?value.toFixed(1)+' dias':String(value);
    paragraph(parent,c.label+': '+(c.available?Math.round(c.points)+'/'+c.max+' pontos · '+value:'indisponível')+'. '+c.basis+'.');
  }
  if(risk.lastAppointmentAt)paragraph(parent,'Último apontamento: '+date(Date.parse(risk.lastAppointmentAt)));
  paragraph(parent,risk.notice);
}
function remoteDetails(details,id){
  const button=document.createElement('button'),output=document.createElement('div');
  button.type='button';button.className='s';button.textContent='Conferir base sincronizada';
  output.setAttribute('role','status');details.append(button,output);
  async function load(method='GET',requestId){
    if(typeof window.tmFetch!=='function')throw Error('Entre no sistema antes de consultar o histórico.');
    const response=await window.tmFetch('/api/audit-ticket-inspection?id='+encodeURIComponent(id),{
      method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId})}:{})
    });
    const data=await response.json();
    if(!response.ok||!data.ok)throw Error(data.error||'Consulta indisponível.');
    return data;
  }
  function show(data){
    output.replaceChildren();
    paragraph(output,'Origem sincronizada em '+(data.sourceSyncedAt?date(Date.parse(data.sourceSyncedAt)):'data não informada'));
    const item=data.item;
    paragraph(output,item.closed?'Chamado encerrado na origem.':'Risco sincronizado: '+item.criticality+' ('+item.score+'/100) · '+item.owner+' · '+item.sector);
    if(!item.closed&&!item.forecastKnown)paragraph(output,'Sem previsão válida: não é possível estimar o vencimento. A pontuação reflete os demais fatores observados.');
    riskDetails(output,item.risk);
    for(const f of item.findings)paragraph(output,f.label);
    for(const gap of item.gaps||[])paragraph(output,gap);
    for(const h of item.timeline||[])paragraph(output,date(h.at)+' → '+date(h.until)+' · '+(h.sector||'Setor não informado')+' · '+(h.owner||'Responsável não informado')+' · '+h.hours.toFixed(1)+' h');
    for(const e of data.history)paragraph(output,e.label+' · detectado '+date(e.openedAt)+(e.resolvedAt?' · encerrado '+date(e.resolvedAt):' · ativo'));
    for(const warning of data.warnings)paragraph(output,warning);
    if(data.saved)paragraph(output,'Fiscalização registrada no ambiente de homologação.');
    else if(data.storageEnabled){
      const save=document.createElement('button');save.type='button';save.className='s';save.textContent='Registrar em homologação';
      const requestId=crypto.randomUUID();
      save.addEventListener('click',async()=>{
        save.disabled=true;
        try{show(await load('POST',requestId));}
        catch(error){paragraph(output,error.message);save.disabled=false;}
      });output.append(save);
    }else paragraph(output,'Registro persistente desativado.');
  }
  button.addEventListener('click',async()=>{
    button.disabled=true;output.textContent='Consultando histórico sincronizado…';
    try{show(await load());}catch(error){output.textContent=error.message;}
    finally{button.disabled=false;}
  });
}
// Build the radar after capturing the existing execution button.
const executeInspection=panel.querySelector('button');
const radar=document.createElement('section');
radar.className='preventive-risk-radar';
radar.setAttribute('aria-label','Radar Preventivo');
const radarTitle=document.createElement('h3');radarTitle.textContent='Ticket Manager | Radar Preventivo';
const radarNote=document.createElement('p');radarNote.textContent='Dados carregados na Central. Índice heurístico, não probabilidade. Nenhuma cobrança é realizada por este painel.';
const radarCards=document.createElement('div');radarCards.className='radar-cards';
const radarRanks=document.createElement('div');radarRanks.className='radar-ranks';
const radarSelection=document.createElement('p');radarSelection.setAttribute('aria-live','polite');
const radarReset=document.createElement('button');radarReset.type='button';radarReset.className='s';radarReset.textContent='Limpar filtros do radar';
let radarCategory='',radarOwner='';
radarReset.addEventListener('click',()=>{radarCategory='';radarOwner='';render();});
radar.append(radarTitle,radarNote,radarCards,radarRanks,radarSelection,radarReset);
const radarTable=panel.querySelector('table');
if(radarTable){let target=radarTable;while(target.parentElement&&target.parentElement!==panel)target=target.parentElement;target.before(radar);}else panel.append(radar);
function renderRadar(base){
 const summary=summarizeRadar(base);
 radarCards.replaceChildren();radarRanks.replaceChildren();
 for(const [key,label] of RADAR_CATEGORIES){
  const button=document.createElement('button');button.type='button';button.className='radar-card radar-'+key;
  button.setAttribute('aria-pressed',String(radarCategory===key));
  const value=document.createElement('strong');value.textContent=String(summary.counts[key]);
  const caption=document.createElement('span');caption.textContent=label;
  button.append(value,caption);button.addEventListener('click',()=>{radarCategory=radarCategory===key?'':key;render();});radarCards.append(button);
 }
 for(const [title,entries,kind] of [['Risco alto e crítico por setor',summary.sectors,'sector'],['Risco alto e crítico por responsável',summary.owners,'owner']]){
  const group=document.createElement('div');const heading=document.createElement('h4');heading.textContent=title;group.append(heading);
  if(!entries.length)paragraph(group,'Nenhum chamado nesta classificação.');
  const max=entries[0]?.[1]||1;
  for(const [name,count] of entries.slice(0,10)){
   const button=document.createElement('button');button.type='button';button.className='radar-rank';
   const active=kind==='owner'?radarOwner===name:panel.querySelector('[name=sector]').value===name;
   button.setAttribute('aria-pressed',String(active));
   const label=document.createElement('span');label.textContent=name+' · '+count;
   const bar=document.createElement('meter');bar.min=0;bar.max=max;bar.value=count;bar.setAttribute('aria-label',name+': '+count);
   button.append(label,bar);
   button.addEventListener('click',()=>{if(kind==='owner')radarOwner=radarOwner===name?'':name;else{const select=panel.querySelector('[name=sector]');select.value=select.value===name?'':name;}render();});
   group.append(button);
  }
  radarRanks.append(group);
 }
 radarSelection.textContent='Filtros do radar: '+(RADAR_CATEGORIES.find(([key])=>key===radarCategory)?.[1]||'Todas as categorias')+' · '+(radarOwner||'Todos os responsáveis');
}
function render(){
  const baseRows=filterInspections(report,{sector:panel.querySelector('[name=sector]').value,client:panel.querySelector('[name=client]').value,criticality:panel.querySelector('[name=criticality]').value});
  renderRadar(baseRows);
  const rows=filterRadar(baseRows,{category:radarCategory,owner:radarOwner});
  panel.querySelector('[role=status]').textContent=rows.length+' chamados nos dados carregados. Risco por regras; pontuação não representa probabilidade estatística.';
  const body=panel.querySelector('tbody');body.replaceChildren();
  for(const r of rows.slice(0,200)){
    const tr=document.createElement('tr');
    for(const text of [r.id,r.subject,r.client,r.sector,r.owner,r.criticality+' ('+(r.risk?.score===null?'sem índice':r.score+'/100')+') · cobertura '+(r.risk?.coverage??0)+'%',r.findings.map(f=>f.label).join('; ')||'Sem ocorrências',r.reasons.join('; ')||'Sem agravantes identificados'])cell(tr,text);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Histórico e transferências';details.append(summary);
    riskDetails(details,r.risk);
    const guidance=document.createElement('div');guidance.className='radar-guidance';
    const heading=document.createElement('h4');heading.textContent='Sugestões preventivas do Ticket Manager';guidance.append(heading);
    const list=document.createElement('ul');
    for(const suggestion of preventiveGuidance(r)){const li=document.createElement('li');li.textContent=suggestion;list.append(li);}
    if(list.childElementCount)guidance.append(list);else paragraph(guidance,'Nenhuma orientação adicional identificada.');
    details.append(guidance);
    for(const h of r.timeline){const p=document.createElement('p');p.textContent=date(h.at)+' → '+date(h.until)+' · '+(h.sector||'Setor não informado')+' · '+(h.owner||'Responsável não informado')+' · '+h.hours.toFixed(1)+' h';details.append(p);}
    for(const e of history.filter(e=>e.id===r.id)){const p=document.createElement('p');p.textContent=e.label+' · detectado '+date(e.openedAt)+(e.resolvedAt?' · encerrado '+date(e.resolvedAt):' · ativo');details.append(p);}
    for(const gap of r.gaps){const p=document.createElement('p');p.textContent=gap;details.append(p);}
    remoteDetails(details,r.id);
    cell(tr,'').append(details);body.append(tr);
  }
  if(rows.length>200)panel.querySelector('[role=status]').textContent+=' Exibindo os primeiros 200; refine os filtros.';
}
panel.addEventListener('input',render);
function run(){
  const tickets=window.ticketInspectionSource?.();
  if(!tickets?.length){panel.querySelector('[role=status]').textContent='Carregue os chamados na Central antes de executar a fiscalização.';return;}
  report=inspectTickets(tickets,{clientCriticality});
  history=recordOccurrences(history,report,Date.now());
  const select=panel.querySelector('[name=sector]'),selected=select.value;
  select.replaceChildren(new Option('Todos os setores',''));
  for(const sector of [...new Set(report.map(r=>r.sector))].sort())select.add(new Option(sector,sector));
  select.value=selected;render();
}
executeInspection.addEventListener('click',async()=>{
  const button=executeInspection;button.disabled=true;
  try{
    clientCriticality={};
    const client=window.tmEmailAdminClient;
    if(client){
      const {data,error}=await client.functions.invoke('audit-email-dispatch',{body:{action:'vip_config',mode:'list'}});
      clientCriticality=!error&&data?.ok&&Array.isArray(data.names)?Object.fromEntries(data.names.filter(n=>typeof n==='string'&&n.trim()).map(n=>[n,'Alta'])):{};
    }
    run();
  }catch{clientCriticality={};run();}
  finally{button.disabled=false;}
});
let scheduled=false;
window.addEventListener('audit:tickets-updated',()=>{
  if(scheduled)return;
  scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});
});
if(window.ticketInspectionSource?.().length)run();
