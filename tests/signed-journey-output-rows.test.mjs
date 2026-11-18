import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const sample={
 title:'Relatório diário — homologação',from:'2026-11-17',to:'2026-11-17',
 metrics:{minutes:457,appointments:1,tickets:1},
 collaborators:[{name:'Exemplo',sector:'Suporte',minutes:457,minimumMinutes:384,
  targetMinutes:480,minimumGap:0,targetGap:23,minimumBalance:73,targetBalance:-23}],
 daily:[
  {date:'2026-11-17',person:'Exemplo',sector:'Suporte',minutes:457,referenceMinutes:480,
   minimumMinutes:384,minimumBalance:73,targetBalance:-23,status:'Mínimo atingido'},
  {date:'2026-11-15',person:'Exemplo',sector:'Suporte',minutes:45,referenceMinutes:0,
   minimumMinutes:0,minimumBalance:null,targetBalance:null,status:'Dia não útil'}
 ],
 tickets:[],customers:[],activities:[]
};

for(const file of ['arquem-relatorios-anexos.gs','central-auditoria-emails-completo.gs']){
 test('linhas reais de PDF e XLSX preservam saldos: '+file,async()=>{
   const code=await readFile(new URL('../apps-script/'+file,import.meta.url),'utf8');
   const STOP={};
   const tables=[];
   const paragraph={
     setHeading(){return this},editAsText(){return this},
     setForegroundColor(){return this},setBold(){return this}
   };
   const body={
     appendParagraph(){return paragraph},
     appendHorizontalRule(){},
     appendTable(rows){
       tables.push(rows);
       if(rows[0]?.[0]==='Data'&&rows[0]?.includes('Saldo jornada'))throw STOP;
       return {};
     }
   };
   const docId='unit-doc';
   const context={
     console,Date,
     PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
     DocumentApp:{
       ParagraphHeading:{TITLE:'TITLE',HEADING1:'HEADING1',HEADING2:'HEADING2'},
       create:()=>({getId:()=>docId}),
       openById:()=>({getBody:()=>body})
     },
     DriveApp:{getFileById:()=>({getId:()=>docId})}
   };
   vm.createContext(context);
   vm.runInContext(code,context);
   try{context.arquemPdf_(sample,[]);assert.fail('PDF interceptação não ocorreu')}catch(e){if(e!==STOP)throw e}
   const peoplePdf=tables.find(t=>t[0][0]==='Colaborador');
   assert.ok(peoplePdf,'tabela colaborador ausente');
   assert.deepEqual(Array.from(peoplePdf[1].slice(-2)),['+01:13:00','-00:23:00']);
   const dayPdf=tables.find(t=>t[0][0]==='Data');
   assert.ok(dayPdf,'tabela diária ausente');
   assert.deepEqual(Array.from(dayPdf[1].slice(-2)),['+01:13:00','-00:23:00']);
   assert.deepEqual(Array.from(dayPdf[2].slice(-2)),['—','—']);

   const captured={};
   context.arquemSheet_=()=>({getRange:()=>({setNumberFormat(){}})});
   context.arquemCreateSheet_=(_ss,title,headers,rows)=>{
     captured[title]={headers,rows};
     if(title==='Dia a dia')throw STOP;
     return {getRange:()=>({setNumberFormat(){}})};
   };
   context.SpreadsheetApp={create:()=>({
     getId:()=> 'unit-sheet',
     getSheets:()=>[{setName(){},getRange:()=>({setNumberFormat(){}})}]
   })};
   try{context.arquemXlsx_(sample,[]);assert.fail('XLSX interceptação não ocorreu')}catch(e){if(e!==STOP)throw e}
   assert.equal(captured.Colaboradores.headers[7],'Saldo mínimo');
   assert.deepEqual(Array.from(captured.Colaboradores.rows[0].slice(7,9)),['+01:13:00','-00:23:00']);
   assert.equal(captured['Dia a dia'].headers[7],'Saldo jornada');
   assert.deepEqual(Array.from(captured['Dia a dia'].rows[0].slice(6,8)),['+01:13:00','-00:23:00']);
   assert.deepEqual(Array.from(captured['Dia a dia'].rows[1].slice(6,8)),['—','—']);
 });
}
