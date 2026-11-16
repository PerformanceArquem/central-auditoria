# Publicação controlada — Apps Script Voz × Chat

**Projeto oficial:** [Central de Auditoria - Emails](https://script.google.com/d/1WUhIenOGO-B_jAkYgECmpBq-jMeeFrTghwElVyBdKLTTICWnFzgkWmm8/edit)

**Branch de homologação:** `integration/zenvia-voice-chat-reports-20261112` (PR #68). **Não publicar diretamente a branch na Vercel nem substituir a Edge Function v139 do Supabase.**

## 1. Preservar o sistema atual
1. No editor Apps Script, anotar a versão de implantação ativa e manter cópia recuperável da versão atual do código e dos recursos de configuração; não copiar valores de segredos em issues, mensagens ou Git.
2. Confirmar que o projeto possui `MAIL_SECRET` e `ARQUEM_PAPEL_TIMBRADO_DOC_ID` nas propriedades de script. Não alterar os valores existentes.
3. Se o projeto Apps Script contém módulos/adaptações locais além do arquivo do GitHub, comparar e preservar essas rotinas. Não substituir cegamente o projeto inteiro.

## 2. Atualizar o gerador
1. Obter `apps-script/central-auditoria-emails-completo.gs` da branch da PR #68; comparar com o projeto Apps Script atual e aplicar apenas as alterações reconciliadas.
2. Não adicionar `arquem-relatorios-anexos.gs` **também** ao mesmo projeto se o pacote completo já inclui suas funções: isso pode duplicar nomes e produzir comportamento inesperado.
3. Salvar o código, mas **não atualizar o deployment Web App ainda**.

## 3. Gerar amostras sem envio
1. No editor, executar `arquemHomologarVozChatSemEnvio()` com autorização Drive/Docs/Sheets.
2. Confirmar `ok:true`, `sent:false`, `ready:false`, `pendingVisualReview:true`.
3. Abrir os dois links de amostras criados no Drive. Conferir logo/timbrado, leitura das tabelas, PDF íntegro, e as abas do XLSX `Voz e Chat`, `Voz por dia`, `Voz por ramal` e `Metodologia canais`.
4. Conferir TMA/TME como duração, CSAT (notas 8–10 positivas; 1–7 negativas), e **indisponível** quando não houver amostras. Os números nesta etapa são **sintéticos**; não representam o atendimento real.

## 4. Aprovar apenas após revisar
1. Só depois da inspeção, executar `arquemAprovarHomologacaoVozChatSemEnvio()`.
2. Confirmar `visualReviewApproved:true` e `sent:false`.
3. Verificar que `arquemCapacidadesAnexos_()` anuncia `zenviaVoiceReady:true`, `zenviaVoiceVersion:'arquem-voice-chat-v1'`, formatos `pdf` e `xlsx` e papel timbrado válido.
4. Criar nova versão de implantação e atualizar o Web App existente, preservando seu URL, configuração de acesso, executante e segredo.

## 5. Gate antes do Supabase
- Confirmar com teste autorizado e dados reais que as quatro saídas (Kassio Suporte, Carla Suporte, Cristiano Executivo e Cristiano Suporte) recebem PDF e XLSX com a mesma seção Voz × Chat do corpo do e-mail.
- Conferir que a conta Zenvia inteira não seja apresentada como apenas Suporte; conferir os ramais homologados e TME de fila **apenas quando houver medições completas**.
- Confirmar a credencial Zenvia nos Secrets do Supabase, sem copiar ou expor tokens.
- Reconciliar e testar a Edge `audit-email-dispatch` v139 antes de qualquer substituição. Habilitar as flags de voz apenas após teste ponta a ponta, em janela que não comprometa os cron de 09h.

## Reversão
Se houver erro ou anexos incompletos, não ativar as flags. Reverter o Web App à implantação anterior. **Não mexer nas tabelas, disparos em andamento ou cron do Supabase.**

> Este documento descreve execução no editor oficial. Os testes do GitHub não são evidência de publicação do Google Apps Script ou recebimento dos e-mails em produção.
