# Movidesk Incremental — Central de Auditoria

Piloto independente da importação histórica em `movidesk-direct-sync`.

## Pré-requisitos

- SQL `01_instalar.sql` já aplicado no Supabase. As RPCs `audit_incremental_claim` e `audit_incremental_finish`, mais a tabela `audit_incremental_state`, devem existir.
- Edge Function Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `MOVIDESK_TOKEN`, `CRON_SYNC_SECRET` e `SYNC_AUTOMATION_ENABLED`.
- O arquivo `supabase/config.toml` no repositório contém somente configuração desta função. Mescle com quaisquer outras configurações locais de produção antes de usar.

## Deploy manual

```powershell
npx supabase functions deploy movidesk-incremental-sync --project-ref dvaaicqajlppuigeyejr --no-verify-jwt
```

O GitHub não publica a função automaticamente. O endpoint não existirá até fazer o deploy no Supabase.

## Segurança

A verificação JWT do gateway está desligada, porém as ações `probe`/`status` exigem administrador autenticado via Supabase Auth e `audit_users`. `sync_next` também admite o segredo do Cron, que não deve ser enviado ao navegador ou commitado.

## Validação

1. Confirme a função em **Supabase → Edge Functions → Functions**.
2. Teste `probe` como administrador; não altera registros.
3. Confirme compatibilidade dos filtros OData (`lastUpdate`) com a API Movidesk do seu ambiente.
4. Teste **um único lote** `sync_next` e confirme checkpoint, upserts e horários.
5. Configure Cron incremental somente depois de validar, sem modificar o Cron do backfill.
6. Mantenha `REPORT_EMAIL_SEND_ENABLED=false` até importação histórica e incremento validados.

**Estado:** piloto não validado na API real de produção. Não ativar envio automático de e-mails ainda.
