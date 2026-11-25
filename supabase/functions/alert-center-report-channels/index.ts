// Administrative simulation settings only; no delivery.
const env=(k:string)=>Deno.env.get(k)?.trim()??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const keys=['individual','intelligence_team','intelligence_partial','intelligence_triage','production_flow','support_management','direction_consolidated'];
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Método não permitido"},405);
 const base=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),key=env("SUPABASE_SERVICE_ROLE_KEY"),auth=req.headers.get("authorization")??"";
 if(!base||!anon||!key)return reply({error:"Configuração indisponível"},503);
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Sessão necessária"},401);
 try{
 const u=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!u.ok)return reply({error:"Sessão inválida"},401);
 const user=await u.json();if(typeof user.id!=="string"||!user.id)return reply({error:"Sessão inválida"},401);
 const headers={apikey:key,Authorization:"Bearer "+key};
 const admin=new URL(base+"/rest/v1/audit_users");admin.searchParams.set("user_id","eq."+user.id);admin.searchParams.set("role","eq.admin");admin.searchParams.set("is_active","eq.true");admin.searchParams.set("select","user_id");admin.searchParams.set("limit","2");
 const a=await fetch(admin,{headers,signal:AbortSignal.timeout(10000)});if(!a.ok)return reply({error:"Autorização indisponível"},503);
 const admins=await a.json();if(!Array.isArray(admins)||admins.length!==1)return reply({error:"Acesso restrito"},403);
 const body=await req.json();const url=base+"/rest/v1/audit_movidesk_report_channels";
 if(body?.mode==="save"){
 if(!keys.includes(body.reportKey)||typeof body.selected!=="boolean")return reply({error:"Configuração inválida"},400);
 const res=await fetch(url+"?report_key=eq."+encodeURIComponent(body.reportKey),{method:"PATCH",headers:{...headers,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({simulation_selected:body.selected,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
 if(!res.ok)return reply({error:"Falha ao salvar"},502);
 const rows=await res.json();if(rows.length!==1||rows[0].delivery_enabled!==false||rows[0].simulation_selected!==body.selected)return reply({error:"Gravação não confirmada"},502);
 }else if(body?.mode!=="read")return reply({error:"Modo inválido"},400);
 const res=await fetch(url+"?select=report_key,simulation_selected,delivery_enabled&order=report_key.asc",{headers,signal:AbortSignal.timeout(10000)});if(!res.ok)return reply({error:"Consulta indisponível"},502);
 const rows=await res.json();if(!Array.isArray(rows)||rows.length!==keys.length||rows.some(r=>!keys.includes(r.report_key)||r.delivery_enabled!==false||typeof r.simulation_selected!=="boolean"))return reply({error:"Configuração inválida"},502);
 return reply({ok:true,deliveryEnabled:false,channels:rows});
 }catch{return reply({error:"Falha na operação"},502);}
});
