import {robotRecordFacts} from './robot-record-facts.mjs';
import {robotDeadlineFacts} from './robot-deadline-facts.mjs';
import {planRobotNote} from './robot-note-plan.mjs';
// Read-only integration of normalized evidence. A trusted server must verify source coverage.
export function evaluateRobotTicket(ticket,context={}){
 const {now,syncedAt,today,opened,records,recordCoverage=false,deadlineCoverage=false,waitingConfirmed=false,waitingSince=null,lastAppointmentDate=null,appointmentCoverage=false,historyComplete=false,holidays=[],thresholds={},idleThreshold=3,contactThreshold=3,maxFutureBusinessDays=10,blocked=false,existingKeys=[]}=context;
 if(blocked)return {plan:null,review:['blocked-ticket']};
 const review=[];
 const record=robotRecordFacts({today,opened,records,coverageConfirmed:recordCoverage,holidays,idleThreshold,contactThreshold,lastAppointmentDate,appointmentCoverage,waitingSince:waitingConfirmed?waitingSince:null});
 const deadline=robotDeadlineFacts(ticket,{now,waitingConfirmed,deadlineCoverage,holidays,maxFutureBusinessDays});
 if(!record.verified)review.push(record.reason);
 if(!deadline.verified)review.push(deadline.reason);
 const facts={...(record.verified?record.facts:{}),...(deadline.verified?deadline.facts:{})};
 const plan=planRobotNote(ticket,{now,syncedAt,blocked,historyComplete,holidays,thresholds,existingKeys,validatedFacts:{verified:true,facts}});
 return {plan,review};
}
