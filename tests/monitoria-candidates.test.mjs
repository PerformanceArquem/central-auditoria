import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/monitoria-candidates-handler.js';

const prior={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:globalThis.fetch};
function restore(){
 if(prior.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=prior.url;
 if(prior.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=prior.key;
 globalThis.fetch=prior.fetch;
}
test.afterEach(restore);
const respond=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},
 status(code){this.statusCode=code;return this},json(body){this.body=body;return this}});
const json=body=>({ok:true,json:async()=>body});
function setup(role='admin'){
 process.env.SUPABASE_URL='https://test.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fake-server-key';
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
   const u=new URL(url);calls.push({url:u,method:opts.method||'GET'});
   if(u.pathname==='/auth/v1/user')return json({id:'123e4567-e89b-42d3-a456-426614174000'});
   if(u.pathname.endsWith('/audit_users'))return json([{role,is_active:true}]);
   if(u.pathname.endsWith('/audit_direct_appointments'))return json([
    {collaborator_name:'Pessoa Exemplo',ticket_id:'102205',appointment_date:'2026-11-17'}
   ]);
   if(u.pathname.endsWith('/audit_direct_tickets'))return json([
    {ticket_id:'102205',payload:{actions:[{description:'Bom dia'},{description:'Pode ajudar?'}]}}
   ]);
   throw Error('unexpected request '+u.pathname);
 };
 return calls;
}
const request=(token='Bearer demo')=>({method:'GET',headers:token?{authorization:token}:{},query:{days:'30'}});
test('sem sessão não consulta qualquer registro',async()=>{
 const calls=setup();const res=respond();await handler(request(''),res);
 assert.equal(res.statusCode,401);assert.equal(calls.length,0);
});
test('usuário sem papel administrativo não acessa candidatos',async()=>{
 const calls=setup('viewer');const res=respond();await handler(request(),res);
 assert.equal(res.statusCode,403);
 assert.equal(calls.filter(c=>c.url.pathname.endsWith('/audit_direct_appointments')).length,0);
});
test('consulta gera apenas candidatos e não grava nem envia dados',async()=>{
 const calls=setup();const res=respond();await handler(request(),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.ok,true);
 assert.equal(res.body.people.length,1);
 assert.equal(res.body.people[0].chatCandidate.ticketId,'102205');
 assert.equal(res.body.people[0].chatStatus,'Conferir diálogo e autoria');
 assert.equal(res.body.people[0].voiceStatus,'Localizar gravação e confirmar atendente');
 assert.equal(res.body.emailsSent,false);
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls.every(c=>c.url.hostname==='test.supabase.co'));
 assert.ok(!JSON.stringify(res.body).includes('Bom dia'));
});
