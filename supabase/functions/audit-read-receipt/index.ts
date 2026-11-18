import {handleReadReceipt} from './handler.ts';
const env=(key: string)=>Deno.env.get(key)?.trim()||'';
async function db(path: string, init: RequestInit={}) {
  const base=env('SUPABASE_URL'), key=env('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Configuração indisponível.');
  const response=await fetch(base+'/rest/v1/'+path,{
    ...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...init.headers},
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Registro indisponível.');
  const text=await response.text();return text?JSON.parse(text):null;
}
// Authentication is the unguessable per-delivery token, validated against its hash.
// A GET/email-scanner visit never changes data. Only explicit accepted:true can confirm.
Deno.serve(req=>handleReadReceipt(req,db));
