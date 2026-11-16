import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const paths=[
  'apps-script/central-auditoria-emails-completo.gs',
  'apps-script/arquem-relatorios-anexos.gs'
];
const sample={
  timing:{status:'tracked',notice:'Conciliação em andamento',adjustmentCount:1,
    adjustments:[{ticketId:'100769',date:'2026-11-10',person:'Colaborador teste',
      previousMinutes:60,currentMinutes:90,deltaMinutes:30,
      observedAt:'2026-11-16T10:00:00Z',inCurrentPeriod:true}]}
};
for(const path of paths){
  test(path+' validates and renders post-close contract',()=>{
    const source=readFileSync(path,'utf8');
    const begin=source.indexOf('function arquemAjustesValidos_(');
    const end=source.indexOf('function arquemCreateReportAttachments_(',begin);
    assert.ok(begin>=0&&end>begin,'helpers must be present');
    const context=vm.createContext({});
    vm.runInContext(source.slice(begin,end),context);
    assert.equal(context.arquemAjustesValidos_(sample).total,1);
    assert.equal(context.arquemAjustesValidos_(sample).items[0].delta,30);
    assert.match(context.arquemAssinarAjustes_(sample).notice,/data original/);
    const unavailable={timing:{status:'unavailable',adjustments:[]}};
    assert.equal(context.arquemAjustesValidos_(unavailable).total,0);
    for(const status of ['no_comparison','restricted','unavailable']){
      const packet={timing:{status,notice:'Sem conciliação disponível',adjustments:[],adjustmentCount:0}};
      assert.equal(context.arquemAjustesValidos_(packet).items.length,0);
      assert.match(context.arquemAssinarAjustes_(packet).notice,/data original/);
    }
    const negative={timing:{...sample.timing,adjustments:[
      {...sample.timing.adjustments[0],previousMinutes:90,currentMinutes:60,deltaMinutes:-30}
    ]}};
    assert.equal(context.arquemAjustesValidos_(negative).items[0].delta,-30);
    const truncated={timing:{...sample.timing,adjustmentCount:150}};
    assert.equal(context.arquemAjustesValidos_(truncated).total,150);
    assert.equal(context.arquemAjustesValidos_(truncated).items.length,1);
    assert.throws(()=>context.arquemAjustesValidos_({
      timing:{...sample.timing,adjustments:[
        {...sample.timing.adjustments[0],date:'16/11/2026'}
      ]}
    }),/inválido/);
    assert.throws(()=>context.arquemAjustesValidos_({
      timing:{...sample.timing,adjustmentCount:0}
    }),/inválid/);
    assert.throws(()=>context.arquemAjustesValidos_({
      timing:{status:'tracked',adjustmentCount:1,
        adjustments:[{...sample.timing.adjustments[0],deltaMinutes:60}]}
    }),/inválido/);
    assert.match(source,/postCloseAdjustmentsSupported:postCloseReady/);
    assert.match(source,/function arquemHomologarAjustesSemEnvio\(/);
    assert.match(source,/Ajustes identificados após o fechamento/);
    assert.match(source,/Ajustes pós-fechamento/);
    assert.match(source,/setRichTextValues\(linked\)/);
  });
}
