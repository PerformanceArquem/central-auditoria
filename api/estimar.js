export default async function handler(req, res) {
  // Configuração dos cabeçalhos CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-access-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  // Validação da ACCESS_KEY
  const accessKey = req.headers['x-access-key'];
  if (!accessKey || accessKey !== process.env.ACCESS_KEY) {
    return res.status(401).json({ erro: 'Chave de acesso (ACCESS_KEY) inválida ou não informada.' });
  }

  // Validação da chave GEMINI_API_KEY
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ erro: 'A variável GEMINI_API_KEY não foi configurada na Vercel.' });
  }

  const { jornada = 8, tickets = [] } = req.body || {};

  if (!tickets || tickets.length === 0) {
    return res.status(200).json({ resultados: [] });
  }

  // Lista de modelos ordenados por prioridade (Modelo customizado > Recomendações atuais)
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const candidateModels = Array.from(new Set([
    primaryModel,
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash'
  ]));

  const prompt = `Você é um auditor técnico. Analise os chamados abaixo e extraia a estimativa de horas necessária.
Jornada diária: ${jornada}h.
Responda APENAS um array JSON no seguinte formato:
[{"id": "ID", "horas": 10, "confianca": "alta", "trecho": "trecho do texto"}]

Chamados:
${JSON.stringify(tickets)}`;

  let lastError = null;

  // Tentativa dinâmica entre os modelos disponíveis
  for (const modelName of candidateModels) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        
        let resultados = [];
        try {
          resultados = JSON.parse(rawText);
        } catch (e) {
          resultados = [];
        }

        return res.status(200).json({ resultados, modeloUtilizado: modelName });
      }

      const errText = await response.text();
      lastError = `[${modelName} - Status ${response.status}]: ${errText}`;
    } catch (err) {
      lastError = `[${modelName} - Exceção]: ${err.message}`;
    }
  }

  return res.status(500).json({ 
    erro: `Falha na chamada à API Gemini em todos os modelos testados. Detalhe da última resposta: ${lastError}` 
  });
}
