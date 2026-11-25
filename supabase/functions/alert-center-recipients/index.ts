// Read-only directory for alert-center homologation. No notification or ticket writes.
const env=(k:string)=>Deno.env.get(k)?.trim()??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return reply({error:"Método não permitido"},405);
 const base=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),key=env("SUPABASE_SERVICE_ROLE_KEY"),token=env("MOVIDESK_TOKEN");
 if(!base||!anon||!key||!token)return reply({error:"Integração indisponível"},503);
 const auth=req.headers.get("authorization")??"";
 if(!/^Bearer\s+\S+$/i.test(auth))return reply({error:"Sessão necessária"},401);
 try{
 const u=await fetch(base+"/auth/v1/user",{headers:{apikey:anon,Authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!u.ok)return reply({error:"Sessão inválida"},401);
 const user=await u.json();
 if(typeof user.id!=="string"||!user.id)return reply({error:"Sessão inválida"},401);
 const adminUrl=new URL(base+"/rest/v1/audit_users");
 adminUrl.searchParams.set("user_id","eq."+user.id);adminUrl.searchParams.set("role","eq.admin");adminUrl.searchParams.set("is_active","eq.true");adminUrl.searchParams.set("select","user_id");adminUrl.searchParams.set("limit","1");
 const a=await fetch(adminUrl,{headers:{apikey:key,Authorization:"Bearer "+key},signal:AbortSignal.timeout(10000)});
 if(!a.ok)return reply({error:"Autorização indisponível"},503);
 const rows=await a.json();if(!Array.isArray(rows)||rows.length!==1)return reply({error:"Acesso restrito a administradores ativos"},403);
 const url=new URL("https://api.movidesk.com/public/v1/persons");
 url.searchParams.set("token",token);url.searchParams.set("$filter","isActive eq true and personType eq 1 and (profileType eq 1 or profileType eq 3)");
 url.searchParams.set("$select","id,businessName,isActive,personType,profileType,teams");
 const p=await fetch(url,{signal:AbortSignal.timeout(25000),redirect:"error"});
 if(!p.ok)return reply({error:"Consulta Movidesk indisponível",upstreamStatus:p.status},502);
 const list=await p.json();if(!Array.isArray(list))return reply({error:"Resposta inesperada do cadastro"},502);
 const byId=new Map();
 for(const item of list){if(item?.isActive!==true||item.personType!==1||![1,3].includes(item.profileType)||typeof item.id!=="string"||!item.id.trim()||typeof item.businessName!=="string"||!item.businessName.trim())continue;
 byId.set(item.id,{movideskPersonId:item.id,displayName:item.businessName,active:true,teams:Array.isArray(item.teams)?[...new Set(item.teams.filter((t:unknown)=>typeof t==="string"&&t.trim()))]:[]});}
 return reply({mode:"read-only",deliveryEnabled:false,completenessVerified:false,profiles:[...byId.values()].sort((a,b)=>a.displayName.localeCompare(b.displayName,"pt-BR"))});
 }catch{return reply({error:"Falha na consulta autenticada"},502);}
});
