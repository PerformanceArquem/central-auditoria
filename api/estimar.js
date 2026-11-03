
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-access-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const accessKey = process.env.ACCESS_KEY;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!accessKey || req.headers['x-access-key'] !== accessKey) {
    return res.status(403).json({ erro: 'Chave de acesso inválida.' });
  }

  if (!apiKey) {
    return res.status(500).json({ erro: 'GEMINI_API_KEY não configurada.' });
  }

  const configuredModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const models = [
    ...new Set([
      configuredModel,
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite'
    ])
  ];

  const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];

  if (!tickets.length) {
    return res.status(400).json({ erro: 'Nenhum chamado recebido.' });
  }

  const prompt = `
Analise os chamados abaixo e estime o esforço necessário para resolução.
Retorne SOMENTE um JSON em formato de array, sem Markdown.

Cada objeto deve conter:
- id: identificador original do chamado
- hours: estimativa de horas, número positivo
- confidence: confiança entre 0 e 1
- excerpt: justificativa curta

Não invente informações. Considere a complexidade descrita.

CHAMADOS:
${JSON.stringify(tickets)}
`;

  const errors = [];

  for (const modelName of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const message = data?.error?.message || `HTTP ${response.status}`;

        if ([401, 403].includes(response.status)) {
          return res.status(response.status).json({
            erro: `Falha de autenticação Gemini: ${message}`
          });
        }

        errors.push(`${modelName}: ${message}`);
        continue;
      }

      const output = data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('');

      if (!output) {
        errors.push(`${modelName}: resposta vazia.`);
        continue;
      }

      let resultados;

      try {
        resultados = JSON.parse(output);
      } catch {
        errors.push(`${modelName}: resposta não veio em JSON válido.`);
        continue;
      }

      if (!Array.isArray(resultados)) {
        errors.push(`${modelName}: formato de resposta inválido.`);
        continue;
      }

      const validIds = new Set(tickets.map(ticket => String(ticket.id)));

      resultados = resultados.filter(item =>
        item &&
        validIds.has(String(item.id)) &&
        Number.isFinite(Number(item.hours)) &&
        Number(item.hours) > 0
      );

      return res.status(200).json({
        resultados,
        modeloUtilizado: modelName
      });

    } catch (error) {
      errors.push(`${modelName}: ${error.message}`);
    }
  }

  return res.status(502).json({
    erro: 'Falha em todos os modelos Gemini testados.',
    detalhes: errors
  });
}
