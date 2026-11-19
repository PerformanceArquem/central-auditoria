// Homologação de interface SEM deploy: Chromium local no GitHub Actions,
// com HTML real dos cinco painéis + respostas integralmente fictícias.
// Não carregar a aplicação oficial, conectar contas, usar URLs externas ou
// fazer qualquer requisição de envio/alteração.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
const source=path=>readFileSync(resolve(root,path),'utf8');
const html=source('index.html');
const panels=[
  ['auditInsightsPanel','audit-readonly-insights-ui.js'],
  ['policyPreviewPanel','audit-alert-policy-ui.js'],
  ['queueFlowPreviewPanel','audit-queue-flow-ui.js'],
  ['qualityReviewPanel','audit-quality-review-ui.js'],
  ['productivityPreviewPanel','audit-productivity-preview-ui.js']
];
const fixtureDate='2026-11-19T19:00:00Z';
function extractPanel(id) {
  const marker='id="'+id+'"';
  const i=html.indexOf(marker);
  assert(i>=0,'Painel não encontrado no index.html: '+id);
  const start=html.lastIndexOf('<section',i);
  const end=html.indexOf('</section>',i);
  assert(start>=0&&end>i,'Seção HTML não identificada: '+id);
  const markup=html.slice(start,end+'</section>'.length);
  assert.equal((markup.match(/<section\b/g)||[]).length,1,
    'A extração precisa corresponder ao painel de produção sem seções aninhadas.');
  return markup;
}
const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map(x=>x[1]).join('\n');
assert(styles.length>10000,'Estilos reais da Central não encontrados.');
const screenshotDir=resolve(root,'artifacts/audit-visual-smoke');
mkdirSync(screenshotDir,{recursive:true});

function fixtures() {
  const base={mode:'dry-run',notificationsSent:0,changesWritten:0};
  return {
    '/api/audit-readonly-insights':{
      ...base,coverage:{openTickets:1,ticketsMayBePartial:false,appointmentsMayBePartial:false},
      alerts:{total:1,preview:[{ticketId:'3001',team:'Implantação',owner:'Colaborador Exemplo',
        kind:'SLA_VENCIDO',slaDue:fixtureDate,lastActionAt:'2026-11-15T19:00:00Z',
        messagePreview:'Por gentileza, atualizar o tratamento do chamado fictício.'}]},
      queues:{teams:[{team:'Implantação',open:1,verifiedEntry:1,queueDaysAverage:3,
        withoutMovementSevenDays:0,overdue:1}]},
      quality:{totalFlagged:1,preview:[{ticketId:'3001',team:'Implantação',
        owner:'Colaborador Exemplo',subject:'Implantação de unidade fictícia',
        signals:[{evidence:'Campo de acompanhamento requer revisão.'}]}]},
      productivity:{collaboratorsTotal:1,collaborators:[{
        collaborator:'Colaborador Exemplo',hours:2,appointmentCount:1,ticketCount:1,
        teams:['Implantação'],activities:[{activity:'Análise',minutes:120}]
      }]},
      period:{appointmentsFrom:'2026-10-22',appointmentsTo:'2026-11-18'},warnings:[]
    },
    '/api/audit-alert-policy-preview':{
      ...base,scanned:1,qualified:1,team:'Implantação',
      byType:{PREVENTIVO_24H:0,SLA_VENCIDO:1,ESCALONAMENTO_GESTOR:0,SEM_MOVIMENTACAO_7D:0},
      coverage:{partial:false},previewTruncated:false,
      preview:[{ticketId:'3001',ownerName:'Colaborador Exemplo',team:'Implantação',
        type:'SLA_VENCIDO',dueAt:fixtureDate,lastRealActionAt:'2026-11-15T19:00:00Z',
        recipient:'Responsável do chamado (prévia)',
        messagePreview:'Olá, tudo bem? Por gentileza, registrar os próximos passos.'}]
    },
    '/api/audit-queue-flow-preview':{
      ...base,coverage:{openTicketsInSnapshot:1,incompleteHistories:0,
        staleRecordsSkipped:0,potentiallyTruncated:false},
      queue:{teams:[{team:'Implantação',openTickets:1,verifiedQueueEntries:1,
        unverifiableQueueAge:0,averageVerifiedQueueDays:3,
        over15Days:0,withoutRealAction7Days:0}],
        detailsPreview:[{ticketId:'3001',team:'Implantação',owner:'Colaborador Exemplo',
          currentQueueDays:3,currentQueueSince:'2026-11-16T12:00:00Z',
          lastRealActionAt:'2026-11-15T19:00:00Z',queueEvidence:'ownerHistories',
          over15Days:false}]},
      movements:{total:1,routes:[{fromTeam:'Suporte',toTeam:'Implantação',transfers:1,
        uniqueTickets:1}]},
      windowDays:30
    },
    '/api/audit-quality-review':{
      ...base,nonConformitiesCreated:0,evaluated:1,candidates:1,staleSkipped:0,
      coverage:{potentiallyTruncated:false},previewTruncated:false,
      preview:[{ticketId:'3001',team:'Implantação',ownerName:'Colaborador Exemplo',
        subject:'Implantação de unidade fictícia',
        signals:[{code:'SEM_ACAO_7D',title:'Conferir última ação',
          reviewGuidance:'Validar evidência com a Qualidade, sem abrir NC.'}]}]
    },
    '/api/audit-quality-ai-draft':{
      ...base,nonConformitiesCreated:0,aiUsed:false,
      draft:'Orientação local simulada; verifique o procedimento publicado.',
      checklist:[{suggestion:'Consultar o histórico e conferir os registros.'}]
    },
    '/api/audit-productivity-preview':{
      ...base,period:{current:{from:'2026-10-22',to:'2026-11-18'},
        baseline:{from:'2026-09-24',to:'2026-10-21'}},
      coverage:{currentTruncated:false,baselineTruncated:false,
        holidaysFromConfiguredDeliveryCalendar:true},
      totals:{current:{hours:2,appointments:1,uniqueTickets:1,weekendHours:0,
        registeredHolidayHours:0},baseline:{hours:.75},
        varianceHours:1.25,variancePercent:166.7},
      byTeam:[{name:'Implantação',currentHours:2,baselineHours:.75,varianceHours:1.25,
        variancePercent:166.7,currentAppointments:1,currentUniqueTickets:1}],
      byCollaborator:[{name:'Colaborador Exemplo',currentHours:2,baselineHours:.75,
        varianceHours:1.25,variancePercent:166.7,currentAppointments:1,currentUniqueTickets:1}],
      byActivity:[{name:'Análise',currentHours:2,baselineHours:.75,varianceHours:1.25,
        variancePercent:166.7,currentAppointments:1,currentUniqueTickets:1}],
      weekly:[{from:'2026-11-12',to:'2026-11-18',baselineFrom:'2026-10-15',
        baselineTo:'2026-10-21',hours:2,baselineHours:.75,varianceHours:1.25,
        variancePercent:166.7,appointments:1}],
      capacity:{reason:'Escalas reais não homologadas.'}
    }
  };
}
async function harness(browser,viewport) {
  const page=await browser.newPage({viewport,acceptDownloads:true});
  const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.on('request',request=>{
    if(/^https?:/.test(request.url()))errors.push('Requisição externa inesperada: '+request.url());
  });
  await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><html lang="pt-BR"><head>'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>'+styles+
    '\nbody{display:block;margin:0;padding:20px;background:#f3f4f6;}' +
    'main{display:block;max-width:1220px;margin:0 auto;min-width:0;width:100%;}' +
    'section{margin:20px 0;max-width:100%;}' +
    '@media(max-width:650px){body{padding:8px;}.alert-heading{display:block;}.tw{overflow-x:auto;max-width:100%;}}'+
    '</style></head><body><main>'+panels.map(([id])=>extractPanel(id)).join('\n')+
    '</main></body></html>',{waitUntil:'domcontentloaded'});
  await page.evaluate(data=>{
    window.__auditVisualRequests=[];
    window.__authEnabled=true;
    window.tmAuth={getSession:async()=>window.__authEnabled?{access_token:'fictional-session'}:null};
    window.fetch=async(input,opts={})=>{
      const url=new URL(String(input),'https://fake.local');
      const method=(opts.method||'GET').toUpperCase();
      const body=opts.body?JSON.parse(opts.body):null;
      window.__auditVisualRequests.push({path:url.pathname,method,body,
        team:url.searchParams.get('team'),days:url.searchParams.get('days')});
      if(!Object.hasOwn(data,url.pathname))throw Error('Blocked endpoint '+url.pathname);
      if(url.pathname==='/api/audit-quality-ai-draft'){
        if(method!=='POST'||!body?.externalAiConsent||
          !Array.isArray(body.signalCodes)||body.signalCodes.some(x=>x!=='SEM_ACAO_7D')||
          Object.keys(body).some(x=>!['signalCodes','externalAiConsent'].includes(x)))
          throw Error('Invalid AI privacy/consent fixture');
      }else if(method!=='GET')throw Error('Read-only endpoint received '+method);
      const payload=structuredClone(data[url.pathname]);
      if(url.pathname==='/api/audit-alert-policy-preview'&&url.searchParams.get('team'))
        payload.team=url.searchParams.get('team');
      return {ok:true,status:200,json:async()=>payload};
    };
  },fixtures());
  for(const [,path] of panels)await page.addScriptTag({content:source(path)});
  return {page,errors};
}

test('desktop: five working previews, local AI consent gate and offline CSV',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROME_BIN||undefined,args:['--no-sandbox']});
  try{
    const {page,errors}=await harness(browser,{width:1440,height:900});
    try{
      await page.locator('#auditInsightsRun').click();
      await page.waitForFunction(() => document.getElementById('auditInsightsStatus')?.textContent.includes('Prévia gerada sem envios'));
      assert.equal(await page.locator('#auditInsightsAlerts tr').count(),1);

      await page.locator('#policyPreviewTeam').selectOption('Suporte');
      await page.locator('#policyPreviewRun').click();
      await page.waitForFunction(() => document.getElementById('policyPreviewStatus')?.textContent.includes('Simulação concluída para Suporte'));
      assert.equal(await page.locator('#policyPreviewRows tr').count(),1);

      await page.locator('#queueFlowPreviewRun').click();
      await page.waitForFunction(() => document.getElementById('queueFlowPreviewStatus')?.textContent.includes('Prévia concluída'));
      assert.equal(await page.locator('#queueFlowRouteRows tr').count(),1);

      await page.locator('#qualityReviewRun').click();
      await page.waitForFunction(() => document.getElementById('qualityReviewStatus')?.textContent.includes('Nenhuma não conformidade registrada'));
      await page.locator('button[data-quality-index="0"]').click();
      assert.match(await page.locator('#qualityAiDraft').innerText(),/Nenhuma conclusão de NC/i);

      await page.locator('#qualityAiGenerate').click();
      assert.match(await page.locator('#qualityAiStatus').innerText(),/Marque a autorização explícita/i);
      assert.equal((await page.evaluate(()=>window.__auditVisualRequests))
        .filter(x=>x.path==='/api/audit-quality-ai-draft').length,0);

      await page.locator('#qualityAiConsent').check();
      await page.locator('#qualityAiGenerate').click();
      await page.waitForFunction(() => document.getElementById('qualityAiStatus')?.textContent.includes('Gemini não utilizado'));
      assert.match(await page.locator('#qualityAiDraft').innerText(),/Orientação local simulada/i);

      await page.locator('#productivityPreviewRun').click();
      await page.waitForFunction(() => document.getElementById('productivityPreviewStatus')?.textContent.includes('Comparação:'));
      assert.match(await page.locator('#productivityCapacity').innerText(),/não calculadas/i);
      assert.equal(await page.locator('#productivityTeamRows tr').count(),1);

      const [download]=await Promise.all([
        page.waitForEvent('download'),
        page.locator('#productivityCsv').click()
      ]);
      assert.match(download.suggestedFilename(),/^produtividade-apontamentos-.*\.csv$/);

      const requests=await page.evaluate(()=>window.__auditVisualRequests);
      assert.equal(requests.length,6);
      assert.equal(requests.filter(x=>x.method==='POST').length,1);
      assert.equal(requests.filter(x=>x.method==='GET').length,5);
      assert.equal(requests.find(x=>x.path==='/api/audit-alert-policy-preview').team,'Suporte');
      assert.deepEqual(requests.find(x=>x.method==='POST').body,{
        signalCodes:['SEM_ACAO_7D'],externalAiConsent:true
      });
      assert.deepEqual(errors,[]);
      await page.screenshot({path:resolve(screenshotDir,'desktop-five-panels.png'),fullPage:true});
    }finally{await page.close()}
  }finally{await browser.close()}
});

test('mobile: five panels render and remain usable without live requests',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROME_BIN||undefined,args:['--no-sandbox']});
  try{
    const {page,errors}=await harness(browser,{width:390,height:844});
    try{
      for(const id of ['auditInsightsRun','policyPreviewRun','queueFlowPreviewRun',
        'qualityReviewRun','productivityPreviewRun']){
        const btn=page.locator('#'+id);
        assert.equal(await btn.count(),1);
        assert.equal(await btn.isVisible(),true,'Mobile button hidden: '+id);
      }
      await page.locator('#queueFlowPreviewRun').click();
      await page.waitForFunction(() => document.getElementById('queueFlowPreviewStatus')?.textContent.includes('Prévia concluída'));
      await page.locator('#productivityPreviewRun').click();
      await page.waitForFunction(() => document.getElementById('productivityPreviewStatus')?.textContent.includes('Comparação:'));
      assert.deepEqual(errors,[]);
      await page.screenshot({path:resolve(screenshotDir,'mobile-five-panels.png'),fullPage:true});
    }finally{await page.close()}
  }finally{await browser.close()}
});

test('expired session: no analytics fetch or accidental notifications',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUDIT_CHROME_BIN||undefined,args:['--no-sandbox']});
  try{
    const {page,errors}=await harness(browser,{width:1280,height:800});
    try{
      await page.evaluate(()=>window.__authEnabled=false);
      await page.locator('#auditInsightsRun').click();
      await page.waitForFunction(() => document.getElementById('auditInsightsStatus')?.textContent.includes('Entre novamente'));
      await page.locator('#qualityReviewRun').click();
      await page.waitForFunction(() => document.getElementById('qualityReviewStatus')?.textContent.includes('Faça login novamente'));
      assert.equal((await page.evaluate(()=>window.__auditVisualRequests)).length,0);
      assert.deepEqual(errors,[]);
    }finally{await page.close()}
  }finally{await browser.close()}
});
