import {inspectTickets,filterInspections,recordOccurrences} from '/lib/ticket-inspection.mjs';
const panel=document.getElementById('ticketInspection');
let history=[], report=[];
const date=n=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(n);
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
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
