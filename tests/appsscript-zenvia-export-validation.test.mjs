import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Testa a função de validação REAL do Apps Script com blobs simulados.
// Não consulta contas, não dispara e-mails e não altera o Google Drive.
const script=readFileSync('apps-script/arquem-relatorios-anexos.gs','utf8');
const start=script.indexOf('function arquemValidarAnexosVozChat_(attachments)');
const stop=script.indexOf('function arquemCreateReportAttachments_(packet)',start);
assert.ok(start>=0 && stop>start,'Função de validação não encontrada');
const fnSource=script.slice(start,stop);

const sheets=['Voz e Chat','Voz por dia','Voz por ramal','Metodologia canais'];
const xml=(missingSheet='',missingLabel='')=>({
  'xl/workbook.xml':'<workbook>'+sheets.filter(x=>x!==missingSheet)
    .map(x=>'<sheet name="'+x+'"/>').join('')+'</workbook>',
  'xl/sharedStrings.xml':'<sst>'+['CSAT','TMA','TME','Avaliações válidas','Notas 8–10']
    .filter(x=>!missingLabel || !x.includes(missingLabel))
    .map(x=>'<si><t>'+x+'</t></si>').join('')+'</sst>',
  'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row><c><v>5</v></c></row></sheetData></worksheet>'
});
const blob=(name,bytes,mime)=>({
  getName:()=>name,
  getContentType:()=>mime,
  getBytes:()=>Array.from(bytes),
  getDataAsString:()=>Buffer.from(bytes).toString('utf8')
});
const data=(missingSheet='',missingLabel='',pdf='%PDF-')=>({
  files:[
    blob('amostra.pdf',Buffer.from(pdf+'A'.repeat(120)),'application/pdf'),
    blob('amostra.xlsx',Buffer.from('PK'+'.'.repeat(200)),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ],
  extracted:xml(missingSheet,missingLabel)
});
function validate(sample,{failZip=false}={}){
  const context=vm.createContext({Utilities:{
    unzip:()=>{if(failZip)throw Error('zip failure');
      return Object.entries(sample.extracted).map(([name,value])=>blob(name,Buffer.from(value),'text/xml'));
    }
  }});
  vm.runInContext(fnSource,context);
  return context.arquemValidarAnexosVozChat_(sample.files);
}
test('aceita PDF e XLSX estruturados com abas e indicadores Zenvia',()=>{
  const result=validate(data());
  assert.equal(result.validated,true);
  assert.deepEqual(Array.from(result.sheets),sheets);
});
test('recusa XLSX sem a aba Voz por ramal',()=>{
  assert.throws(()=>validate(data('Voz por ramal')),/sem abas de Voz/);
});
test('recusa XLSX sem CSAT',()=>{
  assert.throws(()=>validate(data('','CSAT')),/sem indicadores obrigatórios/);
});
test('recusa arquivo que não é PDF',()=>{
  assert.throws(()=>validate(data('','','INVALID')),/PDF inválido/);
});
test('recusa XLSX quando descompactação falha',()=>{
  assert.throws(()=>validate(data(),{failZip:true}),/não é ZIP válido/);
});
test('recusa PDF/XLSX incompleto ou ausente',()=>{
  const sample=data();sample.files.pop();
  assert.throws(()=>validate(sample),/exatamente PDF e Excel/);
});
