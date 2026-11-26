import test from 'node:test';
import assert from 'node:assert/strict';
import {composeTriageDraft} from './triage-message.mjs';
const context={threshold:3,referenceTime:'2026-11-26T14:00:00Z',now:'2026-11-26T14:05:00Z'};
const base={ticketId:'1',subject:'Exemplo',eligible:true,reason:'threshold-reached',enteredDate:'2026-11-18',businessDays:5,syncedAt:'2026-11-26T13:00:00Z'};
test('only validated eligible tickets enter the requested evaluation list',()=>{
 const d=composeTriageDraft({...context,rows:[base,{...base,ticketId:'2',eligible:false,reason:'not-found-by-api',businessDays:null,enteredDate:null},{...base,ticketId:'3',eligible:false,reason:'below-threshold',businessDays:2}]});
 assert.equal(d.eligibleCount,1);assert.equal(d.reviewCount,1);assert.equal(d.waitingCount,1);
 assert.match(d.text,/#1 \| Exemplo/);assert.doesNotMatch(d.text,/#2 \|/);assert.doesNotMatch(d.text,/#3 \|/);assert.match(d.text,/PRÉVIA · NENHUM ENVIO/);
});
test('stale ticket histories never enter the requested evaluation list',()=>{
 const d=composeTriageDraft({...context,rows:[{...base,syncedAt:'2026-11-24T13:00:00Z'}]});
 assert.equal(d.eligibleCount,0);assert.equal(d.reviewCount,1);
});
test('old consultations and duplicate IDs are rejected',()=>{
 assert.throws(()=>composeTriageDraft({...context,now:'2026-11-26T16:00:00Z',rows:[base]}));
 assert.throws(()=>composeTriageDraft({...context,rows:[base,base]}));
});
test('subjects cannot inject new message lines',()=>{
 const d=composeTriageDraft({...context,rows:[{...base,subject:'Exemplo\nDestinatário indevido'}]});
 assert.match(d.text,/#1 \| Exemplo Destinatário indevido \|/);
});
test('invalid calendar dates remain in review',()=>{
 const d=composeTriageDraft({...context,rows:[{...base,enteredDate:'2026-02-30'}]});
 assert.equal(d.eligibleCount,0);assert.equal(d.reviewCount,1);
});
