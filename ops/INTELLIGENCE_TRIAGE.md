# Triagem da Inteligência

Destinatários exclusivos deste relatório: Cassiano (zanona@arquem.com.br), Keila (inteligencia.gerencia@arquem.com.br), Cristiano/Direção (canestraro@arquem.com.br). Kassio permanece com suas outras rotinas; não recebe esta edição.

Critério aprovado em 13/11/2026: T1–T4 abertos, equipe Inteligência, serviço Triagem, mais de 15 dias corridos desde o início da permanência contínua atual na equipe. Trocas de responsável dentro da mesma equipe não reiniciam o prazo. A origem é a API Movidesk, com listagem paginada e detalhes/históricos atuais; o relatório não depende apenas do cache sincronizado.

O backend isolado é intelligence-triage-report. Usa REPORT_CRON_SECRET para autenticação, MOVIDESK_TOKEN para leitura e as configurações já existentes do Gmail Web App. Nenhuma credencial é armazenada no repositório. Snapshots, hashes e registros de envio ficam em tabelas com RLS e acesso exclusivo de service_role.

Horário: 09h America/Sao_Paulo, segunda a sexta; feriados com affects_delivery no calendário corporativo são respeitados. O job independente começa inativo. Não alterar os jobs antigos para habilitar este relatório.

Idempotência: chave única por data e destinatário. Estados processing/uncertain exigem conferência no Gmail antes de qualquer repetição. Não apagar linhas para tentar de novo sem conferir o provedor. O Web App acrescenta outro controle por Script Properties e consulta Gmail antes do envio.

## Publicação do e-mail

O workflow deploy-intelligence-triage.yml baixa o projeto Apps Script existente, reconhece o ponto de autenticação e acrescenta a extensão sem substituir os geradores dos demais relatórios. Falha antes de escrever quando não reconhece a instalação. A versão do clasp é fixa.

Em 13/11/2026 a primeira execução parou no clasp pull com invalid_grant / invalid_rapt (reauthentication required), antes de qualquer push/deploy do Apps Script. É necessário renovar a autenticação da conta proprietária e atualizar a credencial protegida CLASPRC_JSON no GitHub. Não colocar credenciais em issues, chats ou arquivos do repositório.

Após renovar: executar o workflow; chamar a ação validate no backend para gerar PDF/XLSX sem envio; conferir anexos; testar send com snapshotId válido e confirmar Gmail. Somente então ativar o job intelligence-triage-weekdays-09h. A primeira edição manual utiliza o mesmo registro diário de idempotência.

