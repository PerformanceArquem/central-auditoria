const scopes=[['all','Três grupos'],['intelligence','Inteligência e subsetores'],['production','Produção'],['support','Suporte']];
export function mountRobotOverviewControls(root,{authorize,beforeRead,onData,getEpoch,request=fetch}) {
  const doc=root.ownerDocument;
  const node=(tag,text)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const title=node('h2','Visão dos setores · consulta em testes');
  const help=node('p','Consulta administrativa, sem gravação ou envio. Avalia previsões e identificação do responsável nos dados sincronizados. Históricos antigos ficam para revisão. Ausência de apontamentos e tempo na fila não são avaliados nesta consulta.');help.className='muted';
  const label=node('label','Grupo gerencial'),select=node('select');select.id='robot-overview-scope';select.className='tm-select';label.htmlFor=select.id;
  for(const [value,text] of scopes){const option=node('option',text);option.value=value;select.append(option);}select.value='all';label.append(select);
  const button=node('button','Consultar setores em modo leitura');button.type='button';
  const status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  root.replaceChildren(title,help,label,button,status);let serial=0;
  function invalidate(){serial++;status.textContent='';button.disabled=false;select.disabled=false;}
  button.addEventListener('click',async()=>{
    beforeRead();const epoch=getEpoch(),run=++serial,scope=select.value;
    button.disabled=true;select.disabled=true;status.textContent='Consultando os setores...';
    try {
      const token=await authorize();if(epoch!==getEpoch()||run!==serial)return;
      if(typeof token!=='string'||!token.trim())throw Error('Sessão não confirmada. Entre novamente.');
      const response=await request('/api/audit?route=robot-overview&scope='+encodeURIComponent(scope),{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store'});
      if(epoch!==getEpoch()||run!==serial)return;
      const data=await response.json();
      if(epoch!==getEpoch()||run!==serial)return;
      if(!response.ok)throw Error('Consulta não concluída. '+(response.status===503?'Esta visão ainda não foi habilitada neste ambiente.':response.status===409?'Limite de mil chamados atingido; selecione um grupo menor.':'Confira a sessão e tente novamente.'));
      if(data?.ok!==true||data.mode!=='read-only'||data.source!=='overview-read-only'||data.scope!==scope||data.complete!==true||data.deliveryEnabled!==false||data.writeEnabled!==false||!Array.isArray(data.alerts)||!Array.isArray(data.review)||!Array.isArray(data.tickets)||!Number.isInteger(data.recordsRead)||data.recordsRead<0||data.recordsRead>1000||data.tickets.length>1000||!Number.isFinite(Date.parse(data.referenceTime)))throw Error('Resposta incompleta ou não validada. Nenhum resultado foi exibido.');
      onData(data);status.textContent=data.recordsRead+' chamados na seleção consultada. Somente leitura; nenhum envio.';
    }catch(error){if(run===serial&&epoch===getEpoch())status.textContent=error.message;}
    finally{if(run===serial){button.disabled=false;select.disabled=false;}}
  });
  return {invalidate};
}
