import test from 'node:test';
import assert from 'node:assert/strict';
import parser from '../lib/audit-movidesk-datetime.cjs';
import core from '../lib/audit-readonly-insights.cjs';
import flow from '../lib/audit-queue-flow.cjs';
import policy from '../lib/audit-alert-policy.cjs';

const {parseMovideskUtc}=parser;

test('documented Movidesk UTC without Z is the same absolute instant as with Z',()=>{
  const plain='2026-11-19T19:00:00';
  const explicit='2026-11-19T19:00:00Z';
  const expected=Date.parse(explicit);
  assert.equal(parseMovideskUtc(plain),expected);
  assert.equal(parseMovideskUtc(explicit),expected);
  assert.equal(core.utc(plain),expected);
  assert.equal(flow.utc(plain),expected);
  assert.equal(policy.evaluateAlertPolicies([
    {ticket_id:'1',source_synced_at:explicit,payload:{
      id:1,ownerTeam:'Implantação',baseStatus:'New',
      owner:{id:'owner1'},slaSolutionDate:plain,slaSolutionDateIsPaused:false,
      lastActionDate:'2026-11-19T18:00:00'
    }}
  ],{now:expected,team:'Implantação'}).byType.PREVENTIVO_24H,1);
});

test('Brazilian display converts UTC only at presentation, without changing deadline',()=>{
  const timestamp=parseMovideskUtc('2026-11-19T19:00:00');
  const format=new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hour12:false
  });
  const parts=Object.fromEntries(format.formatToParts(new Date(timestamp))
    .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  assert.equal(parts.year,'2026');
  assert.equal(parts.month,'11');
  assert.equal(parts.day,'19');
  assert.equal(parts.hour,'16');
  assert.equal(parts.minute,'00');
  assert.equal(new Date(timestamp).toISOString(),'2026-11-19T19:00:00.000Z');
});

test('Movidesk seven-digit fractional timestamps are parsed to millisecond resolution',()=>{
  const value='2019-11-12T03:05:23.7055716';
  const result=parseMovideskUtc(value);
  assert.equal(new Date(result).toISOString(),'2019-11-12T03:05:23.705Z');
});

test('explicit offsets retain absolute time without double subtraction',()=>{
  assert.equal(parseMovideskUtc('2026-11-19T16:00:00-03:00'),
    parseMovideskUtc('2026-11-19T19:00:00Z'));
  assert.equal(parseMovideskUtc('2026-11-19T22:00:00+03:00'),
    parseMovideskUtc('2026-11-19T19:00:00Z'));
});

test('invalid dates never become fabricated overdue SLA or queue time',()=>{
  for(const item of [null,undefined,'','2026-11-19','2026-02-30T12:00:00',
    '2026-13-19T12:00:00','2026-11-19T25:00:00',
    '2026-11-19T12:70:00','2026-11-19T12:00:00+25:00',
    '2026-11-19T12:00:00+03:90','not-a-date']){
    assert.equal(parseMovideskUtc(item),null,'Invalid UTC input accepted: '+String(item));
  }
});

test('all analytic engines share UTC contract, not runtime-local interpretation',()=>{
  const plain='2026-11-17T10:30:00';
  assert.equal(core.utc(plain),parseMovideskUtc(plain));
  assert.equal(flow.utc(plain),parseMovideskUtc(plain));
});
