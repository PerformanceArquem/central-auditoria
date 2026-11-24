# Central 2.0 — validação da PR #203

Data: 24/11/2026. Branch: codex/central-2-workspace-responsive-20261124.

## Escopo conferido

Prévia HTTP local isolada, com o menu e barra extraídos do index.html e os arquivos ui/workspace.css e ui/workspace.js da proposta. Indicadores, filtros e tabela foram preenchidos com dados fictícios. Nenhuma integração, autenticação ou API de produção foi executada.

- Desktop: botão recolhe o menu; recarregamento preserva a preferência; botão reabre o menu.
- Ctrl+K: foco na busca de módulos.
- Celular, viewport 390 × 844: filtros em uma coluna e indicadores em duas colunas, sem transbordamento horizontal da página na prévia (scrollWidth 375; innerWidth 390).
- Menu móvel: abertura pelo botão, busca “voz” encontra Métricas de Voz na categoria Auditorias, Escape fecha o menu e devolve o foco ao botão.
- Retorno ao desktop: estado do botão e menu sincronizados. Override de viewport removido ao terminar.
- GitHub Actions: Validate workspace performance aprovado para d972bf15cef231e63dd0212f0b5456c31c93d071, execução 45464594441.
- Checagem de sintaxe e sete verificações de estado com DOM simulado aprovadas na implementação inicial.

## Limites e liberação

Esta validação cobre apresentação e controles compartilhados em uma prévia com dados fictícios. Não substitui homologação de todos os painéis com sessão autenticada, dados reais, exportações e impressão. A tabela demonstrativa não tem volume suficiente para validar rolagem vertical longa.

A PR permanece em rascunho. Sem merge, publicação, alteração de cron, destinatários ou envio real.

## Correção de foco — continuação

Abertura do menu no celular agora foca a busca. Seleção de módulo no celular fecha o menu e foca o primeiro título h2/h3 do painel, com fallback para o botão do menu. Mudança de breakpoint devolve o foco ao botão se o elemento ativo estava no menu que foi ocultado.

Verificado no navegador na prévia isolada: abertura foca workspaceNavSearch; seleção de Visão geral foca H2 e fecha o menu; desktop para 390×844 com foco na busca passa foco a workspaceMenuToggle com aria-expanded=false. Sintaxe e as sete verificações locais anteriores continuam aprovadas. A prévia só representa o painel demonstrativo; integração com todos os módulos reais segue pendente.
