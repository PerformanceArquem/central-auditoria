import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.TICKET_INSPECTION_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
after(async()=>db.close());
const sql=readFileSync(new URL('../supabase/migrations/20261123143000_ticket_inspection_staging.sql',import.meta.url),'utf8');
// Supabase service_role has BYPASSRLS; reproduce that role, never grant browser roles access.
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(sql);
const actor='b039f3af-ef13-4c21-a3d6-29c1a430b487';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function record(n,{id='101',source='2026-11-23T12:00:00Z',findings=[],score=25}={}){
 return (await db.query('select public.audit_record_ticket_inspection($1,$2,$3,$4,$5,$6,$7) as result',[uuid(n),id,source,actor,JSON.stringify(findings),JSON.stringify(['no_owner']),score])).rows[0].result;
}
test('migration is repeatable and records a snapshot through the staging RPC',async()=>{
 await db.exec(sql);await db.exec('set role service_role');
 assert.deepEqual(await record(1,{findings:[{code:'no_owner',label:'Sem responsável'}]}),{saved:true,duplicate:false});
 const rows=(await db.query('select * from public.audit_ticket_inspection_snapshots')).rows;assert.equal(rows.length,1);assert.equal(rows[0].actor,actor);assert.equal(rows[0].ticket_id,'101');assert.equal(rows[0].score,25);
});
test('idempotency prevents duplicate rows, and a request cannot switch tickets',async()=>{
 assert.deepEqual(await record(1),{saved:true,duplicate:true});
 await assert.rejects(record(1,{id:'102'}),/already used/);
 assert.equal((await db.query('select count(*)::int as n from public.audit_ticket_inspection_snapshots')).rows[0].n,1);
});
test('an older synchronized source is rejected without changing the history',async()=>{
 assert.deepEqual(await record(2,{source:'2026-11-22T12:00:00Z'}),{stale:true});
 assert.equal((await db.query('select count(*)::int as n from public.audit_ticket_inspection_snapshots')).rows[0].n,1);
 assert.deepEqual(await record(3,{source:'2026-11-23T13:00:00Z'}),{saved:true,duplicate:false});
});
test('database constraints reject malformed snapshots and invalid risk scores',async()=>{
 await assert.rejects(record(4,{id:'103',score:101}),/check constraint/);
 await assert.rejects(record(5,{id:'bad'}),/check constraint/);
 await assert.rejects(db.query('select public.audit_record_ticket_inspection($1,$2,$3,$4,$5,$6,$7)',[uuid(6),'103','2026-11-23T14:00:00Z',actor,'{}','[]',25]),/check constraint/);
});
test('service role can read and call RPC, but cannot write table directly',async()=>{
 await assert.rejects(db.query('delete from public.audit_ticket_inspection_snapshots'),/permission denied/);
 await assert.rejects(db.query('update public.audit_ticket_inspection_snapshots set score=0'),/permission denied/);
});
test('anonymous and authenticated roles cannot read, insert, or execute the RPC',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('reset role; set role '+role);
  await assert.rejects(db.query('select * from public.audit_ticket_inspection_snapshots'),/permission denied/);
  await assert.rejects(record(10,{id:'104'}),/permission denied/);
 }
 await db.exec('reset role');
 const rows=(await db.query('select ticket_id from public.audit_ticket_inspection_snapshots')).rows;assert.equal(rows.length,2);
});
