# Homologação do fluxo matinal — proposta de 23/11/2026

Branch de testes. Nenhum cron, cadastro, dado, implantação ou envio real alterado.
Horários de Brasília. Esta entrega ainda NÃO encerra a homologação do fluxo completo.

| Marco | Comportamento esperado | Situação nesta branch |
| --- | --- | --- |
| 07h50 | Preparar dados e validar PDF/XLSX corporativos | Cron candidato; comparativos antecipados; exportação real antecipada ainda pendente |
| 08h40 | Validar destinatários, anexos e obrigatoriedades | Simulador admin somente leitura disponível; validação real do gerador pendente |
| 08h57 | Iniciar disparos controlados | Política 08h57–09h59, SQL candidato não aplicado |
| 09h00 | Conferir aceites, faltantes e erros | Consultas de diagnóstico; nenhuma confirmação de entrega final |
| Após 09h | Monitorar sem reenvios fora da janela | Guardas no backend e candidato Apps Script; alertas reais ainda não ativados |

## Implementado

- Guardas de horário na entrada e imediatamente antes da chamada ao provedor, com contexto isolado por requisição para não bloquear e-mails manuais.
- Guarda adicional no Apps Script após geração dos anexos e antes de MailApp.sendEmail; depende da publicação separada do gerador.
- Simulação `morning_simulation` protegida por administrador ativo, sem reservas, alterações ou chamada de e-mail. Lotes lógicos de oito; execução real continua serial (um relatório por chamada), preservando reservas atômicas existentes.
- Comparativos preparados no cache por até 15 minutos, vinculados à versão do cadastro; cobertura existente continua obrigatória. Configurações personalizadas e CSAT mantêm suas restrições atuais.
- Preparação limita duas tentativas caras por execução e 45 segundos antes de iniciar outra; reaproveita cobertura por período e consulta de estado histórico. Não interrompe uma operação já em andamento.
- Consulta de responsáveis em blocos de 20 IDs, sem repetição e sem retry de timeouts.
- Excel usa uma escrita em lote para horas dos clientes, preservando valores e apresentação; geradores de referência atualizados em conjunto.
- SQL candidato exige opt-in explícito, preserva comandos privados e desativa o cron tardio de retentativas somente quando for aplicado após revisão.

## Investigação somente leitura

No dia 23/11, o semanal de Alan registrou statement timeout na tabela de chamados; Carla (semanal) e Cassiano (diário) registraram timeout genérico. Esses registros não identificam de forma conclusiva a fase do provedor. Nenhum foi reaberto ou reenviado.

O segundo cadastro da Keila possui permissão exclusiva `production_flow`, enquanto o cadastro de Inteligência tem escopo diferente. Não é seguro excluir, fundir ou transformar um deles em relatório geral. A trilha especializada e os setores vinculados precisam ser confrontados com uma prévia real antes de qualquer correção cadastral.

O cron management-retry está ativo entre 10h e 17h. Esta branch prepara sua desativação; produção continua com a configuração existente.

## Critérios restantes para liberação

1. Reconciliar o código ativo da Edge e do Apps Script com o GitHub antes de substituir versões.
2. Implementar cache seguro dos ARQUIVOS PDF/XLSX no gerador, com invalidação por destinatário, permissão, conteúdo, modelo e período; hoje o cache contém dados, não arquivos exportados.
3. Executar geração real sem MailApp/GmailApp, inspecionar visualmente papel timbrado, horas, filtros, totais e comparativos.
4. Concluir validação automática das 08h40 e monitor das 09h00 com diagnóstico por fase; conferir cobertura e as duas inscrições da Keila.
5. Medir tempos reais, inclusive comparativo que ainda percorre o histórico de chamados; não afirmar resolução dos timeouts apenas pela redução de lote.
6. Homologar reservas concorrentes e estado ambíguo pós-provedor. `sent` significa aceite; não comprova entrega na caixa.
7. Revisar PR. Merge pode acionar deploy automático da Edge; não mesclar para testar. Publicação, cron e alertas reais são etapas separadas.

Não inserir comandos de cron com segredos, relatórios reais ou dados pessoais nos artefatos públicos da PR.
