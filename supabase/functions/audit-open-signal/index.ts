// Image-load signals are imperfect. Never treat this endpoint as proof of a human read.
const gif = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
const headers = {'Content-Type':'image/gif','Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const env=(key:string)=>Deno.env.get(key)?.trim()||'';
const reply=()=>new Response(gif.slice(),{status:200,headers});
const hash=async(raw:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req)=>{
  // Always return the same image, even for expired, nonexistent or malformed tokens.
  if(req.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
  try {
    const token=new URL(req.url).searchParams.get('t')||'';
    if(!/^[a-f0-9]{64}$/.test(token))return reply();
    const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
    if(!base||!key)return reply();
    const tokenHash=await hash(token);
    const api=base.replace(/\/$/,'')+'/rest/v1/audit_email_read_receipts';
    const h={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
    const path='?open_token_hash=eq.'+tokenHash+'&select=dispatch_key,delivered_at,expires_at,first_opened_at&limit=1';
    const found=await fetch(api+path,{headers:h,signal:AbortSignal.timeout(5000)});
    if(!found.ok)return reply();
    const [row]=await found.json();
    if(!row||!row.delivered_at||Date.parse(row.expires_at)<=Date.now()||row.first_opened_at)return reply();
    await fetch(api+'?open_token_hash=eq.'+tokenHash+'&first_opened_at=is.null&delivered_at=not.is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),{
      method:'PATCH',headers:{...h,Prefer:'return=minimal'},body:JSON.stringify({first_opened_at:new Date().toISOString()}),signal:AbortSignal.timeout(5000)
    });
  }catch { /* Suppress implementation details and always return the same image. */ }
  return reply();
});
