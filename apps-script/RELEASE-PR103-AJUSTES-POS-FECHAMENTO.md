# PR #103 — roteiro de homologação e recuperação dos relatórios

## Estado verificado em 16/11/2026
- Supabase `audit-email-dispatch` v143: a função bloqueia `timing` se o gerador responder sem `postCloseAdjustmentsSupported: true`.
- Registros `audit_email_sector_dispatches`: 10 `daily` e 12 `weekly` em `failed`, mensagem "Gerador ainda não homologado para observações de ajustes posteriores ao fechamento".
- Foram observados 3 envios de Triagem da Inteligência com anexos no Gmail conectado, distintos dos 22 relatórios setoriais.
- Os 6 checks da PR #103 passaram. Checks Node/Deno **não** substituem testes reais de Google Docs/Sheets/Drive.
- O projeto Apps Script oficial é `Central de Auditoria - Emails`. O acesso Google Drive a metadados não autoriza alterar conteúdo do projeto Apps Script.
- O workflow `.github/workflows/appsscript-clasp-controlled.yml` tem modo `audit` sem escrita, e `publish` exige hashes revisados, árvore completa, autorização e aprovação do ambiente. `clasp push` **não** muda automaticamente a implantação Web App `/exec`.

## Sequência segura (sem enviar e-mails até a etapa final)
1. **Backup e inventário:** obter todas as fontes reais do Apps Script via `clasp pull` em fluxo protegido, salvando de forma privada versões e IDs de implantações. Não divulgar secrets nem o código inteiro se ele contiver credenciais.
2. **Reconciliar origem:** as fontes `apps-script/central-auditoria-emails-completo.gs` e `apps-script/arquem-relatorios-anexos.gs` são referências alternativas: **nunca** publicar ambas como arquivos independentes quando definirem as mesmas funções. Preservar `doPost`, Zenvia, Triagem e outras extensões já existentes.
3. **Homologar em projeto isolado:** instalar somente os helpers de ajustes, rodar `arquemHomologarAjustesSemEnvio()` com conta autorizada e papel timbrado configurado. Conferir em PDF/XLSX os valores antes/depois, diferença positiva/negativa, data do trabalho, data da observação, links do Movidesk, total de linhas e ausência de duplicação de horas.
4. **Separar validação técnica e aprovação visual:** executar `arquemHomologarAjustesSemEnvio()` no editor instalado: gera PDF e XLSX com dados sintéticos, sem e-mails, e devolve `technicalValidation:true, visualApprovalRequired:true`. **Nesta etapa a capacidade permanece FALSE**, intencionalmente.
   - Como o gerador limpa os temporários, preparar revisão visual real em ambiente de homologação autorizado; não presumir conteúdo correto só pelo tamanho dos blobs. Validar página PDF, tabela, cabeçalho, valores 01:00:00 → 01:30:00, diferença +00:30:00, link para o chamado e a aba Excel.
   - Após a revisão independente dos dois arquivos com evidência registrada, um responsável autorizado configura nas propriedades do Apps Script: `ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION=post-close-v1`, `ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID=<ID exato do modelo timbrado>` e `ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT=<timestamp ISO-8601 posterior à homologação técnica>`. Não preencher antes da validação; uma nova homologação técnica invalida a aprovação visual anterior.
   - Confirmar `capabilities.postCloseAdjustmentsSupported=true` somente quando o modelo não foi alterado depois da homologação e o controle de revisão foi preenchido corretamente. Validar também `paperTemplateConfigured=true`, sem alterar funcionalidades legadas. Simular os estados `tracked`, `no_comparison`, `restricted` e `unavailable`.
5. **Publicação controlada:** seguir fluxo de revisão e hashes do workflow; após criar a versão, validar a atualização da implantação `/exec` apontada por `GMAIL_WEBAPP_URL`. Monitorar logs e prover rollback da versão anterior.
6. **Reconciliação de Gmail:** procurar mensagem por destinatário/assunto/período e comparar com IDs do provedor. Não assumir ausência definitiva quando a conta de envio for outra.
7. **Reenvio controlado:** apenas após entrega comprovada de PDF e XLSX em teste autorizado. Não converter registros `failed` para `sent` sem aceite do provedor. Processar **um** destinatário inicialmente e verificar anexos/recebimento; depois lotes pequenos, com chave de idempotência, bloqueio de concorrência e trilha de auditoria.
8. **Preservar automações:** não mexer nos agendamentos 09h e na Triagem da Inteligência até homologação integral.

## Critério objetivo para concluir
- Fonte real conciliada e implantada sem colisões de função
- PDF/XLSX reais de ajustes verificados; link para chamado e horas conferidos
- `/exec` responde com a capacidade esperada e relatório de teste autorizado é entregue com dois anexos
- 22 registros conciliados por destinatário; nenhum duplicado; falhas resolvidas ou justificadas em log
- Agendamento 09h e envio independente de Triagem permanecem saudáveis

## Auditoria inicial de destinatários (sem e-mails nesta etapa)
- Diário + semanal: Alan, Arthur, Carla, Cassiano, Cristiano, Kassio, Kleber, Laís, Letícia, Lucas Vieira
- Semanal: Keila e Direção
- A presença de um registro `failed` no banco não é prova, isoladamente, de não entrega por outro remetente.
