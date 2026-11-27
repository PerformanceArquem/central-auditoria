# Visão dos três grupos — homologação

Branch de testes: `feat/robot-overview-readonly-20261127`.

## Escopo implementado

- Seleção dos três grupos, somente Inteligência e subsetores, Produção ou Suporte.
- Filtros existentes de setor, responsável, nível e motivo aplicados ao resultado da consulta.
- Dados sincronizados há mais de 24 horas, no futuro ou sem referência de sincronização ficam exclusivamente para revisão.
- Regras de previsão vencida, aviso em até 24 horas, escalonamento após 48 horas, previsão não informada e identidade do responsável não informada.
- Datas de SLA pausadas ou sem confirmação de pausa não geram alertas de vencimento. Ausência de apontamentos e permanência na fila ficam suspensas nesta etapa; não há cobertura suficiente para avaliá-las.

## Consulta protegida

O novo GET `/api/audit?route=robot-overview&scope=all` usa o roteador existente e não cria outra função Vercel. Aceita apenas os escopos fixos definidos no modelo. Confere a sessão pelo Supabase e exige exatamente um cadastro de administrador ativo. Não aceita gravação, não chama transportes de mensagens e não altera destinatários ou horários.

A consulta usa projeção restrita da base de relatórios, sem ações, descrições de ações ou contatos. Excesso de mil chamados interrompe a resposta com HTTP 409 e não retorna resultados parciais. Credenciais ficam no servidor. Há limpeza de resultados e descarte de respostas tardias quando a sessão ou os parâmetros mudam.

## Ativação em testes

A rota permanece desabilitada por padrão e exige `ROBOT_OVERVIEW_ENABLED=true` apenas no ambiente da branch de homologação. A implementação não altera esse parâmetro, não modifica o Supabase e não habilita o recurso na produção atual.

A validação local utilizou dados fictícios para os três grupos. Foram conferidos filtros, revisão separada e layout em 390 px, sem transbordamento horizontal. Os testes automatizados cobrem autorização, bloqueio de métodos de escrita, limite de volume, falhas de origem, projeção de campos, dados desatualizados, descarte após invalidação da sessão e os fluxos existentes da triagem.

Pendente: prévia hospedada com a rota habilitada apenas na branch, consulta autenticada de dados reais e avaliação do limite de volume por grupo. Não considerar esta etapa homologada em produção.
