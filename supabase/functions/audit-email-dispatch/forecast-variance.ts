// Snapshot de previsões encerradas para relatório executivo, sem IA externa.
type R = Record<string,any>;
type ForecastAlert = {
  id:string;subject:string;client:string;sector:string;owner:string;status:string;
  estimatedHours:number;actualMinutes:number;gapHours:number;variancePercent:number;
  confidence:string;evidence:string;updatedAt:string;
};
export async function forecastSection(
 rec:R,
 deps:{db:(path:string)=>Promise<any>;norm:(v:unknown)=>string;duration:(minutes:number)=>string;emailEsc:(v:unknown)=>string}
):Promise<{text:string;html:string;rows:ForecastAlert[]}>{
 const {db,norm,duration,emailEsc:esc}=deps;
 const empty={text:'',html:'',rows:[] as ForecastAlert[]};
 const results=await db('audit_forecast_variance_snapshots?select=ticket_id,subject,client_name,sector,status,estimated_hours,actual_minutes,variance_percent,evidence,confidence,updated_at&order=variance_percent.desc&limit=150') as R[];
 if(!Array.isArray(results)||!results.length)return empty;
 const stamp=Date.parse(String(results[0].updated_at||''));
 if(!Number.isFinite(stamp)||Date.now()-stamp>90*60*1000)return empty;
 const linked=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).map(norm).filter(Boolean);
 const scope=String(rec.scope||'sector'),person=norm(rec.collaborator_name);
 const qualified=results.filter(x=>{
  const expected=Number(x.estimated_hours),minutes=Number(x.actual_minutes),gap=Number(x.variance_percent);
  if(!(expected>=8&&minutes>0&&gap>=60&&minutes<expected*60))return false;
  if(!/^(fechad|conclu|resolvid|encerrad|finalizad)/.test(norm(x.status)))return false;
  if(linked.length&&!linked.includes(norm(x.sector)))return false;
  if(scope!=='management'&&!linked.length)return false;
  return /^\d{1,12}$/.test(String(x.ticket_id||''));
 });
 if(!qualified.length)return empty;
 const ids=qualified.map(x=>String(x.ticket_id));
 const owners=await db('audit_direct_tickets?select=ticket_id,owner:payload->owner&ticket_id=in.('+ids.join(',')+')&limit=150') as R[];
 const ownerMap=new Map((Array.isArray(owners)?owners:[]).map(x=>[
  String(x.ticket_id),String(x.owner?.businessName||x.owner?.name||'Não informado')
 ]));
 const rows=qualified.filter(x=>!person||norm(ownerMap.get(String(x.ticket_id)))===person).map(x=>{
  const expected=Number(x.estimated_hours),minutes=Number(x.actual_minutes);
  return {id:String(x.ticket_id),subject:String(x.subject||'Sem assunto'),
   client:String(x.client_name||'Não informado'),sector:String(x.sector||'Sem setor'),
   owner:ownerMap.get(String(x.ticket_id))||'Não informado',status:String(x.status||'—'),
   estimatedHours:expected,actualMinutes:minutes,gapHours:Math.max(0,expected-minutes/60),
   variancePercent:Number(x.variance_percent),confidence:String(x.confidence||'baixa'),
   evidence:String(x.evidence||''),updatedAt:String(x.updated_at||'')};
 }).sort((a,b)=>b.gapHours-a.gapHours||b.variancePercent-a.variancePercent).slice(0,8);
 if(!rows.length)return empty;
 const hours=(v:number)=>duration(Math.round(v*60));
 const updated=new Date(stamp).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const disclaimer='Fotografia atual da base, não limitada ao período deste e-mail. Revisar escopo aprovado, entrega e integridade dos apontamentos. Diferenças não comprovam irregularidade.';
 const text='\n\nAUDITORIA DE PREVISÕES — CHAMADOS ENCERRADOS\n'+
  'Base atualizada: '+updated+' (Brasília). '+rows.length+' candidato(s) apresentados.\n'+
  rows.map(x=>'#'+x.id+' | '+x.client+' | '+x.sector+' | Resp.: '+x.owner+
   ' | Previsto: '+hours(x.estimatedHours)+' | Apontado: '+duration(x.actualMinutes)+
   ' | Diferença: '+hours(x.gapHours)+' ('+x.variancePercent.toFixed(1)+'%)'+
   ' | Confiança: '+x.confidence+' | https://arquem.movidesk.com/Ticket/Edit/'+x.id).join('\n')+
  '\n'+disclaimer;
 const th=(label:string)=>'<th style="padding:9px 7px;text-align:left;font-size:11px;color:#e9f6ff;font-weight:700">'+label+'</th>';
 const body=rows.map((x,i)=>'<tr style="background:'+(i%2===0?'#fff':'#f5f8fc')+'">'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:12px"><a style="color:#1267a8;font-weight:700;text-decoration:none" href="https://arquem.movidesk.com/Ticket/Edit/'+encodeURIComponent(x.id)+'">#'+esc(x.id)+'</a><div style="color:#718198;font-size:10px">'+esc(x.sector)+'</div></td>'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:12px">'+esc(x.client)+'<div style="color:#65748b;font-size:11px">Responsável: '+esc(x.owner)+'</div></td>'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:12px;white-space:nowrap">'+hours(x.estimatedHours)+'</td>'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:12px;white-space:nowrap">'+duration(x.actualMinutes)+'</td>'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:12px;color:#a85b24;font-weight:700;white-space:nowrap">'+hours(x.gapHours)+'<div style="font-size:11px">'+x.variancePercent.toFixed(1)+'%</div></td>'+
  '<td style="padding:10px 7px;border-bottom:1px solid #e3eaf4;font-size:11px">'+esc(x.confidence)+'</td></tr>').join('');
 const html='<section style="margin:26px 0;border:1px solid #dce7f4;border-radius:10px;overflow:hidden">'+
  '<div style="background:#183956;padding:18px 16px;color:#fff"><div style="font-weight:700;font-size:16px">Auditoria de previsões × apontamentos</div>'+
  '<div style="font-size:12px;margin-top:5px;color:#cbdff0">Chamados encerrados · '+rows.length+' candidato(s) · Base de '+esc(updated)+' (Brasília)</div></div>'+
  '<div style="overflow-x:auto"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">'+
  '<thead style="background:#2b5475"><tr>'+th('Chamado')+th('Cliente / responsável')+th('Previsto')+th('Apontado')+th('Diferença')+th('Confiança')+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
  '<p style="padding:10px 14px 15px;color:#60728b;font-size:11px;line-height:1.5;margin:0">'+esc(disclaimer)+'</p></section>';
 return {text,html,rows};
}
