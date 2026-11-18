# Liberação controlada — saldos de jornada (PR #121)

## Objetivo

Trocar a exibição de **Diferença para a mínima** e **Diferença para a jornada** de um indicador de falta truncada em zero para **saldo assinado** (apontado menos referência), preservando os indicadores históricos `minimumGap` e `targetGap` para compatibilidade. O escopo é e-mail, PDF e Excel corporativos; **nenhum agendamento, destinatário ou envio automático deve ser modificado**.

## Estado verificado em 18/11/2026

- PR #121: verificações automatizadas aprovadas, incluindo os testes de `journey-gaps.ts`, dos dois geradores de PDF/XLSX e do pacote de e-mail.
- A função `audit-email-dispatch` ainda estava ativa na **versão 154** no projeto Supabase `dvaaicqajlppuigeyejr`.
- O fluxo `.github/workflows/deploy-audit-email.yml` publica automaticamente a função no Supabase após alterações em `main`.
- O Google Apps Script **não** é publicado automaticamente pelo fluxo do Supabase. `.github/workflows/appsscript-clasp-controlled.yml` exige liberação manual, correspondência de hashes, fonte revisada em `apps-script/deploy-source` e não atualiza o endpoint `/exec` automaticamente.
- Não há confirmação de que a versão ativa do Apps Script contém as mudanças desta PR. Uma checagem automatizada de sintaxe **não** substitui a verificação de PDF/XLSX gerados de verdade.

## Critérios para homologação, **sem envio de e-mail**

1. Fazer snapshot somente leitura do Apps Script implantado (script ID já configurado na workflow controlada) e conferir a implementação real de `doPost`, de `arquemCreateReportAttachments_` e das permissões. Não sobrescrever a versão remota de forma destrutiva.
2. Preparar uma versão revisada que combine as alterações de `apps-script/arquem-relatorios-anexos.gs` e da implantação corrente, sem criar `doPost` ou geradores duplicados, nem alterar `MAIL_SECRET` e demais propriedades.
3. Usar `arquemTesteAnexosSemEnvio` / `arquemValidarPublicacaoSemEnvio` somente no ambiente controlado, confirmando dois arquivos reais, legíveis e timbrados (PDF e XLSX); não chamar `MailApp.sendEmail` nem `GmailApp.sendEmail`.
4. Conferir **valores e sinal** em todos os formatos. Fixture: realizado `07:37:00`; mínima `06:24:00`; jornada `08:00:00`; saldos `+01:13:00` e `−00:23:00`. Confirmar também um caso abaixo da mínima e outro acima da jornada.
5. Conferir os nomes e alinhamento das colunas no PDF e na planilha, formatos de horas acima de 24 h e separação de apontamentos em fins de semana/feriados.
6. Registrar evidência da prévia real e aprovação dos anexos na PR #121 antes de integrar ao `main`.

## Recuperação do acesso `clasp` — bloqueio confirmado

Auditoria somente leitura reexecutada em 18/11/2026: [workflow run 43925902801](https://github.com/PerformanceArquem/central-auditoria/actions/runs/43925902801), job `audit`, etapa `Read-only snapshot`. Falha no `clasp pull`: `invalid_grant`, subtipo `invalid_rapt`. O segredo existe, mas a autenticação Google armazenada exige nova verificação da conta. **Reexecutar a mesma workflow com o segredo antigo não resolve.**

1. Em computador confiável, entrar com a **conta Google responsável pelo projeto** e instalar a versão do `clasp` usada no fluxo (`npm install -g @google/clasp@3.4.1`). Usar `clasp login` e concluir a autenticação interativa/MFA. O `clasp login --no-localhost` pode ser usado se necessário, conforme a documentação do Google.
2. Confirmar localmente, em uma pasta isolada com `.clasp.json` apontando para o script correto, que `clasp pull` tem acesso. Faça cópia de segurança dos arquivos existentes; não executar `clasp push` ou `clasp deploy` nesta fase.
3. Substituir **somente** o secret `CLASPRC_JSON` em [GitHub Actions Secrets](https://github.com/PerformanceArquem/central-auditoria/settings/secrets/actions) pelo conteúdo completo do arquivo privado `~/.clasprc.json` recém-autorizado. Não adicionar à árvore git, às mensagens de chat, às issues, aos anexos ou aos logs. Limitar acesso ao arquivo local.
4. Abrir [workflow Apps Script](https://github.com/PerformanceArquem/central-auditoria/actions/workflows/appsscript-clasp-controlled.yml), selecionar **Run workflow**, branch `main`, operação **audit**. **Não selecionar publish.** Conferir `Read-only snapshot`, análise do contrato `doPost` e simulação de overlay. O sucesso dessa auditoria significa acesso e consistência de código, **não** que os PDF/XLSX reais foram gerados nem que o endpoint `/exec` foi atualizado.
5. Registrar apenas os resultados não sensíveis da execução na PR #121. Prossiga com os passos de homologação e release descritos abaixo antes do merge.

Referências: [guia oficial do Google para `clasp`](https://developers.google.com/apps-script/guides/clasp?hl=pt-BR) e [opções de login](https://github.com/google/clasp).

## Reconciliação de duplicidades da auditoria remota (18/11/2026)

A auditoria `clasp pull` foi restabelecida, mas encontrou **8 nomes duplicados** no projeto. O job de consolidação anterior bloqueou 8 arquivos JavaScript / 48 funções globais em vez de 6 / 39. Entre os conflitos: `arquemCreateReportAttachments_`, `arquemPdf_` e `arquemXlsx_` com implementações diferentes em `ZenviaVozChat.js` e `homologacao-pr103-isolada.js`.

O novo guard da PR #121:
- compara o corpo de cada declaração pela AST;
- elimina **somente cópias byte-idênticas**, **apenas no diretório temporário** da simulação (sem `clasp push`);
- interrompe a auditoria se restarem definições distintas sob o mesmo nome;
- não trata atualização de inventário por contagem como autorização de publicação.

**Revisão obrigatória antes do release:** decidir explicitamente as implementações canônicas dos geradores PDF/XLSX e as funções de homologação, confirmar compatibilidade com o `doPost` oficial e os modelos atuais, e registrar a decisão. A execução de CI com dados sintéticos não comprova que os conflitos reais foram resolvidos.

## Implantação coordenada

1. Registrar versão, hashes, endpoint `/exec` ativo e plano de reversão do Apps Script, sem expor segredos no log.
2. Publicar a fonte revisada no Apps Script pelo processo aprovado, criar uma versão e **atualizar o deployment `/exec` de forma explícita** após validação da versão. A workflow atual de `clasp` cria versão, mas não atualiza `/exec` sozinha; verificar o procedimento de atualização do deployment antes de avançar.
3. Verificar a resposta protegida de `capabilities`, a disponibilidade dos anexos e a correspondência entre a versão homologada e a ativa.
4. Incorporar a PR #121 ao `main`, supervisionando o deploy automático da função `audit-email-dispatch` no Supabase. **Não considerar o deploy do GitHub como prova de publicação do Apps Script.**
5. Revalidar prévia real, sem envio, usando a nova função e a versão aprovada do Apps Script. Conferir que não há bloqueio de anexos.
6. Monitorar o próximo disparo regular das 09h, preservando deduplicação e logs. **Não executar disparos manuais para testar.**

## Reversão

- Em caso de falha na homologação ou no deployment, não forçar envios. Retornar o deployment do Apps Script para a versão anterior aprovada, se aplicável, e restaurar a versão conhecida da função Supabase pelo processo controlado.
- Registrar versões, logs, destinatários afetados e impacto em anexos, sem compartilhar `MAIL_SECRET` ou tokens.
- Nenhuma alteração no cron `audit-email-dispatch-9h` ou nas listas de destinatários faz parte desta PR.

## Evidências necessárias para encerrar

- [x] Testes automatizados de saldo assinado e sintaxe dos geradores
- [ ] Snapshot da versão efetivamente implantada no Apps Script
- [ ] PDF e XLSX gerados e conferidos sem enviar e-mail
- [ ] Aprovação do modelo corporativo e da atualização `/exec`
- [ ] PR incorporada e deploy Supabase concluído
- [ ] Versões ativas conferidas e acompanhamento do primeiro envio regular
