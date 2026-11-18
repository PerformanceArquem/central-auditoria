import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html'),entry=read('supabase/functions/audit-email-dispatch/index.ts');
const internal=read('supabase/functions/audit-email-dispatch/ticket-charge-internal.ts');
const worker=read('supabase/functions/audit-email-dispatch/ticket-charge-note-worker.ts');
const migration=read('ops/install-ticket-charge-internal-notes.sql');
test('UI requires explicit date, start/end and the current registered user',()=>{
 for(const id of ['alarmEmailInternalNote','alarmEmailLogHours','alarmEmailWorkDate','alarmEmailWorkStart','alarmEmailWorkEnd','alarmEmailWorkActivity'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/alarmSelected\.size!==1/);
 assert.match(html,/timeLog,registerInternalNote/);
 assert.match(html,/registerInternalNote:!!\$\('alarmEmailInternalNote'\)/);
});
test('Appointment records only a verified real interval, never fabricated time',()=>{
 const transpiled=stripTypeScriptTypes(internal).replace(/export\s+/g,'');
 const factory=new Function(transpiled+';return {validateTimeLog,movideskInternalAction};');
 const {validateTimeLog,movideskInternalAction}=factory();
 const past={date:'2026-11-17',start:'09:00',end:'09:30',activity:'Avaliação de chamados'};
 const log=validateTimeLog(past);
 assert.equal(log.minutes,30);
 assert.throws(()=>validateTimeLog({...past,start:'10:00',end:'09:30'}));
 assert.throws(()=>validateTimeLog({...past,activity:'Qualquer outra atividade'}));
 assert.throws(()=>validateTimeLog({...past,date:'2027-12-01'}));
 const profile={movidesk_person_id:'1543904936',display_name:'Alan Reis',team_id:189951,team_name:'Qualidade',work_type:'Normal'};
 const action=movideskInternalAction('Auditoria interna',profile,log).actions[0];
 assert.equal(action.type,1);
 assert.deepEqual(action.createdBy,{id:'1543904936'});
 assert.equal(action.timeAppointments[0].workTime,'00:30:00');
 assert.equal(action.timeAppointments[0].activity,'Avaliação de chamados');
 assert.equal(action.timeAppointments[0].createdByTeam.name,'Qualidade');
 assert.equal(movideskInternalAction('Cobrança simples',profile).actions[0].timeAppointments,undefined);
});
test('Queue is private, stable, business-day-aware and released only after email accepted',()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/revoke all on public\.audit_ticket_charge_internal_notes from anon,authenticated,public/);
 assert.match(migration,/for update skip locked limit 1/);
 assert.match(entry,/status:'held'/);
 assert.match(entry,/status:'pending'/);
 assert.match(entry,/status:'sent',sent_at:/);
 assert.match(entry,/registerInternalNote/);
 assert.match(entry,/processChargeInternalNote\(db,E\('MOVIDESK_TOKEN'\)\)/);
 assert.match(entry,/\(await holidays\(\)\)\.has\(today\)/);
 assert.match(worker,/history\[0\]\.status!=='sent'/);
 assert.match(worker,/x\.description\|\|x\.htmlDescription/);
 assert.match(worker,/patchAttempted\?'uncertain':'pending'/);
 assert.match(worker,/created_by_user/);
});
test('Code parses and never creates a time appointment when no time was explicitly supplied',()=>{
 for(const code of [internal,worker])assert.ok(stripTypeScriptTypes(code).length>0);
 assert.match(internal,/if\(timeLog\)\{/);
 assert.match(entry,/if\(timeLogRaw&&ids\.length!==1\)/);
});
