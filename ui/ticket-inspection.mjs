import {inspectTickets,filterInspections,recordOccurrences} from '/lib/ticket-inspection.mjs';
const panel=document.getElementById('ticketInspection');
let history=[], report=[];
const date=n=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(n);
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
function paragraph(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);}
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
  panel.querySelector('[role=status]').textContent=rows.length+' chamados nos dados carregados. Risco por regras; pontuação não representa probabilidade estatística.';
  const body=panel.querySelector('tbody');body.replaceChildren();
  for(const r of rows.slice(0,200)){
    const tr=document.createElement('tr');
    for(const text of [r.id,r.subject,r.client,r.sector,r.owner,r.criticality+' ('+r.score+'/100)',r.findings.map(f=>f.label).join('; ')||'Sem ocorrências',r.reasons.join('; ')||'Sem agravantes identificados'])cell(tr,text);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Histórico e transferências';details.append(summary);
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
  report=inspectTickets(tickets);
  history=recordOccurrences(history,report,Date.now());
  const select=panel.querySelector('[name=sector]'),selected=select.value;
  select.replaceChildren(new Option('Todos os setores',''));
  for(const sector of [...new Set(report.map(r=>r.sector))].sort())select.add(new Option(sector,sector));
  select.value=selected;render();
}
panel.querySelector('button').addEventListener('click',run);
let scheduled=false;
window.addEventListener('audit:tickets-updated',()=>{
  if(scheduled)return;
  scheduled=true;requestAnimationFrame(()=>{scheduled=false;run();});
});
if(window.ticketInspectionSource?.().length)run();
