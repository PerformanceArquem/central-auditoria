import test from 'node:test';
import assert from 'node:assert/strict';
import {isHomologationTicket,excludeHomologation} from './report-exclusions.mjs';
test('exact subject excludes only homologation',()=>{assert.equal(isHomologationTicket({subject:' TM-HOMOLOG-001 '}),true);assert.equal(isHomologationTicket({subject:'Cliente relata TM-HOMOLOG-001'}),false);});
test('verified ID remains excluded after subject change',()=>assert.equal(isHomologationTicket({id:102904,subject:'Alterado'},['102904']),true));
test('nested payload subject supported',()=>assert.equal(isHomologationTicket({payload:{subject:'TM-HOMOLOG-001'}}),true));
test('normal tickets and appointments retained',()=>{const t=[{id:1,subject:'Normal'},{id:2,subject:'TM-HOMOLOG-001'}],a=[{ticket_id:1,duration_minutes:60},{ticket_id:2,duration_minutes:30}];const result=excludeHomologation(t,a);assert.deepEqual(result.tickets,[t[0]]);assert.deepEqual(result.appointments,[a[0]]);assert.equal(t.length,2);assert.equal(a.length,2);});
test('known IDs exclude appointments outside ticket snapshot',()=>{const a=[{ticket_id:102904},{ticket_id:3}];assert.deepEqual(excludeHomologation([],a,['102904']).appointments,[a[1]]);});
test('invalid snapshots rejected',()=>assert.throws(()=>excludeHomologation(null,[])));
