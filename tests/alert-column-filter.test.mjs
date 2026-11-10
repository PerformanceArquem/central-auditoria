import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('function applyRowFilter(t,key){');
const end=html.indexOf('function alarmClearColumnFilters(){',begin);
assert.ok(begin>=0&&end>begin,'função de filtragem não encontrada');
const source=html.slice(begin,end);
const getApply=(filterState,document)=>new Function('CFLT','cellTxt','document',source+'return applyRowFilter;')(
 filterState,c=>String(c.textContent||'').trim(),document
);
const mkHeader=i=>({dataset:{i:String(i)},querySelector:()=>({classList:{toggle(){}}})});
const mkRow=values=>({cells:values.map(text=>({textContent:text})),style:{display:''}});
function setup(headers,values,selected){
 const rows=values.map(mkRow),count={textContent:''},empty={classList:{toggle(name,yes){this.hidden=yes}}};
 const doc={getElementById(id){return id==='alarmColumnFilterCount'?count:id==='alarmColumnFilterEmpty'?empty:null}};
 const table={tHead:{rows:[{cells:headers.map(mkHeader)}]},tBodies:[{rows}]};
 const state={tAlarmOldest:{3:new Set(selected)}};
 const apply=getApply(state,doc);
 return {table,rows,count,empty,state,apply};
}
test('selecionar cliente não oculta a linha correspondente na ordem padrão',()=>{
 const x=setup([0,1,2,3,4],[['','97513','Comercial','Cliente A','Assunto'],['','96484','Direção','Cliente B','Assunto']],['Cliente B']);
 x.apply(x.table,'tAlarmOldest');
 assert.equal(x.rows[0].style.display,'none');
 assert.equal(x.rows[1].style.display,'');
 assert.match(x.count.textContent,/1 de 2/);
});
test('o filtro acompanha a identidade Cliente quando colunas são arrastadas',()=>{
 const x=setup([3,0,4,1,2],[['Cliente A','','Assunto','97513','Comercial'],['Cliente B','','Assunto','96484','Direção']],['Cliente B']);
 x.apply(x.table,'tAlarmOldest');
 assert.equal(x.rows[0].style.display,'none');
 assert.equal(x.rows[1].style.display,'');
 assert.equal(x.empty.classList.hidden,true);
});
test('nenhuma seleção restaura todas as linhas',()=>{
 const x=setup([3,0,4,1,2],[['Cliente A','','Assunto','97513','Comercial'],['Cliente B','','Assunto','96484','Direção']],[]);
 x.rows[0].style.display='none';x.rows[1].style.display='none';
 x.apply(x.table,'tAlarmOldest');
 assert.deepEqual(x.rows.map(r=>r.style.display),['','']);
 assert.equal(x.count.textContent,'Nenhum filtro de coluna ativo.');
});
test('filtro por nome sem correspondência explica o vazio em vez de parecer perda de dados',()=>{
 const x=setup([3,0,4,1,2],[['Cliente A','','Assunto','97513','Comercial'],['Cliente B','','Assunto','96484','Direção']],['Cliente Z']);
 x.apply(x.table,'tAlarmOldest');
 assert.deepEqual(x.rows.map(r=>r.style.display),['none','none']);
 assert.equal(x.empty.classList.hidden,false);
 assert.match(x.count.textContent,/0 de 2/);
});
test('código aplica filtros depois de reorganizar as colunas',()=>{
 const start=html.indexOf('function enhanceTables(){'),end=html.indexOf('function orderFor(',start);
 const body=html.slice(start,end);
 assert.match(body,/perm\(t,ORD\[key\]\);applyRowFilter\(t,key\)/);
 assert.match(html,/onclick="alarmClearColumnFilters\(\)"/);
});
