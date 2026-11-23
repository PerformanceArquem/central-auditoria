# Ticket Manager — assistente operacional em homologação

Branch independente de main. Sem implantação, alteração de banco, e-mail real, agendamento ou publicação. A PR dos envios matinais permanece independente.

O chat de relatórios existente passa a reconhecer cinco consultas operacionais. A autenticação Supabase é validada no servidor e exige `audit_users.role=admin` e `is_active=true`. Permissões de gestor por setor ainda não estão implementadas: esta versão atende somente administradores ativos.

| Consulta | Evidência usada | Limitação explícita |
| --- | --- | --- |
| Chamados parados | Ações registradas, setor atual e sincronização de até 24 horas | Não usa lastUpdate do ticket como prova de inatividade; amostra atual de até 500 chamados, até 30 exibidos |
| Risco VIP | IDs de clientes VIP confirmados no servidor e sinais de SLA/inatividade | Sem lista confirmada, retorna indisponível; sinais operacionais não preveem perda de cliente |
| Horas versus jornada | Minutos dos apontamentos reais por colaborador e setor | Jornada e diferença ficam null até existir escala individual validada com férias/afastamentos; recorte de até 1.000 apontamentos |
| Cobrança humanizada | Chamados abertos com prazo de solução vencido | Gera apenas texto para revisão; não envia, não transfere e não registra ação |
| Falhas dos relatórios | Histórico de disparos no período de execução | No máximo 100 registros; esta fonte não identifica exclusivamente o cron das 09h; timeout genérico não comprova causa ou falta de aceite |

## Gemini

Reaproveita as variáveis de servidor `GEMINI_API_KEY`, `GEMINI_MODEL` (padrão existente `gemini-2.5-flash`) e `GEMINI_AI_DRAFT_ENABLED=true`. A consulta nova envia ao Gemini somente código fixo da operação e contagem, com consentimento explícito a cada pergunta. Não envia pergunta livre, identificadores, nomes, assuntos, ações, mensagens de erro, e-mails, credenciais ou resultados completos. A resposta calculada permanece separada da sugestão generativa e nunca é substituída por ela.

`TICKET_MANAGER_VIP_CLIENT_IDS` é uma lista separada por vírgula de IDs do cliente/organização oficialmente confirmados. Nenhum VIP é inferido por nome, prioridade ou histórico de conversa. Esta branch não configura variáveis reais nem chama Gemini real nos testes.

A IA não recebe ferramentas para SQL livre, HTTP arbitrário ou execução de ações. As consultas são fixas no backend e os erros retornados são sanitizados. O corpo de resposta é limitado e não há armazenamento de histórico do chat. Exportação/ impressão anterior fica desabilitada após uma consulta operacional, para evitar exportar o resultado anterior como se fosse o atual.

## Homologação pendente

- Conferir formato real dos snapshots, SLA pausado, datas de ações e cobertura histórica com a conta administrativa; não afirmar cobertura completa.
- Confirmar cadastro VIP e origem oficial de escalas antes de habilitar indicadores dependentes deles.
- Vincular cada execução ao job/período de preparação para diagnóstico exclusivo dos envios das 09h. Até lá, a interface informa que outros disparos podem aparecer.
- Homologar visualmente o chat e as permissões com sessão real, sem envio de e-mails.
- Revisar tratamento e política do provedor externo antes de ativação. Não habilitar variáveis, merge ou deploy automaticamente.

Testes locais usam fetch simulado: autorização, datas reais, recortes, falhas sanitizadas, ações ausentes, status encerrados, SLA pausado, dados antigos, VIP ausente, jornada desconhecida e payload mínimo ao Gemini.
