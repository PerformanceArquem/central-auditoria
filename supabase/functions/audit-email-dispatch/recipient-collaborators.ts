type Recipient=Record<string,unknown>;
const normalize=(v:unknown)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function recipientCollaborators(rec:Recipient):string[]{
 const value=rec.collaborator_names;
 if(value!=null&&!Array.isArray(value))throw Error('Seleção de colaboradores inválida.');
 const raw=Array.isArray(value)&&value.length?value:(rec.collaborator_name?[rec.collaborator_name]:[]);
 if(raw.length>100||raw.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>160))throw Error('Seleção de colaboradores inválida.');
 const names=new Map<string,string>();for(const item of raw){const s=String(item).trim();names.set(normalize(s),s);}return [...names.values()];
}
export function recipientAllowsCollaborator(rec:Recipient,name:unknown):boolean{
 const selected=recipientCollaborators(rec);return !selected.length||selected.some(x=>normalize(x)===normalize(name));
}
export function recipientSelectionKey(rec:Recipient):string{
 const sectors=(Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector]).filter(Boolean).map(normalize).sort();
 return JSON.stringify({people:recipientCollaborators(rec).map(normalize).sort(),sectors,scope:rec.scope,updated:rec.updated_at||'',daily:rec.daily_target_minutes??480,minimum:rec.minimum_percent??80});
}

