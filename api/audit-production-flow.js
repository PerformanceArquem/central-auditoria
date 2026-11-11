import {buildProductionFlow} from '../lib/production-flow.mjs';
const PAGE=250,MAX=20000;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDate=s=>/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 const fail=(n,s)=>res.status(n).json({ok:false,error:s});
 if(req.method!=='GET')return fail(405,'Método não permitido');
 const to=String(req.query?.to||today()),from=String(req.query?.from||to.slice(0,7)+'-01');
 if(!validDate(from)||!validDate(to)||from>to||to>today()||(Date.parse(to)-Date.parse(from))/86400000>366)return fail(400,'Selecione um período válido de até 367 dias, sem datas futuras.');
 const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');if(!bearer)return fail(401,'Entre no sistema para consultar a rastreabilidade.');
 const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base.startsWith('https://')||!key)return fail(503,'Integração indisponível.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000),headers={apikey:key,Authorization:'Bearer '+key};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+bearer[1]},signal:controller.signal});
  if(!auth.ok)return fail(401,'Sessão expirada.');const user=await auth.json();if(!user?.id)return fail(401,'Sessão inválida.');
  async function read(table,params){const u=new URL(base+'/rest/v1/'+table);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers,signal:controller.signal});if(!r.ok)throw Error('Consulta indisponível: '+table);const data=await r.json();if(!Array.isArray(data))throw Error('Resposta inválida.');return data;}
  const acl=await read('audit_users',{select:'role,is_active',user_id:'eq.'+user.id,limit:'1'});
  if(!acl.some(r=>r.role==='admin'&&r.is_active!==false))return fail(403,'Consulta reservada a administradores.');
  const warnings=[];
  async function people(){
   if(!process.env.MOVIDESK_TOKEN){warnings.push('Cadastro de equipes indisponível: autoria sem vínculo comprovado exige revisão.');return [];}
   try{const all=[];for(let skip=0;skip<5000;skip+=100){
    const u=new URL('https://api.movidesk.com/public/v1/persons');u.searchParams.set('token',process.env.MOVIDESK_TOKEN);u.searchParams.set('$select','id,businessName,teams');u.searchParams.set('$filter','profileType ne 2');u.searchParams.set('$orderby','id');u.searchParams.set('$top','100');u.searchParams.set('$skip',String(skip));
    const r=await fetch(u,{signal:controller.signal});if(!r.ok)throw Error('Cadastro indisponível');const batch=await r.json();if(!Array.isArray(batch))throw Error('Cadastro inválido');all.push(...batch);if(batch.length<100)return all;
   }throw Error('Cadastro excede limite');}catch{warnings.push('Não foi possível conferir as equipes dos autores; casos sem comprovação aparecem para revisão.');return [];}
  }
  async function ticketRows(){const rows=[];for(let offset=0;offset<MAX;offset+=PAGE){
   const columns='ticket_id,created_at_source,source_synced_at,subject:payload->>subject,status:payload->>status,createdDate:payload->>createdDate,ownerTeam:payload->>ownerTeam,owner:payload->owner,createdBy:payload->createdBy,clients:payload->clients,ownerHistories:payload->ownerHistories,statusHistories:payload->statusHistories';
   const batch=await read('audit_direct_tickets',{select:columns,order:'ticket_id.asc',limit:String(PAGE),offset:String(offset)});rows.push(...batch);if(batch.length<PAGE)return rows;
  }throw Error('Limite da base excedido; relatório não apresentado como completo.');}
  const [rows,roster,history,recent]=await Promise.all([ticketRows(),people(),read('audit_direct_sync_state',{select:'completed,updated_at,last_error',job_name:'eq.movidesk_backfill',limit:'1'}),read('audit_recent_reconcile_state',{select:'completed,last_success_at,last_error,period_start,period_end',job_name:'eq.movidesk_recent_reconcile',limit:'1'})]);
  const result=buildProductionFlow(rows,{from,to,people:roster});
  const latest=rows.map(r=>r.source_synced_at).filter(Boolean).sort().at(-1)||null;
  const h=history[0]||{},r=recent[0]||{};
  const age=r.last_success_at?(Date.now()-Date.parse(r.last_success_at))/3600000:Infinity;
  const covered=from>=String(r.period_start||'9999')&&to<String(r.period_end||'')&&r.completed===true&&!r.last_error&&age<=12;
  if(h.completed!==true||h.last_error)warnings.push('Importação histórica em andamento: totais limitados aos chamados sincronizados.');
  if(!covered)warnings.push('Período sem conciliação recente completa; números podem mudar após a sincronização.');
  warnings.push('Equipes dos autores refletem o cadastro atual. O histórico comprova a equipe responsável pelo chamado na data; mudanças antigas de equipe de pessoas exigem conferência.');
  return res.status(200).json({ok:true,...result,partial:h.completed!==true||!covered||!roster.length,coverage:{...result.coverage,latestSync:latest,historicalComplete:h.completed===true,recentCovered:covered},warnings});
 }catch(e){return fail(502,e.name==='AbortError'?'Consulta excedeu o tempo limite. Tente novamente.':'Não foi possível atualizar a rastreabilidade.');}
 finally{clearTimeout(timer);}
}

