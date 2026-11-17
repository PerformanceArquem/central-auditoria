/**
 * SUP-002 v1.0 — Suporte: Correção de Cadastros de Clientes.
 * Criado em 05/10/2026 por Kassio Nascimento.
 * Data e responsável de aprovação não informados no documento fornecido.
 * Referência operacional para monitoria N1/N2/N3, chat e voz.
 * Sem dados pessoais de clientes ou credenciais.
 */
export const SUPPORT_CUSTOMER_REGISTRATION = Object.freeze({
 id:'SUP-002',
 version:'1.0',
 createdAt:'2026-10-05',
 approval:'não informada no documento',
 purpose:'Padronizar identificação, correção e encaminhamento das divergências de cadastro de clientes no Movidesk.',
 channels:['chat','voice'],
 applicability:'Aplicar procedimentos de correção quando uma divergência cadastral for efetivamente identificada. Não presumir divergências sem evidência.',
 phases:[
  {id:'1',name:'Identificação',checks:[
   'Comparar cliente/contato vinculado ao ticket com dados confirmados no atendimento: CNPJ, e-mail e telefone.',
   'Verificar identificação do nome da empresa com número do cliente, e-mail de contato e telefone.',
   'Observar ausência de e-mail, nome fora do padrão, cliente não identificado, duplicidade, vínculo incorreto e múltiplas entradas inconsistentes.',
   'Determinar qual dos quatro cenários se aplica: cadastro incompleto/incorreto vinculado ao principal; cadastro incompleto/incorreto sem vínculo; cadastro principal incorreto/incompleto; cliente não identificado.'
  ],evidence:'Validação exige dados do ticket, cadastro de pessoas do Movidesk e informações confirmadas com o cliente; simples silêncio no chat não comprova falha.'},
  {id:'2.1',name:'Cadastro incorreto ou incompleto vinculado ao principal',checks:[
   'Localizar o cadastro principal/original, normalmente o mais antigo e completo, confirmando a identificação.',
   'No cadastro principal, acrescentar dados em E-mails e Outros contatos e salvar.',
   'Retornar ao ticket, vincular o contato principal e remover o contato incorreto do ticket.'
  ],evidence:'Conferir registros de edição, contatos vinculados e estado do ticket; não inferir conclusão a partir de uma orientação verbal.'},
  {id:'2.2',name:'Cadastro incorreto ou incompleto sem vínculo ao principal',checks:[
   'Na aba Pessoas, localizar o cadastro principal, tipo EMPRESA, com número do cliente no nome, razão social e CNPJ.',
   'Corrigir/preencher os dados, salvar e vincular o principal ao ticket.',
   'Remover o contato incorreto do ticket.'
  ],evidence:'Requer consulta aos registros do Movidesk antes/depois.'},
  {id:'2.3',name:'Cadastro principal incorreto ou cliente não identificado',checks:[
   'Confirmar os dados corretos com o cliente antes de alterá-los.',
   'Localizar o cadastro principal na aba Pessoas (tipo EMPRESA, número do cliente, razão social, CNPJ).',
   'Corrigir e salvar os dados; em caso de cliente não identificado, vincular o principal corrigido ao ticket.',
   'Remover o contato incorreto do ticket.'
  ],evidence:'Confirmar identidade, autorização e registros de cadastro; ausência de edição visível no chat não demonstra negligência.'},
  {id:'2.4',name:'Correção não concluída',checks:[
   'Se não for possível concluir a alteração cadastral nas hipóteses 2.1, 2.2 ou 2.3, aplicar a Fase 3 de escalação.'
  ],evidence:'Verificar motivo do impedimento e encaminhamento efetivamente realizado.'},
  {id:'3.1',name:'Número do cliente ausente ou incorreto',checks:[
   'Consultar Carla, do Financeiro, via canal Discord #Suporte, informando o CNPJ para obter o número correto do cliente.'
  ],evidence:'Consulta ao setor interno depende de histórico do canal ou ticket; não presumir realização ou omissão.'},
  {id:'3.2',name:'Dados vitais inconsistentes',checks:[
   'Para CNPJ ou e-mail financeiro inconsistente, confirmar informação correta com o cliente.',
   'Alertar Financeiro e Comercial via Discord #Geral quando necessário, e corrigir o cadastro segundo a Fase 2.'
  ],evidence:'A confirmação e as comunicações precisam de registros apropriados, sem encaminhar dados sensíveis desnecessariamente à IA.'},
  {id:'3.3',name:'Exclusão/organização de contatos excessivos',checks:[
   'Abrir ticket interno para supervisão quando for necessária exclusão ou reorganização de contatos.',
   'Assunto: Alteração de cadastro cliente - [Nome do cliente].',
   'Motivo Solicitação; Serviço Suporte; Categoria Atendimento Receptivo; Urgência Baixa.',
   'Responsável Kassio Nascimento; Produto e Módulo não aplicáveis; Status Fila.'
  ],evidence:'Conferir ticket interno real e campos, não apenas conversa com o cliente.'}
 ],
 scoringAlignment:[
  {criterion:'R02',name:'Confirmação de dados (Nome e CNPJ)',interpretation:'Verificar nome e CNPJ quando necessário, considerando histórico do chatbot e cadastro já validado. Não exigir nova solicitação se a identificação já estiver comprovada.'},
  {criterion:'R03',name:'Atualização Cadastral',interpretation:'Só exigir correções se houver divergência demonstrada; identificar cenário e validar solução/escalação aplicável. Sem divergência, não penalizar por falta de alteração.'},
  {criterion:'R12',name:'Ação Pública e Macro',interpretation:'Somente conferir registro do atendimento quando houver ação pública real no ticket.'},
  {criterion:'R13',name:'Tabulação e Destino do Ticket',interpretation:'Validar solicitante/contato principal e campos de ticket quando houver evidência sistêmica, sem inferir pelo diálogo.'}
 ],
 safeguards:[
  'SUP-002 complementa SUP-001 e a planilha original; não acrescenta critérios, descontos nem falhas zeradoras.',
  'A alteração de cadastro não é uma obrigação universal de todo atendimento: só se aplica após identificação de divergência.',
  'Não afirmar que um agente deixou de corrigir dados por ausência de menção no extrato; classificar nao_verificavel sem registros.',
  'Escalação correta de problemas cadastrais não é automaticamente uma não conformidade.',
  'Não transmitir informações cadastrais sensíveis, senhas ou credenciais de sistemas para o Gemini.',
  'Validação e aprovação final da monitoria cabem à Qualidade.'
 ]
});
