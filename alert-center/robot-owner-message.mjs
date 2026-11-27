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
  // Waiting-customer facts are supplied only by the validated status/contact evaluator.
  const waiting = facts.aguardando_cliente === true;
  const noContact = waiting && positive(facts.dias_sem_contato);
  const future = waiting && facts.previsao_distante === true && dateBR(facts.data_previsao) && positive(facts.dias_ate_previsao);
  const missing = waiting && facts.sem_previsao === true && !deadline && !dateBR(facts.data_previsao);
  const followup = [];
  if (waiting && positive(facts.dias_aguardando_cliente)) reasons.push('aguarda o retorno do cliente há '+duration(facts.dias_aguardando_cliente));
  if (noContact) followup.push('Não identificamos um novo registro de contato nos últimos '+duration(facts.dias_sem_contato)+(facts.dias_contato_uteis===true?' úteis':'')+(dateBR(facts.data_ultimo_contato)?' (último contato registrado em '+dateBR(facts.data_ultimo_contato)+')':'')+'.');
  if (missing) followup.push('Também não identificamos uma previsão definida.');
  if (future) followup.push('A previsão cadastrada é para '+dateBR(facts.data_previsao)+', daqui a '+duration(facts.dias_ate_previsao)+(facts.dias_previsao_uteis===true?' úteis':'')+'.');
  const customerRequest = waiting && (noContact || missing || future || positive(facts.dias_aguardando_cliente)) ? (unassigned?'Poderiam':'Poderia')+', por gentileza, verificar a possibilidade de retomar o contato com o cliente e atualizar o chamado?'+(missing?' Pedimos também que seja definida uma previsão de acompanhamento.':'')+(future||deadline?' Pedimos também que seja revisada a previsão.':'')+' Caso já tenha ocorrido algum contato, pedimos que registre as informações.' : '';
  const request = unassigned ? 'Poderiam, por gentileza, verificar a situação e direcionar o chamado para acompanhamento?'+(deadline?' Pedimos também que verifiquem a previsão de solução.':'') : deadline ? 'Poderia, por gentileza, nos atualizar sobre o andamento e verificar a possibilidade de ajustar a previsão?' : 'Poderia, por gentileza, nos atualizar sobre o andamento deste chamado e os próximos passos?';
  return [
    'Olá, '+nome_responsavel+'! Tudo bem?',
    ...(reasons.length ? ['Vimos que este chamado '+reasons.join(' e ')+'.'] : []),
    ...followup,
    customerRequest || request,
    'Caso exista alguma dificuldade ou necessidade de apoio, estamos à disposição para ajudar.',
    'Agradecemos pela parceria!',
    'Ticket Manager'
  ].join('\n\n');
}
