import {inspectTickets,filterInspections,recordOccurrences,summarizeInspectionQuality} from '/lib/ticket-inspection.mjs';
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
function render(){
  const rows=filterInspections(report,{sector:panel.querySelector('[name=sector]').value,client:panel.querySelector('[name=client]').value,criticality:panel.querySelector('[name=criticality]').value});
  const quality=summarizeInspectionQuality(rows);
  panel.querySelector('[role=status]').textContent=rows.length+' chamados ativos nos dados carregados. Qualidade: '+quality.noForecast+' sem prazo válido, '+quality.noOwner+' sem responsável, '+quality.noSector+' sem setor; '+quality.unknownRisk+' com risco indeterminado e '+quality.overdue+' vencidos. Indicadores da amostra carregada, sem cobrança automática. Risco por regras; pontuação não representa probabilidade estatística.';
  const body=panel.querySelector('tbody');body.replaceChildren();
  for(const r of rows.slice(0,200)){
    const tr=document.createElement('tr');
    for(const text of [r.id,r.subject,r.client,r.sector,r.owner,r.criticality+' ('+(r.risk?.score===null?'sem índice':r.score+'/100')+') · cobertura '+(r.risk?.coverage??0)+'%',r.findings.map(f=>f.label).join('; ')||'Sem ocorrências',r.reasons.join('; ')||'Sem agravantes identificados'])cell(tr,text);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Histórico e transferências';details.append(summary);
    riskDetails(details,r.risk);
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
panel.querySelector('button').addEventListener('click',async()=>{
  const button=panel.querySelector('button');button.disabled=true;
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
