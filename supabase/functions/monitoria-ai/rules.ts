// Fonte: Formulario_Monitoria_Atendimento.xlsx, aba Monitoria, linhas 9-53.
// Não alterar pesos sem uma nova versão aprovada da planilha. Códigos duplicados recebem IDs estáveis.
export const RULESET_VERSION = "monitoria-suporte-2026-11-17";
export const BLOCK_WEIGHTS = Object.freeze({1:15,2:40,3:15,4:30});
export const CRITICAL = Object.freeze([
  {
    "code": "Z1",
    "name": "Desrespeito",
    "description": "Faltou com respeito, empatia ou cordialidade com o cliente."
  },
  {
    "code": "Z2",
    "name": "Encerramento Indevido",
    "description": "Encerrou o chat sem a confirmação do cliente ou sem respeitar a regra de inatividade (15 min totais). (Ref: SUP 001)"
  },
  {
    "code": "Z3",
    "name": "Informação Prejudicial",
    "description": "Informou ou executou ações indevidas que prejudicaram o cliente ou a Arquem (ex: alterou regras fiscais sem aval contábil)."
  },
  {
    "code": "Z4",
    "name": "Negligência na Escalação",
    "description": "Negligenciou uma escalação ou não abriu o chamado necessário, travando a operação do cliente."
  }
]);
export const RULES = Object.freeze([
  {
    "id": "R01",
    "code": "1.1",
    "block": 1,
    "name": "SLA de Primeira Resposta",
    "description": "O agente enviou a primeira saudação humana dentro de 1 minuto após a resposta do Chatbot?",
    "chat": {
      "points": 5,
      "partial": null
    },
    "voice": {
      "points": null,
      "partial": null
    }
  },
  {
    "id": "R02",
    "code": "1.2",
    "block": 1,
    "name": "Confirmação de dados (Nome e CNPJ)",
    "description": "O agente questionou o nome da pessoa em contato e o CNPJ quando necessário?",
    "chat": {
      "points": 5,
      "partial": null
    },
    "voice": {
      "points": 7.5,
      "partial": null
    }
  },
  {
    "id": "R03",
    "code": "1.3",
    "block": 1,
    "name": "Atualização Cadastral",
    "description": "Coletou os dados atualizados da empresa em caso de identificação de divergências? Alterou corretamente os dados, mantendo como solicitante o cadastro completo do cliente? (Ref: SUP 002)",
    "chat": {
      "points": 5,
      "partial": 2.5
    },
    "voice": {
      "points": 7.5,
      "partial": 4
    }
  },
  {
    "id": "R04",
    "code": "2.1",
    "block": 2,
    "name": "Sondagem e Investigação",
    "description": "O agente fez as perguntas corretas (módulo, rotina, mensagem de erro) para tirar a generalização da fala do cliente antes de supor o problema? (Ref: SUP 003)",
    "chat": {
      "points": 12.5,
      "partial": 7.5
    },
    "voice": {
      "points": 12.5,
      "partial": 7.5
    }
  },
  {
    "id": "R05",
    "code": "2.2",
    "block": 2,
    "name": "Passo a passo de resolução",
    "description": "O agente foi assertivo e seguro nas soluções propostas, demonstrando ter seguido instruções da Intranet ou da liderança?",
    "chat": {
      "points": 12.5,
      "partial": 7.5
    },
    "voice": {
      "points": 12.5,
      "partial": 7.5
    }
  },
  {
    "id": "R06",
    "code": "2.3",
    "block": 2,
    "name": "Uso Correto de Ferramentas de Contorno",
    "description": "O agente tomou a decisão correta ao usar Acesso Remoto ou Ligação Ativa? Critério: se o cliente era leigo/complexo, ele ligou ou acessou? Se acessou, usou o ArqDesk/RustDesk corretamente e deixou o atalho na área de trabalho? (Ref: SUP 004 e SUP 005)",
    "chat": {
      "points": 10,
      "partial": 5
    },
    "voice": {
      "points": 10,
      "partial": 5
    }
  },
  {
    "id": "R07",
    "code": "2.3",
    "block": 2,
    "name": "Regra de Tempo / Pausas",
    "description": "O agente manteve o cliente informado durante as pausas de pesquisa? Respeitou o limite de 10 minutos (chat) /  5 minutos (telefone) e atualizou o cliente a cada 5 minutos (chat) / 2 minutos (telefone)? (Ref: SUP 001)",
    "chat": {
      "points": 5,
      "partial": null
    },
    "voice": {
      "points": 5,
      "partial": null
    }
  },
  {
    "id": "R08",
    "code": "3.1",
    "block": 3,
    "name": "Solução integral",
    "description": "O atendimento foi finalizado após resolver, esclarecer e encaminhar tudo que foi proposto pelo cliente?",
    "chat": {
      "points": 10,
      "partial": 7
    },
    "voice": {
      "points": 10,
      "partial": 7
    }
  },
  {
    "id": "R09",
    "code": "3.2",
    "block": 3,
    "name": "Despedida/Encerramento da conversa",
    "description": "Questionou se há algo mais em que possa ajudar? Ao receber a resposta de que não há mais nada, se despediu de forma cordial e mantendo a Arquem à disposição? Em caso de inatividade, utilizou corretamente os scripts de 5 e 15 minutos dentro das regras?",
    "chat": {
      "points": 5,
      "partial": 3
    },
    "voice": {
      "points": 5,
      "partial": null
    }
  },
  {
    "id": "R10",
    "code": "4.1",
    "block": 4,
    "name": "Título do chamado",
    "description": "O agente utilizou o padrão [RB/ACO] - [DESCRIÇÃO] - [ID/NOME LOJA] corretamente?",
    "chat": {
      "points": 5,
      "partial": null
    },
    "voice": {
      "points": 5,
      "partial": null
    }
  },
  {
    "id": "R11",
    "code": "4.2",
    "block": 4,
    "name": "Coleta de evidências",
    "description": "Se era um erro novo ou material desatualizado, o agente coletou prints e/ou vídeos para a criação de Documentação Intranet? (Ref: SUP 006) OU Se houve escalação, o agente reuniu todas as evidências necessárias para abertura de chamado?",
    "chat": {
      "points": 10,
      "partial": null
    },
    "voice": {
      "points": 10,
      "partial": null
    }
  },
  {
    "id": "R12",
    "code": "4.3",
    "block": 4,
    "name": "Ação Pública e Macro",
    "description": "O agente preencheu o resumo claro e utilizando a macro correta? Caso não tenha utilizado macro, há todas as informações pertinentes ao atendimento e/ou escalação?",
    "chat": {
      "points": 5,
      "partial": null
    },
    "voice": {
      "points": 5,
      "partial": null
    }
  },
  {
    "id": "R13",
    "code": "4.2",
    "block": 4,
    "name": "Tabulação e Destino do Ticket",
    "description": "Os campos obrigatórios (Motivo, Serviço, Categoria, Produto, Módulo) foram preenchidos corretamente? O status final está correto?",
    "chat": {
      "points": 10,
      "partial": 7
    },
    "voice": {
      "points": 10,
      "partial": 7
    }
  }
]);
export function rulesFor(channel) {
 if(!['chat','voice'].includes(channel))throw new Error('Canal inválido');
 return RULES.filter(r=>typeof r[channel].points==='number');
}
