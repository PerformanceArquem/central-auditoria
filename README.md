# central-auditoria

## Publicação em produção pela Vercel CLI (GitHub Actions)

Workflow: [Publicar Central de Auditoria pela Vercel CLI](.github/workflows/vercel-cli-production.yml).

A publicação usa o projeto Vercel existente `central-auditoria`, a equipe Arquem e o domínio de produção já configurado. Nenhuma alteração é feita no banco Supabase ou na configuração do Apps Script por este workflow.

1. Em **GitHub → Settings → Environments**, configure o ambiente `production` com restrição à branch `main` e, quando disponível, revisão obrigatória para implantação.
2. Em **Settings → Secrets and variables → Actions → Secrets** (ou nos Secrets do ambiente `production`), crie `VERCEL_TOKEN` com um token de acesso à equipe/projeto. Nunca inclua o token em arquivos, commits, issues ou mensagens.
3. Em **Settings → Secrets and variables → Actions → Variables**, crie `VERCEL_CLI_ENABLED` com o valor `true` **somente depois** de revisar o acesso e as proteções. O valor ausente ou diferente de `true` mantém as execuções ignoradas.
4. Para disparar manualmente, vá a **Actions → Publicar Central de Auditoria pela Vercel CLI → Run workflow**, na branch `main`.
5. Confira os logs e a URL produzida pela etapa de implantação. **As alterações no GitHub não publicam automaticamente**: execute `Run workflow` apenas quando desejar liberar uma versão consolidada.

O workflow utiliza `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` específicos já conferidos para esse projeto, fixa a versão da CLI e valida o vínculo antes de fazer o deploy. O token fica restrito às etapas de autenticação. **A Vercel CLI não contorna limites da conta:** se continuar retornando erro 402, resolva a limitação do plano/cota e execute o workflow novamente, sem repetir tentativas automáticas.

**Uma única rota de deploy:** o arquivo [`vercel.json`](vercel.json) define `git.deploymentEnabled: false` para impedir novas implantações automáticas da integração Git. A publicação para a Vercel fica concentrada no workflow **manual** GitHub Actions + CLI. Os testes do GitHub e o deploy independente da Edge Function no Supabase não mudam. Essa configuração não elimina a cota da Vercel; uma publicação manual pode continuar sujeita ao erro 402 quando o limite já estiver atingido.
