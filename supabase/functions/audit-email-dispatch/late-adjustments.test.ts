import {summarizeAdjustments,reportTiming} from "./late-adjustments.ts";

const recipient={
  id:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  active:true,
  scope:"sector",
  sector:"Produção - CPO",
  report_sections:{daily_detail:true}
};
const baseline={
  dispatch_key:"ready:example",
  status:"ready",
  period_from:"2026-11-16",
  period_to:"2026-11-16",
  prepared_at:"2026-11-17T10:50:00Z"
};
const event={
  appointment_key:"appointment-1",
  observed_at:"2026-11-17T11:15:00Z",
  before_data:null,
  after_data:{
    ticket_id:"101191",
    appointment_date:"2026-11-16",
    collaborator_name:"Pessoa Teste",
    sector:"Produção - CPO",
    duration_minutes:180
  }
};

Deno.test("ready prepared report counts late inserts without sent emails",()=>{
 const result=summarizeAdjustments([event],recipient,[baseline],"2026-11-16","2026-11-16");
 if(result.length!==1||result[0].deltaMinutes!==180)
  throw Error("Late insertion was not associated with the prepared baseline");
});

Deno.test("insertion before preparation is not reported as late",()=>{
 const before={...event,observed_at:"2026-11-17T10:49:00Z"};
 const result=summarizeAdjustments([before],recipient,[baseline],"2026-11-16","2026-11-16");
 if(result.length!==0)throw Error("Pre-existing record incorrectly flagged");
});

Deno.test("other sectors cannot leak into prepared report",()=>{
 const result=summarizeAdjustments([
  {...event,after_data:{...event.after_data,sector:"Suporte"}}
 ],recipient,[baseline],"2026-11-16","2026-11-16");
 if(result.length!==0)throw Error("Sector boundaries were ignored");
});

Deno.test("reportTiming consults prepared baseline and never initiates sending",async()=>{
 const accesses:string[]=[];
 const db=async(path:string)=>{
  accesses.push(path);
  if(path.startsWith("audit_email_recipients"))return [recipient];
  if(path.startsWith("audit_email_sector_dispatches"))return [];
  if(path.startsWith("audit_email_prepared_reports"))return [baseline];
  throw Error("Unexpected database request: "+path);
 };
 const list=async(table:string)=>{
  if(table!=="audit_appointment_changes")throw Error("Unexpected table");
  return [event];
 };
 const result=await reportTiming({
  recipientId:recipient.id,reportKind:"daily",
  from:"2026-11-16",to:"2026-11-16",reportSections:{daily_detail:true}
 },db,list);
 if(!result||result.status!=="tracked"||result.adjustmentCount!==1)
  throw Error("Expected one post-preparation adjustment without mail dispatch");
 if(!accesses.some(v=>v.startsWith("audit_email_prepared_reports")))
  throw Error("Prepared baselines were not queried");
});
