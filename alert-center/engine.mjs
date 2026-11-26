import {triageEntry} from "./triage-history.mjs";
// Pure simulation engine. No network, database writes or notification dispatch.
export const defaults = Object.freeze({ preventiveHours: 24, escalationHours: 48, idleBusinessDays: 3, triageBusinessDays: 3 });
export function businessDays(from, to, holidays = []) {
  const a = new Date(from), b = new Date(to);
  if (!Number.isFinite(+a) || !Number.isFinite(+b) || a >= b) return 0;
  // Inputs must be normalized to local calendar dates (YYYY-MM-DD).
  a.setUTCHours(0,0,0,0); b.setUTCHours(0,0,0,0);
  const excluded = new Set(holidays);
  let n = 0;
  while (a < b) {
    a.setUTCDate(a.getUTCDate()+1);
    if (![0,6].includes(a.getUTCDay()) && !excluded.has(a.toISOString().slice(0,10))) n++;
  }
  return n;
}
export function simulate(tickets, { now, localDate, holidays = [], settings = {}, existingKeys = [] }) {
  if (!Number.isFinite(Date.parse(now)) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("Explicit clock and local date required");
  const cfg = {...defaults,...settings};
  for (const name of Object.keys(defaults)) {
    if (!Number.isInteger(cfg[name]) || cfg[name] <= 0) throw new Error("Invalid alert setting: "+name);
  }
  const keys = new Set(existingKeys), alerts = [], triage = [];
  const active = new Set(), triageIds = new Set(), triageReview = [];
  for (const t of tickets) {
    if (t.closed || t.sector !== "intelligence") continue;
    const add = (rule, recipient) => {
      const occurrence = String(t.id)+":"+rule;
      active.add(occurrence);
      const key = occurrence+":"+localDate;
      if (keys.has(key)) return;
      keys.add(key);
      alerts.push({key, occurrence, ticketId:t.id, rule, recipient, simulated:true});
    };
    const hours = (Date.parse(t.dueAt)-Date.parse(now))/3600000;
    if (hours < 0) {
      add("overdue","owner");
      if (hours <= -cfg.escalationHours) add("escalation","manager");
    } else if (hours <= cfg.preventiveHours) add("preventive","owner");
    const idleSince = t.lastAppointmentDate || t.createdDate;
    if (idleSince && businessDays(idleSince,localDate,holidays)>=cfg.idleBusinessDays) add("idle","owner");
    const historyResult = t.history ? triageEntry(t.history,{now,localDate}) : null;
    if (historyResult && !historyResult.eligible && historyResult.reason!=='outside-triage')
      triageReview.push({ticketId:t.id,reason:historyResult.reason});
    const triageDate = historyResult ? historyResult.enteredDate : t.triageEnteredDate;
    const inTriage = historyResult ? historyResult.eligible : t.inTriage;
    if (inTriage && triageDate) {
      const days = businessDays(triageDate,localDate,holidays);
      if (days >= cfg.triageBusinessDays && !triageIds.has(String(t.id))) {
        triageIds.add(String(t.id));
        active.add(String(t.id)+":aged-triage");
        triage.push({ticketId:t.id, subject:t.subject, customer:t.customer, owner:t.owner, lastAppointmentDate:t.lastAppointmentDate, link:t.link, days, severity:days>=10?"critical":days>=5?"priority":"attention"});
      }
    }
  }
  const key = "production-manager:aged-triage:"+localDate;
  if (triage.length && !keys.has(key)) alerts.push({key,rule:"aged-triage",recipient:"production-manager",tickets:triage,simulated:true});
  return {alerts,activeOccurrences:[...active],triageReview,simulated:true};
}
