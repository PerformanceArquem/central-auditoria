import {calculateJourneyGaps} from './journey-gaps.ts';
function eq(actual:number,expected:number,label:string){
  if(actual!==expected)throw new Error(label+': expected '+expected+', got '+actual);
}
Deno.test('single collaborator: 04:06 of 08:00 requires 03:54',()=>{
 const r=calculateJourneyGaps([246],480,384);
 eq(r.people,1,'people');eq(r.referenceTargetMinutes,480,'target');
 eq(r.targetGapMinutes,234,'journey gap');eq(r.minimumGapMinutes,138,'minimum gap');
});
Deno.test('two colleagues: combined time above 08:00 must not erase their individual gaps',()=>{
 const r=calculateJourneyGaps([246,302],480,384);
 eq(r.people,2,'people');eq(r.referenceTargetMinutes,960,'team target');
 eq(r.referenceMinimumMinutes,768,'minimum');eq(r.targetGapMinutes,412,'journey gaps');
 eq(r.minimumGapMinutes,220,'minimum gaps');
});
Deno.test('one colleague overtime cannot compensate another under target',()=>{
 const r=calculateJourneyGaps([600,240],480,384);
 eq(r.targetGapMinutes,240,'target gap');
 eq(r.minimumGapMinutes,144,'minimum gap');
});
Deno.test('all colleagues meet target and no data',()=>{
 eq(calculateJourneyGaps([480,500],480,384).targetGapMinutes,0,'all at target');
 eq(calculateJourneyGaps([],480,384).people,0,'empty');
});
