# Etapa 2 — Fiscalização Inteligente de Chamados

Branch de homologação: `test/etapa-2-fiscalizacao-inteligente`.

O painel fica na seção de projetos, junto à auditoria de previsões. Reavalia automaticamente os chamados carregados quando a Central renderiza seus dados, e permite executar nova avaliação pelo botão. Os filtros de setor, cliente e criticidade combinam-se. Exibe até 200 linhas por vez; refine os filtros para consultar outras linhas.

Critérios: SLA anterior ao instante da avaliação; ausência de previsão ou responsável; ausência de apontamentos nas ações carregadas; última ação com sete dias ou mais; última permanência confirmada no setor com sete dias ou mais. Ações não carregadas não comprovam ausência de apontamentos. Chamados encerrados, resolvidos, cancelados e excluídos são desconsiderados.

Risco heurístico: vencido = 100; prazo em até 48 horas +45; sem responsável +25; inatividade ou permanência prolongada +25; sem apontamentos carregados +10, limitado a 100. Crítica >=70, alta >=40, média >0, baixa =0. Isso não é uma probabilidade estatística nem uma previsão treinada. Ausência de prazo impede estimar vencimento e é sinalizada como ocorrência. Dados incompletos podem subestimar risco.

Transferências usam exclusivamente `ownerHistories.changedDate`, `ownerTeam` e `owner`. Segmentos são ordenados por instante e calculados em horas corridas. Não se presume data de transferência a partir da abertura ou de uma atualização genérica. A consulta padrão atual não garante que `ownerHistories` seja carregado: o painel sinaliza essa lacuna. Validar a origem com amostras reais antes de expandir a sincronização.

Ocorrências guardam detecção, resolução observada e recorrência apenas em memória da sessão. Um chamado ausente de um lote não é considerado resolvido. Nenhum dado é enviado ao servidor. Persistência compartilhada e aquisição completa do histórico são pendências para homologação posterior, exigindo implementação e revisão separadas.

Validação: `node --test tests/ticket-inspection.test.mjs` e `node --check ui/ticket-inspection.mjs`. Na homologação visual, carregar chamados, abrir o painel, combinar filtros e conferir exemplos de prazo, ações e transferências com o Movidesk. Não disparar mensagens, aplicar migrações ou publicar durante esses testes.
