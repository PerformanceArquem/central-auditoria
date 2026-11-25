import {hashReceiptToken} from '../_shared/read-receipts.ts';
type Db = (path: string, init?: RequestInit) => Promise<any>;
const origins = new Set(['https://performancearquem.github.io','https://central-auditoria-iota.vercel.app','https://centralauditoria.ddns.net','https://www.centralauditoria.ddns.net']);
export async function handleReadReceipt(req: Request, db: Db, now = new Date()): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin',
    'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'});
  if (origin && origins.has(origin)) headers.set('Access-Control-Allow-Origin',origin);
  const reply=(body: unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if (origin && !origins.has(origin)) return reply({ok:false,error:'Origem não autorizada.'},403);
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST') return reply({ok:false,error:'Método não permitido.'},405);
  try {
    const raw = await req.text();
    if (raw.length>2048) return reply({ok:false,error:'Solicitação inválida.'},413);
    let body; try { body=JSON.parse(raw); } catch { return reply({ok:false,error:'Solicitação inválida.'},400); }
    if (!body || !['inspect','confirm'].includes(body.action) || !/^[a-f0-9]{64}$/.test(String(body.token||'')))
      return reply({ok:false,error:'Link inválido.'},400);
    if (body.action==='confirm' && body.accepted!==true) return reply({ok:false,error:'Confirme sua leitura para continuar.'},400);
    const hash=await hashReceiptToken(body.token);
    const path='audit_email_read_receipts?token_hash=eq.'+hash;
    const [row]=await db(path+'&select=dispatch_key,recipient_name,subject,period_from,period_to,expires_at,delivered_at,confirmed_at&limit=1');
    if (!row) return reply({ok:false,error:'Link inválido ou indisponível.'},404);
    if (Date.parse(row.expires_at)<=now.getTime()) return reply({ok:false,error:'Este link de confirmação expirou.'},410);
    if (!row.delivered_at) return reply({ok:false,error:'O envio deste relatório ainda não foi confirmado.'},409);
    let confirmedAt=row.confirmed_at;
    if (body.action==='confirm' && !confirmedAt) {
      const updated=await db(path+'&confirmed_at=is.null&delivered_at=not.is.null&expires_at=gt.'+encodeURIComponent(now.toISOString()),{
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({confirmed_at:now.toISOString()})
      });
      // Concurrent clicks preserve the first acknowledgement and its original timestamp.
      confirmedAt=updated?.[0]?.confirmed_at || (await db(path+'&select=confirmed_at&limit=1'))?.[0]?.confirmed_at;
      if (!confirmedAt) return reply({ok:false,error:'Não foi possível confirmar. Tente novamente.'},409);
    }
    return reply({ok:true,recipient:row.recipient_name,subject:row.subject,from:row.period_from,to:row.period_to,
      status:confirmedAt?'confirmed':'pending',confirmedAt:confirmedAt||null});
  } catch { return reply({ok:false,error:'Confirmação temporariamente indisponível. Tente novamente.'},503); }
}
