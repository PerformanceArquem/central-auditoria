export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const accessKey = req.headers['x-access-key'];
  if (!accessKey || accessKey !== process.env.ACCESS_KEY) {
    return res.status(401).json({ erro: 'Chave de acesso inválida ou não informada.' });
  }

  const { jornada = 8, tickets = [] } = req.body;
  if (!tickets.length) {
    return res.status(200).json({ resultados: [] });
  }

  try {
    const prompt = `Você é um auditor técnico. Analise os chamados abaixo e extraia a estimativa de horas necessária.
Jornada diária: ${jornada}h.
Responda APENAS um array JSON no seguinte formato:
[{"id": "ID", "horas": 10, "confianca": "alta", "trecho": "trecho do texto onde identificou"}]

Chamados:
${JSON.stringify(tickets)}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const resultados = JSON.parse(rawText);

    return res.status(200).json({ resultados });
  } catch (err) {
    return res.status(500).json({ erro: 'Falha na IA: ' + err.message });
  }
}
