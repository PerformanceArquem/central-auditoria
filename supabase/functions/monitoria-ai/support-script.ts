/**
 * Roteiro operacional fornecido pela Gestão do Suporte para monitorias receptivas.
 * Sem número/versão documental informados: referência complementar, sem novos descontos.
 * Os exemplos de fala são ilustrativos, não expressões literais obrigatórias.
 */
export const SUPPORT_SCRIPT = Object.freeze({
 reference:'Roteiro de atendimento de suporte — saudação até despedida',
 sourceVersion:'não informada',
 channels:['chat','voice'],
 stages:[
  {
   id:'S01',name:'Saudação inicial',rules:[
    'Na ligação, apresentar nome e Suporte Arquem e perguntar com quem está falando.',
    'Em canais com saudação automática, considerar o fluxo automatizado ao verificar o início do atendimento.'
   ],evidence:'Somente gravação ou mensagens completas demonstram a saudação; canal automatizado não exige saudação manual idêntica.'
  },
  {
   id:'S02',name:'Identificação e encaminhamento',rules:[
    'Consultar se o cliente está em implantação, quando pertinente, e encaminhar ao setor correto explicando ao cliente.',
    'Se o cliente não estiver em implantação, prosseguir com o atendimento de Suporte.'
   ],evidence:'Consulta a Kanban e situação de implantação exigem registros de sistema; não presumir omissão pelo diálogo.'
  },
  {
   id:'S03',name:'Entendimento e sondagem',rules:[
    'Investigar a situação antes de solicitar acesso remoto indiscriminadamente.',
    'Usar perguntas adequadas para identificar erro, rotina, módulo e impacto; quando possível orientar solução por instruções claras.'
   ],evidence:'Avaliar relevância e adequação da sondagem, sem exigir todos os exemplos literais.'
  },
  {
   id:'S04',name:'Histórico de atendimentos',rules:[
    'Pesquisar chamados anteriores por palavras-chave para identificar ocorrência repetida ou ticket ainda aberto.',
    'Quando houver situação não prevista ou erro sistêmico pendente, seguir a triagem/encaminhamento à Inteligência conforme processo vigente.'
   ],evidence:'A pesquisa no sistema requer histórico de consultas/chamados; sem prova, nao_verificavel.'
  },
  {
   id:'S05',name:'Solução ou escalação',rules:[
    'Explicar a orientação com passos claros e verificar se o cliente conseguiu prosseguir.',
    'Quando não for solucionável imediatamente, informar encaminhamento e protocolo quando existir.',
    'Pode ser adequada a transição de chat para ligação quando houver demora de respostas, gravidade, urgência, complexidade ou necessidade de maior atenção.'
   ],evidence:'Avaliar a adequação da ação ao contexto, não exigir ligação ativa sem necessidade demonstrada.'
  },
  {
   id:'S06',name:'Registro do atendimento',rules:[
    'Oferecer o número do ticket/protocolo ao cliente.',
    'No caso resolvido, registrar solicitação e solução de modo completo.',
    'Na escalação, registrar o que foi tentado, os resultados e o setor responsável; orientar o cliente sobre acompanhamento pelo Movidesk.'
   ],evidence:'Tabulação e detalhes do ticket dependem da consulta aos campos reais, nunca exclusivamente da conversa.'
  },
  {
   id:'S07',name:'Encerramento e pesquisa de satisfação',rules:[
    'Perguntar se há algo mais em que possa ajudar e encerrar cordialmente.',
    'Informar sobre pesquisa de satisfação quando cabível à jornada atendida.',
    'Adaptar bom dia/boa tarde e despedida ao contexto; não exigir texto literal do exemplo.'
   ],evidence:'Em extrato parcial sem trecho de despedida, nao_verificavel; regras temporais SUP-001 continuam prevalecendo.'
  }
 ],
 safeguards:[
  'Scripts são modelos de comunicação, não frases obrigatórias palavra por palavra.',
  'Não criar penalidade nova nem ampliar pesos da planilha de monitoria.',
  'Quando não houver prova de Kanban, pesquisa de histórico, acesso remoto ou tabulação, marcar nao_verificavel.',
  'Não confundir canal WhatsApp citado no roteiro com o canal de chat Movidesk efetivamente integrado.',
  'Não sugerir encerramento indevido nem crítica sem registros suficientes e validação humana.',
  'Não há credenciais, dados confidenciais nem cópias de conversas neste arquivo.'
 ]
});
