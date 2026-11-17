// Standalone Mini Central de Monitoria; never stores credentials outside Supabase Auth.
(()=>{
 const el=id=>document.getElementById(id);
 let client=null;
 async function init(){
  const status=el('loginStatus');
  try{
   const response=await fetch('/api/auth',{method:'GET',cache:'no-store'});
   const config=await response.json();
   if(!response.ok||!config.url||!config.key)throw Error('Configuração de autenticação não disponível');
   if(!window.supabase?.createClient)throw Error('Biblioteca de autenticação indisponível');
   client=window.supabase.createClient(config.url,config.key,{
     auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
     global:{headers:{'x-client-info':'arquem-mini-monitoria'}}
   });
   window.tmEmailAdminClient=client;
   window.tmAuth={getSession:async()=>{
     const {data:{session},error}=await client.auth.getSession();
     if(error||!session?.access_token)throw Error('Sessão expirada');
     const check=await client.auth.getUser();
     if(check.error||!check.data.user)throw Error('Sessão inválida');
     return (await client.auth.getSession()).data.session;
   }};
   const {data}=await client.auth.getSession();
   if(data.session)await verifyAndOpen();
  }catch(e){status.textContent=String(e.message||e)}
 }
 async function verifyAndOpen(){
  const status=el('loginStatus');
  try{
   const session=await window.tmAuth.getSession();
   const response=await fetch('/api/monitoria-reviews?kind=alerts',{
    headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||'Acesso à Monitoria ainda não configurado');
   const current=await client.auth.getUser();
   el('signedUser').textContent=current.data.user.email||'Usuário autorizado';
   el('userPanel').hidden=false;
   el('monitoriaLogin').hidden=true;
   el('monitoriaApp').hidden=false;
   status.textContent='';
   window.monitoriaRefreshAlerts?.();
   const url=new URL(location.href),rec=url.searchParams.get('recording'),kind=url.searchParams.get('kind');
   if(/^\d{1,14}$/.test(rec||'')&&['outbound','inbound'].includes(kind))
    window.monitoriaOpenRecording?.({id:rec,kind});
  }catch(e){
   el('monitoriaApp').hidden=true;
   el('monitoriaLogin').hidden=false;
   status.textContent='Acesso não liberado: '+String(e.message||e);
  }
 }
 document.addEventListener('DOMContentLoaded',()=>{
  el('monitoriaLogin').addEventListener('submit',async e=>{
    e.preventDefault();const status=el('loginStatus');status.textContent='Verificando conta…';
    if(!client){status.textContent='Autenticação indisponível';return}
    const {error}=await client.auth.signInWithPassword({
      email:el('monLoginEmail').value.trim(),
      password:el('monLoginPassword').value
    });
    el('monLoginPassword').value='';
    if(error){status.textContent='Não foi possível autenticar: '+error.message;return}
    await verifyAndOpen();
  });
  el('logout').addEventListener('click',async()=>{
   await client?.auth.signOut();location.replace('/monitoria.html');
  });
  init();
 });
})();
