// Zenvia Voice (TotalVoice): somente leitura, métricas agregadas e acesso administrativo.
// Os números de telefone, gravações e o Access-Token nunca são retornados ao navegador.
const BASE='https://voice-api.zenvia.com';
const PAGE=200,MAX_PAGES=20,MAX_DAYS=31;
const fail=(res,status,error)=>res.status(status).json({ok:false,error});
const day=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return false;
 const ms=Date.parse(s+'T12:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===s;};
const utcDay=s=>Date.parse(s+'T12:00:00Z');
const seconds=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?Math.round(n):0};
const status=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const attended=x=>['atendida','atendido','answered','completada'].includes(status(x));
const missed=x=>['sem resposta','nao atendida','nao atendido','nao_atendida','ocupado','ocupada','congestionado','falha','cancelada','cancelado','nao existe','failed','busy','no answer'].includes(status(x));
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
    const probeOnly=req.query?.check==='1';
    if(probeOnly){
      const queueId=String(process.env.ZENVIA_VOICE_QUEUE_ID||'').trim();
      const queueConfigured=/^[1-9]\\d{0,11}$/.test(queueId);
      const endpoints=[
        {channel:'outbound',path:'/chamada/relatorio'},
        {channel:'inbound',path:'/did/relatorio'}
      ];
      if(queueConfigured)endpoints.push({channel:'queue',path:'/fila/'+queueId+'/relatorio'});
      const checks=await Promise.all(endpoints.map(async item=>{
        const u=new URL(BASE+item.path);
        u.searchParams.set('data_inicio',start);
        u.searchParams.set('data_fim',end);
        u.searchParams.set('posicao','0');
        u.searchParams.set('limite','1');
        try{
          const response=await fetch(u,{method:'GET',
            headers:{'Access-Token':token,Accept:'application/json'},signal:ctrl.signal});
          if(!response.ok){
            return {channel:item.channel,status:response.status===401||response.status===403?'unauthorized':
              response.status===429?'rate_limited':'provider_error'};
          }
          const body=await response.json();
          return {channel:item.channel,status:body?.sucesso!==false&&
            Array.isArray(body?.dados?.relatorio)&&Number.isInteger(Number(body?.dados?.total))?
            'ok':'invalid_schema'};
        }catch(_){return {channel:item.channel,status:'unreachable'};}
      }));
      return res.status(200).json({ok:true,diagnostic:true,provider:'Zenvia Voice',
        queueConfigured,checks,ready:checks.every(x=>x.status==='ok'),
        note:'Diagnóstico não contém números, gravações, chamadas ou credenciais.'});
    }
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
        const total=body.dados.total==null?NaN:Number(body.dados.total);
        if(!Number.isFinite(total)||total<0||!Number.isInteger(total))
          throw Error('Total de registros invalido na paginacao Zenvia');
        if(total>PAGE*MAX_PAGES)throw Error('Relatorio supera o limite seguro de paginacao');
        if(offset+rows.length>=total)return all;
        // A API pode devolver pagina menor que o limite solicitado.
        // Nunca concluir o relatório enquanto o total da origem indicar mais registros.
        if(!rows.length)throw Error('Paginacao incompleta da Zenvia');
        offset+=rows.length;
      }
      throw Error('Relatório excede limite de consulta; reduza o período');
    };
    const queueId=String(process.env.ZENVIA_VOICE_QUEUE_ID||'').trim();
    // Apenas fila configurada previamente em ambiente seguro; jamais aceitar ID de fila arbitrario da requisicao.
    const queueConfigured=/^[1-9]\d{0,11}$/.test(queueId);
    const [outbound,inbound,queueCalls]=await Promise.all([
      fetchAll('/chamada/relatorio'),fetchAll('/did/relatorio'),
      queueConfigured?fetchAll('/fila/'+queueId+'/relatorio'):Promise.resolve(null)
    ]);
    const days=new Map(),extensions=new Map();
    const summary={total:0,inbound:0,outbound:0,answered:0,unanswered:0,
      durationSeconds:0,talkSeconds:0,tmaSeconds:null,tmeSeconds:null,unclassified:0,inProgress:0};
    const seen=new Set();
    for(const [direction,list] of [['outbound',outbound],['inbound',inbound]]){
      for(const call of list){
        const identity=String(call.id??'');
        if(identity){const key=direction+':'+identity;if(seen.has(key))continue;seen.add(key);}
        const date=dateOf(call);
        if(!day(date)||date<start||date>end)continue;
        const leg=direction==='outbound'?call.destino||{}:call;
        const ok=attended(leg.status);
        const inProgress=call.ativa===true||call.ativa===1||call.ativo===true||call.ativo===1||status(call.status_geral)==='curso';
        const kind=inProgress?'inProgress':ok?'answered':missed(leg.status)?'unanswered':'unclassified';
        const duration=seconds(leg.duracao_segundos);
        const talk=seconds(leg.duracao_falada_segundos);
        summary.total++;summary[direction]++;
        summary[kind]++;
        if(kind==='answered'){summary.durationSeconds+=duration;summary.talkSeconds+=talk;}
        const d=days.get(date)||{date,total:0,answered:0,unanswered:0,inProgress:0,unclassified:0};
        d.total++;d[kind]++;days.set(date,d);
        const ext=String(direction==='outbound'?call.ramal_id_origem||'':call.ramal_id||'').trim();
        if(/^\d{1,12}$/.test(ext)){
          const e=extensions.get(ext)||{extension:ext,total:0,answered:0,unanswered:0,inProgress:0,unclassified:0};
          e.total++;e[kind]++;extensions.set(ext,e);
        }
      }
    }
    const queueSummary={configured:queueConfigured,queueId:queueConfigured?queueId:null,
      calls:null,waitSampleCount:0,waitTotalSeconds:null,tmeSeconds:null,missingWaitSamples:null};
    if(queueCalls){
      const queueSeen=new Set(),unique=[];
      for(const row of queueCalls){
        const id=String(row.id??'');
        if(id&&queueSeen.has(id))continue;
        if(id)queueSeen.add(id);
        const date=dateOf(row);
        if(day(date)&&date>=start&&date<=end)unique.push(row);
      }
      queueSummary.calls=unique.length;
      let waitSum=0,missing=0;
      for(const row of unique){
        const raw=row.tempo_espera;
        // A API pode retornar null: nao transformar campo ausente em 0 nem inventar TME.
        if(raw==null||raw===''){missing++;continue;}
        const n=Number(raw);
        if(!Number.isFinite(n)||n<0){missing++;continue;}
        waitSum+=n;queueSummary.waitSampleCount++;
      }
      queueSummary.missingWaitSamples=missing;
      queueSummary.waitTotalSeconds=waitSum;
      // Somente publica TME para a fila quando TODOS os registros da janela tem tempo_espera.
      queueSummary.tmeSeconds=unique.length>0&&!missing?Math.round(waitSum/unique.length):null;
      summary.tmeSeconds=queueSummary.tmeSeconds;
    }
    // Tempo medio de atendimento (conversa), sem incluir tentativa/chamada nao atendida.
    summary.tmaSeconds=summary.answered?Math.round(summary.talkSeconds/summary.answered):null;
    // TME exige timestamps de fila, que não constam deste extrato.
    return res.status(200).json({ok:true,provider:'Zenvia Voice',from:start,to:end,summary,queue:queueSummary,
      byDay:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),
      byExtension:[...extensions.values()].sort((a,b)=>b.total-a.total).slice(0,100),
      limitations:[queueConfigured?'TME disponível somente com cobertura integral de tempo_espera na fila configurada':'TME indisponível: ID da fila não configurado no servidor','TMA calculado apenas sobre chamadas atendidas',
        'Chamadas em andamento e com status desconhecido não são classificadas como não atendidas',
        'Nenhum número, áudio ou gravação é exposto']});
  }catch(error){
    return fail(res,error?.name==='AbortError'?504:502,
      error?.name==='AbortError'?'Tempo limite na consulta Zenvia':'Não foi possível consolidar os dados de voz');
  }finally{clearTimeout(timeout);}
}
