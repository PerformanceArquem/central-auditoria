// Administrative dry-run only. No Movidesk writes or notifications.
const env=(k:string)=>Deno.env.get(k)?.trim()??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Método não permitido"},405);
 const base=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),key=env("SUPABASE_SERVICE_ROLE_KEY");
 const authorizedId=env("ALERT_CENTER_TEST_RECIPIENT_ID");
 if(!base||!anon||!key||!authorizedId)return reply({error:"Homologação não configurada"},503);
 const auth=req.headers.get("authorization")??"";
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Sessão necessária"},401);
 try{
 const u=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!u.ok)return reply({error:"Sessão inválida"},401);
 const user=await u.json();if(typeof user.id!=="string"||!user.id)return reply({error:"Sessão inválida"},401);
 const headers={apikey:key,Authorization:"Bearer "+key};
 const admin=new URL(base+"/rest/v1/audit_users");
 admin.searchParams.set("user_id","eq."+user.id);admin.searchParams.set("role","eq.admin");admin.searchParams.set("is_active","eq.true");admin.searchParams.set("select","user_id");admin.searchParams.set("limit","2");
 const a=await fetch(admin,{headers,signal:AbortSignal.timeout(10000)});
 if(!a.ok)return reply({error:"Autorização indisponível"},503);
 const admins=await a.json();if(!Array.isArray(admins)||admins.length!==1)return reply({error:"Acesso restrito"},403);
 let body;try{body=await req.json();}catch{return reply({error:"Requisição inválida"},400);}
 if(body?.confirmed!==true||body?.recipientId!==authorizedId||body?.mode!=="dry-run")return reply({error:"Teste não autorizado"},403);
 const p=new URL(base+"/rest/v1/audit_movidesk_note_profiles");
 p.searchParams.set("movidesk_person_id","eq."+authorizedId);p.searchParams.set("active","eq.true");p.searchParams.set("select","movidesk_person_id,active");p.searchParams.set("limit","2");
 const pr=await fetch(p,{headers,signal:AbortSignal.timeout(10000)});
 if(!pr.ok)return reply({error:"Cadastro indisponível"},503);
 const profiles=await pr.json();if(!Array.isArray(profiles)||profiles.length!==1||profiles[0].movidesk_person_id!==authorizedId||profiles[0].active!==true)return reply({error:"Cadastro de homologação inválido"},403);
 // Preserve compatibility with the previously homologated preview.
 if(body.requestKey===undefined)return reply({mode:"dry-run",authorized:true,deliveryEnabled:false,subject:"TM-HOMOLOG-001",requiresDuplicateCheck:true,requiresMetricsExclusion:true,ticketCreated:false,historyRecorded:false});
 if(typeof body.requestKey!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey))return reply({error:"Identificador da solicitação inválido"},400);
 const saved=await fetch(base+"/rest/v1/rpc/alert_center_record_simulation",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({p_request_key:body.requestKey,p_recipient_id:authorizedId,p_actor_id:user.id}),signal:AbortSignal.timeout(10000)});
 if(!saved.ok)return reply({error:"Não foi possível registrar a simulação"},saved.status===409?409:503);
 const record=await saved.json();
 if(!record||typeof record.id!=="string"||typeof record.duplicate!=="boolean"||record.status!=="simulated"||record.deliveryEnabled!==false||record.ticketCreated!==false)return reply({error:"Registro não confirmado"},502);
 return reply({mode:"dry-run",authorized:true,deliveryEnabled:false,subject:"TM-HOMOLOG-001",requiresDuplicateCheck:true,requiresMetricsExclusion:true,ticketCreated:false,historyRecorded:true,history:{id:record.id,createdAt:record.createdAt,duplicate:record.duplicate,status:"simulated"}});
 }catch{return reply({error:"Falha na validação"},502);}
});
