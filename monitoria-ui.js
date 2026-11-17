/* Mini Central de Monitoria — fluxo assistido, sem envio automático ou persistência de mídia. */
(()=>{
 const $=id=>document.getElementById(id);
 let localAudioUrl='',lastAnalysis=null,channel='chat';
 const status=(msg)=>{if($('monStatus'))$('monStatus').textContent=msg};
 const safeName=n=>String(n||'arquivo').replace(/[^\w.-]+/g,'_').slice(0,80);
 function download(name,text,type){
   const url=URL.createObjectURL(new Blob([text],{type}));
   const a=document.createElement('a');a.href=url;a.download=safeName(name);a.click();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 function render(analysis){
   const result=$('monResults');result.replaceChildren();
   const title=document.createElement('h3');
   title.textContent='Nota sugerida: '+analysis.scoreSuggestion+'/100 · '+(analysis.criticalFlag?'Possível falha crítica · revisão obrigatória':analysis.incomplete?'Avaliação incompleta':'Revisão da Qualidade pendente');
   result.appendChild(title);
   const subtitle=document.createElement('p');
   subtitle.textContent='Versão '+analysis.version+' · critérios verificáveis '+analysis.verifiedCriteria+'/'+analysis.totalCriteria+' · nenhuma penalidade definitiva automática';
   result.appendChild(subtitle);
   const table=document.createElement('table');table.style.width='100%';table.style.borderCollapse='collapse';
   const head=document.createElement('tr');
   for(const label of ['Código','Critério','Situação','Desconto','Evidência']){const th=document.createElement('th');th.textContent=label;th.style.textAlign='left';th.style.borderBottom='1px solid #cbd5e1';head.appendChild(th)}
   table.appendChild(head);
   for(const r of analysis.criteria){
    const tr=document.createElement('tr');
    for(const value of [r.code,r.name,r.decision,String(r.deducted),r.evidence||'Não disponível']){
      const td=document.createElement('td');td.textContent=value;td.style.padding='8px';td.style.borderBottom='1px solid #e2e8f0';tr.appendChild(td);
    }
    table.appendChild(tr);
   }
   result.appendChild(table);
   for(const c of analysis.critical.filter(x=>x.suspected)){
    const alert=document.createElement('p');alert.textContent='⚠ '+c.code+' — '+c.name+': análise crítica exige validação humana. '+c.evidence;result.appendChild(alert);
   }
   $('monExportReview').disabled=false;
 }
 async function analyse(){
   if(!($('monConsent')?.checked)){status('Autorize explicitamente o processamento da conversa pelo Gemini.');return}
   const transcript=$('monTranscript').value.trim();
   if(transcript.length<60){status('Informe uma transcrição completa ou importe o chat.');return}
   const button=$('monRun');button.disabled=true;status('Conferindo sessão e solicitando avaliação ao Gemini…');
   try{
     const client=window.tmEmailAdminClient;
     const session=await window.tmAuth?.getSession?.();
     if(!client?.functions||!session?.access_token)throw Error('Faça login com um usuário administrador autorizado.');
     const {data,error}=await client.functions.invoke('monitoria-ai',{body:{channel,transcript,consent:true}});
     if(error)throw Error(data?.error||error.message||'Erro ao consultar o Gemini');
     if(!data?.ok||!data.analysis)throw Error(data?.error||'Análise não disponibilizada');
     lastAnalysis=data.analysis;render(lastAnalysis);
     status('Avaliação sugerida pronta para conferência manual. Não foi gravada nem enviada.');
   }catch(e){status('Falha na análise: '+String(e.message||e));}
   finally{button.disabled=false}
 }
 function init(){
   if(!$('monTranscript'))return;
   $('monChannel').addEventListener('change',e=>{
      channel=e.target.value==='voice'?'voice':'chat';
      status(channel==='voice'?'Importe a gravação e forneça transcrição para análise.':'Importe ou cole o histórico do chat.');
   });
   $('monAudioFile').addEventListener('change',e=>{
      if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);
      const f=e.target.files?.[0];const player=$('monAudioPlayer');
      if(!f){player.removeAttribute('src');return}
      if(!f.type.startsWith('audio/')||f.size>100*1024*1024){status('Selecione um áudio de até 100 MB.');e.target.value='';return}
      localAudioUrl=URL.createObjectURL(f);player.src=localAudioUrl;player.hidden=false;
      const link=$('monDownloadAudio');link.href=localAudioUrl;link.download=safeName(f.name);link.hidden=false;
      status('Áudio disponível para ouvir e baixar neste navegador. Nenhum arquivo foi enviado ao servidor.');
   });
   $('monChatFile').addEventListener('change',async e=>{
     const file=e.target.files?.[0];if(!file)return;
     if(!/\.(txt|csv)$/i.test(file.name)||file.size>150000){status('Use TXT ou CSV de até 150 KB.');return}
     $('monTranscript').value=await file.text();status('Conversa importada para conferência.');
   });
   $('monRun').addEventListener('click',analyse);
   $('monExportChat').addEventListener('click',()=>download('chat_monitoria.txt',$('monTranscript').value,'text/plain;charset=utf-8'));
   $('monExportReview').addEventListener('click',()=>{if(lastAnalysis)download('avaliacao_monitoria.json',JSON.stringify(lastAnalysis,null,2),'application/json')});
   $('monResults').textContent='Selecione um canal e informe a conversa para iniciar.';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
