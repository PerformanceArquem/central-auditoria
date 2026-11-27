import {composeTriageDraft} from './triage-message.mjs';

// Reuses an already authenticated read-only query. No API calls or storage.
export function triageRobotSnapshot({rows,threshold,referenceTime,now}) {
  // Reuse the existing query expiry, duplicate ID and threshold checks.
  composeTriageDraft({rows,threshold,referenceTime,now});
  const clock=Date.parse(now), alerts=[], review=[];
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  let waiting=0,outside=0;
  for(const row of rows) {
    const synced=Date.parse(row.syncedAt);
    const fresh=Number.isFinite(synced)&&synced<=clock&&clock-synced<=86400000;
    if(row.reason==='outside-triage'){outside++;continue;}
    if(row.reason==='below-threshold'&&fresh){waiting++;continue;}
    const valid=row.eligible===true&&row.reason==='threshold-reached'&&fresh&&validDate(row.enteredDate)&&Number.isInteger(row.businessDays)&&row.businessDays>=threshold;
    if(valid) alerts.push({ticketId:row.ticketId,rule:'aged-triage'});
    else review.push({...row,reason:!fresh?'stale-history':row.reason==='threshold-reached'?'invalid-history':row.reason});
  }
  return {source:'triage-read-only',referenceTime,threshold,alerts,review,tickets:rows.map(row=>({...row,id:row.ticketId})),waiting,outside};
}
