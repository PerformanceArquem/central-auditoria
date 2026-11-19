# Homologação integrada — cinco etapas da Central de Auditoria

**Estado:** somente testes e revisão. **Não é autorização para publicação.**

## Dependências
1. PR #180 — base analítica, criada sobre main;
2. PR #181 — alertas por setor, baseada na #180;
3. PR #182 — fluxo de filas, baseada na #181;
4. PR #183 — Qualidade com verificação humana, baseada na #182;
5. PR #184 — horas apontadas e comparativos, baseada na #183;
6. esta branch — testes de integração, baseada na #184.

A PR #179, de SLA da Implantação, está **fora desta cadeia**.

## Controles imutáveis
- Nenhum disparo de notas Movidesk, e-mails ou notificações.
- Nenhuma criação, atualização ou fechamento de chamado.
- Nenhuma abertura ou classificação automática de NC ou SGNC.
- Nenhum cron novo ou modificação dos relatórios automáticos das 09h.
- Nenhuma migração SQL, RLS, troca de autenticação, deploy, merge ou publicação.
- Não inserir tokens, clientes, dados pessoais ou documentos internos no GitHub.

O único POST dessas novas funcionalidades é uma solicitação isolada de texto
ao Gemini. Requer sessão de administrador, consentimento explícito e a variável
QUALITY_GEMINI_DRAFT_ENABLED=true. Por padrão, o Gemini fica desligado.
O payload contém apenas códigos genéricos de verificação, sem dados do chamado.

## Testes automatizados
Executar com Node 22, em uma só bateria:
- tests/audit-readonly-insights.test.mjs
- tests/audit-alert-policy.test.mjs
- tests/audit-queue-flow.test.mjs
- tests/audit-quality-review.test.mjs
- tests/audit-productivity-comparisons.test.mjs
- tests/audit-integrated-homologation.test.mjs

Os testes integrados cruzam os cinco cálculos sobre dados fictícios e validam
pausa de SLA, fechamento, movimentação entre equipes, ausência de última ação,
horas reais, controle de acesso e ausência de escritas.

## Homologação autenticada ainda pendente
1. Usar um ambiente de teste isolado sem credenciais de produção.
2. Validar administradores, usuários comuns e sessão expirada.
3. Verificar responsividade, erros, estados vazios e filtros dos cinco painéis.
4. Conferir os campos reais do payload sincronizado e dos apontamentos.
5. Comparar amostras com Movidesk: status, proprietário, SLA, última ação e histórico.
6. Marcar limites de páginas e histórico incompleto, sem divulgar valores como totais.
7. Verificar duplicidade: simulação não equivale a histórico real de notificações.
8. Conferir feriados e fins de semana, sem inventar jornada ou capacidade.
9. Comparar regras da Qualidade com versão vigente aprovada na intranet.
10. Assegurar que a IA continua desligada por padrão e só recebe códigos genéricos
    se houver consentimento e aprovação de privacidade.
11. Verificar possíveis previews automáticos da integração GitHub-Vercel.
    Preview não equivale a deploy de produção; não fazer deploy manual.
12. Registrar a aprovação humana, problemas e ações antes de qualquer merge.

## Critério de liberação
- CI de integração completa, na revisão mais recente;
- validações com dados fictícios e revisão de privacidade;
- conferência visual autenticada e dados reais em homologação isolada;
- aprovação da Qualidade e do responsável pelo ambiente;
- autorização explícita e separada para incorporar, publicar ou notificar.

**Status:** esta etapa valida somente testes automatizados.
Homologação visual e operacional com dados reais não foi realizada.


## Contrato de datas e status confirmado na homologação de leitura

A documentação oficial do Movidesk declara UTC para slaSolutionDate,
lastActionDate e ownerHistories.changedDate, embora a API serialize algumas
datas sem Z ou offset explícito. Fonte:
https://atendimento.movidesk.com/kb/pt-br/article/256/movidesk-ticket-api

- O parser unificado audit-movidesk-datetime.cjs trata esses valores sem
  offset como UTC e rejeita datas inválidas. **Não** aplica UTC-03 às datas
  de origem antes do cálculo; só converte para America/Sao_Paulo ao exibir.
- Chamados com baseStatus Resolved ou Closed não integram filas abertas mesmo
  quando closed_at_source está nulo. O status é a evidência de encerramento.
- A falta de slaSolutionDate impede alerta por vencimento. A revisão de
  Qualidade pode propor conferir o preenchimento, mas isso não comprova
  descumprimento de norma, nem autoriza abrir NC.
- ownerHistories com equipe, data ou ordem duvidosa não comprova tempo na
  equipe; o indicador deve permanecer ausente e ser revisado.
- Apontamentos somente geram horas quando existem duration_minutes válidos
  com data de trabalho dentro da janela do comparativo.

**Escopo da verificação:** metadados e totais agregados por consulta
somente leitura. Nenhuma identificação de pessoa, cliente ou ticket real foi
copiada para o repositório. A cobertura do histórico completo e o teste
visual autenticado continuam pendentes.

Testes adicionais:
- tests/audit-movidesk-datetime.test.mjs — UTC sem Z, precisão, fuso de
  exibição e rejeição de datas inválidas;
- tests/audit-integrated-homologation.test.mjs — status Resolved sem
  closed_at_source e chamados ativos sem SLA.
