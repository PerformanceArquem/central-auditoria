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
    const preview=context.arquemAmostraAjustes_();
    assert.equal(preview.timing.adjustmentCount,2);
    assert.equal(context.arquemAjustesValidos_(preview).items.length,2);
    assert.deepEqual(Array.from(context.arquemAjustesValidos_(preview).items,x=>x.delta),[30,-30]);
    assert.ok(preview.timing.adjustments.every(x=>x.person.startsWith('Pessoa demonstrativa')));
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
    assert.match(source,/ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION/);
    assert.match(source,/ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID/);
    assert.match(source,/postVisualAt>=postCheckedAt/);
    assert.match(source,/postCloseAdjustmentsSupported:false/);
    assert.match(source,/function arquemPrepararRevisaoVisualAjustesSemEnvio\(/);
    assert.match(source,/ARQUEM_HOMOLOGACAO_FOLDER_ID/);
    assert.match(source,/folder\.createFile\(b\)/);
    assert.match(source,/props\.deleteProperty\('ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT'\)/);
    assert.match(source,/function arquemHomologarAjustesSemEnvio\(/);
    assert.match(source,/Ajustes identificados após o fechamento/);
    assert.match(source,/Ajustes pós-fechamento/);
    assert.match(source,/setRichTextValues\(linked\)/);
    // Resumo: header at row 1 and history at row 9 must survive additions.
    assert.match(source,/first\.getRange\(10,1,3,2\)\.setValues\(/);
    assert.match(source,/first\.getRange\('B5'\)\.setNumberFormat/);
    // Signed text prevents Excel's negative-time hash rendering.
    assert.match(source,/\(x\.delta<0\?'-':'\+'\)\+arquemH_\(Math\.abs\(x\.delta\)\)/);
    assert.match(source,/sheet\.getRange\(2,4,row,2\)\.setNumberFormat/);

  });
  test(path+' rejects public review folders before generating files',()=>{
    const source=readFileSync(path,'utf8');
    const start=source.indexOf('function arquemPrepararRevisaoVisualAjustesSemEnvio()');
    const end=source.indexOf('function arquemHomologarAjustesSemEnvio()',start);
    assert.ok(start>=0&&end>start);
    let homologations=0,created=0;
    const folder={getSharingAccess:()=> 'ANYONE_WITH_LINK',createFile:()=>{
      created++;return {getName:()=> 'sample.pdf',getUrl:()=> 'private-link',getId:()=> 'private-id'};
    }};
    const context=vm.createContext({
      PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-folder-id'})},
      DriveApp:{Access:{PRIVATE:'PRIVATE'},getFolderById:()=>folder},
      arquemHomologarAjustesSemEnvio:()=>{homologations++;return {technicalValidation:true,postCloseAdjustmentsSupported:false};},
      arquemCreateReportAttachments_:()=>[
        {getContentType:()=> 'application/pdf',getName:()=> 'sample.pdf'},
        {getContentType:()=> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',getName:()=> 'sample.xlsx'}
      ],
      arquemAmostraAjustes_:()=>({schema:'arquem-mail-v1'})
    });
    vm.runInContext(source.slice(start,end),context);
    assert.throws(()=>context.arquemPrepararRevisaoVisualAjustesSemEnvio(),/pasta.*público/);
    assert.equal(homologations,0,'public folder must be rejected before technical state changes');
    assert.equal(created,0,'no file may be created in public folder');
    folder.getSharingAccess=()=> 'PRIVATE';
    const result=context.arquemPrepararRevisaoVisualAjustesSemEnvio();
    assert.equal(result.sent,false);
    assert.equal(result.visualApprovalRequired,true);
    assert.equal(homologations,1);
    assert.equal(created,2);
  });

  test(path+' removes preview PDFs if saving the Excel fails',()=>{
    const source=readFileSync(path,'utf8');
    const start=source.indexOf('function arquemPrepararRevisaoVisualAjustesSemEnvio()');
    const end=source.indexOf('function arquemHomologarAjustesSemEnvio()',start);
    let attempts=0,trashCount=0;
    const blobs=[
      {getContentType:()=> 'application/pdf',getName:()=> 'report.pdf'},
      {getContentType:()=> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       getName:()=> 'report.xlsx'}
    ];
    const folder={
      getSharingAccess:()=> 'PRIVATE',
      createFile:blob=>{
        attempts++;
        if(attempts===2)throw Error('Drive quota exceeded');
        return {setTrashed:()=>{trashCount++;},getName:()=>blob.getName(),getUrl:()=> 'private',getId:()=> 'file-1'};
      }
    };
    const context=vm.createContext({
      PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-folder'})},
      DriveApp:{Access:{PRIVATE:'PRIVATE'},getFolderById:()=>folder},
      arquemHomologarAjustesSemEnvio:()=>({technicalValidation:true,postCloseAdjustmentsSupported:false}),
      arquemCreateReportAttachments_:()=>blobs,
      arquemAmostraAjustes_:()=>({schema:'arquem-mail-v1'})
    });
    vm.runInContext(source.slice(start,end),context);
    assert.throws(()=>context.arquemPrepararRevisaoVisualAjustesSemEnvio(),/quota exceeded/);
    assert.equal(attempts,2);
    assert.equal(trashCount,1);
  });

  test(path+' holds capability closed until technical and visual signoff',()=>{
    const source=readFileSync(path,'utf8');
    const start=source.indexOf('function arquemCapacidadesAnexos_()');
    const end=source.indexOf('function arquemTesteKeilaSemEnvio()',start);
    assert.ok(start>=0 && end>start);
    const approvals={
      ARQUEM_PAPEL_TIMBRADO_DOC_ID:'template-123',
      ARQUEM_ATTACHMENTS_VALIDATED_TEMPLATE_ID:'template-123',
      ARQUEM_ATTACHMENTS_VALIDATED_AT:'2026-11-16T11:00:00.000Z',
      ARQUEM_POST_CLOSE_VALIDATED_VERSION:'post-close-v1',
      ARQUEM_POST_CLOSE_VALIDATED_TEMPLATE_ID:'template-123',
      ARQUEM_POST_CLOSE_VALIDATED_AT:'2026-11-16T12:00:00.000Z'
    };
    const context=vm.createContext({
      PropertiesService:{getScriptProperties:()=>({
        getProperty:key=>approvals[key]||''
      })},
      DriveApp:{getFileById:()=>({
        getMimeType:()=> 'application/vnd.google-apps.document',
        getLastUpdated:()=>new Date('2026-11-16T10:00:00.000Z')
      })},
      MimeType:{GOOGLE_DOCS:'application/vnd.google-apps.document'}
    });
    vm.runInContext(source.slice(start,end),context);
    const check=()=>context.arquemCapacidadesAnexos_();
    assert.equal(check().paperTemplateConfigured,true);
    assert.equal(check().postCloseAdjustmentsSupported,false);
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION='post-close-v1';
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID='template-123';
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT='2026-11-16T11:59:59.000Z';
    assert.equal(check().postCloseAdjustmentsSupported,false,'visual approval before technical check invalid');
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT='2026-11-16T12:01:00.000Z';
    assert.equal(check().postCloseAdjustmentsSupported,true,'both approvals enable capability');
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID='different-template';
    assert.equal(check().postCloseAdjustmentsSupported,false,'different approved template must fail closed');
    approvals.ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID='template-123';
    approvals.ARQUEM_POST_CLOSE_VALIDATED_AT='2026-11-16T12:02:00.000Z';
    assert.equal(check().postCloseAdjustmentsSupported,false,'fresh technical check invalidates visual approval');
  });

}
