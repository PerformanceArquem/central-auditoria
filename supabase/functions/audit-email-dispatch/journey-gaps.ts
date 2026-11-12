/** Aggregate reference gaps independently by collaborator.
 * Team totals cannot offset one colleague's missing hours with another's excess.
 * Values are imported minutes; this is NOT attendance or time-clock evidence.
 */
export function calculateJourneyGaps(minutesByPerson:Iterable<number>,targetPerPerson:number,minimumPerPerson:number) {
  const minutes=[...minutesByPerson].map(Number).filter(Number.isFinite);
  const capacity=Math.max(0,targetPerPerson);
  const minimum=Math.max(0,minimumPerPerson);
  return {
    people:minutes.length,
    referenceTargetMinutes:Math.round(capacity*minutes.length),
    referenceMinimumMinutes:Math.round(minimum*minutes.length),
    targetGapMinutes:Math.round(minutes.reduce((sum,value)=>sum+Math.max(0,capacity-value),0)),
    minimumGapMinutes:Math.round(minutes.reduce((sum,value)=>sum+Math.max(0,minimum-value),0))
  };
}
