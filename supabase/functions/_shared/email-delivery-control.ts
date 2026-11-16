type Row = Record<string, unknown>;
type DB = (path:string, options?:Record<string, unknown>)=>Promise<any>;
type Env = (name:string)=>string;

/** No cache: a global pause must apply to the next provider call. */
export async function emailDeliveryState(db:DB) {
  const rows=await db('audit_email_delivery_control?id=eq.true&select=paused,revision,changed_at&limit=1');
  if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].paused!=='boolean')
    throw new Error('Não foi possível confirmar a chave de e-mails. Os envios permanecem bloqueados.');
  return rows[0] as {paused:boolean;revision:number;changed_at:string};
}
export async function assertEmailDeliveryEnabled(db:DB) {
  const state=await emailDeliveryState(db);
  if(state.paused!==false)throw new Error('Envio de e-mails desligado pelo administrador.');
}

/** Called only after the existing admin JWT authorization in the dispatcher. */
export async function emailDeliveryAdmin(payload:Row,req:Request,db:DB,env:Env,endpoint:string) {
  const current=await emailDeliveryState(db);
  if(!Object.hasOwn(payload,'paused'))return {ok:true,...current};
  if(typeof payload.paused!=='boolean'||typeof payload.revision!=='number'||!Number.isSafeInteger(payload.revision))
    throw new Error('Estado da chave inválido. Atualize a página.');
  if(payload.paused===false&&payload.confirmResume!==true)
    throw new Error('Confirme a reativação dos e-mails.');
  if(Number(payload.revision)!==Number(current.revision))throw new Error('A chave foi alterada por outro administrador. Atualize a página.');
  const adminAuthorization=req.headers.get('authorization')||'';
  if(!/^Bearer\s+\S+$/.test(adminAuthorization))throw new Error('Sessão de administrador ausente.');
  const auth=await fetch(env('SUPABASE_URL').replace(/\/$/,'')+'/auth/v1/user',{
    headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:adminAuthorization},
    signal:AbortSignal.timeout(12000)
  });
  const user=auth.ok?await auth.json():null;
  if(!user?.id)throw new Error('Sessão expirada. Faça login novamente.');
  const setState=()=>db('rpc/audit_set_email_delivery_paused',{
    method:'POST',body:JSON.stringify({p_paused:payload.paused,p_expected_revision:payload.revision,p_actor:user.id})
  });
  const providerState=async(paused:boolean)=>{
    if(!env('GMAIL_MAIL_SECRET'))throw Error('Controle do serviço de e-mail indisponível.');
    const response=await fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({token:env('GMAIL_MAIL_SECRET'),action:'email_delivery_control',paused,adminAuthorization}),
      signal:AbortSignal.timeout(15000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||result?.sucesso!==true||result.paused!==paused)
      throw new Error('O serviço de e-mail não confirmou a mudança. Os envios permanecem bloqueados.');
  };
  if(payload.paused){
    // Stop the server and schedules first, even when the provider is unavailable.
    const state=await setState();
    try{await providerState(true);}catch(_){
      return {ok:true,...state,warning:'E-mails desligados no servidor. O serviço de entrega não confirmou a pausa.'};
    }
    return {ok:true,...state};
  }
  // The database stays paused until the provider confirms the explicit resume.
  await providerState(false);
  try{return {ok:true,...await setState()};}
  catch(error){await providerState(true).catch(()=>{});throw error;}
}
