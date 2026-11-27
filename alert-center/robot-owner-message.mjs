// Pure internal-note builder. Facts must originate from validated rule evaluation.
const dateBR = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value.split('-').reverse().join('/') : '';
const positive = n => Number.isSafeInteger(n) && n > 0;
const duration = n => n + (n === 1 ? ' dia' : ' dias');
export function robotOwnerMessage(ticket, facts = {}) {
  const owner = ticket?.owner;
  const hasOwner = owner?.id != null && String(owner.id).trim() !== '';
  const name = hasOwner && typeof owner.businessName === 'string' ? owner.businessName.replace(/[\x00-\x1f\x7f]/g, ' ').trim().split(/\s+/)[0] : '';
  const nome_responsavel = name || 'equipe';
  const reasons = [];
  const deadline = dateBR(facts.data_previsao_vencida);
  const opened = dateBR(facts.data_abertura);
  const last = dateBR(facts.data_ultimo_registro);
  const idle = facts.dias_sem_registro ?? facts.dias_sem_atualizacao;
  if (facts.sem_registro === true && opened) reasons.push('ainda não possui registro de acompanhamento desde a abertura em '+opened);
  else if (positive(idle)) reasons.push('está há '+duration(idle)+' sem atualização'+(last ? ', com último registro em '+last : ''));
  if (deadline) reasons.push('está com a previsão de solução vencida desde '+deadline);
  const queue = ticket?.ownerTeam === 'Suporte' && positive(facts.dias_na_fila);
  if (queue) reasons.push('está na fila do Suporte há '+duration(facts.dias_na_fila)+(dateBR(facts.data_entrada_fila) ? ', desde '+dateBR(facts.data_entrada_fila) : ''));
  const unassigned = queue && owner === null;
  if (unassigned) reasons.push('ainda não possui um responsável definido');
  const request = unassigned ? 'Poderiam, por gentileza, verificar a situação e direcionar o chamado para acompanhamento?'+(deadline?' Pedimos também que verifiquem a previsão de solução.':'') : deadline ? 'Poderia, por gentileza, nos atualizar sobre o andamento e verificar a possibilidade de ajustar a previsão?' : 'Poderia, por gentileza, nos atualizar sobre o andamento deste chamado e os próximos passos?';
  return [
    'Olá, '+nome_responsavel+'! Tudo bem?',
    ...(reasons.length ? ['Vimos que este chamado '+reasons.join(' e ')+'.'] : []),
    request,
    'Caso exista alguma dificuldade ou necessidade de apoio, estamos à disposição para ajudar.',
    'Agradecemos pela parceria!',
    'Ticket Manager'
  ].join('\n\n');
}
