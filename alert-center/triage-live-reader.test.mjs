import test from 'node:test';
import assert from 'node:assert/strict';
import {readTriageHistories} from './triage-live-reader.mjs';
test('uses only GET and checks the older-ticket endpoint for missing IDs',async()=>{
 const paths=[];
 const result=await readTriageHistories(['1','2'],'fixture-token',async(url,options)=>{
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');paths.push(url.pathname);
 return Response.json(paths.length===1?[{id:1}]:[{id:2}]);
 });
 assert.deepEqual(paths,['/public/v1/tickets','/public/v1/tickets/past']);
 assert.equal(result.tickets.length,2);assert.equal(result.requests,2);
});
test('one request when the current endpoint returns every selected ticket',async()=>{
 const result=await readTriageHistories(['1'],'fixture-token',async()=>Response.json([{id:1}]));
 assert.equal(result.requests,1);
});
test('does not retry rate limits',async()=>{
 let calls=0;
 await assert.rejects(readTriageHistories(['1'],'fixture-token',async()=>{calls++;return new Response('',{status:429});}),/rate limit/);
 assert.equal(calls,1);
});
test('rejects unexpected IDs rather than expanding the consultation scope',async()=>{
 await assert.rejects(readTriageHistories(['1'],'fixture-token',async()=>Response.json([{id:99}])),/Unexpected/);
});
test('rejects invalid selection before issuing requests',async()=>{
 let calls=0;await assert.rejects(readTriageHistories(["1 or id gt 0"],'fixture-token',async()=>{calls++;return Response.json([]);}));
 assert.equal(calls,0);
});
