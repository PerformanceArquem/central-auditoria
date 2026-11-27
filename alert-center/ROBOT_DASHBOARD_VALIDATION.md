# Validação do painel do Robô Fiscalizador

Consulta realizada em 27/11/2026 às 09h12 (Brasília), em modo somente leitura, no projeto da Central de Auditoria. Branch local: `feat/robot-dashboard-filters-20261127`. Sem publicação ou alteração em integrações.

## Dados conferidos

Foi consultada a seleção usada pelo endpoint `alert-center-triage-preview`: chamados abertos da Inteligência em Em Análise, com os mesmos filtros de encerramento, cancelamento e exclusão. Os históricos importados foram processados localmente por `evaluateImportedTriage`, `triageRobotSnapshot` e `consolidateRobot`, com limite de três dias úteis e os feriados cadastrados.

| Resultado | Chamados |
| --- | ---: |
| Total da seleção | 25 |
| Atingiram o limite e têm histórico validado | 5 |
| Abaixo do limite | 4 |
| Para revisão: histórico desatualizado | 16 |

O painel consolidou cinco ocorrências de acompanhamento e 16 chamados para revisão. Os quatro chamados abaixo do limite não entraram nas cobranças. Nenhum chamado para revisão entrou na lista de cobrança. As combinações de filtros preservaram as contagens e o conjunto consultado.

## Responsáveis

A seleção importada contém 24 chamados com `owner` nulo e um com identidade informada. Este último estava abaixo do limite; portanto, os 21 chamados exibidos nas tabelas do painel não tinham identidade informada na consulta. Isso não comprova ausência de responsável no Movidesk. O painel explicita a ausência do dado e preserva o identificador quando ele está disponível, sem inferir nomes.

## Limites da validação

- A primeira etapa usou a base importada e processamento local. A conferência autenticada posterior está registrada abaixo.
- O novo botão `Exibir consulta no painel do robô` permanece apenas na branch local. A consulta administrativa e a prévia existentes foram validadas na versão oficial, mas o novo botão ainda não foi homologado em um ambiente publicado de testes.
- O painel oferece somente o escopo da triagem consultada; os cartões não representam uma auditoria completa de todos os setores.
- A versão permanece local. Nenhuma mensagem, reserva, gravação de chamado, alteração de e-mail ou publicação foi realizada.

Os testes automatizados cobrem separação de revisão, filtros, responsáveis, prazo da consulta, invalidação da sessão e resposta tardia. A conferência visual local usa dados fictícios e não substitui a homologação autenticada.

## Conferência autenticada posterior — 27/11/2026

Na página oficial da Central de Alertas, a ação `Consultar triagem real` concluiu com sessão administrativa e reproduziu os totais da base importada: 25 consultados, cinco acima do limite, quatro abaixo e 16 para revisão.

A ação `Conferir históricos antigos no Movidesk` validou diretamente 13 históricos. Os dois chamados ainda pendentes de consulta individual foram conferidos pelos respectivos botões `Conferir #`. O resultado final foi:

| Resultado após conferência direta | Chamados |
| --- | ---: |
| Total consultado | 25 |
| Acima do limite com histórico validado | 18 |
| Abaixo do limite | 4 |
| Para revisão: resposta 404 da API | 3 |

Os chamados 81901, 91853 e 92989 retornaram 404. Isso não comprova exclusão ou encerramento; eles permanecem para revisão e fora da prévia gerencial. Nenhuma nova tentativa automática foi adicionada.

A ação `Preparar prévia gerencial` confirmou 18 chamados para avaliação e três para revisão de dados. A conferência direta vale somente para a consulta atual: não atualiza a base importada, não envia mensagens e não cria reservas. Recarregar a base recupera os históricos importados.

Nenhuma publicação da branch local foi realizada. A validação autenticada desta etapa se refere à consulta de triagem e à prévia já existentes na versão oficial.
