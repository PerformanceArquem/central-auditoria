import {recipientCollaborators,recipientAllowsCollaborator,recipientSelectionKey} from '../supabase/functions/audit-email-dispatch/recipient-collaborators.ts';
const assert=(x:unknown,m:string)=>{if(!x)throw Error(m)};
Deno.test('explicit group excludes former and unselected collaborators',()=>{
 const rec={collaborator_names:['Ana','Beto']};
 const scoped=['Ana','Beto','Ex-colaborador'].filter(n=>recipientAllowsCollaborator(rec,n));
 assert(scoped.join(',')==='Ana,Beto','group leaked excluded person');
});
Deno.test('legacy individual and all-team registrations remain compatible',()=>{
 assert(recipientAllowsCollaborator({collaborator_name:'Ana'},'ANA'),'legacy name failed');
 assert(!recipientAllowsCollaborator({collaborator_name:'Ana'},'Beto'),'legacy leakage');
 assert(recipientAllowsCollaborator({collaborator_names:[],collaborator_name:null},'Beto'),'all-team mode failed');
});
Deno.test('group overrides stale scalar and normalizes duplicates and accents',()=>{
 const rec={collaborator_names:[' Ána ','ANA','Beto'],collaborator_name:'Ex-colaborador'};
 assert(recipientCollaborators(rec).length===2,'duplicates remained');
 assert(!recipientAllowsCollaborator(rec,'Ex-colaborador'),'stale scalar overrode group');
});
Deno.test('malformed explicit selections fail instead of expanding to everyone',()=>{
 for(const rec of [{collaborator_names:'Ana'},{collaborator_names:['']},{collaborator_names:[null]},{collaborator_names:Array(101).fill('Ana')}]){
  let failed=false;try{recipientAllowsCollaborator(rec,'Ex-colaborador')}catch{failed=true}assert(failed,'invalid selection was treated as everyone');
 }
});
Deno.test('changing selected people invalidates cached report content',()=>{
 const old={scope:'sector',sectors:['Suporte'],collaborator_names:['Ana','Ex-colaborador']};
 assert(recipientSelectionKey(old)!==recipientSelectionKey({...old,collaborator_names:['Ana']}),'old cache survived removal');
 assert(recipientSelectionKey({...old,collaborator_names:['Ana','Beto']})===recipientSelectionKey({...old,collaborator_names:['Beto','Ana']}),'ordering should not alter equivalent scope');
});

