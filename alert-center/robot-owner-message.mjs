// Pure message builder for the internal-only robot. No network or email.
export function robotOwnerMessage(ticket) {
  const owner = ticket?.owner;
  const name = owner && owner.id != null && typeof owner.businessName === 'string'
    ? owner.businessName.replace(/[\x00-\x1f\x7f]/g, ' ').trim().split(/\s+/)[0] : '';
  const nome_responsavel = name || 'equipe';
  return [
    'Olá, '+nome_responsavel+'! Tudo bem?',
    'Poderia, por gentileza, nos atualizar sobre o andamento deste chamado e os próximos passos?',
    'Caso exista alguma dificuldade ou necessidade de apoio, estamos à disposição para ajudar.',
    'Agradecemos pela parceria!',
    'Ticket Manager'
  ].join('\n\n');
}
