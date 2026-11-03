export default async function handler(req, res) {
  // Cabeçalhos CORS
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

  try {
    const prompt = `Você é um auditor técnico. Analise os chamados abaixo e extraia a estimativa de horas necessária.
Jornada diária: ${jornada}h.
Responda APENAS um array JSON no seguinte formato:
[{"id": "ID", "horas": 10, "confianca": "alta", "trecho": "trecho do texto"}]

Chamados:
${JSON.stringify(tickets)}`;

    // Utiliza o alias oficial gemini-2.5-flash mantido pela Google API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!response.ok) {
      const errDetails = await response.text();
      return res.status(500).json({ erro: `Erro no provedor Gemini (${response.status}): ${errDetails}` });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    
    let resultados = [];
    try {
      resultados = JSON.parse(rawText);
    } catch (e) {
      resultados = [];
    }

    return res.status(200).json({ resultados });
  } catch (err) {
    return res.status(500).json({ erro: 'Exceção interna na Serverless Function: ' + err.message });
  }
}
