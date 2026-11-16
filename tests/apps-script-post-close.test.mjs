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
    assert.match(source,/folder\.createFile\(blob\)/);
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
    assert.match(source,/\['Chamado','Data do trabalho','Colaborador','Antes','Depois','Diferença','Diferença \(min\)','Identificado em','No período'\]/);
    assert.match(source,/\(x\.delta<0\?'-':'\+'\)\+arquemH_\(Math\.abs\(x\.delta\)\),x\.delta,x\.observedAt/);
    assert.match(source,/sheet\.getRange\(2,7,row,1\)\.setNumberFormat/);
    assert.equal(context.arquemAmostraAjustes_().timing.adjustments.reduce((n,x)=>n+x.deltaMinutes,0),0);
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
      ARQUEM_ATTACHMENTS_VALIDATED:'true',
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

test('recovery audit preserves main administrative email delivery control',()=>{
  const source=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
  assert.ok(source.includes('import {assertEmailDeliveryEnabled,emailDeliveryAdmin}'));
  assert.ok(source.includes("if(action==='email_delivery_control')"));
  assert.ok(source.includes('await emailDeliveryAdmin(payload,req,db,E,validUrl())'));
  assert.equal(source.split('await assertEmailDeliveryEnabled(db)').length-1,2);
  assert.ok(source.includes("if (action === 'recovery_audit')"));
});

test('recovery audit remains authenticated, read-only and never dispatches email',()=>{
  const source=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
  const start=source.indexOf("if (action === 'recovery_audit') {");
  const end=source.indexOf("if (action === 'dispatch_health') {",start);
  assert.ok(start>=0&&end>start,'read-only admin recovery action must exist');
  const code=source.slice(start,end);
  const slash=String.fromCharCode(92);
  const expression='/^'+slash+'d{4}-'+slash+'d{2}-'+slash+'d{2}$/';
  const datePattern=new RegExp('^'+slash+'d{4}-'+slash+'d{2}-'+slash+'d{2}$');
  assert.equal(datePattern.test('2026-11-15'),true);
  assert.equal(datePattern.test('15/11/2026'),false);
  assert.ok(code.includes(expression),'ISO date guard must match digits');
  assert.ok(!code.includes(expression.replaceAll(slash,slash+slash)),'no double-escaped date regex');
  assert.ok(code.includes("new Date(start+'T12:00:00Z').toISOString().slice(0,10)!==start"));
  assert.match(code,/readOnly:true/);
  assert.match(code,/manualVerificationRequired:true/);
  assert.match(code,/automaticRetryAllowed:false/);
  assert.ok(code.includes('limit=101'),'query must fetch one extra record to detect truncation');
  assert.ok(code.includes('report_kind=in.(daily,weekly)'),'filter scheduled report kinds before pagination');
  assert.ok(code.includes('dispatch_key=not.like.preliminary:*'),'exclude preliminary records before pagination');
  assert.ok(code.includes('const records=(rows as R[]).slice(0,100).map(x=>('));
  assert.ok(code.includes("const start=String(payload.periodEnd||'')"),'period must be supplied explicitly');
  assert.ok(code.includes('dispatchKey:String(x.dispatch_key)'),'unique dispatch key required for audit');
  assert.ok(code.includes('recipientId:String(x.recipient_id)'),'recipient identity required for unique matches');
  assert.ok(code.includes('const truncated=(rows as R[]).length>100'));
  assert.ok(code.includes('records,total:records.length,truncated,complete:!truncated'));
  assert.ok(code.includes('possible_delivery_needs_verification'));
  assert.ok(code.includes('unconfirmed_failure_needs_verification'));
  assert.ok(code.includes("failureCategory:"));
  assert.ok(code.includes("'attachments_not_approved'"));
  assert.ok(code.includes("'provider_or_delivery_failure'"));
  assert.ok(!code.includes('failure:String(x.error_message'), 'provider errors must not be returned verbatim');
  assert.equal(code.includes('sendMail('),false);
  assert.equal(code.includes("method:'PATCH'"),false);
  assert.equal(code.includes("method:'POST'"),false);
  assert.equal(code.includes("method:'DELETE'"),false);
  assert.ok(source.includes("action === 'dispatch_health' || action === 'recovery_audit'"));
  assert.ok(source.includes('if (!await isAdmin(req))'));
});


test('final Apps Script doPost rejects unapproved post-close reports before MailApp',()=>{
  const source=readFileSync('apps-script/central-auditoria-emails-completo.gs','utf8');
  const start=source.indexOf('function doPost(e) {');
  const end=source.indexOf('function resposta(obj) {',start);
  assert.ok(start>=0&&end>start);
  let approved=false, sent=0;
  const props={getProperty(k){
    if(k==='MAIL_SECRET')return 'fixture-secret';
    if(k==='ARQUEM_ATTACHMENTS_VALIDATED')return 'true';
    return '';
  }};
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>props},
    arquemCapacidadesAnexos_:()=>({paperTemplateConfigured:true,postCloseAdjustmentsSupported:approved}),
    arquemCreateReportAttachments_:()=>[{name:'report.pdf'},{name:'report.xlsx'}],
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:()=>{sent++;}},
    resposta:obj=>obj,
    console:{error:()=>{}}
  });
  vm.runInContext(source.slice(start,end),ctx);
  const packet={schema:'arquem-mail-v1',timing:{status:'tracked',adjustments:[]}};
  const invoke=()=>ctx.doPost({postData:{contents:JSON.stringify({
    token:'fixture-secret',email:'test@example.org',assunto:'Relatório',texto:'Resumo',reportData:packet
  })}});
  assert.equal(invoke().sucesso,false);
  assert.equal(sent,0,'never send a report with timing prior to approval');
  approved=true;
  assert.equal(invoke().sucesso,true);
  assert.equal(sent,1,'approved report may proceed through final mail handler');
});

for(const path of paths){
  test(path+' capabilities are disabled until final attachment flag is true',()=>{
    const source=readFileSync(path,'utf8');
    const begin=source.indexOf('function arquemCapacidadesAnexos_()');
    const end=source.indexOf('\n/**',begin);
    assert.ok(begin>=0&&end>begin,'capability declaration must exist');
    const settings={
      ARQUEM_PAPEL_TIMBRADO_DOC_ID:'fixture-template',
      ARQUEM_ATTACHMENTS_VALIDATED_TEMPLATE_ID:'fixture-template',
      ARQUEM_ATTACHMENTS_VALIDATED_AT:'2026-11-16T10:00:00Z',
      ARQUEM_POST_CLOSE_VALIDATED_VERSION:'post-close-v1',
      ARQUEM_POST_CLOSE_VALIDATED_TEMPLATE_ID:'fixture-template',
      ARQUEM_POST_CLOSE_VALIDATED_AT:'2026-11-16T10:05:00Z',
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION:'post-close-v1',
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID:'fixture-template',
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT:'2026-11-16T10:06:00Z'
    };
    const ctx=vm.createContext({
      PropertiesService:{getScriptProperties:()=>({getProperty:key=>settings[key]||''})},
      DriveApp:{getFileById:()=>({
        getMimeType:()=> 'GOOGLE_DOCS',
        getLastUpdated:()=>new Date('2026-11-16T09:00:00Z')
      })},
      MimeType:{GOOGLE_DOCS:'GOOGLE_DOCS'}
    });
    vm.runInContext(source.slice(begin,end),ctx);
    let cap=ctx.arquemCapacidadesAnexos_();
    assert.equal(cap.paperTemplateConfigured,false);
    assert.equal(cap.postCloseAdjustmentsSupported,false);
    settings.ARQUEM_ATTACHMENTS_VALIDATED='true';
    cap=ctx.arquemCapacidadesAnexos_();
    assert.equal(cap.paperTemplateConfigured,true);
    assert.equal(cap.postCloseAdjustmentsSupported,true);
  });
}


test('clasp dry-run supports already reconciled source only after inventory guards',()=>{
  const src=readFileSync('apps-script/ci-clasp-reconcile-dry-run.mjs','utf8');
  assert.match(src,/duplicated\.length!==18 && duplicated\.length!==0/);
  assert.match(src,/original\.length!==6 \|\| afterNames\.size!==39/);
  assert.match(src,/if\(lostNames\.length\|\|newNames\.length\)/);
  assert.match(src,/if\(missingCritical\.length\)/);
  assert.match(src,/if\(previous\)throw Error\('Duplicate remains/);
  assert.match(src,/Manifesto original foi modificado/);
  assert.doesNotMatch(src,/clasp\s+(?:push|deploy)/);
});

test('executive and support recipients sharing an email keep independent dispatch identities',()=>{
  const dispatch=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
  const visual=readFileSync('supabase/functions/audit-email-dispatch/email-visuals.ts','utf8');
  const executiveId='1b8168c6-bec0-4f6d-a3f9-feaec63ed147';
  const supportId='8f44d5bc-0cd8-45da-97b2-c2407663083a';
  const from='2026-11-09',to='2026-11-15',kind='weekly';
  const key=(id)=>id+':'+kind+':'+from+':'+to;
  assert.notEqual(key(executiveId),key(supportId));
  assert.ok(dispatch.includes('const key = `${id}:${t.kind}:${t.from}:${t.to}`'));
  assert.ok(dispatch.includes('on_conflict=dispatch_key'));
  assert.ok(visual.includes("String(rec.id)==='1b8168c6-bec0-4f6d-a3f9-feaec63ed147'"));
  assert.ok(visual.includes("director?'ARQUEM':sectors.join(' / ')"));
  assert.ok(visual.includes('export function reportSubject('));
});

test('dispatch observability distinguishes attempts from provider acceptance and inbox delivery',()=>{
  const source=readFileSync('supabase/functions/audit-email-dispatch/index.ts','utf8');
  assert.ok(source.includes('const deliverySummary={'));
  assert.ok(source.includes('attempts:handled'));
  assert.ok(source.includes("providerAccepted:dispatchResults.filter(x=>x.status==='sent').length"));
  assert.ok(source.includes("failed:dispatchResults.filter(x=>x.status==='failed').length"));
  assert.ok(source.includes("skipped:dispatchResults.filter(x=>x.status==='skipped'||('skipped' in x && x.skipped!=null)).length"));
  assert.ok(source.includes('inboxDeliveryVerified:false'));
  assert.ok(source.includes('handled,deliverySummary'));
  assert.ok(source.includes('results:dispatchResults'));
});

test('safe release overlay uses audited 39-function source inventory without publishing',()=>{
  const overlay=readFileSync('apps-script/ci-clasp-safe-overlays.mjs','utf8');
  assert.ok(overlay.includes('existingNames.size!==39'));
  assert.ok(overlay.includes('functions=39 changed=2 preserved=37'));
  assert.ok(overlay.includes('doPostOriginal=true manifestOriginal=true'));
  assert.ok(overlay.includes("if(finalNames.get('doPost').text!==originalDoPost.text)"));
  assert.ok(overlay.includes("if(missing.length||added.length)throw Error"));
  assert.doesNotMatch(overlay,/clasp\\s+(?:push|deploy|create-version)/);
});

for (const path of paths) {
  test(path+' invalidates old visual signoff even when technical validation fails',()=>{
    const source=readFileSync(path,'utf8');
    const start=source.indexOf('function arquemHomologarAjustesSemEnvio()');
    const end=source.indexOf('function arquemCreateReportAttachments_',start);
    assert.ok(start>=0&&end>start);
    const approvals={
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT:'2026-11-16T10:00:00Z',
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION:'post-close-v1',
      ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID:'template'
    };
    const deleted=[];
    const ctx=vm.createContext({
      PropertiesService:{getScriptProperties:()=>({
        getProperty:key=>key==='ARQUEM_PAPEL_TIMBRADO_DOC_ID'?'template':(approvals[key]||''),
        deleteProperty:key=>{deleted.push(key);delete approvals[key];},
        setProperties:()=>{throw Error('Validation should not complete');}
      })},
      arquemValidarPublicacaoSemEnvio:()=>{throw Error('Simulated technical failure');}
    });
    vm.runInContext(source.slice(start,end),ctx);
    assert.throws(()=>ctx.arquemHomologarAjustesSemEnvio(),/Simulated technical failure/);
    assert.deepEqual(deleted,[
      'ARQUEM_POST_CLOSE_VISUAL_APPROVED_AT',
      'ARQUEM_POST_CLOSE_VISUAL_APPROVED_VERSION',
      'ARQUEM_POST_CLOSE_VISUAL_APPROVED_TEMPLATE_ID'
    ]);
    assert.equal(Object.keys(approvals).length,0);
  });
}
