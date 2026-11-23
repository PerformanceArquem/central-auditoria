# Sincronização de texto Unicode

Os logs do Ticket Manager registravam respostas 400 do PostgREST com a mensagem `Empty or invalid json` em lotes específicos, enquanto outros lotes eram gravados normalmente. O tamanho registrado no envio coincidia com o recebido no gateway, sem evidência de corpo vazio.

Uma reprodução sintética, apontada exclusivamente para uma tabela comprovadamente inexistente, diferenciou os casos: texto comum e emoji válido chegaram à resolução da tabela (`PGRST205`/404); um surrogate UTF-16 isolado produziu `PGRST102`/400. A mesma string após `toWellFormed()` foi aceita pelo parser e chegou ao 404 da tabela inexistente. Nenhum registro foi inserido nesses testes.

A API normaliza apenas valores de texto da cópia serializada antes do envio. Caracteres Unicode incompletos tornam-se U+FFFD, sem modificar o objeto original ou o cache do navegador. Texto válido, acentos, emojis completos e sequências de escape literais permanecem iguais. Nomes de campo e identificadores malformados são rejeitados antes de gravar, evitando alteração de identidade ou colisão de campos.

As respostas de gravação informam `normalizedUnicodeStrings`. Logs registram somente operação, contagem e código de erro seguro, sem conteúdo de chamados, tokens ou identidades. Permanecem os limites de lote, controle de acesso e confirmação de gravação existentes. A correção não adiciona tentativas automáticas de escrita nem mensagens.

Validação: `node --test tests/ticket-manager-api-diagnostics.test.mjs tests/audit-router.test.mjs tests/ticket-inspection-api.test.mjs tests/email-admin-ui.test.mjs` — 37 testes aprovados. As operações de escrita foram simuladas nos testes automatizados. A confirmação sobre os lotes reais depende dos logs das próximas sincronizações normais, sem forçar gravações de chamados para validar a correção.
