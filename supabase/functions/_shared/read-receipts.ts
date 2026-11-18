// Explicit acknowledgements and optional image-load signals; never equate image load with human reading.
export type ReceiptContext = {
  dispatchKey: string;
  recipientId?: unknown;
  recipientName?: unknown;
  from?: unknown;
  to?: unknown;
  source?: 'sector' | 'triage' | 'ticket_charge';
};
type Db = (path: string, init?: RequestInit) => Promise<any>;
const bytesHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const hashReceiptToken = async (token: string) => bytesHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
export async function receiptToken(secret: string, dispatchKey: string) {
  if (!secret || !dispatchKey) throw new Error('Configuração da confirmação de leitura incompleta.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return bytesHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('arquem-read-receipt-v1\n'+dispatchKey)));
}
export async function openSignalToken(secret: string, dispatchKey: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return bytesHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('arquem-open-signal-v1\n'+dispatchKey)));
}
export function openSignalContent(token: string) {
  const url = 'https://dvaaicqajlppuigeyejr.supabase.co/functions/v1/audit-open-signal?t='+encodeURIComponent(token);
  // Transparent one-pixel GIF. No IP, user agent or precise location is intentionally stored.
  return '<img src="'+url+'" width="1" height="1" alt="" aria-hidden="true" style="width:1px;height:1px;opacity:0" />'+
    '<p style="font-size:11px;color:#52657a">Aviso de transparência: este e-mail pode registrar o carregamento de uma imagem como abertura detectada. Isso não comprova leitura. A confirmação de leitura é voluntária.</p>';
}
const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function receiptContent(url: string) {
  return {
    text:'\n\nCONFIRMAÇÃO DE LEITURA\nApós ler o relatório, confirme sua leitura: '+url+'\nA confirmação só é registrada após clicar em “Confirmar minha leitura” na página.\n',
    html:'<div data-arquem-read-receipt style="margin:24px 0;padding:18px;background:#f2f6fc;border-left:4px solid #173b65">'+
      '<p style="margin:0 0 12px;color:#173b65;font-weight:bold">Confirmação de leitura</p>'+
      '<a href="'+esc(url)+'" style="display:inline-block;background:#173b65;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px">Confirmar leitura do relatório</a>'+
      '<p style="margin:12px 0 0;font-size:12px;color:#52657a">A confirmação só é registrada após clicar em “Confirmar minha leitura” na página.</p></div>'
  };
}
export function appendReceiptHtml(html: string, section: string) {
  // Use the same insertion point as report sections; retain the corporate footer.
  const marker = /<\/body\s*>/i;
  return marker.test(html) ? html.replace(marker, section+'\n</body>') : html+section;
}
export async function prepareReadReceipt(db: Db, secret: string, ctx: ReceiptContext, email: string, subject: string) {
  const token = await receiptToken(secret, ctx.dispatchKey);
  const tokenHash = await hashReceiptToken(token);
  const openToken = await openSignalToken(secret, ctx.dispatchKey);
  const openTokenHash = await hashReceiptToken(openToken);
  const now = new Date();
  const rows = await db('audit_email_read_receipts?on_conflict=dispatch_key', {
    method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:JSON.stringify({dispatch_key:ctx.dispatchKey,token_hash:tokenHash,open_token_hash:openTokenHash,source:ctx.source||'sector',
      recipient_id:ctx.recipientId||null,recipient_name:String(ctx.recipientName||'Destinatário'),
      recipient_email:email,subject,period_from:ctx.from||null,period_to:ctx.to||null,
      expires_at:new Date(now.getTime()+90*86400000).toISOString()})
  });
  // Retries keep the same link, expiry and first confirmation. Never reset an acknowledgement.
  const row = rows?.[0] || (await db('audit_email_read_receipts?dispatch_key=eq.'+encodeURIComponent(ctx.dispatchKey)+'&select=token_hash,open_token_hash,recipient_email,expires_at&limit=1'))?.[0];
  if (!row || row.token_hash!==tokenHash || row.open_token_hash!==openTokenHash || row.recipient_email!==email || Date.parse(row.expires_at)<=now.getTime())
    throw new Error('Não foi possível preparar a confirmação de leitura deste envio.');
  const url = 'https://central-auditoria-iota.vercel.app/confirmar-leitura.html#token='+token;
  const ack = receiptContent(url);
  return {dispatchKey:ctx.dispatchKey,...ack,text:ack.text+'\nAviso: imagens deste e-mail podem gerar registro automático de abertura detectada, sem comprovar leitura.\n',html:ack.html+openSignalContent(openToken)};
}
export async function markReceiptDelivered(db: Db, dispatchKey: string) {
  await db('audit_email_read_receipts?dispatch_key=eq.'+encodeURIComponent(dispatchKey)+'&delivered_at=is.null', {
    method:'PATCH',body:JSON.stringify({delivered_at:new Date().toISOString()})
  });
}
