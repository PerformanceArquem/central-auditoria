# Padrão obrigatório dos relatórios da Central de Auditoria

Todo relatório novo ou alterado deve seguir o padrão corporativo já aprovado, no corpo do email, PDF e Excel. Não criar um modelo simples independente.

- Email: cabeçalho ARQUEM SISTEMAS / Central de Auditoria, azul institucional, cartões de indicadores, tabelas legíveis, rodapé corporativo e versão em texto simples.
- PDF e Excel: modelo corporativo, títulos e períodos claros, nomes das pessoas, unidades corretas, dados e permissões consistentes com o email.
- Datas e horários em português, no fuso America/Sao_Paulo. Não expor timestamps UTC ou detalhes técnicos ao destinatário.
- Antes de publicar, testar os dados e conferir visualmente uma prévia real sem enviar email. Preservar destinatários, agendamentos e prevenção de duplicidades.

Referências de implementação: `reportEmailHtml` em `supabase/functions/audit-email-dispatch/index.ts` e `triagePresentation` em `supabase/functions/intelligence-triage-report/presentation.ts`.
