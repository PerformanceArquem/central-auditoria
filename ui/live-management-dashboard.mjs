import {summarizeManagement} from '/lib/live-management-dashboard.mjs';
const target=document.getElementById('t-mgmt');
if(target){
 const root=document.createElement('section');root.className='card';root.setAttribute('aria-label','Dashboard gerencial integrado');
 const make=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
 const title=make('h3','Dashboard Gerencial Integrado');
 const note=make('p','Indicadores da base carregada; entradas, saídas e apontamentos da data selecionada. Estoque, risco e gargalos refletem a situação atual, não uma fotografia histórica.','subtle');
 const filters=make('div','','row');
 const date=document.createElement('input');date.type='date';date.setAttribute('aria-label','Data dos indicadores');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 date.value=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
 const sector=document.createElement('select');sector.setAttribute('aria-label','Setor');sector.add(new Option('Todos os setores',''));
 const vipButton=make('button','Consultar lista corporativa VIP','s');vipButton.type='button';
 const dateGroup=make('div','','fg');dateGroup.append(make('label','Data'),date);
 const sectorGroup=make('div','','fg');sectorGroup.append(make('label','Setor atual'),sector);
 filters.append(dateGroup,sectorGroup,vipButton);
 const status=make('p','','subtle');status.setAttribute('role','status');
 const cards=make('div','','kpis'),charts=make('div','','radar-ranks');
 const exports=make('div','','row'),exportStatus=make('p','','subtle');exportStatus.setAttribute('aria-live','polite');
 let snapshot=null;
 for(const format of ['Excel','PDF']){
  const button=make('button','Exportar '+format,'s');button.type='button';exports.append(button);
  button.addEventListener('click',()=>{
   try{
    if(!snapshot)throw Error('Indicadores indisponíveis para exportação.');
    const {d,scope,freshness}=snapshot;
    const matrices=[
     ['Resumo',[['Indicador','Valor'],['Data',d.day],['Setor',scope],['Origem',freshness],['Base carregada',d.loaded],['Chamados abertos atualmente',d.backlog],['Entradas na data',d.opened],['Encerrados na data',d.closed],['Vencidos atualmente',d.radar.overdue],['Risco alto ou crítico',d.radar.high+d.radar.critical],['Clientes VIP em risco',d.vipRisk??'Indisponível'],['Gargalos sinalizados',d.gaps],['Horas apontadas na data',d.hours],['Risco indeterminado',d.radar.unknown],['Encerrados sem data confirmada',d.unknownClosure],['Escopo','Estoque e risco atuais; entradas, encerramentos e horas da data selecionada.']]],
     ['Setores',[['Setor','Entradas','Encerramentos','Estoque atual','Horas apontadas'],...d.sectors.map(r=>[r.sector,r.opened,r.closed,r.backlog,r.hours])]],
     ['Colaboradores',[['Colaborador','Horas apontadas'],...d.owners]],
     ['Radar',[['Classificação','Chamados'],...Object.entries(d.radar)]]
    ];
    const filename='Dashboard_Gerencial_'+d.day;
    if(format==='Excel'){
     const x=window.XLSX;if(!x)throw Error('Biblioteca Excel indisponível.');
     const wb=x.utils.book_new();
     for(const [name,matrix] of matrices){const ws=x.utils.aoa_to_sheet(matrix);ws['!cols']=matrix[0].map((_,i)=>({wch:i===0?40:25}));x.utils.book_append_sheet(wb,ws,name);}
     x.writeFile(wb,filename+'.xlsx');
    }else{
     const PDF=window.jspdf?.jsPDF;if(!PDF)throw Error('Biblioteca PDF indisponível.');
     const doc=new PDF({orientation:'landscape',unit:'pt',format:'a4'});
     if(typeof doc.autoTable!=='function')throw Error('Biblioteca de tabelas PDF indisponível.');
     matrices.forEach(([name,matrix],i)=>{if(i)doc.addPage();doc.setFontSize(15);doc.text('Central de Auditoria | Dashboard Gerencial - '+name,40,40);doc.autoTable({startY:55,head:[matrix[0]],body:matrix.slice(1).map(r=>r.map(v=>typeof v==='number'?fmt.format(v):String(v??'Indisponível'))),styles:{fontSize:9,overflow:'linebreak'},headStyles:{fillColor:[21,45,74]}});});
     doc.save(filename+'.pdf');
    }
    exportStatus.textContent='Exportação solicitada: '+format+'.';
   }catch(e){exportStatus.textContent=e.message;}
  });
 }
 root.append(title,note,filters,status,cards,charts,exports,exportStatus);target.prepend(root);
 let clientCriticality={},vipKnown=false,vipMessage='',dirty=true,scheduled=false;
 const fmt=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
 const team=t=>{const v=(t.payload||t).ownerTeam;return (typeof v==='string'?v.trim():String(v?.businessName||v?.name||'').trim())||'Sem setor';};
 function render(){
  snapshot=null;
  const source=window.managementDashboardSource?.();
  if(!source){status.textContent='Aguardando a base sincronizada.';return;}
  const selected=sector.value,teams=[...new Set(source.tickets.map(team))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  sector.replaceChildren(new Option('Todos os setores',''),...teams.map(t=>new Option(t,t)));sector.value=teams.includes(selected)?selected:'';
  if(!date.value){status.textContent='Selecione uma data válida.';cards.replaceChildren();charts.replaceChildren();return;}
  if(!source.tickets.length&&!source.appointments.length){status.textContent='Base sem registros carregados; indicadores indisponíveis.';cards.replaceChildren();charts.replaceChildren();return;}
  const d=summarizeManagement({...source,day:date.value,sector:sector.value,clientCriticality,vipKnown});
  status.textContent='Base filtrada: '+d.loaded+' chamados · '+(source.lastSync?'Última consulta registrada: '+new Date(source.lastSync).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Sincronização não confirmada nesta sessão')+' · '+d.unknownClosure+' encerrados sem data confirmada. '+vipMessage;
  snapshot={d,scope:sector.value||'Todos os setores',freshness:status.textContent};
  cards.replaceChildren();
  for(const [label,value] of [['Chamados abertos atualmente',d.backlog],['Entradas na data',d.opened],['Encerrados na data',d.closed],['Vencidos atualmente',d.radar.overdue],['Risco alto ou crítico',d.radar.high+d.radar.critical],['Clientes VIP em risco',d.vipRisk],['Gargalos sinalizados',d.gaps],['Horas apontadas na data',fmt.format(d.hours)+' h'],['Risco indeterminado',d.radar.unknown]]){
   const card=make('div','','card');card.append(make('small',label),make('b',value===null?'Indisponível':String(value)));cards.append(card);
  }
  charts.replaceChildren();
  for(const [heading,entries] of [['Entradas por setor atual',d.sectors.map(r=>[r.sector,r.opened])],['Encerramentos por setor atual',d.sectors.map(r=>[r.sector,r.closed])],['Estoque atual por setor',d.sectors.map(r=>[r.sector,r.backlog])],['Horas apontadas por colaborador',d.owners]]){
   const group=make('div');group.append(make('h3',heading));
   const sorted=entries.filter(r=>r[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,10),max=Math.max(1,...sorted.map(r=>r[1]));
   if(!sorted.length)group.append(make('p','Nenhum registro na seleção.'));
   for(const [name,value] of sorted){const line=make('div','','radar-rank');line.append(make('span',name+' · '+fmt.format(value)));const meter=document.createElement('meter');meter.min=0;meter.max=max;meter.value=value;meter.setAttribute('aria-label',name+': '+fmt.format(value));line.append(meter);group.append(line);}
   charts.append(group);
  }
  dirty=false;
 }
 function schedule(){dirty=true;if(scheduled||target.classList.contains('hide'))return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;if(dirty&&!target.classList.contains('hide'))render();});}
 date.addEventListener('change',render);sector.addEventListener('change',render);
 vipButton.addEventListener('click',async()=>{vipButton.disabled=true;try{const client=window.tmEmailAdminClient;if(!client)throw Error('Sessão indisponível');const {data,error}=await client.functions.invoke('audit-email-dispatch',{body:{action:'vip_config',mode:'list'}});if(error||!data?.ok||!Array.isArray(data.names))throw Error('Lista corporativa indisponível');clientCriticality=Object.fromEntries(data.names.filter(n=>typeof n==='string'&&n.trim()).map(n=>[n.trim(),'Alta']));vipKnown=true;vipMessage='Lista VIP corporativa consultada.';}catch{clientCriticality={};vipKnown=false;vipMessage='Não foi possível consultar a lista VIP.';}finally{vipButton.disabled=false;schedule();}});
 window.addEventListener('audit:tickets-updated',schedule);
 new MutationObserver(schedule).observe(target,{attributes:true,attributeFilter:['class']});
 schedule();
}
