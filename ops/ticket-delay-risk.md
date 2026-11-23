# Previsão inteligente de atraso — versão 2

Implementação na branch `test/risco-atraso-multifator`, sem publicação automática ou alteração de registros reais.

O índice é heurístico e explicável. Não é uma probabilidade calibrada, um modelo estatístico treinado nem uma decisão automática de cobrança. O painel mostra a contribuição de cada fator, a cobertura disponível e informações ausentes. Sem prazo válido, o índice é indeterminado (`null`), mesmo que existam ocorrências operacionais.

| Fator | Peso máximo | Regra de contribuição |
| --- | ---: | --- |
| Proximidade do vencimento | 30 | Até 24h: 30; 48h: 24; 72h: 18; 7 dias: 8; acima disso: 0 |
| Tempo sem apontamento | 20 | 7+ dias: 20; 3+ dias: 12; 1+ dia: 6; menos: 0 |
| Transferências entre setores | 15 | 5+: 15; 3+: 10; 1+: 5; nenhuma observada: 0 |
| Histórico semelhante | 15 | Proporção de resolvidos após o prazo × 15; mínimo de cinco comparáveis |
| Criticidade do cliente | 10 | Crítica: 10; Alta: 7; Média: 3; Baixa explicitamente cadastrada: 0 |
| Tempo acumulado no setor atual | 10 | 15+ dias: 10; 7+ dias: 7; 3+ dias: 3; menos: 0 |

Índice = soma das contribuições disponíveis ÷ soma dos seus pesos máximos × 100, arredondado. Cobertura = soma dos pesos dos fatores disponíveis (máximo 100%). Fator ausente não recebe zero: fica indisponível e reduz a cobertura. A cobertura é alta com 85%+, média com 60%+ e baixa abaixo disso; essas faixas indicam disponibilidade de fatores, sem afirmar precisão preditiva.

Faixas do índice: Crítica >=70, Alta >=40, Média >0 e Baixa =0. Chamado já vencido recebe 100 com estado **Já vencido**, distinguindo atraso confirmado de previsão. Alerta preditivo de risco elevado é criado apenas com prazo ainda não vencido, índice >=70 e cobertura >=60%. Sem cobertura suficiente, a ocorrência preditiva anterior não é encerrada por ausência de evidência.

O tempo sem apontamento usa exclusivamente registros `timeAppointments` datados, não a última ação textual. Sem nenhum apontamento e com cobertura explícita das ações, a contagem usa a abertura, sinalizando essa base. Datas ausentes, inválidas ou futuras e cobertura desconhecida não comprovam atividade recente. Troca de responsável no mesmo setor não conta como transferência. O tempo acumulado soma visitas e retornos ao setor atual; o painel mantém também a permanência contínua já existente.

Semelhantes têm o mesmo setor, categoria e serviço. Só entram resolvidos/fechados com prazo e conclusão válidos, sem cancelados, excluídos ou conclusões futuras. IDs duplicados não aumentam a amostra, e o próprio chamado não compõe seu histórico. Os grupos são indexados uma vez por análise, evitando varrer toda a coorte para cada chamado. O histórico é observacional e sujeito a cobertura/alterações dos dados sincronizados.

No navegador, a amostra histórica é limitada aos chamados carregados. Ao executar manualmente a fiscalização, a lista corporativa VIP é consultada pela ação existente `vip_config/list`: correspondência exata confirmada indica prioridade Alta. Ausência na lista não significa cliente de baixa criticidade. O motor aceita também cadastro explícito das quatro criticidades por ID ou nome exato; a integração atual usa os VIPs corporativos existentes, sem novo cadastro persistente.

Na consulta sincronizada, o servidor recalcula tudo a partir da origem autorizada, lê até 500 resolvidos sincronizados e consulta a lista corporativa com o token do administrador. A seleção histórica exclui assuntos, conversas e dados de contatos. Falha de contexto é apresentada como fator indisponível, sem impedir o restante da análise. A única ação POST adicional é a consulta de configuração `vip_config/list`, sem envio de e-mails. Não há gravação automática, migração ou novo endpoint/função Vercel.

Validação automatizada: `node --test tests/ticket-delay-risk.test.mjs tests/ticket-inspection.test.mjs tests/ticket-inspection-api.test.mjs tests/audit-router.test.mjs tests/workspace-performance.test.mjs tests/ticket-manager-api-diagnostics.test.mjs`. Usa dados fictícios e respostas simuladas; inclui exclusão de histórico inválido, último apontamento versus ação, retornos ao setor, criticidade exata, ausência de prazo, cobertura e autorização.
