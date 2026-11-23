import policy from '../lib/ticket-manager-assistant.cjs';
const {parse,tickets,delivery}=policy;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const reply=(status,data)=>res.status(status).json(data);
 if(req.method!=='POST')return reply(405,{ok:false,error:'Método não permitido'});
 const match=/^Bearer ([A-Za-z0-9._-]{1,16000})$/.exec(req.headers.authorization||'');if(!match)return reply(401,{ok:false,error:'Faça login na Central'});
 const base=(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key)return reply(503,{ok:false,error:'Consulta indisponível'});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{
  async function json(response){if(!response.ok)throw Error('upstream');const reader=response.body.getReader();let size=0;const chunks=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2000000){await reader.cancel();throw Error('size');}chunks.push(Buffer.from(part.value));}const text=Buffer.concat(chunks).toString('utf8');if(Buffer.byteLength(text)>2000000)throw Error('size');return JSON.parse(text);}
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+match[1]},signal:controller.signal});
  if(!auth.ok)return reply(401,{ok:false,error:'Sessão expirada. Faça login novamente.'});
  const user=await json(auth);
  if(!user?.id||user.is_anonymous)return reply(401,{ok:false,error:'Sessão inválida'});
  async function read(table,params){const url=new URL(base+'/rest/v1/'+table);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));const rows=await json(await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+key},signal:controller.signal}));if(!Array.isArray(rows))throw Error('shape');return rows;}
  const acl=await read('audit_users',{select:'role,is_active',user_id:'eq.'+user.id,limit:1});
  if(!acl.some(r=>r.role==='admin'&&r.is_active===true))return reply(403,{ok:false,error:'Consulta reservada a administradores ativos'});
  let q;try{const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(Buffer.byteLength(JSON.stringify(body)||'')>4096)throw Error('Pergunta muito longa');q=parse(body);}catch(e){return reply(400,{ok:false,error:e.message==='Unexpected end of JSON input'?'Solicitação inválida':String(e.message).slice(0,120)});}
  const warnings=[];let rows=[],sources=[],matched=0,answer='';
  if(!q.operation)return reply(200,{ok:true,answer:'Posso consultar chamados parados, sinais de risco VIP, horas e jornada, rascunhos de cobrança e falhas dos relatórios. Escolha uma dessas consultas.',rows:[],aiUsed:false,readOnly:true});
  if(q.operation==='delivery'){
   if(q.sector||q.collaborator||q.client)return reply(400,{ok:false,error:'Limpe os filtros de setor, colaborador e cliente para consultar os registros de envio'});
   const data=await read('audit_email_sector_dispatches',{select:'recipient_id,report_kind,period_from,period_to,status,error_message,created_at',created_at:'gte.'+q.from+'T00:00:00-03:00',and:'(created_at.lt.'+new Date(Date.parse(q.to+'T00:00:00-03:00')+86400000).toISOString()+')',status:'in.(failed,processing)',order:'created_at.desc',limit:101});
   rows=delivery(data.slice(0,100));
   const ids=[...new Set(rows.map(r=>r.recipientId).filter(id=>/^[a-f0-9-]{36}$/i.test(id)))];
   if(ids.length){const people=await read('audit_email_recipients',{select:'id,name',id:'in.('+ids.join(',')+')',limit:100});const names=new Map(people.map(p=>[p.id,String(p.name||'Destinatário')]));rows=rows.map(r=>({...r,recipientName:names.get(r.recipientId)||'Destinatário não identificado'}));}
   matched=rows.length;sources=['Histórico de disparos da Central'];if(data.length>100)warnings.push('Amostra limitada aos 100 registros mais recentes');
   answer=rows.length+' registro(s) com falha ou em processamento no período de execução. Timeout genérico não comprova a causa ou ausência de aceite. Não houve reenvio.';
   warnings.push('Registros de disparo não comprovam entrega final. A identificação exclusiva da rotina das 09h não está disponível nesta fonte; outros disparos podem aparecer.');
  }else if(q.operation==='journey'){
   const data=await read('audit_direct_appointments',{select:'collaborator_name,sector,duration_minutes,appointment_date',appointment_date:'gte.'+q.from,and:'(appointment_date.lte.'+q.to+')',order:'appointment_date.asc',limit:1001});
   const groups=new Map();for(const a of data.slice(0,1000)){if(q.sector&&a.sector!==q.sector||q.collaborator&&a.collaborator_name!==q.collaborator)continue;const n=Number(a.duration_minutes);if(!Number.isFinite(n)||n<0)continue;const name=String(a.collaborator_name||'Não informado'),id=JSON.stringify([name,a.sector]);const g=groups.get(id)||{name,sector:a.sector,minutes:0,journeyMinutes:null,gapMinutes:null};g.minutes+=n;groups.set(id,g);}rows=[...groups.values()];matched=rows.length;sources=['Apontamentos reais sincronizados do Movidesk'];
   if(q.client)return reply(400,{ok:false,error:'Limpe o filtro de cliente para consultar jornada'});
   answer='Horas apontadas calculadas a partir dos registros reais. Jornada e diferença indisponíveis: falta escala individual validada com férias e afastamentos. Não representam avaliação de desempenho.';
   if(data.length>1000)warnings.push('Recorte parcial: primeiros 1.000 apontamentos. Reduza o período.');
  }else{
   const vipIds=new Set((process.env.TICKET_MANAGER_VIP_CLIENT_IDS||'').split(',').map(s=>s.trim()).filter(s=>/^\d{1,20}$/.test(s)));
   if(q.operation==='vip'&&!vipIds.size)return reply(200,{ok:true,answer:'Cadastro de clientes VIPs ainda não confirmado para este assistente. Não é possível classificar o risco VIP com segurança.',rows:[],aiUsed:false,readOnly:true});
   const data=await read('audit_direct_tickets',{select:'ticket_id,source_synced_at,status:payload->>status,ownerTeam:payload->>ownerTeam,owner:payload->owner,clients:payload->clients,actions:payload->actions,slaSolutionDate:payload->>slaSolutionDate,slaSolutionDateIsPaused:payload->slaSolutionDateIsPaused,closedIn:payload->>closedIn,canceledIn:payload->>canceledIn,isDeleted:payload->isDeleted',order:'ticket_id.asc',limit:501});
   const result=tickets(data.slice(0,500).map(row=>({...row,payload:row})),q,Date.now(),vipIds);rows=result.rows;matched=result.matched;sources=['Chamados sincronizados do Movidesk'];
   warnings.push('Fotografia atual; o período selecionado não filtra a idade dos chamados. Cobertura limitada a 500 registros sincronizados; não é total histórico.');
   if(result.excludedStale)warnings.push(result.excludedStale+' registros sem sincronização recente foram excluídos');
   answer=q.operation==='draft'?'Rascunho para revisão: Olá! Poderia verificar os chamados abaixo, cujo prazo de solução consta vencido na base consultada? Por favor, informe o andamento, possíveis impedimentos e a previsão atualizada. Obrigado pelo apoio. Nenhuma cobrança foi enviada.':q.operation==='vip'?'Sinais operacionais de atenção em clientes VIPs: prazo vencido ou inatividade comprovada. A lista prioriza vencidos; não é uma previsão de perda de cliente.':matched+' chamado(s) com mais de '+q.days+' dias sem ação registrada no recorte. Última atualização do ticket não é usada como prova de inatividade.';
  }
  let aiUsed=false,aiSuggestion='';
  // Only anonymous counts and a fixed operation code leave the server. No free-form question or ticket content.
  if(q.externalAiConsent===true&&process.env.GEMINI_AI_DRAFT_ENABLED==='true'&&process.env.GEMINI_API_KEY){
   const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
   if(/^[a-zA-Z0-9._-]{2,80}$/.test(model))try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:'Escreva até três orientações gerais em português para revisão humana de indicadores operacionais. Use somente a contagem recebida. Não invente nomes, causas, jornada, evidências ou envios realizados. Não execute ações. Não faça avaliação de pessoas.'}]},contents:[{role:'user',parts:[{text:JSON.stringify({operation:q.operation,count:matched})}]}],generationConfig:{temperature:0,maxOutputTokens:350}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
    const out=await json(response);aiSuggestion=String(out.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('\n')||'').slice(0,2200);aiUsed=!!aiSuggestion;
   }catch{warnings.push('IA externa indisponível; resultado calculado preservado');}
  }
  return reply(200,{ok:true,answer,aiSuggestion,aiUsed,rows,matched,sources,warnings,generatedAt:new Date().toISOString(),readOnly:true,notificationsSent:0});
 }catch{return reply(503,{ok:false,error:'Não foi possível consultar os dados autorizados. Nenhuma ação foi executada.'});}
 finally{clearTimeout(timer);}
}
