import { timingSafeEqual } from 'node:crypto';

// Variáveis de ambiente na Vercel (Settings → Environment Variables):
//   ACCESS_KEY          a "Senha da função" digitada no painel (Leitura por IA)
//   GEMINI_API_KEY      chave da API do Gemini (Google AI Studio; fica só no servidor)
//   GEMINI_MODEL        opcional; padrão: gemini-3.8-flash
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export const config = { maxDuration: 60 };

function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const SYSTEM = `Você lê textos de chamados de suporte e extrai a PREVISÃO DE HORAS de trabalho que o próprio texto informa (por exemplo "previsão de 3h", "estimado em 2 dias", "30 minutos", "meio período").
Regras:
- Só extraia o que está escrito no texto. Nunca invente nem estime por conta própria; se não houver previsão clara, omita o chamado.
- Converta tudo para horas decimais. Para "dias", multiplique pela jornada diária (horas por dia) informada.
- "trecho" é o pedaço curto do texto original (até 120 caracteres) que contém a previsão.
- "confianca" é "alta", "media" ou "baixa".
- Responda SOMENTE com JSON puro, sem markdown, no formato:
{"resultados":[{"id":"123","horas":2.5,"confianca":"alta","trecho":"..."}]}`;

function parseJson(text) {
  const clean = String(text || '').replace(/```json|```/gi, '').trim();
  const i = clean.indexOf('{');
  const j = clean.lastIndexOf('}');
  if (i < 0 || j <= i) return { resultados: [] };
  return JSON.parse(clean.slice(i, j + 1));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ erro: 'Use POST.' });
    }
    if (!ACCESS_KEY || !API_KEY) {
      return res.status(500).json({ erro: 'Servidor sem configuração: defina ACCESS_KEY e GEMINI_API_KEY na Vercel.' });
    }
    if (!sameKey(req.headers['x-access-key'], ACCESS_KEY)) {
      return res.status(401).json({ erro: 'Senha da função inválida.' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ erro: 'JSON malformatado.' }); }
    }
    const tickets = Array.isArray(body?.tickets) ? body.tickets.slice(0, 12) : [];
    if (!tickets.length) return res.status(400).json({ erro: 'Nenhum chamado enviado.' });
    const jornada = Number(body.jornada) > 0 ? Number(body.jornada) : 8;

    const payload = tickets.map(t => ({ id: String(t.id), texto: String(t.texto || '').slice(0, 3000) }));

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{
            role: 'user',
            parts: [{ text: `Jornada diária: ${jornada} horas.\nChamados (JSON):\n${JSON.stringify(payload)}` }],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(50000),
      }
    );

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ erro: `Gemini ${r.status}: ${j?.error?.message || 'falha na chamada'}` });
    }

    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    let out;
    try { out = parseJson(text); } catch { return res.status(502).json({ erro: 'A IA devolveu uma resposta que não é JSON.' }); }

    const ids = new Set(payload.map(t => t.id));
    const resultados = (out.resultados || [])
      .filter(x => x && ids.has(String(x.id)) && Number(x.horas) > 0)
      .map(x => ({
        id: String(x.id),
        horas: Number(x.horas),
        confianca: x.confianca ?? '',
        trecho: String(x.trecho ?? '').slice(0, 200),
      }));

    return res.status(200).json({ resultados });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return res.status(timeout ? 504 : 500).json({ erro: timeout ? 'A IA não respondeu a tempo.' : String(e.message || e) });
  }
}
