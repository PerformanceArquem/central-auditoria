type Row=Record<string,any>;
export const COMPARISON_POLICY='sector-comparisons-v1';
const norm=(x:unknown)=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const esc=(x:unknown)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const day=(x:string,n:number)=>{const d=new Date(x+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const date=(x:unknown)=>{
 if(!x)return '';const value=String(x);const d=new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value)?value:value+'Z');
 return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'';
};
const display=(x:string)=>x.slice(8,10)+'/'+x.slice(5,7)+'/'+x.slice(0,4);
const person=(x:any)=>String(x?.businessName||x?.name||x||'');
const hours=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.round(n)%60).padStart(2,'0');
export function comparisonWindow(to:string){
 const current=to.slice(0,7)+'-01',previousEnd=day(current,-1);
 return {current,previous:previousEnd.slice(0,7)+'-01',previousEnd,to};
}
export function buildComparisons(rec:Row,appointments:Row[],tickets:Row[],from:string,to:string,holidays:Set<string>,complete=true){
 const window=comparisonWindow(to);
 const configured=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).filter(Boolean);
 const allowed=new Set(configured.map(norm));
 const names=(Array.isArray(rec.collaborator_names)&&rec.collaborator_names.length?rec.collaborator_names:rec.collaborator_name?[rec.collaborator_name]:[]).map(norm);
 const permitted=(sector:unknown,owner:unknown)=>
  (allowed.has(norm(sector))||(rec.scope==='management'&&!allowed.size))&&(!names.length||names.includes(norm(owner)));
 if(!['management','sector'].includes(String(rec.scope))||rec.scope==='sector'&&!allowed.size)throw Error('Escopo inválido para comparativos');
 const scoped=appointments.filter(a=>permitted(a.sector,a.collaborator_name));
 const sectors=new Map<string,string>(configured.map((s:string)=>[norm(s),s]));
 scoped.forEach(a=>sectors.set(norm(a.sector),String(a.sector)));
 const events:{id:string;sector:string;at:string}[]=[];
 let missingHistory=0;
 for(const t of tickets){
  const history=t.owner_histories??t.payload?.ownerHistories;
  if(!Array.isArray(history)||!history.length){if(permitted(t.sector,person(t.owner)))missingHistory++;continue;}
  const ordered:Row[]=history.map((h:Row):Row=>({...h,at:Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(String(h.changedDate))?h.changedDate:h.changedDate+'Z')})).sort((a:Row,b:Row)=>a.at-b.at);
  if(ordered.some((h:Row)=>!Number.isFinite(h.at))){if(permitted(t.sector,person(t.owner)))missingHistory++;continue;}
  let previous='';
  for(const h of ordered){
   const sector=norm(h.ownerTeam),changed=sector!==previous;previous=sector;
   if(!changed||!permitted(h.ownerTeam,person(h.owner))||['qualidade','treinamento'].includes(sector))continue;
   const at=date(h.changedDate);if(!at||at>to)continue;
   sectors.set(sector,String(h.ownerTeam));events.push({id:String(t.ticket_id),sector,at});
  }
 }
 const businessDays=(start:string,end:string)=>{let n=0;for(let d=start;d<=end;d=day(d,1)){const w=new Date(d+'T12:00:00Z').getUTCDay();if(w!==0&&w!==6&&!holidays.has(d))n++;}return n;};
 const target=Number(rec.daily_target_minutes??480),minimum=Number(rec.minimum_percent??80);
 if(!Number.isFinite(target)||target<=0||!Number.isFinite(minimum)||minimum<0||minimum>100)throw Error('Referência de jornada inválida');
 const aggregate=(start:string,end:string,sector?:string)=>{
  const rows=scoped.filter(a=>String(a.appointment_date)>=start&&String(a.appointment_date)<=end&&(!sector||norm(a.sector)===sector));
  const selectedSectors=sector?[sector]:[...sectors.keys()];
  const incoming=new Set<string>();
  for(const key of selectedSectors){
   if(['qualidade','treinamento'].includes(key)){
    rows.filter(a=>norm(a.sector)===key&&norm(a.activity)&&a.ticket_id).forEach(a=>incoming.add(key+'|'+a.ticket_id));
   }else events.filter(e=>e.sector===key&&e.at>=start&&e.at<=end).forEach(e=>incoming.add(key+'|'+e.id));
  }
  const people=new Set(rows.map(a=>norm(a.collaborator_name)).filter(Boolean));
  const referenceMinutes=businessDays(start,end)*target*(names.length&&!sector?names.length:people.size);
  return {from:start,to:end,incoming:incoming.size,workedTickets:new Set(rows.map(a=>String(a.ticket_id))).size,
   appointments:rows.length,minutes:rows.reduce((n,a)=>n+Math.max(0,Number(a.duration_minutes)||0),0),
   referenceMinutes,minimumMinutes:Math.round(referenceMinutes*minimum/100),people:people.size,
   basis:sector&&['qualidade','treinamento'].includes(sector)?'Chamados distintos com atividades registradas':'Chamados distintos por setor no histórico de entradas'};
 };
 const monthly=[{label:display(window.previous)+' a '+display(window.previousEnd),...aggregate(window.previous,window.previousEnd),partial:false},
  {label:display(window.current)+' a '+display(to),...aggregate(window.current,to),partial:day(to,1).slice(0,7)===to.slice(0,7)}];
 const weekly=[];let start=window.previous;
 while(start<=to){const weekday=new Date(start+'T12:00:00Z').getUTCDay();const sunday=day(start,(7-weekday)%7);const end=sunday>to?to:sunday;
  weekly.push({label:display(start)+' a '+display(end),...aggregate(start,end),partial:weekday!==1||end!==sunday});start=day(end,1);}
 const bySector=[...sectors].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR')).map(([key,sector])=>({sector,...aggregate(from,to,key),historyAvailable:['qualidade','treinamento'].includes(key)||missingHistory===0}));
 const note='Entradas: chamados distintos por setor no histórico de mudança de equipe; retornos ao mesmo setor contam uma vez no período. Qualidade e Treinamento: chamados distintos com atividade registrada no período, não transferências. O mesmo chamado pode aparecer em mais de um setor. Referência de jornada dos nomes configurados ou das pessoas com apontamentos; não é controle de ponto. Mês/semana parcial não equivale a período fechado. Cobertura limitada à base sincronizada.';
 return {version:COMPARISON_POLICY,from,to,monthly,weekly,sectors:bySector,historyComplete:complete&&missingHistory===0,missingHistory,note};
}
export function renderComparisons(data:ReturnType<typeof buildComparisons>){
 const table=(headers:string[],rows:any[][])=>'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:11px;border-collapse:collapse"><thead><tr style="background:#edf3fb">'+headers.map(h=>'<th style="padding:8px;text-align:left;color:#173b65">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td style="padding:8px;border-bottom:1px solid #dce7f3">'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const summary=(rows:Row[])=>rows.map(r=>[r.label+(r.partial?' · parcial':''),r.incoming,r.workedTickets,r.appointments,hours(r.minutes),hours(r.referenceMinutes)]);
 const maximum=Math.max(...data.monthly.map(m=>m.minutes),1);
 const bars=data.monthly.map(m=>'<div style="margin:12px 0;font-size:12px;color:#173b65">'+esc(m.label)+(m.partial?' · parcial':'')+' · '+hours(m.minutes)+'<table role="presentation" width="100%" style="background:#eaf0f7;margin-top:4px"><tr><td width="'+Math.max(1,Math.round(100*m.minutes/maximum))+'%" bgcolor="#218c89" height="10"></td><td></td></tr></table></div>').join('');
 const headers=['Período','Entradas¹','Trabalhados','Apontamentos','Horas','Jornada ref.'];
 const title='Comparativo de chamados, apontamentos e carga horária';
 const html='<section style="margin:24px 0;padding:20px;border:1px solid #dce7f3;border-radius:10px;background:#fff"><h2 style="font-size:17px;color:#173b65">'+title+'</h2>'+(!data.historyComplete?'<p style="color:#9a5800">Histórico de entradas incompleto; contagens de transferências podem estar parciais.</p>':'')+'<h3 style="font-size:14px;color:#173b65">Dois meses de referência</h3>'+bars+table(headers,summary(data.monthly))+'<h3 style="font-size:14px;color:#173b65">Comparativo semanal dos dois meses</h3>'+table(headers,summary(data.weekly))+'<h3 style="font-size:14px;color:#173b65">Chamados por setor · período do relatório</h3>'+table(['Setor','Entradas / atividades¹','Apontamentos','Horas','Base'],data.sectors.map(s=>[s.sector,s.historyAvailable?s.incoming:'Parcial: '+s.incoming,s.appointments,hours(s.minutes),s.basis]))+'<p style="font-size:10px;line-height:1.6;color:#65758a">¹ '+esc(data.note)+'</p></section>';
 const text='\n\n'+title+'\n'+headers.join(' | ')+'\n'+summary(data.monthly).map(r=>r.join(' | ')).join('\n')+'\n\nSemanas:\n'+summary(data.weekly).map(r=>r.join(' | ')).join('\n')+'\n\nPor setor:\n'+data.sectors.map(s=>s.sector+' | '+s.incoming+' | '+s.basis).join('\n')+'\n'+data.note;
 return {html,text};
}
