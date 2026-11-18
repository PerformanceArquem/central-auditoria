// Project metrics are based exclusively on workTime recorded in Movidesk.
// The daily goal mirrors the Projects and Deadlines module; forecast is optional.
export const isProjectChargeSubject=(value:unknown):boolean=>
  /^\s*P\s*\*\*/i.test(String(value||''));
export type ProjectWorkRow={appointment_date?:unknown;duration_minutes?:unknown};
export type ProjectGoalStatus='Abaixo da meta'|'Meta cumprida'|'Estourou';
export function projectChargeMetrics(rows:ProjectWorkRow[],dailyGoalHours:number,
  periodFrom?:string,periodTo?:string,forecastHours?:number|null){
 if(!Number.isFinite(dailyGoalHours)||dailyGoalHours<=0||dailyGoalHours>24)
  throw Error('Meta diária do projeto inválida.');
 const byDate=new Map<string,number>();
 let totalMinutes=0;
 for(const row of rows){
  const date=String(row.appointment_date||'');
  const minutes=Number(row.duration_minutes);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(minutes)||minutes<=0)continue;
  totalMinutes+=minutes;
  if((!periodFrom||date>=periodFrom)&&(!periodTo||date<=periodTo))
   byDate.set(date,(byDate.get(date)||0)+minutes);
 }
 const buckets={below:0,onTarget:0,above:0};
 for(const m of byDate.values()){
  const hours=m/60;
  if(hours<dailyGoalHours-0.25)buckets.below++;
  else if(hours>dailyGoalHours+0.25)buckets.above++;
  else buckets.onTarget++;
 }
 const activeDays=byDate.size;
 const periodMinutes=[...byDate.values()].reduce((a,b)=>a+b,0);
 const avgDailyHours=activeDays?periodMinutes/60/activeDays:null;
 const avgStatus:ProjectGoalStatus|null=avgDailyHours===null?null:
   avgDailyHours<dailyGoalHours-0.25?'Abaixo da meta':
   avgDailyHours>dailyGoalHours+0.25?'Estourou':'Meta cumprida';
 const forecast=typeof forecastHours==='number'&&Number.isFinite(forecastHours)&&forecastHours>0?forecastHours:null;
 const usedHours=totalMinutes/60;
 return {dailyGoalHours,periodFrom:periodFrom||null,periodTo:periodTo||null,
  periodMinutes,activeDays,averageDailyHours:avgDailyHours,averageStatus:avgStatus,
  belowDays:buckets.below,withinDays:buckets.onTarget,aboveDays:buckets.above,
  totalMinutes,forecastHours:forecast,
  differenceHours:forecast===null?null:forecast-usedHours,
  percentUsed:forecast===null?null:usedHours/forecast*100,
  budgetStatus:forecast===null?'Sem previsão':usedHours>forecast?'Estourou':
    usedHours>=forecast*0.9?'Quase no limite (90% ou mais)':'Dentro da previsão'};
}
