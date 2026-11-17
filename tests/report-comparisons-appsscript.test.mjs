import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script/arquem-comparativos.gs',import.meta.url),'utf8');
const row={label:'01/10/2026 a 31/10/2026',from:'2026-10-01',to:'2026-10-31',partial:false,incoming:3,workedTickets:4,appointments:5,minutes:1800,referenceMinutes:2400,minimumMinutes:1920,people:1};
const packet=()=>({comparisons:{version:'sector-comparisons-v1',monthly:[{...row},{...row,label:'01/11/2026 a 15/11/2026',partial:true}],weekly:[{...row}],sectors:[{...row,sector:'Qualidade',basis:'Chamados distintos com atividades registradas',historyAvailable:true}],historyComplete:true,note:'Horas pela data informada no apontamento.'}});
function harness(){
 const sheets=[],pdf=[],formatted=[],charts=[];
 const range={setValue(){return this}};
 const chart={setChartType(){return this},addRange(){return this},setPosition(){return this},setOption(){return this},build(){return this}};
 const ctx=vm.createContext({Number,Array,String,Error,
  arquemAddHeading_:(_body,title)=>pdf.push(title),arquemEstilizarTabelaPdf_:table=>table,
  arquemH_:minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0'),
  arquemExcelHora_:minutes=>minutes/1440,arquemFormatarHoras_:(sheet,columns,count)=>formatted.push({sheet:sheet.title,columns,count}),
  arquemCreateSheet_:(_ss,title,headers,rows)=>{const sheet={title,headers,rows,getRange:()=>range,newChart:()=>chart,insertChart:c=>charts.push(c)};sheets.push(sheet);return sheet},
  Charts:{ChartType:{COLUMN:'COLUMN'}}
 });vm.runInContext(source,ctx);
 return {ctx,sheets,pdf,formatted,charts,body:{appendTable:rows=>{pdf.push(rows);return rows},appendParagraph:text=>pdf.push(text)}};
}
test('PDF and Excel include both months, weekly data and the sector counting basis',()=>{
 const h=harness(),p=packet();h.ctx.arquemComparativosPdf_(h.body,p);h.ctx.arquemComparativosXlsx_({},p);
 assert.ok(h.pdf.includes('Comparativo de chamados, apontamentos e carga horária'));
 assert.ok(h.pdf.some(v=>Array.isArray(v)&&JSON.stringify(v).includes('Qualidade')));
 assert.deepEqual(h.sheets.map(s=>s.title),['Comparativo mensal','Comparativo semanal','Entradas por setor','Regras dos comparativos']);
 const monthly=h.sheets[0];assert.equal(monthly.rows[0][7],1800/1440);assert.equal(monthly.rows[1][3],'Sim');
 assert.equal(h.sheets[2].rows[0][3],3);assert.match(h.sheets[2].rows[0][9],/atividades/);
 assert.ok(h.formatted.some(f=>f.sheet==='Comparativo mensal'&&f.columns.includes(8)));assert.equal(h.charts.length,1);
});
test('invalid metric or schema blocks attachment generation; old packets remain supported',()=>{
 const h=harness();assert.equal(h.ctx.arquemComparativosValidos_({}),null);
 const p=packet();p.comparisons.monthly[0].minutes=-1;assert.throws(()=>h.ctx.arquemComparativosXlsx_({},p));
 const bad=packet();bad.comparisons.version='unknown';assert.throws(()=>h.ctx.arquemComparativosPdf_(h.body,bad));
});
