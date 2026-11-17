import {buildComparisons,comparisonWindow,renderComparisons} from '../supabase/functions/audit-email-dispatch/report-comparisons.ts';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)};
const rec={scope:'management',sectors:['Inteligência'],daily_target_minutes:480,minimum_percent:80};
const ap=(date:string,ticket='1',sector='Inteligência',minutes=60)=>({appointment_date:date,ticket_id:ticket,sector,collaborator_name:'Keila',activity:'Análise',duration_minutes:minutes,created_at:'2026-11-17T13:00:00Z'});
const hist=(team:string,date:string,owner='Keila')=>({ownerTeam:team,changedDate:date+'T12:00:00Z',owner:{businessName:owner}});
Deno.test('hours use the appointment work date even when registered later',()=>{
 const result=buildComparisons(rec,[ap('2026-10-31'),ap('2026-11-10','2')],[],'2026-11-09','2026-11-15',new Set());
 assert(result.monthly[0].minutes===60&&result.monthly[1].minutes===60,'registration date moved historical hours');
 assert(result.monthly[1].partial,'current incomplete month must be labelled');
 assert(result.monthly[0].appointments===1,'old month count incorrect');
});
Deno.test('sector entries collapse same-team reassignment and deduplicate re-entry tickets',()=>{
 const tickets=[{ticket_id:'1',owner_histories:[hist('Suporte','2026-11-09'),hist('Inteligência','2026-11-10'),hist('Inteligência','2026-11-11','Outra pessoa'),hist('Suporte','2026-11-12'),hist('Inteligência','2026-11-13')]}];
 const data=buildComparisons(rec,[ap('2026-11-10')],tickets,'2026-11-09','2026-11-15',new Set());
 assert(data.sectors.length===1&&data.sectors[0].incoming===1,'re-entry inflated tickets or leaked sector');
 assert(data.monthly[1].incoming===1,'monthly entries incorrect');
});
Deno.test('quality and training counters use distinct tickets with dated activity',()=>{
 const data=buildComparisons({...rec,sectors:['Qualidade','Treinamento']},[
  ap('2026-11-10','1','Qualidade'),ap('2026-11-11','1','Qualidade'),ap('2026-11-12','2','Treinamento'),
  {...ap('2026-11-12','3','Qualidade'),activity:''},ap('2026-11-12','4','Suporte')
 ],[{ticket_id:'99',owner_histories:[hist('Qualidade','2026-11-10')]}],'2026-11-09','2026-11-15',new Set());
 assert(data.sectors.find(s=>s.sector==='Qualidade')?.incoming===1,'activity tickets double counted');
 assert(data.sectors.find(s=>s.sector==='Treinamento')?.incoming===1,'training ticket missing');
 assert(data.sectors.every(s=>s.basis.includes('atividade')),'wrong count basis');
});
Deno.test('individual scopes do not reveal another collaborator or sector',()=>{
 const data=buildComparisons({...rec,scope:'sector',collaborator_name:'Keila'},[
  ap('2026-11-10'),{...ap('2026-11-11','2'),collaborator_name:'Outra pessoa'},ap('2026-11-11','3','Suporte')
 ],[{ticket_id:'2',owner_histories:[hist('Inteligência','2026-11-11','Outra pessoa')]}],'2026-11-09','2026-11-15',new Set());
 assert(data.monthly[1].appointments===1&&data.monthly[1].incoming===0,'privacy scope leaked');
});
Deno.test('month boundaries handle January and weekly rows partition the same two months',()=>{
 const window=comparisonWindow('2027-01-05');assert(window.previous==='2026-12-01','January boundary wrong');
 const data=buildComparisons(rec,[ap('2026-12-31'),ap('2027-01-01','2')],[],'2027-01-01','2027-01-05',new Set(['2027-01-01']));
 assert(data.weekly.reduce((n,r)=>n+r.minutes,0)===120,'weekly partitions double count or omit hours');
 assert(data.monthly[1].referenceMinutes===960,'holiday reference incorrect');
});
Deno.test('unavailable history stays explicit; malicious labels are escaped',()=>{
 const data=buildComparisons({...rec,sectors:['<img src=x>']},[ap('2026-11-10','1','<img src=x>')],[{ticket_id:'1',sector:'<img src=x>',owner:'Keila'}],'2026-11-09','2026-11-15',new Set(),false);
 const section=renderComparisons(data);assert(!data.historyComplete,'missing coverage hidden');
 assert(!section.html.includes('<img src=x>')&&section.html.includes('&lt;img'),'unescaped label');
 assert(section.html.includes('incompleto'),'coverage warning absent');
});
