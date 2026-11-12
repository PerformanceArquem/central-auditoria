// Zenvia Voice (TotalVoice): somente leitura, métricas agregadas e acesso administrativo.
// Os números de telefone, gravações e o Access-Token nunca são retornados ao navegador.
const BASE='https://voice-api.zenvia.com';
const PAGE=200,MAX_PAGES=20,MAX_DAYS=31;
const fail=(res,status,error)=>res.status(status).json({ok:false,error});
const day=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&
  new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const utcDay=s=>Date.parse(s+'T12:00:00Z');
const seconds=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):0};
const status=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const attended=x=>['atendida','atendido','answered','completada'].includes(status(x));
const dateOf=x=>String(x.data_inicio||x.data_criacao||x.destino?.data_inicio||'').slice(0,10);
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return fail(res,405,'Método não permitido');
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!/^https:\/\//.test(base)||!key)return fail(res,503,'Autenticação da Central indisponível');
  const match=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');
  if(!match)return fail(res,401,'É necessário entrar na Central de Auditoria');
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),45000);
  try{
    const userResponse=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:'Bearer '+match[1]},signal:ctrl.signal});
    if(!userResponse.ok)return fail(res,401,'Sessão inválida ou expirada');
    const user=await userResponse.json();
    if(!user?.id)return fail(res,401,'Sessão inválida');
    const acl=new URL(base+'/rest/v1/audit_users');
    acl.searchParams.set('select','role,is_active');
    acl.searchParams.set('user_id','eq.'+user.id);
    acl.searchParams.set('limit','1');
    const profile=await fetch(acl,{headers:{apikey:key,Authorization:'Bearer '+key},signal:ctrl.signal});
    if(!profile.ok)return fail(res,503,'Não foi possível validar o perfil');
    const permissions=await profile.json();
    if(!Array.isArray(permissions)||!permissions.some(x=>String(x.role).toLowerCase()==='admin'&&x.is_active!==false))
      return fail(res,403,'Somente administradores podem consultar indicadores de voz');
    const start=Array.isArray(req.query?.start)?'':String(req.query?.start||'');
    const end=Array.isArray(req.query?.end)?'':String(req.query?.end||'');
    if(!day(start)||!day(end)||utcDay(end)<utcDay(start)||utcDay(end)-utcDay(start)>MAX_DAYS*86400000)
      return fail(res,400,'Informe um período válido de até 31 dias');
    const token=process.env.ZENVIA_VOICE_ACCESS_TOKEN;
    if(!token)return fail(res,503,'Zenvia Voice não configurada no servidor');
    const fetchAll=async path=>{
      let all=[],offset=0;
      for(let page=0;page<MAX_PAGES;page++){
        const url=new URL(BASE+path);
        url.searchParams.set('data_inicio',start);
        url.searchParams.set('data_fim',end);
        url.searchParams.set('posicao',String(offset));
        url.searchParams.set('limite',String(PAGE));
        const r=await fetch(url,{method:'GET',headers:{'Access-Token':token,Accept:'application/json'},signal:ctrl.signal});
        if(!r.ok)throw Error('Resposta não disponível da Zenvia Voice');
        const body=await r.json();
        if(body?.sucesso===false||!Array.isArray(body?.dados?.relatorio))
          throw Error('Formato de relatório Zenvia não reconhecido');
        const rows=body.dados.relatorio;
        all.push(...rows);
        const total=Number(body.dados.total);
        if((Number.isFinite(total)&&offset+rows.length>=total)||rows.length<PAGE)return all;
        if(!rows.length)throw Error('Paginação incompleta da Zenvia');
        offset+=rows.length;
      }
      throw Error('Relatório excede limite de consulta; reduza o período');
    };
    const [outbound,inbound]=await Promise.all([
      fetchAll('/chamada/relatorio'),fetchAll('/did/relatorio')
    ]);
    const days=new Map(),extensions=new Map();
    const summary={total:0,inbound:0,outbound:0,answered:0,unanswered:0,
      durationSeconds:0,talkSeconds:0,tmaSeconds:null,tmeSeconds:null};
    const seen=new Set();
    for(const [direction,list] of [['outbound',outbound],['inbound',inbound]]){
      for(const call of list){
        const identity=String(call.id??'');
        if(identity){const key=direction+':'+identity;if(seen.has(key))continue;seen.add(key);}
        const date=dateOf(call);
        if(!day(date)||date<start||date>end)continue;
        const leg=direction==='outbound'?call.destino||{}:call;
        const ok=attended(leg.status);
        const duration=seconds(leg.duracao_segundos);
        const talk=seconds(leg.duracao_falada_segundos);
        summary.total++;summary[direction]++;
        summary[ok?'answered':'unanswered']++;
        if(ok){summary.durationSeconds+=duration;summary.talkSeconds+=talk;}
        const d=days.get(date)||{date,total:0,answered:0,unanswered:0};
        d.total++;d[ok?'answered':'unanswered']++;days.set(date,d);
        const ext=String(direction==='outbound'?call.ramal_id_origem||'':call.ramal_id||'').trim();
        if(/^\d{1,12}$/.test(ext)){
          const e=extensions.get(ext)||{extension:ext,total:0,answered:0,unanswered:0};
          e.total++;e[ok?'answered':'unanswered']++;extensions.set(ext,e);
        }
      }
    }
    summary.tmaSeconds=summary.answered?Math.round(summary.durationSeconds/summary.answered):null;
    // TME exige timestamps de fila, que não constam deste extrato.
    return res.status(200).json({ok:true,provider:'Zenvia Voice',from:start,to:end,summary,
      byDay:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),
      byExtension:[...extensions.values()].sort((a,b)=>b.total-a.total).slice(0,100),
      limitations:['TME indisponível: extrato não contém espera em fila','TMA calculado apenas sobre chamadas atendidas',
        'Nenhum número, áudio ou gravação é exposto']});
  }catch(error){
    return fail(res,error?.name==='AbortError'?504:502,
      error?.name==='AbortError'?'Tempo limite na consulta Zenvia':'Não foi possível consolidar os dados de voz');
  }finally{clearTimeout(timeout);}
}
