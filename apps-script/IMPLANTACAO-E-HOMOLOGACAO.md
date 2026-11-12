# Publicação controlada — anexos da Central de Auditoria

## Objetivo
Atualizar o gerador de anexos **sem modificar a autenticação, segredos, URL pública e `doPost` principal**. A versão vigente fica mantida até os testes passarem.

## Código-fonte
- Arquivo auxiliar: `apps-script/arquem-relatorios-anexos.gs`
- **Não** usar esse auxiliar para substituir integralmente o `doPost`; manter suas validações atuais.
- A função de envio deve passar `reportData` para `arquemCreateReportAttachments_` e inserir os dois blobs no `GmailApp.sendEmail(...,{attachments:anexos})`.
- O endpoint `action: 'capabilities'` só pode ser exposto depois da validação do segredo existente.

## Etapas na conta Google executora
1. Abrir o **projeto original do Google Apps Script** que recebe os envios da Arquem.
2. Fazer uma cópia de segurança do script atual e identificar a implantação Web App vigente.
3. Substituir **somente o conteúdo do arquivo auxiliar** pelos comandos do `.gs` do repositório. Preservar `doPost`, `MAIL_SECRET`, URL, identidade de execução, permissões e integrações atuais.
4. Conferir a propriedade `ARQUEM_PAPEL_TIMBRADO_DOC_ID` e o acesso do executor ao modelo Google Docs.
5. Executar **sem envio** no editor, na ordem:
   - `arquemValidarPublicacaoSemEnvio()`
   - `arquemHomologarSecoesSemEnvio()`
   - `arquemHomologarKeilaSemEnvio()` — deve retornar 2 anexos, com exemplos de movimentações
   - `arquemHomologarCSATSemEnvio()` — deve retornar 2 anexos e classificar nota **8** como positiva.
6. Conferir se `arquemCapacidadesAnexos_()` retorna `paperTemplateConfigured: true`, `keilaProductionReady: true` e `csatNotesReady: true`. A versão de Rastreabilidade exigida pelo backend é **arquem-8-keila-movements**.
7. Implantar uma **nova versão da implantação existente** (e não uma URL separada), preservando o acesso já autorizado. Depois consultar a ação de leitura `attachment_probe` no backend; ela não envia mensagens.
8. Testar geração e conteúdo dos PDF/XLSX com dados **fictícios** antes de autorizar disparo real. Validar: páginas e tabelas da Produção, abas Resumo/Entradas/Saídas/Movimentações, links; abas CSAT - Notas e notas 8–10.
9. Só depois, validar um envio de e-mail **expressamente autorizado**, com proteção por período e destinatário, sem reenvio automático de mensagens antigas.

## Regras operacionais
- Envio matinal em **lotes de até 2 relatórios**, entre 08h45 e 08h59, segunda–sexta, exceto feriados cadastrados.
- Relatórios diários tomam o último dia útil como referência. O trabalho de fins de semana/feriados deve continuar discriminado, sem criar jornada obrigatória.
- CSAT positivo: notas 8, 9 e 10; negativas: 1–7. Carla e Kassio recebem CSAT do Suporte e o detalhamento de avaliações disponibilizado pela origem.
- Rastreabilidade da Keila: entradas e saídas com cada movimentação, sem métricas de Qualidade/CSAT nesse relatório.
- O parcial da equipe às 12h é uma rotina separada.

## Restrições
- **Não** publicar o novo backend nem o Web App declarando anexos homologados se a função de testes não tiver sido executada.
- **Não** manipular flags de homologação manualmente.
- **Não** gerar/enviar mensagens em duplicidade para verificar aparência.
