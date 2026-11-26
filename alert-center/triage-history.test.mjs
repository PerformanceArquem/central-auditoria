import test from 'node:test';
import assert from 'node:assert/strict';
import {triageEntry} from './triage-history.mjs';
import {businessDays,simulate} from './engine.mjs';
const context={now:'2026-11-26T13:30:00Z',localDate:'2026-11-26'};
const base={team:'Inteligência',status:'Em Análise',historyComplete:true,syncedAt:'2026-11-26T13:00:00Z',teamHistory:[{date:'2026-11-12',team:'Inteligência'}],statusHistory:[{date:'2026-11-05',status:'Fila'},{date:'2026-11-18',status:'Em Análise'}]};
test('counts the overlap of current sector and triage status',()=>{
 const result=triageEntry(base,context);
 assert.equal(result.enteredDate,'2026-11-18');
 assert.equal(businessDays(result.enteredDate,context.localDate,['2026-11-20']),5);
});
test('returning to the sector resets the current stay',()=>{
 const result=triageEntry({...base,teamHistory:[{date:'2026-11-04',team:'Inteligência'},{date:'2026-11-05',team:'Produção - CPO'},{date:'2026-11-24',team:'Inteligência'}]},context);
 assert.equal(result.enteredDate,'2026-11-24');
});
test('returning to triage status resets the current stay',()=>{
 const result=triageEntry({...base,statusHistory:[{date:'2026-11-04',status:'Em Análise'},{date:'2026-11-13',status:'Agendado'},{date:'2026-11-19',status:'Em Análise'}]},context);
 assert.equal(result.enteredDate,'2026-11-19');
 assert.equal(businessDays(result.enteredDate,context.localDate,['2026-11-20']),4);
});
test('repeated current status does not reset the clock',()=>{
 const result=triageEntry({...base,statusHistory:[{date:'2026-11-18',status:'Em Análise'},{date:'2026-11-24',status:'Em Análise'}]},context);
 assert.equal(result.enteredDate,'2026-11-18');
});
test('old or future synchronization blocks eligibility',()=>{
 for(const syncedAt of ['2026-11-24T13:00:00Z','2026-11-27T13:00:00Z','2026-11-26T13:00:00','invalid']){
 assert.equal(triageEntry({...base,syncedAt},context).eligible,false);
 }
});
test('missing, incomplete, mismatched and unordered history blocks eligibility',()=>{
 for(const change of [
 {historyComplete:false},{teamHistory:[]},{statusHistory:[]},
 {statusHistory:[{date:'2026-11-18',status:'Fila'}]},
 {statusHistory:[{date:'2026-11-24',status:'Fila'},{date:'2026-11-18',status:'Em Análise'}]},
 {statusHistory:[{date:'2026-02-30',status:'Em Análise'}]},
 {statusHistory:[{date:'2026-11-27',status:'Em Análise'}]}
 ])assert.equal(triageEntry({...base,...change},context).eligible,false);
});
test('other statuses, sectors and closed tickets are not triage',()=>{
 for(const change of [{status:'Fila'},{team:'Produção - CPO'},{closed:true}])assert.equal(triageEntry({...base,...change},context).eligible,false);
});

test('engine uses history overlap instead of an older triage date',()=>{
 const r=simulate([{id:1,sector:'intelligence',inTriage:true,triageEnteredDate:'2026-11-01',history:{...base,teamHistory:[{date:'2026-11-24',team:'Inteligência'}]}}],context);
 assert.equal(r.alerts.filter(a=>a.rule==='aged-triage').length,0);
});
test('engine reports stale history for review without issuing a triage alert',()=>{
 const r=simulate([{id:1,sector:'intelligence',inTriage:true,triageEnteredDate:'2026-11-01',history:{...base,syncedAt:'2026-11-01T13:00:00Z'}}],context);
 assert.equal(r.alerts.length,0);
 assert.deepEqual(r.triageReview,[{ticketId:1,reason:'stale-history'}]);
});
