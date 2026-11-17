import {RULES,CRITICAL,rulesFor} from "./rules.ts";
import {evaluate} from "./scoring.ts";

Deno.test("pesos totais correspondem à planilha para chat e telefonia",()=>{
 for(const channel of ['chat','voice'] as const){
  const sum=rulesFor(channel).reduce((n,r)=>n+(r[channel].points??0),0);
  if(sum!==100)throw Error(channel+" deve totalizar 100, obteve "+sum);
 }
 if(RULES.length!==13||CRITICAL.length!==4)throw Error("Critérios divergentes da planilha");
});

Deno.test("códigos duplicados têm identificadores internos únicos",()=>{
 const ids=RULES.map(r=>r.id);
 if(new Set(ids).size!==ids.length)throw Error("IDs repetidos");
 if(RULES.filter(r=>r.code==='2.3').length!==2||RULES.filter(r=>r.code==='4.2').length!==2)
  throw Error("Códigos originais da planilha foram perdidos");
});

Deno.test("nao verificável jamais gera desconto definitivo",()=>{
 const result=evaluate('chat',[{id:'R01',decision:'nao_conforme',evidence:'Trecho inventado'}],[],'Conversa de teste sem evidencia');
 if(result.criteria[0].decision!=='nao_verificavel'||result.criteria[0].deducted!==0||!result.incomplete||!result.provisional)
  throw Error("Reprovação sem trecho literal não pode causar desconto");
});

Deno.test("descontos aplicam modalidade e valor parcial da planilha",()=>{
 const transcript='Atendimento: dúvidas de cadastro. Fim.';
 const result=evaluate('chat',[{id:'R03',decision:'parcial',evidence:'dúvidas de cadastro'}],[],transcript);
 if(result.scoreSuggestion!==97.5)throw Error("Desconto parcial incorreto: "+result.scoreSuggestion);
});

Deno.test("falha crítica fundamentada sugere zero mas exige revisão humana",()=>{
 const transcript='Agente: vou encerrar este atendimento imediatamente.';
 const result=evaluate('voice',[],[{id:'Z2',decision:'nao_conforme',evidence:'vou encerrar este atendimento imediatamente'}],transcript);
 if(result.scoreSuggestion!==0||!result.criticalFlag||!result.requiresHumanApproval)
  throw Error("Falha crítica não sinalizada para revisão");
});

Deno.test("falha crítica sem evidência não zera a nota",()=>{
 const result=evaluate('chat',[],[{id:'Z1',decision:'nao_conforme',evidence:'trecho inexistente'}],'Bom dia. Como posso ajudar?');
 if(result.scoreSuggestion!==100||result.criticalFlag)throw Error("Zeramento sem evidência");
});
