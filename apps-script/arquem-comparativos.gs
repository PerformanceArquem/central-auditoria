// Extensão do gerador corporativo instalado. Não autentica nem envia e-mails.
function arquemComparativosValidos_(p){
 const data=p&&p.comparisons;if(!data)return null;
 if(data.version!=='sector-comparisons-v1'||!Array.isArray(data.monthly)||data.monthly.length!==2||
  !Array.isArray(data.weekly)||data.weekly.length>12||!Array.isArray(data.sectors)||data.sectors.length>60)
  throw Error('Comparativos inválidos');
 for(const row of data.monthly.concat(data.weekly,data.sectors)){
  for(const key of ['incoming','workedTickets','appointments','minutes','referenceMinutes','minimumMinutes'])
   if(!Number.isFinite(Number(row[key]))||Number(row[key])<0)throw Error('Métrica inválida no comparativo');
 }
 return data;
}
function arquemComparativosPdf_(body,p){
 const data=arquemComparativosValidos_(p);if(!data)return;
 arquemAddHeading_(body,'Comparativo de chamados, apontamentos e carga horária');
 if(!data.historyComplete)body.appendParagraph('Histórico de entradas incompleto; contagens podem estar parciais.');
 const table=(title,items)=>{
  arquemAddHeading_(body,title);
  arquemEstilizarTabelaPdf_(body.appendTable([['Período','Entradas¹','Chamados trabalhados','Apontamentos','Horas','Jornada ref.']].concat(items.map(r=>[
   String(r.label)+(r.partial?' · parcial':''),String(r.incoming),String(r.workedTickets),String(r.appointments),arquemH_(r.minutes),arquemH_(r.referenceMinutes)
  ]))));
 };
 table('Dois meses de referência',data.monthly);table('Semanas dos dois meses',data.weekly);
 arquemAddHeading_(body,'Chamados por setor · período do relatório');
 arquemEstilizarTabelaPdf_(body.appendTable([['Setor','Entradas / atividades¹','Apontamentos','Horas','Base']].concat(data.sectors.map(r=>[
  String(r.sector),String(r.incoming),String(r.appointments),arquemH_(r.minutes),String(r.basis)
 ]))));
 body.appendParagraph('¹ '+String(data.note||''));
}
function arquemComparativosXlsx_(ss,p){
 const data=arquemComparativosValidos_(p);if(!data)return;
 const headers=['Período','Início','Fim','Parcial','Entradas por setor¹','Chamados trabalhados','Apontamentos','Horas apontadas','Jornada de referência','Mínimo de referência','Pessoas com apontamento'];
 const sheet=(title,items)=>{
  const sh=arquemCreateSheet_(ss,title,headers,items.map(r=>[r.label,r.from,r.to,r.partial?'Sim':'Não',r.incoming,r.workedTickets,r.appointments,arquemExcelHora_(r.minutes),arquemExcelHora_(r.referenceMinutes),arquemExcelHora_(r.minimumMinutes),r.people]));
  arquemFormatarHoras_(sh,[8,9,10],items.length);return sh;
 };
 const months=sheet('Comparativo mensal',data.monthly);sheet('Comparativo semanal',data.weekly);
 const sectors=arquemCreateSheet_(ss,'Entradas por setor',
  ['Setor','Início','Fim','Chamados distintos¹','Trabalhados','Apontamentos','Horas','Jornada ref.','Mínimo ref.','Base da contagem','Histórico disponível'],
  data.sectors.map(r=>[r.sector,r.from,r.to,r.incoming,r.workedTickets,r.appointments,arquemExcelHora_(r.minutes),arquemExcelHora_(r.referenceMinutes),arquemExcelHora_(r.minimumMinutes),r.basis,r.historyAvailable?'Sim':'Parcial']));
 arquemFormatarHoras_(sectors,[7,8,9],data.sectors.length);
 arquemCreateSheet_(ss,'Regras dos comparativos',['Regra','Descrição'],[
  ['Método',data.note],['Data das horas','Data informada no apontamento. Não usa a data do cadastro da ação.'],
  ['Cobertura',data.historyComplete?'Histórico importado disponível':'Histórico de entradas incompleto; contagens podem estar parciais.']
 ]);
 months.getRange(1,12).setValue('Horas (numérico)');
 data.monthly.forEach((r,i)=>months.getRange(i+2,12).setValue(Number(r.minutes)/60));
 const chart=months.newChart().setChartType(Charts.ChartType.COLUMN)
  .addRange(months.getRange(1,1,3,1)).addRange(months.getRange(1,12,3,1))
  .setPosition(5,1,0,0).setOption('title','Horas apontadas · dois meses')
  .setOption('legend',{position:'none'}).build();months.insertChart(chart);
}
