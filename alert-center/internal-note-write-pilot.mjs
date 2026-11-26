import {previewInternalNote,PILOT_ID,PILOT_REFERENCE,PILOT_TEXT} from './internal-note-pilot.mjs';
// Server only. Caller must authenticate the pilot profile and atomically reserve
// the reference in durable storage before invoking. Never retry an uncertain write.
export async function writeInternalNote({token,ownerId,authorId,confirmed,reserve,fetcher=fetch}){
 if(confirmed!==true||!authorId||typeof reserve!=='function')throw Error('Autorização ou reserva ausente.');
 const preview=await previewInternalNote(token,ownerId,fetcher);
 if(!preview.eligible)return {status:'duplicate',ticketId:PILOT_ID};
 if(await reserve(PILOT_REFERENCE)!==true)return {status:'reserved',ticketId:PILOT_ID};
 const url=new URL('https://api.movidesk.com/public/v1/tickets');
 url.searchParams.set('token',token);url.searchParams.set('id',PILOT_ID);
 const description=PILOT_TEXT+'\n\n'+PILOT_REFERENCE;
 try{
 const response=await fetcher(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({actions:[{id:0,type:1,description,createdBy:{id:String(authorId)}}]}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)return {status:'uncertain',ticketId:PILOT_ID,httpStatus:response.status};
 const check=await previewInternalNote(token,ownerId,fetcher);
 return {status:check.duplicate?'registered':'uncertain',ticketId:PILOT_ID};
 }catch{return {status:'uncertain',ticketId:PILOT_ID};}
}
