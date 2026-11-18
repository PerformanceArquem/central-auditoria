import {calculateJourneyGaps} from '../supabase/functions/audit-email-dispatch/journey-gaps.ts';

const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message)};

Deno.test('saldo positivo da meta mínima permanece visível',()=>{
  // 07:37 apontadas, mínimo 06:24 e jornada 08:00
  const result=calculateJourneyGaps([457],480,384);
  assert(result.minimumBalanceMinutes===73,'saldo mínimo deveria ser +01:13');
  assert(result.targetBalanceMinutes===-23,'saldo jornada deveria ser -00:23');
  assert(result.minimumGapMinutes===0,'campo histórico de falta deve continuar zero');
  assert(result.targetGapMinutes===23,'falta jornada existente deve continuar 23');
});

Deno.test('saldos abaixo das duas referências são negativos',()=>{
  const result=calculateJourneyGaps([300],480,384);
  assert(result.minimumBalanceMinutes===-84,'saldo mínimo incorreto');
  assert(result.targetBalanceMinutes===-180,'saldo jornada incorreto');
});

Deno.test('saldos iguais à meta e acima da jornada',()=>{
  const exactlyMinimum=calculateJourneyGaps([384],480,384);
  const aboveJourney=calculateJourneyGaps([525],480,384);
  assert(exactlyMinimum.minimumBalanceMinutes===0,'meta exata deve ser zero');
  assert(aboveJourney.minimumBalanceMinutes===141,'superávit mínimo incorreto');
  assert(aboveJourney.targetBalanceMinutes===45,'superávit jornada incorreto');
});

Deno.test('equipe preserva déficits individuais sem compensar falta por excesso',()=>{
  const result=calculateJourneyGaps([300,600],480,384);
  assert(result.minimumGapMinutes===84,'falta individual não pode ser anulada');
  assert(result.targetGapMinutes===180,'falta jornada individual não pode ser anulada');
  assert(result.minimumBalanceMinutes===132,'saldo consolidado assinado incorreto');
  assert(result.targetBalanceMinutes===-60,'saldo consolidado assinado incorreto');
});
