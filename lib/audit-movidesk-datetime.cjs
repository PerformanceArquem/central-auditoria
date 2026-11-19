'use strict';

/**
 * Movidesk API fields slaSolutionDate, lastActionDate and ownerHistories.changedDate
 * are documented as UTC datetimes, even when serialized without a trailing "Z".
 *
 * Source: https://atendimento.movidesk.com/kb/pt-br/article/256/movidesk-ticket-api
 *
 * This parser intentionally treats a timezone-less Movidesk datetime as UTC.
 * It never interprets the value as the web server's local timezone, nor as
 * America/Sao_Paulo local clock time. Convert to the viewer's timezone only
 * when presenting the date in the UI.
 *
 * Returns epoch milliseconds, or null when missing/invalid.
 */
function parseMovideskUtc(value) {
  if(typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
  if(!match) return null;

  const [,y,mo,d,h,mi,s,,zone] = match;
  const calendarTime = Date.UTC(+y,+mo-1,+d,+h,+mi,+s);
  if(!Number.isFinite(calendarTime)) return null;
  // Date.UTC normalizes impossible dates; reject them instead of inventing SLA.
  if(new Date(calendarTime).toISOString().slice(0,19) !==
    [y,mo,d].join('-')+'T'+[h,mi,s].join(':')) return null;

  if(zone && zone.toUpperCase() !== 'Z'){
    const zoneHour=Number(zone.slice(1,3));
    const zoneMinute=Number(zone.slice(4,6));
    if(zoneHour>23 || zoneMinute>59) return null;
  }
  const normalized=zone?value:value+'Z';
  const milliseconds=Date.parse(normalized);
  return Number.isFinite(milliseconds)?milliseconds:null;
}

module.exports={parseMovideskUtc};
