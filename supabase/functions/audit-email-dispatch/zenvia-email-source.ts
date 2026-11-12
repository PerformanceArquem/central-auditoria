// Somente leitura da API oficial TotalVoice/Zenvia. Não retorna números nem gravações.
const BASE='https://voice-api.zenvia.com';
const PAGE=200,MAX_PAGES=20;
const validDay=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const norm=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const answered=new Set(['atendida','atendido','answered','completada']);
const missed=new Set(['sem resposta','nao atendida','nao atendido','nao_atendida','ocupado','ocupada','congestionado','falha','cancelada','cancelado','nao existe','failed','busy','no answer']);
const positive=(n:unknown)=>{const x=Number(n);return Number.isFinite(x)&&x>0?Math.round(x):0};
const measuredSeconds=(n:unknown)=>{if(n==null||n==='')return null;const x=Number(n);return Number.isFinite(x)&&x>=0?Math.round(x):null};
type R=Record<string,any>;
const addDate=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export async function readZenviaEmailMetrics(from:string,to:string,token:string,queueId='',http:typeof fetch=fetch){
 if(!validDay(from)||!validDay(to)||from>to||!token)throw Error('Zenvia sem período ou token válidos');
 if(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z')>370*86400000)
  throw Error('Período Zenvia muito longo');
 const fetchAll=async(path:string,a:string,b:string)=>{
  const rows:R[]=[];let offset=0;
  for(let page=0;page<MAX_PAGES;page++){
   const u=new URL(BASE+path);u.searchParams.set('data_inicio',a);u.searchParams.set('data_fim',b);
   u.searchParams.set('posicao',String(offset));u.searchParams.set('limite',String(PAGE));
   const res=await http(u.toString(),{method:'GET',headers:{'Access-Token':token,Accept:'application/json'},
    signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error('Zenvia não disponível; não liberar relatório incompleto');
   const body=await res.json();
   if(body?.sucesso===false||!Array.isArray(body?.dados?.relatorio)||
      !Number.isInteger(Number(body.dados.total))||Number(body.dados.total)<0)
    throw Error('Contrato Zenvia não confirmado');
   const count=Number(body.dados.total),batch=body.dados.relatorio as R[];
   if(count>MAX_PAGES*PAGE||offset+batch.length>MAX_PAGES*PAGE)
    throw Error('Quantidade de chamadas excede limite de coleta');
   rows.push(...batch);offset+=batch.length;
   if(offset>=count)return rows;
   if(!batch.length)throw Error('Página de chamadas ausente, relatório incompleto');
  }
  throw Error('Limite de paginação Zenvia excedido');
 };
 const metrics={total:0,inbound:0,outbound:0,answered:0,unanswered:0,inProgress:0,unclassified:0,
  durationSeconds:0,talkSeconds:0 as number|null,tmaSeconds:null as number|null,tmeSeconds:null as number|null,
  tmaSamples:0,tmaMissingSamples:0,
  queueCalls:null as number|null,queueMissingWait:null as number|null};
 const day=new Map<string,R>(),hour=new Map<string,number>(),extension=new Map<string,R>(),
   known=new Set<string>();
 const queueConfigured=/^[1-9]\d{0,11}$/.test(queueId);
 let qCount=0,qMissing=0,qSum=0;
 for(let part=from;part<=to;part=addDate(part,31)){
  const end=addDate(part,30)<to?addDate(part,30):to;
  const [outgoing,incoming,queue]=await Promise.all([
   fetchAll('/chamada/relatorio',part,end),fetchAll('/did/relatorio',part,end),
   queueConfigured?fetchAll('/fila/'+queueId+'/relatorio',part,end):Promise.resolve(null)
  ]);
  for(const [direction,rows] of [['outbound',outgoing],['inbound',incoming]] as const){
   for(const row of rows){
    const id=String(row.id??'');
    if(id&&known.has(direction+':'+id))continue;
    if(id)known.add(direction+':'+id);
    const timestamp=String(row.data_inicio||row.data_criacao||row.destino?.data_inicio||'');
    const d=timestamp.slice(0,10);
    if(!validDay(d)||d<from||d>to)continue;
    const leg=direction==='outbound'?row.destino||{}:row;
    const state=norm(leg.status);
    const active=row.ativa===true||row.ativa===1||row.ativo===true||row.ativo===1||norm(row.status_geral)==='curso';
    const status=active?'inProgress':answered.has(state)?'answered':missed.has(state)?'unanswered':'unclassified';
    metrics.total++;metrics[direction]++;metrics[status]++;
    const talk=measuredSeconds(leg.duracao_falada_segundos);
    if(status==='answered'){
      if(talk==null)metrics.tmaMissingSamples++;
      else {metrics.tmaSamples++;metrics.talkSeconds=(metrics.talkSeconds??0)+talk;}
      metrics.durationSeconds+=positive(leg.duracao_segundos);
    }
    const cell=day.get(d)||{date:d,total:0,answered:0,unanswered:0,inProgress:0,unclassified:0};
    cell.total++;cell[status]++;day.set(d,cell);
    const hh=/^\d{4}-\d{2}-\d{2}T(\d{2}):/.exec(timestamp)?.[1];
    if(hh&&Number(hh)<24)hour.set(hh,(hour.get(hh)||0)+1);
    const ext=String(direction==='outbound'?row.ramal_id_origem??'':row.ramal_id??'');
    if(/^\d{1,12}$/.test(ext)){
      const e=extension.get(ext)||{extension:ext,total:0,answered:0,unanswered:0,talkSeconds:0 as number|null,missingTalkSamples:0};
      e.total++;
      if(status==='answered'){
        e.answered++;
        if(talk==null)e.missingTalkSamples++;
        else e.talkSeconds=(e.talkSeconds??0)+talk;
      }
      if(status==='unanswered')e.unanswered++;
      extension.set(ext,e);
    }
   }
  }
  if(queue){
   const queueSeen=new Set<string>();
   for(const row of queue){
    const id=String(row.id??'');
    if(id&&queueSeen.has(id))continue;
    if(id)queueSeen.add(id);
    const d=String(row.data_inicio||row.data_criacao||'').slice(0,10);
    if(!validDay(d)||d<part||d>end)continue;
    qCount++;
    const wait=row.tempo_espera,n=Number(wait);
    if(wait==null||wait===''||!Number.isFinite(n)||n<0){qMissing++;continue;}
    qSum+=n;
   }
  }
 }
 // Sem duracao falada para TODAS as chamadas atendidas, não publicar TMA parcial.
 metrics.tmaSeconds=metrics.answered&&metrics.tmaMissingSamples===0?
   Math.round((metrics.talkSeconds??0)/metrics.answered):null;
 if(metrics.tmaMissingSamples)metrics.talkSeconds=null;
 metrics.queueCalls=queueConfigured?qCount:null;
 metrics.queueMissingWait=queueConfigured?qMissing:null;
 metrics.tmeSeconds=queueConfigured&&qCount&&!qMissing?Math.round(qSum/qCount):null;
 return {metrics,byDay:[...day.values()].sort((a,b)=>a.date.localeCompare(b.date)),
  byHour:[...hour].map(([hour,count])=>({hour,count})).sort((a,b)=>b.count-a.count),
  byExtension:[...extension.values()].map(x=>({...x,talkSeconds:x.missingTalkSamples?null:x.talkSeconds} as R))
    .sort((a,b)=>Number((b as R).total)-Number((a as R).total)).slice(0,30),
  coverageVerified:true,source:'Zenvia Voice',queueConfigured};
}
