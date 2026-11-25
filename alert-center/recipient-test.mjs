import {calculateSchedule} from './schedule.mjs';
const rules=['forecast','idle','triage','individual','team','partial'];
const defaults={forecast:'08:30',idle:'08:30',triage:'08:30',individual:'09:00',team:'09:00',partial:'12:00'};
export function simulateRecipient({profile,selectedRules=rules,times={},lead=10}){
  if(!profile||profile.active!==true||typeof profile.movideskPersonId!=='string'||!profile.movideskPersonId.trim())throw Error('Selecione um colaborador ativo com ID Movidesk validado.');
  if(!Array.isArray(selectedRules)||!selectedRules.length||selectedRules.some(r=>!rules.includes(r)))throw Error('Selecione regras válidas.');
  return [...new Set(selectedRules)].map(rule=>({rule,recipientId:profile.movideskPersonId,schedule:calculateSchedule(rule,times[rule]??defaults[rule],lead),status:'simulated',deliveryEnabled:false,fixtureOnly:true}));
}
