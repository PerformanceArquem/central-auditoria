# Homologação do GitHub Pages

O repositório é público e pode usar GitHub Pages no plano Free. O endereço previsto é https://performancearquem.github.io/central-auditoria/. Esse caminho compartilha a origem do navegador com todos os projetos Pages da conta. A Central guarda sessão e dados de trabalho no navegador. Antes de usar credenciais reais, confirmar o controle exclusivo dessa origem ou configurar domínio dedicado e ajustar o cliente e as origens permitidas nos servidores.

A Central alterna painéis no navegador. O pacote mantém as âncoras, links com query string e a página física `confirmar-leitura.html`. Os recursos e módulos têm caminhos relativos. As rotas desconhecidas podem retornar 404. Para montar o pacote em uma pasta vazia, executar `node scripts/build-pages.mjs <pasta>`. Publicar somente essa pasta após homologação.

A Vercel continua executando APIs de autenticação auxiliar, Movidesk, Ticket Manager, previsão, inspeção, produção, comparações e Zenvia. O CORS usa a origem prevista e os endpoints necessários. Os tokens de provedores e as chaves de serviço continuam no backend. Links de gravação e de e-mails existentes continuam com a URL da Vercel durante a transição. A retirada posterior da Vercel exige um backend substituto e tratamento desses links e demais consumidores.

O login Supabase atual usa e-mail e senha, com detecção de sessão por URL desativada. O fluxo atual dispensa callback. Se OAuth, convites ou recuperação de senha precisarem retornar ao Pages, validar o fluxo e incluir somente as URLs exatas em Supabase Auth → URL Configuration. Preservar o Site URL atual durante a homologação.

## Antes de publicar

1. Conferir isolamento da origem, acesso anônimo, políticas de dados, RPCs e papéis. Validar preflights e respostas CORS da Vercel com a origem aprovada, preservando a autenticação por Bearer.
2. Homologar as mudanças de origem nas funções Supabase `audit-ai-reports` e `audit-read-receipt`. Para `audit-email-dispatch`, acrescentar a origem aprovada ao valor atual de `REPORT_ALLOWED_ORIGINS`. Preservar as origens existentes. Validar login, recarga, logout e leitura de Movidesk, Zenvia e Supabase com conta de teste.
3. Conferir visualmente prévias corporativas reais, PDF e Excel, inclusive anexos do Apps Script, sem enviar e-mail. Preservar propriedades, acionadores, destinatários, agendamento e controle de duplicidade. Validar confirmação de leitura com dados descartáveis ou simulados.
4. Configurar GitHub Pages com GitHub Actions e publicar somente o pacote depois da aprovação. Conferir o endereço atribuído pelo GitHub, HTTPS, recursos estáticos e links diretos. Manter a Vercel e o monitoramento existentes durante o corte e até validar os substitutos.
