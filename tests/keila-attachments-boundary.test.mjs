import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script=readFileSync('apps-script/arquem-relatorios-anexos.gs','utf8');
const start=script.indexOf('function arquemCreateReportAttachments_(packet) {');
const end=script.indexOf('\nfunction arquemFilename_',start);
assert.ok(start>=0 && end>start,'Attachment generator must exist');
const functionSource=script.slice(start,end);
const fakeBlob=()=>({
  getBytes:()=>new Uint8Array([1,2,3]),
  setName:()=>{},
});
const captures=[];
const scope={
  arquemSanearPacote_:p=>structuredClone(p),
  arquemPdf_:(p)=>{captures.push(structuredClone(p));return fakeBlob();},
  arquemXlsx_:(p)=>{captures.push(structuredClone(p));return fakeBlob();},
  arquemFilename_:s=>s.replace(/\s+/g,'_'),
  DriveApp:{getFileById:()=>({setTrashed:()=>{}})},
};
vm.createContext(scope);
vm.runInContext(functionSource,scope);

const base=()=>({
  schema:'arquem-mail-v1',title:'Keila teste',from:'2026-11-11',to:'2026-11-11',
  metrics:{entered:1,exited:2},productionFlow:{entered:1,exited:2,
    movements:[{id:'123',client:'CONFIDENCIAL',responsible:'PESSOA RESTRITA'}]},
  tickets:[{id:'123',client:'CONFIDENCIAL'}],daily:[{person:'PESSOA RESTRITA'}],
  customers:[{name:'CONFIDENCIAL'}],productionQuality:[{name:'PESSOA RESTRITA'}],
  csatRatings:[{score:10}],timing:{adjustments:[{ticketId:'123'}]}
});

test('Keila attachment boundary strips personal information in both renderers',()=>{
  captures.length=0;
  const files=scope.arquemCreateReportAttachments_(base());
  assert.equal(files.length,2);
  assert.equal(captures.length,2);
  for(const p of captures){
    assert.equal(JSON.stringify(p.productionFlow),JSON.stringify({entered:1,exited:2}));
    assert.deepEqual(Object.keys(p.metrics).sort(),['entered','exited']);
    const serialized=JSON.stringify(p);
    for(const forbidden of ['CONFIDENCIAL','PESSOA RESTRITA','productionQuality','csatRatings','movements','timing','123'])
      assert.ok(!serialized.includes(forbidden),`Forbidden content: ${forbidden}`);
  }
});

test('Keila accepts zero totals and rejects invalid, negative, fractional and missing totals',()=>{
  const zero=base();zero.productionFlow={entered:0,exited:0};
  assert.equal(scope.arquemCreateReportAttachments_(zero).length,2);
  for(const invalid of [-1,NaN,1.5,undefined,'não numérico']){
    const p=base();p.productionFlow.entered=invalid;
    assert.throws(()=>scope.arquemCreateReportAttachments_(p),/inválidos/);
  }
});

test('Keila PDF and XLSX branches never include detailed movement tables',()=>{
  const pdf=script.slice(script.indexOf('function arquemPdf_('),script.indexOf('function arquemXlsx_('));
  const xlsx=script.slice(script.indexOf('function arquemXlsx_('),script.indexOf('function arquemSheet_('));
  assert.match(pdf,/if\(p\.productionFlow\)/);
  assert.doesNotMatch(pdf,/Entradas na Produção — chamados detalhados/);
  assert.doesNotMatch(xlsx,/\['Entradas',moves\.filter/);
  assert.ok(xlsx.includes('first.insertChart(chart)'),'Bar chart must be inserted');
  assert.ok(xlsx.includes('sheets.length!==1'),'Fail if XLSX has more than one tab');
  assert.ok(xlsx.includes("sheets[0].getName()!=='Resumo'"),'Only Resumo tab allowed');
  assert.ok(xlsx.includes('getCharts().length!==1'),'Require exactly one chart');
  assert.ok(xlsx.includes('indicadores de entrada/saida divergentes'),'Totals mismatch must fail');
});
