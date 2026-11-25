export function calculateSchedule(id,time,lead){
  if(!['forecast','idle','triage','individual','team','partial'].includes(id))throw Error('Regra desconhecida.');
  if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)||!Number.isInteger(lead)||lead<1||lead>120)throw Error('Informe horários válidos e antecedência de 1 a 120 minutos.');
  const [h,m]=time.split(':').map(Number),start=h*60+m-lead;
  if(start<0)throw Error('A preparação deve ocorrer no mesmo dia do disparo.');
  if(id==='partial'&&start<710)throw Error('A parcial preserva o período até 11h50; a preparação não pode começar antes desse horário.');
  return {time,prepare:String(Math.floor(start/60)).padStart(2,'0')+':'+String(start%60).padStart(2,'0'),reference:id==='partial'?'Hoje, 09h–11h50':id==='individual'||id==='team'?'Dia anterior':'Situação atual dos chamados'};
}
