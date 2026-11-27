// Pure message builder for the internal-only robot. No network or email.
export function robotOwnerMessage(ticket, facts = {}) {
  const owner = ticket?.owner;
  const name = owner && owner.id != null && typeof owner.businessName === 'string'
    ? owner.businessName.replace(/[\x00-\x1f\x7f]/g, ' ').trim().split(/\s+/)[0] : '';
  const nome_responsavel = name || 'equipe';
  // Facts must come from the validated rule evaluator, not an arbitrary timestamp.
  const days = facts.dias_sem_atualizacao;
  const date = facts.data_previsao_vencida;
  const idle = Number.isSafeInteger(days) && days > 0;
  const validDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  const reasons = [];
  if (idle) reasons.push('está há '+days+(days === 1 ? ' dia sem atualização' : ' dias sem atualização'));
  if (validDate) reasons.push('está com a previsão de solução vencida desde '+date.split('-').reverse().join('/'));
  return [
    'Olá, '+nome_responsavel+'! Tudo bem?',
    ...(reasons.length ? ['Identificamos que este chamado '+reasons.join(' e ')+'.'] : []),
    validDate ? 'Poderia, por gentileza, nos atualizar sobre o andamento e verificar a possibilidade de ajustar a previsão?' : 'Poderia, por gentileza, nos atualizar sobre o andamento deste chamado e os próximos passos?',
    'Caso exista alguma dificuldade ou necessidade de apoio, estamos à disposição para ajudar.',
    'Agradecemos pela parceria!',
    'Ticket Manager'
  ].join('\n\n');
}
