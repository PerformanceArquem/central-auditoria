# Chave global de envio de e-mails

A chave fica em **Gerenciar e-mails → Envio de e-mails**. A instalação inicia desligada.
Somente administradores ativos autenticados podem consultar e alterar o estado.

- O servidor consulta o estado antes da geração e imediatamente antes do envio.
- Relatórios, testes individuais, cobranças e Triagem usam o mesmo bloqueio.
- Estado ausente ou indisponível bloqueia o envio.
- Desligar pausa os agendamentos conhecidos, preservando frequências e destinatários.
- Ligar exige confirmação explícita e restaura somente os agendamentos ativos antes da pausa; não reenvia registros `failed`.
- Alterações são registradas em `audit_email_run_logs`, com controle de revisão concorrente.

O controle do Apps Script também exige a sessão JWT atual do administrador, verificada na ação administrativa existente. A credencial compartilhada de envio, sozinha, não permite ligar nem desligar a chave. Não gravar JWTs ou credenciais em arquivos ou logs.

Instalação do Apps Script: preservar a fonte instalada. Depois da autenticação do `doPost`, tratar `email_delivery_control` com `arquemEmailDeliveryControl_(dados,props)`; para outras ações de envio, bloquear enquanto `ARQUEM_EMAILS_PAUSED` for diferente de `false`. As ações de leitura `capabilities`, `triage_validate` e `voice_chat_preview` continuam disponíveis. O helper está em `apps-script/email-delivery-control-guard.gs`.

Banco: `ops/sql/email-delivery-control.sql`. RPC exposta somente ao papel interno `service_role`; a autorização do administrador é verificada na API antes da chamada. Nenhuma credencial privilegiada é entregue ao navegador.
