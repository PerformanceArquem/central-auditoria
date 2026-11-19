/* Etapa 5: métricas de horas efetivamente apontadas; sem qualquer envio. */
(function(){
  'use strict';
  let running=false,lastData=null;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
  const number=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2});
  const delta=v=>Number(v)>=0?'+'+number(v):number(v);
  const pct=v=>v===null||v===undefined?'Sem base anterior':(v>0?'+':'')+v.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const tr=(cells)=>'<tr>'+cells.map(t=>'<td>'+esc(t)+'</td>').join('')+'</tr>';
  function draw(id,rows,cols){
    const body=$(id);
    if(!body)return;
    body.innerHTML=rows.length?rows.join(''):'<tr><td colspan="'+cols+'">Sem dados válidos no recorte.</td></tr>';
  }
  function rowFor(x){
    return tr([x.name,number(x.currentHours)+' h',number(x.baselineHours)+' h',
      delta(x.varianceHours)+' h',pct(x.variancePercent),
      x.currentAppointments,x.currentUniqueTickets]);
  }
  async function previewProductivity(){
    const button=$('productivityPreviewRun'),status=$('productivityPreviewStatus'),
      metrics=$('productivityPreviewMetrics');
    if(!button||!status||!metrics||running)return;
    running=true;button.disabled=true;$('productivityCsv').disabled=true;
    lastData=null;metrics.textContent='';
    status.textContent='Consultando apontamentos reais sem registrar mudanças...';
    try{
      const session=await window.tmAuth?.getSession?.();
      if(!session?.access_token)throw Error('Sua sessão expirou. Faça login novamente.');
      const query=new URLSearchParams({
        days:$('productivityDays').value,comparison:$('productivityCompare').value
      });
      const response=await fetch('/api/audit-productivity-preview?'+query,{
        method:'GET',cache:'no-store',
        headers:{Authorization:'Bearer '+session.access_token,Accept:'application/json'}
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Dados de produtividade indisponíveis.');
      if(data.mode!=='dry-run'||data.notificationsSent!==0||data.changesWritten!==0)
        throw Error('Resposta sem as garantias de modo de simulação.');
      lastData=data;
      metrics.textContent=[
        number(data.totals.current.hours)+' h atuais',
        number(data.totals.baseline.hours)+' h anteriores',
        delta(data.totals.varianceHours)+' h de diferença',
        pct(data.totals.variancePercent),
        data.totals.current.appointments+' apontamentos',
        data.totals.current.uniqueTickets+' chamados com apontamento'
      ].join(' · ');
      draw('productivityTeamRows',(data.byTeam||[]).map(rowFor),7);
      draw('productivityPersonRows',(data.byCollaborator||[]).map(rowFor),7);
      draw('productivityActivityRows',(data.byActivity||[]).map(rowFor),7);
      draw('productivityWeekRows',(data.weekly||[]).map(x=>
        tr([x.from+' a '+x.to,x.baselineFrom+' a '+x.baselineTo,
          number(x.hours)+' h',number(x.baselineHours)+' h',
          delta(x.varianceHours)+' h',pct(x.variancePercent),x.appointments])
      ),7);
      const h=data.totals.current;
      $('productivityOutOfDays').textContent='No período atual: '+number(h.weekendHours)+
        ' h apontadas em fins de semana'+
        (h.registeredHolidayHours!==null?' · '+number(h.registeredHolidayHours)+
          ' h em feriados cadastrados (excluindo fins de semana).':
          ' · classificação de feriados indisponível.')+
        ' Estes registros não constituem prova de jornada contratual.';
      $('productivityCapacity').textContent='Capacidade e diferença de jornada: não calculadas. '+
        (data.capacity?.reason||'Faltam escalas validadas.');
      status.textContent='Comparação: '+data.period.current.from+' a '+data.period.current.to+
        ' versus '+data.period.baseline.from+' a '+data.period.baseline.to+
        '. '+(data.coverage.currentTruncated||data.coverage.baselineTruncated?
          'Atenção: limite de páginas atingido; valores parciais. ':'')+
        (data.coverage.holidaysFromConfiguredDeliveryCalendar?
          'Feriados conforme calendário de rotinas cadastrado. ':
          'Feriados sem validação completa. ')+
        'Sem envios ou gravações. Não interpretar apontamentos como avaliação individual.';
      $('productivityCsv').disabled=false;
    }catch(error){
      status.textContent='Comparativo não concluído: '+(error.message||'erro')+
        '. Nenhuma alteração foi realizada.';
      for(const id of ['productivityTeamRows','productivityPersonRows',
        'productivityActivityRows','productivityWeekRows'])draw(id,[],7);
    }finally{button.disabled=false;running=false;}
  }
  function csvField(v){
    let value=String(v??'');
    // Protege contra fórmulas interpretadas por Excel/Google Sheets.
    if(/^[\s]*[=+\-@\t\r]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  }
  function exportSummary(){
    if(!lastData)return;
    const d=lastData,rows=[['Grupo','Nome','Horas atuais','Horas base',
      'Variação (horas)','Variação (%)','Apontamentos atuais','Chamados com apontamento']];
    for(const [label,key] of [
      ['Equipe','byTeam'],['Colaborador','byCollaborator'],['Atividade','byActivity']
    ])for(const r of d[key]||[]){
      rows.push([label,r.name,r.currentHours,r.baselineHours,r.varianceHours,
        r.variancePercent===null?'Sem base':r.variancePercent,
        r.currentAppointments,r.currentUniqueTickets]);
    }
    const csv='\uFEFF'+rows.map(c=>c.map(csvField).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='produtividade-apontamentos-'+d.period.current.from+
      '-a-'+d.period.current.to+'.csv';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  window.previewProductivity=previewProductivity;
  window.exportProductivityCsv=exportSummary;
})();
