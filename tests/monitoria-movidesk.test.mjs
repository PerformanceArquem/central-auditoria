import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{normalize} from '../lib/monitoria-movidesk-handler.js';
const prevFetch=globalThis.fetch;
const original=Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','MOVIDESK_TOKEN'].map(k=>[k,process.env[k]]));
test.afterEach(()=>{
 globalThis.fetch=prevFetch;
 for(const [k,v] of Object.entries(original))v===undefined?delete process.env[k]:process.env[k]=v;
});
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
function response(){return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;return this},
 status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}
function prepare(role='admin'){
 process.env.SUPABASE_URL='https://test.supabase.co';
 process.env.SUPABASE_SERVICE_ROLE_KEY='service-test';
 process.env.MOVIDESK_TOKEN='private-token';
 const requests=[];
 globalThis.fetch=async url=>{
  const u=new URL(url);requests.push(u);
  if(u.pathname==='/auth/v1/user')return json({id:'user-1'});
  if(u.pathname==='/rest/v1/audit_users')return json([{role,is_active:true}]);
  return json([{id:102205,subject:'Atendimento chat',actions:[
   {id:12,createdDate:'2026-11-17T12:30:00Z',createdBy:{name:'Atendente'},description:'Bom dia',origin:2,type:2},
   {id:13,createdDate:'2026-11-17T12:31:00Z',createdBy:{name:'Cliente'},htmlDescription:'<p>Preciso de ajuda</p>',origin:2,type:2,isDeleted:false},
   {id:14,isDeleted:true,description:'Mensagem excluída'}
  ]}]);
 };
 return requests;
}
const req=(ticketId,authorization='Bearer user-token')=>({method:'GET',query:{ticketId},headers:{authorization}});
test('proíbe consulta sem sessão',async()=>{
 const calls=prepare();const res=response();
 await handler(req('102205',''),res);
 assert.equal(res.statusCode,401);assert.equal(calls.length,0);
});
test('bloqueia usuário sem perfil admin',async()=>{
 const calls=prepare('user');const res=response();
 await handler(req('102205'),res);
 assert.equal(res.statusCode,403);
 assert.equal(calls.some(x=>x.hostname==='api.movidesk.com'),false);
});
test('retorna interações documentadas por chamado, sem token no cliente',async()=>{
 const calls=prepare();const res=response();
 await handler(req('102205'),res);
 assert.equal(res.statusCode,200);
 assert.equal(res.body.source,'movidesk_ticket_actions');
 assert.equal(res.body.messages.length,2);
 assert.equal(res.body.messages[1].text,'Preciso de ajuda');
 assert.equal(JSON.stringify(res.body).includes('private-token'),false);
 const request=calls.find(x=>x.hostname==='api.movidesk.com');
 assert.equal(request?.searchParams.get('$expand'),'actions');
 assert.equal(request?.searchParams.get('$filter'),'id eq 102205');
});
test('rejeita números de chamado inválidos antes de consultar Movidesk',async()=>{
 const calls=prepare();const res=response();
 await handler(req('102205 OR true'),res);
 assert.equal(res.statusCode,400);
 assert.equal(calls.some(x=>x.hostname==='api.movidesk.com'),false);
});

test('cobertura do extrato não presume chat completo e identifica origens heterogêneas',()=>{
 const data=normalize({id:1001,subject:'Registro',actions:[
  {id:1,origin:2,type:2,createdDate:'2026-11-17',createdBy:{name:'Atendente'},description:'Conversa'},
  {id:2,origin:26,type:1,createdDate:'2026-11-17',createdBy:{name:'Interno'},description:'Nota interna'},
  {id:3,origin:0,type:2,isDeleted:true,description:'Excluída'}
 ]});
 assert.equal(data.coverage.chatFullHistoryVerified,false);
 assert.equal(data.coverage.activeActions,2);
 assert.equal(data.coverage.renderedInteractions,2);
 assert.deepEqual(data.coverage.actionOrigins,['2','26']);
 assert.equal(data.coverage.requiresHumanCheck,true);
 assert.match(data.warning,/NÃO HOMOLOGADO COMO CHAT COMPLETO/);
});

test('usa extrato já sincronizado quando Movidesk falha, sem alegar chat completo',async()=>{
 prepare();
 const seen=[];
 globalThis.fetch=async input=>{
  const u=new URL(input);seen.push(u);
  if(u.pathname==='/auth/v1/user')return json({id:'user-1'});
  if(u.pathname==='/rest/v1/audit_users')return json([{role:'admin',is_active:true}]);
  if(u.hostname==='api.movidesk.com')return new Response('{}',{status:503});
  if(u.pathname==='/rest/v1/audit_direct_tickets')return json([{
   ticket_id:'102205',payload:{id:102205,subject:'Atendimento sincronizado',
    actions:[{id:1,createdDate:'2026-11-17',createdBy:{name:'Atendente'},description:'Olá'},
     {id:2,createdDate:'2026-11-17',createdBy:{name:'Cliente'},description:'Ajuda'}]}
  }]);
  throw Error('unexpected '+u.pathname);
 };
 const res=response();await handler(req('102205'),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.syncedFallback,true);
 assert.equal(res.body.messages.length,2);
 assert.equal(res.body.coverage.chatFullHistoryVerified,false);
 assert.match(res.body.warning,/EXTRATO SINCRONIZADO/);
 assert.equal(seen.filter(u=>u.pathname==='/rest/v1/audit_direct_tickets').length,1);
});
test('não consulta extrato sincronizado quando autenticação falha',async()=>{
 prepare();const seen=[];
 globalThis.fetch=async input=>{
  const u=new URL(input);seen.push(u);
  if(u.pathname==='/auth/v1/user')throw Error('auth offline');
  throw Error('unexpected call');
 };
 const res=response();await handler(req('102205'),res);
 assert.equal(res.statusCode,503);
 assert.equal(seen.filter(u=>u.pathname==='/rest/v1/audit_direct_tickets').length,0);
});
