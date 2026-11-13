# Central de Auditoria — GitHub Actions + clasp

## Objetivo
Conectar o GitHub ao projeto Apps Script **Central de Auditoria - Emails** (`1WUhIenOGO-B_jAkYgECmpBq-jMeeFrTghwElVyBdKLTTICWnFzgkWmm8`) sem sobrescrever scripts de Produção, Suporte, Inteligência e as rotinas atuais de 09h.

**O workflow não é automático em produção.** `audit` é somente leitura. `publish` exige revisão humana, duas hashes corretas e uma árvore completa de fontes reconciliadas. Publicar o código com `clasp push` **não** atualiza a implantação /exec atual: essa segunda etapa só ocorrerá depois de homologar o PDF e o Excel no editor do Google.

## Configuração inicial (sem compartilhar credenciais no chat)
1. Em https://script.google.com/home/usersettings, ative **Google Apps Script API** na conta proprietária/que tenha permissão de edição do projeto.
2. Em um computador confiável, com Node.js >= 20, execute `npm install -g @google/clasp@3.4.1` e `clasp login`. Autorize a Conta Google que gerencia o projeto. O arquivo local `~/.clasprc.json` contém **refresh token** e deve permanecer privado.
3. No GitHub, entre em `PerformanceArquem/central-auditoria` → **Settings → Secrets and variables → Actions → Secrets** e crie `CLASPRC_JSON` com o conteúdo integral do arquivo `~/.clasprc.json`. **Nunca** coloque esse JSON em código, issue, chat, imagem ou log.
4. Em **Settings → Environments**, crie o ambiente **`apps-script-production`**, configure revisores obrigatórios (quando disponível no plano do repositório) e restrinja a branch **main**. Se a proteção por revisores não estiver disponível, **não habilite a publicação**; use apenas a auditoria.
5. Na variável de ambiente `apps-script-production` crie `APPS_SCRIPT_RELEASE_ENABLED` com valor **false**. Passe para **true** somente após revisão completa do projeto original, da origem reconciliada e do plano de reversão.

## Primeira execução — somente auditoria
1. Revise a PR #68 e faça merge da configuração de CI **somente depois da revisão do workflow**. O evento manual `workflow_dispatch` precisa estar registrado na branch padrão para aparecer em **Actions**.
2. Em Actions, escolha **Apps Script - audit and manual approved publish** → **Run workflow** → selecione `main`, operação **audit**.
3. A auditoria usa `clasp pull` e publica no resumo do job o **inventário de arquivos** e a **SHA-256** do código remoto. Ela não altera o Apps Script e não envia e-mails.
4. Compare o inventário com o editor do Google. Registre a versão ativa da implantação `/exec` e preserve backup seguro do código original.

## Preparar origem para publicação
1. A pasta `apps-script/deploy-source/` **não é criada automaticamente**: até sua existência, o job publish falha de forma segura.
2. Após preservar backup privado, faça a reconciliação completa de todas as fontes do projeto. Não misture o pacote completo com uma segunda cópia da extensão, nem apague `Código.gs`, `ZenviaVozChat.gs`, `intelligence-triage-mail.gs` ou outros scripts sem prova de que foram incorporados.
3. Submeta as fontes completas e reconciliadas para revisão no GitHub, **sem segredos**. Verifique duplicidades (especialmente `doPost` e `arquemCreateReportAttachments_`).
4. Calcule SHA-256 da origem usando o mesmo algoritmo de `apps-script/ci-clasp-guard.mjs` (modo audit em cópia local controlada). Confirme que todos os nomes dos arquivos coincidem exatamente com o inventário remoto.

## Publicação com aprovação
1. Execute **Run workflow → publish** na branch `main`, com a SHA-256 remota da auditoria e SHA-256 da origem aprovada.
2. O GitHub só poderá avançar depois da **aprovação manual** do ambiente `apps-script-production`, variável `APPS_SCRIPT_RELEASE_ENABLED=true` e testes aprovados.
3. Antes de enviar, o workflow baixa novamente o Apps Script. Bloqueia se qualquer arquivo remoto mudou, se a origem aprovada mudou ou se a lista de arquivos difere. Em seguida, faz `clasp push --force` e cria **nova versão**, mas **não edita a implantação Web App**.
4. No editor do Apps Script, execute `arquemHomologarVozChatSemEnvio()`, examine os dois arquivos sintéticos de PDF e Excel e só depois execute `arquemAprovarHomologacaoVozChatSemEnvio()`.
5. Confirme capacidades e métricas reais antes de atualizar manualmente a **implantação existente**, preservando a URL /exec e os envios das 09h.

## Reversão
Se os arquivos ou dados estiverem incorretos, mantenha a implantação /exec no número de versão antigo e não habilite as flags Zenvia no Supabase. Se houve atualização do código remoto, restaure as fontes a partir do backup privado antes de novas alterações. Nunca exponha `MAIL_SECRET`, tokens Movidesk, Zenvia ou credenciais OAuth.

## Restrições importantes
- O controle de revisão no GitHub só é efetivo se a proteção de ambiente e branch estiver configurada pelo administrador.
- Os secrets são necessários para o job de auditoria; o workflow **não gera credenciais**.
- `clasp push` reescreve o código remoto: não usar a origem parcial da PR #68 diretamente no projeto com vários arquivos.
- A implantação `/exec` exige homologação e alteração consciente após a atualização do código.
