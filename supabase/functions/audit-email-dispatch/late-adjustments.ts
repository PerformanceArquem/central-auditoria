type R=Record<string,any>;
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export const TIMING_NOTICE='As horas são contabilizadas pela data do trabalho. Apontamentos incluídos ou alterados depois podem atualizar períodos anteriores. A ausência de registros no fechamento não comprova ausência de trabalho.';
export function allowedAppointment(rec:R,row:R|null){
 if(!row)return false;
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map(norm).filter(Boolean);
 const people=(Array.isArray(rec.collaborator_names)&&rec.collaborator_names.length?rec.collaborator_names:rec.collaborator_name?[rec.collaborator_name]:[]).map(norm).filter(Boolean);
 const sector=norm(row.sector);
 return ((rec.scope==='management'&&!sectors.length)||sectors.some((s:string)=>s===sector||(s==='sucesso'&&sector==='sucesso do cliente')))&&(!people.length||people.includes(norm(row.collaborator_name)));
}
export function summarizeAdjustments(events:R[],rec:R,priorReports:R[],from:string,to:string){
 const items=new Map<string,R>();
 for(const event of [...events].sort((a,b)=>String(a.observed_at).localeCompare(String(b.observed_at)))){
  const before=event.before_data,after=event.after_data;
  const snapshots=[before,after].filter((x,i,a)=>x&&a.findIndex(y=>y&&y.appointment_date===x.appointment_date&&y.collaborator_name===x.collaborator_name&&y.sector===x.sector)===i);
  for(const snapshot of snapshots){
   if(!allowedAppointment(rec,snapshot))continue;
   const date=String(snapshot.appointment_date||'');
   if(!date||date>to)continue;
   const reported=priorReports.some(p=>p.status==='sent'&&!String(p.dispatch_key||'').startsWith('preliminary:')&&p.period_from<=date&&p.period_to>=date&&Date.parse(p.sent_at)<Date.parse(event.observed_at));
   if(!reported)continue;
   const belongs=(x:R|null)=>x&&x.appointment_date===date&&x.collaborator_name===snapshot.collaborator_name&&x.sector===snapshot.sector&&allowedAppointment(rec,x);
   const previous=belongs(before)?Number(before.duration_minutes)||0:0,current=belongs(after)?Number(after.duration_minutes)||0:0;
   if(previous===current)continue;
   const key=String(event.appointment_key)+'|'+date+'|'+snapshot.collaborator_name+'|'+snapshot.sector;
   const existing=items.get(key);
   if(existing){existing.currentMinutes=current;existing.observedAt=event.observed_at;}
   else items.set(key,{ticketId:String(snapshot.ticket_id||''),date,person:String(snapshot.collaborator_name||''),previousMinutes:previous,currentMinutes:current,observedAt:event.observed_at,inCurrentPeriod:date>=from&&date<=to});
  }
 }
 return [...items.values()].filter(x=>x.currentMinutes!==x.previousMinutes).map(x=>({...x,deltaMinutes:x.currentMinutes-x.previousMinutes}));
}
export async function reportTiming(packet:R,db:(path:string)=>Promise<any>,list:(table:string,suffix?:string,limit?:number)=>Promise<R[]>){
 const base={notice:TIMING_NOTICE,adjustments:[] as R[],status:'no_comparison',generatedAt:new Date().toISOString()};
 if(packet.productionFlow)return null;
 if(packet.reportSections?.daily_detail===false)return {...base,status:'restricted'};
 const id=String(packet.recipientId||'');
 if(!/^[-a-f0-9]{36}$/i.test(id))return base;
 const recipients=await db('audit_email_recipients?id=eq.'+encodeURIComponent(id)+'&active=eq.true&select=*&limit=1');
 if(!recipients.length)return base;
 if(recipients[0].report_sections?.daily_detail===false)return {...base,status:'restricted'};
 const previous=await db('audit_email_sector_dispatches?recipient_id=eq.'+encodeURIComponent(id)+'&status=eq.sent&report_kind=eq.'+encodeURIComponent(String(packet.reportKind||'daily'))+'&select=dispatch_key,status,period_from,period_to,sent_at&order=sent_at.desc&limit=250');
 const official=previous.filter((p:R)=>!String(p.dispatch_key).startsWith('preliminary:'));
 if(!official.length)return base;
 const since=String(official[0].sent_at);
 const events=await list('audit_appointment_changes','?select=appointment_key,observed_at,before_data,after_data&observed_at=gt.'+encodeURIComponent(since)+'&order=observed_at.asc',25000);
 const adjustments=summarizeAdjustments(events,recipients[0],official,String(packet.from),String(packet.to));
 return {...base,notice:base.notice+(adjustments.length>100?' Exibidos os 100 primeiros de '+adjustments.length+' ajustes.':''),status:'tracked',adjustments:adjustments.slice(0,100),adjustmentCount:adjustments.length};
}
export function timingContent(timing:R){
 const hh=(n:number)=>{const sign=n<0?'-':'';n=Math.abs(n);return sign+Math.floor(n/60)+'h'+String(n%60).padStart(2,'0');};
 const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):s;
 const observed=(s:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(s));
 const rows=timing.adjustments||[],visible=rows.slice(0,100),total=Number(timing.adjustmentCount)||rows.length;
 const note='Identificado na atualização dos dados; a data exata do lançamento no Movidesk não é fornecida. Os ajustes permanecem na data original do trabalho e não são somados novamente ao dia atual.';
 const text='\n\nPOSIÇÃO DOS APONTAMENTOS\n'+timing.notice+(rows.length?'\nAJUSTES IDENTIFICADOS APÓS FECHAMENTO ANTERIOR\n'+visible.map((r:R)=>date(r.date)+' | '+r.person+' | #'+r.ticketId+' | '+hh(r.previousMinutes)+' → '+hh(r.currentMinutes)+' | diferença '+hh(r.deltaMinutes)+' | identificado em '+observed(r.observedAt)).join('\n')+'\n'+note:'')+(total>100?'\nExibidos 100 de '+total+' ajustes.':'');
 const html='<div style="margin:20px 0;padding:16px;background:#f2f6fc;border-left:4px solid #218c89;font-size:12px;line-height:1.6"><strong>Posição dos apontamentos</strong><p>'+esc(timing.notice)+'</p>'+(rows.length?'<strong>Ajustes identificados após fechamento anterior</strong><table width="100%" cellpadding="6" style="border-collapse:collapse"><tr><th>Data do trabalho</th><th>Colaborador / chamado</th><th>Antes → atual</th><th>Diferença</th><th>Identificado em</th></tr>'+visible.map((r:R)=>'<tr><td>'+esc(date(r.date))+'</td><td>'+esc(r.person)+' / #'+esc(r.ticketId)+'</td><td>'+hh(r.previousMinutes)+' → '+hh(r.currentMinutes)+'</td><td>'+hh(r.deltaMinutes)+'</td><td>'+esc(observed(r.observedAt))+'</td></tr>').join('')+'</table><p>'+esc(note)+'</p>':'')+(total>100?'<p>Exibidos 100 de '+total+' ajustes.</p>':'')+'</div>';
 return {text,html};
}

