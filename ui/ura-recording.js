(function(){
 const id=new URLSearchParams(location.search).get('uraRecording');
 if(!id)return;
 async function open(){
  const panel=document.createElement('section');panel.className='card';panel.style.cssText='position:fixed;inset:10% 10% auto;z-index:99999;background:white;padding:24px';
  const title=document.createElement('h2');title.textContent='Gravação da ligação';const status=document.createElement('p');status.textContent='Validando acesso à gravação...';
  const back=document.createElement('a');back.href='/';back.textContent='Voltar à Central';panel.append(title,status,back);document.body.appendChild(panel);
  try{
   if(!/^[1-9]\d{0,14}$/.test(id))throw Error('Identificador de ligação inválido.');
   // tmAuth is registered before the asynchronous Supabase client initialization.
   for(let i=0;(!window.tmAuth?.getSession||!window.tmEmailAdminClient?.auth)&&i<60;i++)await new Promise(r=>setTimeout(r,500));
   if(!window.tmEmailAdminClient?.auth)throw Error('A autenticação ainda não carregou. Atualize esta página para tentar novamente.');
   const session=await window.tmAuth?.getSession?.();if(!session?.access_token)throw Error('Entre na Central e abra novamente o link da gravação.');
   const response=await fetch('/api/voice-reconciliation?'+new URLSearchParams({action:'recording',callId:id}),{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Gravação indisponível.');
   const url=new URL(data.url);if(url.protocol!=='https:'||url.username||url.password||!['voice-api.zenvia.com','voice-app.zenvia.com','api.evoline.com.br'].includes(url.hostname))throw Error('Link de gravação não autorizado.');
   location.replace(url.href);
  }catch(e){status.textContent=e.message||'Não foi possível abrir a gravação.';}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',open,{once:true});else open();
})();
