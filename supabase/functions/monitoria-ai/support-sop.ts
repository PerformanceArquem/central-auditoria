/**
 * SUP-001 v1.1, Suporte – Macro Fluxo de Atendimento N1/N2/N3.
 * Criado 23/09/2026; aprovado 27/10/2026; revisão 16/11/2026.
 * Referência operacional complementar à rubrica do formulário de monitoria.
 * Sem senhas, logins, tokens ou dados pessoais.
 */
export const SUPPORT_SOP = Object.freeze({
 id:'SUP-001',
 version:'1.1',
 revisedAt:'2026-11-16',
 appliesTo:['chat','voice'],
 purpose:'Referência operacional; não altera pesos, notas ou regras zeradoras da planilha.',
 phases:[
  {phase:0,name:'Preparação',checks:[
   'Início do turno 09:00: Movidesk, Zenvia e Intranet acessados.',
   'Status Online/Disponível nos sistemas de atendimento (SUP 010).'
  ],evidence:'Somente registros administrativos de login/status podem comprovar; não inferir a partir de conversa.'},
  {phase:1,name:'Recepção e triagem',checks:[
   'Até 2 chats simultâneos distribuídos automaticamente ou 1 ligação por vez.',
   'Chat: primeira saudação humana até 1 minuto após resposta do cliente ao chatbot.',
   'Validar identificação e CNPJ a partir do histórico do chatbot; se indisponível/divergente, seguir SUP 002.'
  ],evidence:'SLA requer horários de resposta do chatbot e do primeiro contato humano; cadastro requer registro verificável.'},
  {phase:2,name:'Investigação e resolução',checks:[
   'Sondar o problema com perguntas pertinentes; seguir troubleshooting SUP 003.',
   'Acesso remoto via RustDesk/ArqDesk apenas quando a complexidade ou dificuldade de comunicação justificar (SUP 004).',
   'Se comunicação continuar limitada, avaliar ligação ativa conforme SUP 005.',
   'Informar ao cliente quando estiver buscando informação/documentação ou apoio N2/N3.',
   'Chat: espera de até 10 minutos; se exceder, atualizar cliente a cada 5 minutos.',
   'Voz: espera de até 5 minutos; se exceder, atualizar cliente a cada 2 minutos.',
   'Resolver ou escalar quando os recursos se esgotarem; se não houver documentação, seguir SUP 006.'
  ],evidence:'Tempos somente com marcas temporais confiáveis; necessidade de acesso remoto depende do contexto real.'},
  {phase:3,name:'Encerramento de chat',checks:[
   'Resolvido: confirmação do cliente, oferecer ajuda adicional e despedida cordial.',
   'Inatividade: aos 5 minutos sem resposta enviar aviso de encerramento em 10 minutos; aos 15 minutos totais enviar mensagem final e encerrar, conforme SUP 007.',
   'Resposta tardia de agradecimento: comunicar encerramento e fechar chat.'
  ],evidence:'Não concluir encerramento indevido a partir de extrato parcial sem sequência e horários completos.'},
  {phase:4,name:'Pós-atendimento e tabulação',checks:[
   'Ação pública com nome do contato, ocorrido, processo utilizado e solução, utilizando macro SUP 008.',
   'Preencher motivo do contato, serviço, categoria, urgência, produto, módulo, e responsável/acompanhamento (o próprio agente).',
   'Previsão de solução somente se escalado.',
   'Resolvido: ticket resolvido/fechado; escalado: ticket permanece aberto, conforme SUP 009.'
  ],evidence:'Obrigatoriamente conferir campos/status reais do ticket; texto do chat isolado não comprova tabulação.'}
 ],
 evidencePolicy:[
  'Ações do ticket e extratos não são automaticamente histórico integral de chat.',
  'Se não houver evidência para um critério, marcar nao_verificavel, nunca inventar infração nem aprovação.',
  'Se houver informação insuficiente para validar cronologia, não calcular atraso por suposição.',
  'Para voz, só avaliar interação de ligação autenticada e atribuída ao colaborador.',
  'Critérios não aplicáveis a um canal ou situação não geram desconto automático.',
  'Referências SUP 002–010 são documentos auxiliares; não presumir seu conteúdo além do SUP-001 fornecido.',
  'O fluxo SUP-001 orienta a interpretação; os pesos e descontos permanecem os definidos pela planilha Formulario_Monitoria_Atendimento.xlsx.'
 ]
});
