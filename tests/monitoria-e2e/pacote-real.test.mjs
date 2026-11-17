import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import JSZip from 'jszip';
import {jsPDF} from 'jspdf';
import * as XLSX from 'xlsx';

const source=readFileSync(new URL('../../monitoria-packages.js',import.meta.url),'utf8');
const elements=new Map();
const el=id=>{
 if(!elements.has(id))elements.set(id,{
  id,value:'',disabled:false,textContent:'',srcdoc:'',onclick:null,onchange:null,oninput:null,
  click(){}
 });
 return elements.get(id);
};
const clicked=[];
let binary=null;
const URLLike=class extends URL{
 static createObjectURL(blob){binary=blob;return 'blob:mock-download'}
 static revokeObjectURL(){}
};
const uuid='123e4567-e89b-42d3-a456-426614174001';
const approved={
 id:uuid,review_status:'approved',score_approved:95.5,score_suggested:94.5,
 channel:'chat',source_id:'102205',monitored_at:'2026-11-17',
 collaborator_name:'Colaborador Teste',reviewer_name:'Analista Qualidade',
 sector:'Suporte',criteria:[{id:'R02',decision:'conforme',deducted:0,evidence:'Bom dia',reason:'Atendimento validado'}],
 critical_confirmed:false,critical_findings:[],reviewer_notes:'Validada pela Qualidade',
 audit_monitoria_alerts:null
};
const voice={
 ...approved,id:'123e4567-e89b-42d3-a456-426614174002',channel:'voice',source_id:'1234567',
 recording_kind:'outbound',score_suggested:90,score_approved:90,critical_confirmed:true,
 critical_findings:[{code:'Z3',suspected:true,evidence:'Informação incorreta'}]
};
const provisional={
 ...approved,id:'123e4567-e89b-42d3-a456-426614174003',review_status:'provisional',
 score_approved:null,source_id:'102299'
};
const fetches=[];
const sandbox={
 URL:URLLike,URLSearchParams,Blob,Date,Number,String,Math,Array,Map,Set,
 JSON,encodeURIComponent,
 location:{origin:'https://central-auditoria-iota.vercel.app'},
 document:{
  readyState:'complete',getElementById:el,addEventListener(){},
  createElement(tag){
   assert.equal(tag,'a');
   return {href:'',download:'',click(){clicked.push(this.download)}};
  }
 },
 window:{XLSX,JSZip,jspdf:{jsPDF},tmAuth:{getSession:async()=>({access_token:'synthetic-test-jwt'})}},
 fetch:async (url,options)=>{
  fetches.push({url:String(url),options});
  if(String(url).includes('/api/monitoria-reviews')){
    return {ok:true,json:async()=>({ok:true,reviews:[approved,voice,provisional],partial:false})};
  }
  if(String(url).includes('/api/monitoria-movidesk')){
    return {ok:true,json:async()=>({ok:true,messages:[
      {at:'2026-11-17T09:10:00',sender:'Atendente',text:'Bom dia, como posso ajudar?'},
      {at:'2026-11-17T09:12:00',sender:'Cliente',text:'Preciso de atendimento.'}
    ],partial:false})};
  }
  throw Error('Unexpected network request: '+url);
 },
 setTimeout(){},
 globalThis:null
};
sandbox.globalThis=sandbox;
vm.runInNewContext(source,sandbox,{timeout:5000});
function assertPdf(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 assert.equal(Buffer.from(bytes.slice(0,5)).toString('ascii'),'%PDF-');
 assert.ok(bytes.byteLength>1800,'PDF generated should have substantive bytes');
}
test('gera ZIP verdadeiro com Excel, PDF final e extrato com informação de cobertura',async()=>{
 el('monPackagePeriod').value='monthly';
 el('monPackageAnchor').value='2026-11-17';
 el('monPackageCollaborator').value='Colaborador Teste';
 await el('monPackagePreviewButton').onclick();
 assert.equal(el('monPackageDownload').disabled,false);
 await el('monPackageDownload').onclick();
 assert.ok(binary instanceof Blob,'A download blob should be generated');
 assert.equal(clicked.length,1);
 assert.ok(clicked[0].endsWith('.zip'));
 const raw=Buffer.from(await binary.arrayBuffer());
 assert.equal(raw.subarray(0,2).toString(),'PK','ZIP file signature');
 const zip=await JSZip.loadAsync(raw);
 const filenames=Object.keys(zip.files);
 assert.ok(filenames.includes('Notas_Monitoria.xlsx'));
 assert.ok(filenames.includes('Relatorio_Final_Monitoria.pdf'));
 assert.ok(filenames.includes('Email_Corporativo_Previa.html'));
 assert.ok(filenames.some(x=>/^Interacoes_Movidesk\/Extrato_102205_/.test(x)));
 const report=await zip.file('Relatorio_Final_Monitoria.pdf').async('nodebuffer');
 assertPdf(report);
 const chatName=filenames.find(x=>/^Interacoes_Movidesk\/Extrato_102205_/.test(x));
 assertPdf(await zip.file(chatName).async('nodebuffer'));
 const excel=await zip.file('Notas_Monitoria.xlsx').async('nodebuffer');
 const wb=XLSX.read(excel,{type:'buffer'});
 assert.deepEqual(wb.SheetNames,['Notas','Critérios','Não Conformidades']);
 const values=XLSX.utils.sheet_to_json(wb.Sheets['Notas'],{header:1});
 assert.equal(values.length,3,'only approved reviews plus header');
 assert.ok(values.some(r=>r.includes('Analista Qualidade')&&r.includes(95.5)));
 assert.ok(!values.some(r=>r.includes('102299')),'provisional review should not leak to package');
 const html=await zip.file('Email_Corporativo_Previa.html').async('string');
 assert.ok(html.includes('monitoria_voice=1234567'));
 assert.ok(html.includes('review=123e4567-e89b-42d3-a456-426614174002'));
 assert.ok(!html.includes('synthetic-test-jwt'));
 const manifest=JSON.parse(await zip.file('MANIFESTO_MONITORIA.json').async('string'));
 assert.equal(manifest.approvedReviews,2);
 assert.equal(manifest.chatFullHistoryValidated,false);
 assert.equal(manifest.emailsSent,false);
 assert.equal(manifest.chatExtractsIncluded[0].fullChatVerified,false);
 assert.equal(fetches.filter(x=>x.url.includes('/api/monitoria-movidesk')).length,1);
 for(const request of fetches){
   assert.equal(request.options.headers.Authorization,'Bearer synthetic-test-jwt');
 }
});
