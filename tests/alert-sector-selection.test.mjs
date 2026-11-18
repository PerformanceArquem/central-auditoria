import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function block(start,end){
 const i=html.indexOf(start),j=html.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i);
 return html.slice(i,j);
}
test('change handler maintains sector selection separately from synchronized tickets',()=>{
 assert.match(html,/<select id="alarmTeam" onchange="alarmTeamChanged\(this.value\)"/);
 const code=block("let alarmChosenTeam='';","// Destinatários cadastrados");
 assert.match(code,/const chosen=alarmChosenTeam\|\|select.value\|\|''/);
 assert.doesNotMatch(code,/teams.includes\(chosen\)\?chosen:''/);
});
test('sector remains selected across empty and partial sync refresh, clears only on user action',()=>{
 const code=block("let alarmChosenTeam='';","// Destinatários cadastrados");
 let select;
 class Option {constructor(text,value){this.text=text;this.value=value}}
 class Select {
  constructor(){this.options=[new Option('Todos os setores','')];this.value='';this.dataset={}}
  replaceChildren(){this.options=[];this.value=''}
  add(option){this.options.push(option)}
  set value(v){this._value=this.options.some(x=>x.value===v)?v:''}
  get value(){return this._value}
 }
 select=new Select();
 const context={Option,$:()=>select,renderAlerts:()=>{},};
 vm.createContext(context);
 vm.runInContext(code+';this.setOptions=alarmSetTeamOptions;this.selectTeam=alarmTeamChanged',context);
 context.setOptions([{team:'Suporte'},{team:'Produção'}]);
 context.selectTeam('Produção');
 assert.equal(select.value,'Produção');
 context.setOptions([{team:'Suporte'}]);
 assert.equal(select.value,'Produção','selected sector lost during partial sync');
 context.setOptions([]);
 assert.equal(select.value,'Produção','selected sector lost during empty sync');
 context.setOptions([{team:'Produção'},{team:'Suporte'}]);
 assert.equal(select.value,'Produção');
 context.selectTeam('');
 context.setOptions([{team:'Produção'},{team:'Suporte'}]);
 assert.equal(select.value,'');
});
