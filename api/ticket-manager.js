export default async function handler(req, res) {
  if (req.method === 'POST') {
    let body = req.body;
    
    // Garantir que o corpo da requisição seja interpretado como objeto JSON válido
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'JSON malformatado enviado ao servidor.' });
      }
    }

    if (!body || !body.tickets) {
      return res.status(400).json({ error: 'Payload de tickets ausente ou inválido.' });
    }

    // Executa a requisição para o Supabase...
  }
}
