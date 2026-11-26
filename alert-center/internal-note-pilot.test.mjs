import test from 'node:test';
import assert from 'node:assert/strict';
import {previewInternalNote,PILOT_ID,PILOT_REFERENCE} from './internal-note-pilot.mjs';
const now=new Date('2026-11-26T19:00:00Z');
const ticket={id:PILOT_ID,status:'Em análise',owner:{id:'pilot-owner'},slaSolutionDate:'2026-11-25T21:00:00Z',slaSolutionDateIsPaused:false,actions:[]};
const run=(changes={})=>previewInternalNote('fake-token','pilot-owner',async(url,opts)=>{
 assert.equal(opts.method,'GET');assert.equal(url.searchParams.get('id'),PILOT_ID);
 return {ok:true,json:async()=>({...ticket,...changes})};
},now);
test('eligible and read only',async()=>{const r=await run();assert.equal(r.eligible,true);assert.equal(r.deliveryEnabled,false);assert.equal(r.mailSent,false);assert.equal(r.appointmentCreated,false)});
test('duplicate',async()=>{assert.equal((await run({actions:[{description:PILOT_REFERENCE}]})).eligible,false)});
test('wrong owner',async()=>{await assert.rejects(run({owner:{id:'other'}}))});
test('wrong ticket',async()=>{await assert.rejects(run({id:'999'}))});
test('closed',async()=>{await assert.rejects(run({status:'Fechado'}))});
test('future deadline',async()=>{await assert.rejects(run({slaSolutionDate:'2026-11-30T00:00:00Z'}))});
test('paused',async()=>{await assert.rejects(run({slaSolutionDateIsPaused:true}))});
test('missing history',async()=>{await assert.rejects(run({actions:null}))});
