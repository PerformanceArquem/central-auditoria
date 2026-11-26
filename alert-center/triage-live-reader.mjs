// Read-only Movidesk requests. Results stay in memory; no database writes.
export async function readTriageHistories(ids,token,fetcher=fetch){
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length)throw Error('Invalid ticket selection');
 if(!token)throw Error('Movidesk integration unavailable');
 const found=new Map();let requests=0;
 for(const path of ['tickets','tickets/past']){
 const missing=ids.filter(id=>!found.has(id));if(!missing.length)break;
 const url=new URL('https://api.movidesk.com/public/v1/'+path);
 url.searchParams.set('token',token);url.searchParams.set('$filter',missing.map(id=>'id eq '+id).join(' or '));
 url.searchParams.set('$select','id,subject,ownerTeam,status,baseStatus,closedIn,ownerHistories,statusHistories');
 url.searchParams.set('$expand','ownerHistories,statusHistories');
 url.searchParams.set('$top','100');
 requests++;
 const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)});
 if(response.status===429){const error=new Error('Movidesk rate limit');error.code='rate-limit';throw error;}
 if(!response.ok)throw Error('Movidesk read unavailable');
 const rows=await response.json();if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid Movidesk response');
 for(const row of rows){
 const id=String(row?.id??'');if(!missing.includes(id)||found.has(id))throw Error('Unexpected or duplicate ticket');
 found.set(id,row);
 }
 }
 return {tickets:[...found.values()],missingIds:ids.filter(id=>!found.has(id)),requests};
}
