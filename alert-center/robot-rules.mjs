// Pure simulation; no network, writes or scheduler.
// Input dates are local Brasilia calendar dates. Caller must validate source and freshness.
export const DAY_SECTORS=['suporte','inteligencia','implantacao','qa','qualidade','sucesso do cliente','treinamento'];
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v??''))throw Error('Data local inválida');const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw Error('Data local inválida');return d;};
export function businessDays(from,to,holidays=[]){
 const a=date(from),b=date(to),h=new Set(holidays);let n=0;
 for(let d=new Date(+a+86400000);d<=b;d=new Date(+d+86400000)){if(d.getUTCDay()!==0&&d.getUTCDay()!==6&&!h.has(d.toISOString().slice(0,10)))n++;}
 return n;
}
export function evaluateRobot(t,{today,clock,holidays=[],cycles={}}){
 const d=date(today),sector=norm(t.sector),production=sector==='producao',status=norm(t.status);
 const output={ticketId:String(t.id),mode:'dry-run',deliveryEnabled:false,actions:[],resolved:[]};
 if(!production&&!DAY_SECTORS.includes(sector))return output;
 if(d.getUTCDay()===0||d.getUTCDay()===6||holidays.includes(today)||clock!==(production?'05:30':'18:05'))return output;
 if(t.sourceVerified!==true||t.historyVerified!==true||!status||!t.id)return {...output,review:true};
 const active=!/fechad|resolvid|cancelad|encerrad|concluid|finalizad/.test(status);
 const rules=[];
 if(active){
 if(t.forecastState==='overdue')rules.push('overdue');
 if(production&&['agendado','em analise','em execucao'].includes(status)&&t.forecastState==='missing')rules.push('missing_forecast');
 if(['overdue','valid'].includes(t.forecastState)&&t.lastAppointmentDate&&businessDays(t.lastAppointmentDate,today,holidays)>5)rules.push('stale_appointment');
 if(!production&&Number.isFinite(t.idleBusinessMinutes)&&t.idleBusinessMinutes>=1080)rules.push('idle');
 }
 for(const key of Object.keys(cycles))if(!rules.includes(key)&&t.conditionsVerified===true)output.resolved.push(key);
 for(const key of rules){
 const c=cycles[key];let level=1;
 if(c){if(![1,2,3].includes(c.lastLevel)||!c.firstDate)continue;const days=businessDays(c.firstDate,today,holidays);if(c.lastLevel===3)continue;const threshold=key==='idle'?(c.lastLevel===1?2:6):(c.lastLevel===1?2:5);if(days<threshold)continue;level=c.lastLevel+1;}
 output.actions.push({key,level});
 }
 if(output.actions.length)output.message=composeRobotMessage(output.actions);
 return output;
}
const labels={overdue:'a previsão de entrega está vencida',missing_forecast:'a demanda ainda necessita de uma previsão de entrega',stale_appointment:'a demanda possui previsão, mas está há mais de cinco dias úteis sem apontamentos',idle:'a demanda permanece sem movimentação efetiva'};
export function composeRobotMessage(actions){
 const level=Math.max(...actions.map(x=>x.level));const details=actions.map(x=>labels[x.key]).filter(Boolean).join('; ');
 const intro=level===1?'Durante nosso acompanhamento, identificamos que':level===2?'Retomando nosso acompanhamento, verificamos que':'Durante nosso acompanhamento, percebemos que ainda precisamos de atenção especial, pois';
 return 'Olá! Tudo bem?\n\n'+intro+' '+details+'. Poderia, por gentileza, verificar o andamento e nos informar se existe algum impedimento ou necessidade de apoio? '+(level===3?'Podemos alinhar juntos os próximos passos.':'Estamos à disposição para ajudar.')+'\n\nAtenciosamente,\nTicket Manager | Gestão da Qualidade\nArquem Sistemas';
}
