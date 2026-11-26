import {businessDays} from './engine.mjs';
export const EMAIL_SECTORS=Object.freeze([
 {sector:'Inteligência',recipientId:'ba07a7f7-6b33-4788-8a05-a5fd6e899387'},
 {sector:'Qualidade',recipientId:'8f150a28-df5f-4c53-872f-ca753556d576'},
 {sector:'Sucesso do Cliente',recipientId:'2dd4813c-2b2a-42f0-ac45-4baad40a7817'},
 {sector:'Testes (QA)',recipientId:'a8cce01e-27b0-419e-9ef0-3d54447c7a6b'},
 {sector:'Treinamento',recipientId:'8bfd9bdb-c4a5-4d62-91e0-4e4822db3ca0'},
 {sector:'Implantação',recipientId:'ae9ed56e-5a77-4cd2-985b-05a0ddff4e8c'}
]);
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const closed=new Set(['fechado','resolvido','cancelado','concluido','concluido (sem confirmacao)','encerrado','finalizado']);
export const RULE_LABELS=Object.freeze({overdue:'Prazo vencido',preventive:'Vencimento em até 24 horas',escalation:'Atraso de pelo menos 48 horas',idle:'Sem apontamento há 3 dias úteis'});
export function localClock(now){
 const date=new Date(now);if(!Number.isFinite(+date))throw Error('Horário inválido.');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {date:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,weekday:new Date(parts.year+'-'+parts.month+'-'+parts.day+'T12:00:00Z').getUTCDay()};
}
export function idleCoverageStart(now,holidays=[]){
 const today=localClock(now).date;
 let from=today;
 for(let i=0;i<370;i++){
 from=new Date(Date.parse(from+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 if(businessDays(from,today,holidays)>=3)return from;
 }
 throw Error('Calendário sem cobertura confirmada.');
}
export function inEmailWindow(now,holidays=[]){
 const clock=localClock(now);
 return ![0,6].includes(clock.weekday)&&!holidays.includes(clock.date)&&clock.time>='08:30'&&clock.time<='08:39';
}
export function sectorRecipient(sector,recipients){
 const expected=EMAIL_SECTORS.find(item=>item.sector===sector);if(!expected)throw Error('Setor não autorizado.');
 const matches=recipients.filter(rec=>rec.id===expected.recipientId&&rec.active===true);
 if(matches.length!==1)throw Error('Destinatário ativo não confirmado para '+sector+'.');
 const rec=matches[0],email=String(rec.email||'').trim().toLowerCase();
 const sectors=Array.isArray(rec.sectors)&&rec.sectors.length?rec.sectors:[rec.sector];
 if(!sectors.includes(sector)||!email.match(/^[^@\s]+@arquem\.com\.br$/)||rec.daily_enabled!==true)throw Error('Cadastro de envio diário incompatível com '+sector+'.');
 // Keep each new alert scoped to one approved sector even for multi-sector recipients.
 return {...rec,email,sector,sectors:[sector]};
}
export function evaluateEmailAlerts(records,{now,holidays=[],appointmentCoverage=false}){
 const clock=localClock(now),seen=new Set(),review=[],alerts=[];
 if(!Array.isArray(records)||records.length>2000)throw Error('Seleção incompleta; nenhum envio permitido.');
 const sectors=new Set(EMAIL_SECTORS.map(x=>x.sector));
 for(const row of records){
 const id=String(row.ticket_id||''),p=row.payload||{};
 if(!/^\d{1,12}$/.test(id)||seen.has(id))throw Error('Chamado inválido ou duplicado.');seen.add(id);
 if(!sectors.has(p.ownerTeam))continue;
 if(row.excluded===true||normalize(p.subject)==='tm-homolog-001'||row.closed_at_source||p.closedIn||p.canceledIn||String(p.isDeleted)==='true'||closed.has(normalize(p.status)))continue;
 const synced=Date.parse(row.source_synced_at);
 if(!Number.isFinite(synced)||synced>Date.parse(now)||Date.parse(now)-synced>86400000){review.push({ticketId:id,sector:p.ownerTeam,reason:'stale-history'});continue;}
 const rules=[];
 const paused=p.slaSolutionDateIsPaused!==false&&p.slaSolutionDateIsPaused!=='false';
 const dueValue=p.slaSolutionDate;
 const due=typeof dueValue==='string'&&dueValue?Date.parse(/(Z|[+-]\d{2}:\d{2})$/i.test(dueValue)?dueValue:dueValue+'Z'):NaN;
 if(!paused&&Number.isFinite(due)){
 const hours=(due-Date.parse(now))/3600000;
 if(hours<0){rules.push('overdue');if(hours<=-48)rules.push('escalation');}
 else if(hours<=24)rules.push('preventive');
 }
 // Missing appointments never become evidence unless reconciliation covers the interval.
 if(appointmentCoverage){
 const since=String(row.last_real_appointment?.date||'');
 const created=String(p.createdDate||'');
 const from=since||(/^\d{4}-\d{2}-\d{2}/.test(created)?localClock(/(Z|[+-]\d{2}:\d{2})$/.test(created)?created:created+'Z').date:'');
 if(from&&businessDays(from,clock.date,holidays)>=3)rules.push('idle');
 }
 if(rules.length)alerts.push({...row,ticket_id:id,rules});
 }
 return {date:clock.date,alerts,review,appointmentCoverage};
}
export function alertBody(rows,sector,now){
 const clock=localClock(now),date=clock.date.split('-').reverse().join('/');
 return 'ARQUEM SISTEMAS · Central de Auditoria\nTicket Manager · Alertas de chamados\nSetor: '+sector+'\nReferência: '+date+' às '+clock.time+' (Brasília)\n\nOlá! Por gentileza, confira os chamados abaixo e atualize o andamento e a previsão de tratamento, quando possível. Se houver impedimentos, sinalize a necessidade de apoio à gestão do seu setor.\n\n'+
 rows.map(row=>'#'+row.ticket_id+' · '+row.rules.map(rule=>RULE_LABELS[rule]).join(' · ')).join('\n')+
 '\n\nA ausência de apontamentos não comprova ausência de trabalho. Este acompanhamento não altera chamados nem registra horas.';
}
