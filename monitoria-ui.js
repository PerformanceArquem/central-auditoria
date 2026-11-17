/* Mini Central de Monitoria — fluxo assistido, sem envio automático ou persistência de mídia. */
(()=>{
 const $=id=>document.getElementById(id);
 let localAudioUrl='',selectedAudio=null,lastAnalysis=null,channel='chat';
 const status=(msg)=>{if($('monStatus'))$('monStatus').textContent=msg};
 const safeName=n=>String(n||'arquivo').replace(/[^\w.-]+/g,'_').slice(0,80);
 function download(name,text,type){
   const url=URL.createObjectURL(new Blob([text],{type}));
   const a=document.createElement('a');a.href=url;a.download=safeName(name);a.click();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 async function api(params,{binary=false}={}){
   const session=await window.tmAuth?.getSession?.();
   if(!session?.access_token)throw Error('Faça login como administrador autorizado.');
   const url='/api/monitoria-zenvia?'+new URLSearchParams(params);
   const res=await fetch(url,{headers:{Authorization:'Bearer '+session.access_token},
      credentials:'same-origin',cache:'no-store'});
   if(binary){
     if(!res.ok){const d=await res.json().catch(()=>({}));throw Error(d.error||'Áudio indisponível');}
     return await res.blob();
   }
   const body=await res.json().catch(()=>({}));
   if(!res.ok||body.ok!==true)throw Error(body.error||'Consulta indisponível');
   return body;
 }
 async function listCalls(){
   const start=$('monFrom').value,end=$('monTo').value;
   status('Consultando chamadas na Zenvia…');
   try{
     const data=await api({action:'calls',from:start,to:end,limit:40});
     const list=$('monCalls');list.replaceChildren();
     if(!data.calls.length){list.textContent='Nenhuma chamada localizada para este período.';return}
     for(const call of data.calls){
       const row=document.createElement('div');
       row.style.cssText='border:1px solid #dae2ee;border-radius:8px;padding:10px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
       const description=document.createElement('span');
       description.textContent='#'+call.id+' · '+call.direction+' · '+call.started+' · '+call.status+' · '+call.durationSeconds+'s';
       const button=document.createElement('button');button.type='button';button.className='s';
       button.textContent='Ouvir / baixar';
       button.title=call.recordingAvailable?'Carregar gravação da chamada':'Consultar se existe gravação para esta chamada';
       button.addEventListener('click',async()=>{
         button.disabled=true;status('Baixando gravação autenticada da Zenvia…');
         try{
           const media=await api({action:'audio',kind:call.kind,id:call.id},{binary:true});
           if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);
           selectedAudio=media;
           localAudioUrl=URL.createObjectURL(media);
           const player=$('monAudioPlayer');player.src=localAudioUrl;player.hidden=false;
           const link=$('monDownloadAudio');link.href=localAudioUrl;link.download='ligacao-'+call.id+'.mp3';link.hidden=false;
           $('monChannel').value='voice';channel='voice';
           status('Gravação carregada. Para análise pelo Gemini, informe a transcrição textual.');
         }catch(e){status('Falha ao carregar gravação: '+String(e.message||e));}
         finally{button.disabled=false;}
       });
       row.append(description,button);list.appendChild(row);
     }
     status(data.calls.length+' chamadas consultadas. Nenhuma gravação foi enviada ao Gemini.');
   }catch(e){status('Consulta de ligações: '+String(e.message||e));}
 }
 async function loadChat(){
   const protocol=$('monProtocol').value.trim();
   status('Consultando histórico de chat pelo protocolo…');
   try{
     const data=await api({action:'chat',protocol});
     const lines=data.messages.map(m=>'['+(m.at||'sem horário')+'] '+(m.sender||'Participante')+': '+m.text);
     $('monTranscript').value=lines.join('\n');
     $('monChannel').value='chat';channel='chat';
     status(data.messages.length+' mensagens carregadas da Zenvia. Revise o histórico antes de enviar ao Gemini.');
   }catch(e){status('Consulta de chat: '+String(e.message||e));}
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
 async function transcribe(){
   if(!$('monConsent')?.checked){status('Autorize o processamento do áudio pelo Gemini antes de transcrever.');return}
   if(!selectedAudio){status('Selecione uma gravação para transcrever.');return}
   if(selectedAudio.size>3*1024*1024){status('Transcrição direta limitada a 3 MB. Divida ou compacte o áudio antes de enviar.');return}
   const mimeType=selectedAudio.type||'audio/mpeg';
   if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/mp4','audio/m4a'].includes(mimeType)){
     status('Formato não suportado para transcrição. Converta para MP3, WAV, OGG, M4A ou WebM.');return
   }
   const button=$('monTranscribe');button.disabled=true;
   status('Transcrevendo áudio com Gemini. Revise o texto antes de avaliar.');
   try{
     const client=window.tmEmailAdminClient;
     const session=await window.tmAuth?.getSession?.();
     if(!client?.functions||!session?.access_token)throw Error('Faça login como administrador autorizado.');
     const audioBase64=await new Promise((resolve,reject)=>{
       const r=new FileReader();
       r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');
       r.onerror=()=>reject(Error('Não foi possível ler o áudio'));
       r.readAsDataURL(selectedAudio);
     });
     const {data,error}=await client.functions.invoke('monitoria-ai',{
       body:{action:'transcribe',consent:true,mimeType,audioBase64}
     });
     if(error||!data?.ok)throw Error(data?.error||error?.message||'Transcrição indisponível');
     $('monTranscript').value=data.transcript||'';
     $('monChannel').value='voice';channel='voice';
     lastAnalysis=null;$('monExportReview').disabled=true;
     status('Transcrição sugerida. Confira palavras, falantes e horários antes de solicitar a avaliação.');
   }catch(e){status('Transcrição: '+String(e.message||e));}
   finally{button.disabled=false;}
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
      selectedAudio=f;
      localAudioUrl=URL.createObjectURL(f);player.src=localAudioUrl;player.hidden=false;
      const link=$('monDownloadAudio');link.href=localAudioUrl;link.download=safeName(f.name);link.hidden=false;
      status('Áudio disponível para ouvir e baixar neste navegador. Nenhum arquivo foi enviado ao servidor.');
   });
   $('monChatFile').addEventListener('change',async e=>{
     const file=e.target.files?.[0];if(!file)return;
     if(!/\.(txt|csv)$/i.test(file.name)||file.size>150000){status('Use TXT ou CSV de até 150 KB.');return}
     $('monTranscript').value=await file.text();status('Conversa importada para conferência.');
   });
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   $('monFrom').value=today;$('monTo').value=today;
   $('monSearchCalls')?.addEventListener('click',listCalls);
   $('monLoadChat')?.addEventListener('click',loadChat);
   $('monTranscribe')?.addEventListener('click',transcribe);
   $('monRun').addEventListener('click',analyse);
   $('monExportChat').addEventListener('click',()=>download('chat_monitoria.txt',$('monTranscript').value,'text/plain;charset=utf-8'));
   $('monExportReview').addEventListener('click',()=>{if(lastAnalysis)download('avaliacao_monitoria.json',JSON.stringify(lastAnalysis,null,2),'application/json')});
   $('monResults').textContent='Selecione um canal e informe a conversa para iniciar.';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
 else init();
})();
