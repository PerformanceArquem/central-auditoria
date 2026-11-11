/**
 * Padrao de comunicacao externa ARQUEM.
 * Identificadores de hospedagem e banco pertencem somente a logs internos.
 * Mantem numeros, indicadores, links de chamados e as ressalvas de cobertura.
 */
const infraNames = /\b(?:supabase|vercel|google\s+apps\s+script|postgresql|postgres)\b/gi;
export function corporateCopy(value: string): string {
  return String(value ?? '').replace(infraNames, 'plataforma interna');
}
export function corporatePacket<T>(value: T): T {
  if (typeof value === 'string') return corporateCopy(value) as T;
  if (Array.isArray(value)) return value.map(corporatePacket) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string,unknown>)
      .map(([key,v]) => [key,corporatePacket(v)])) as T;
  }
  return value;
}
const escapeHtml = (s:string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/** Corpo HTML corporativo de contingencia para mensagens que so possuem texto. */
export function corporateFallbackHtml(subject:string,body:string):string {
  const title = escapeHtml(corporateCopy(subject)).slice(0,240);
  const content = escapeHtml(corporateCopy(body)).replace(/\r\n?/g,'\n')
    .replace(/\n/g,'<br>');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;padding:0;background:#eef3fa;font-family:Arial,Helvetica,sans-serif;color:#263d59">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa"><tr>'+
    '<td align="center" style="padding:24px 12px">'+
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px;background:#fff;border:1px solid #dce7f3;border-radius:12px">'+
    '<tr><td style="background:#142f50;color:#fff;padding:26px 30px">'+
    '<div style="font-size:12px;color:#9edbea;font-weight:700;letter-spacing:1.5px">ARQUEM SISTEMAS</div>'+
    '<div style="font-size:23px;font-weight:700;margin-top:12px">Central de Auditoria</div>'+
    '<div style="font-size:12px;color:#d3e2f0;margin-top:7px">Gestão de Qualidade · Comunicação corporativa</div>'+
    '</td></tr><tr><td style="padding:26px 30px">'+
    '<h1 style="margin:0 0 18px;font-size:20px;line-height:1.4;color:#173b65">'+title+'</h1>'+
    '<div style="font-size:13px;line-height:1.8;overflow-wrap:anywhere">'+content+'</div>'+
    '</td></tr><tr><td style="padding:17px 30px;background:#f5f8fc;border-top:1px solid #e1e9f4;color:#60748c;font-size:11px">'+
    'ARQUEM SISTEMAS · Gestão de Qualidade · Informações de acompanhamento</td></tr>'+
    '</table></td></tr></table></body></html>';
}
/** Nao permitir sequer que texto externo esquecido revele nome de fornecedor. */
export function assertCorporateCopy(value:unknown):void {
  const serialized=JSON.stringify(value) ?? '';
  if (/\b(?:supabase|vercel|google\s+apps\s+script|postgresql|postgres)\b/i.test(serialized))
    throw new Error('Conteudo de comunicacao possui identificador de infraestrutura');
}
