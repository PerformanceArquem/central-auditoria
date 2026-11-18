(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const nav=el('tabs'),search=el('workspaceNavSearch'),density=el('workspaceDensity'),toggle=el('workspaceMenuToggle');
  if(!nav||!search||!density||!toggle)return;
  const folders=[...nav.querySelectorAll('.nav-folder')];
  let beforeSearch=null;
  function filterModules(){
    const query=normalize(search.value.trim());
    if(query&&!beforeSearch)beforeSearch=folders.map(folder=>folder.open);
    let matches=0;
    folders.forEach((folder,index)=>{
      const section=normalize(folder.querySelector('summary')?.textContent);
      let visible=0;
      folder.querySelectorAll('button[data-t]').forEach(button=>{
        const match=!query||normalize(button.textContent+' '+section).includes(query);
        button.hidden=!match;visible+=Number(match);
      });
      folder.hidden=visible===0;matches+=visible;
      if(query&&visible)folder.open=true;
      if(!query&&beforeSearch)folder.open=beforeSearch[index];
    });
    if(!query)beforeSearch=null;
    el('workspaceNavEmpty').hidden=matches>0;
  }
  search.addEventListener('input',filterModules);
  search.addEventListener('keydown',event=>{
    if(event.key==='Escape'){search.value='';filterModules();}
    if(event.key==='Enter'){event.preventDefault();const first=nav.querySelector('button[data-t]:not([hidden])');first?.click();}
  });
  function setMenu(open){document.body.classList.toggle('workspace-nav-open',open);toggle.setAttribute('aria-expanded',String(open));}
  toggle.addEventListener('click',()=>setMenu(!document.body.classList.contains('workspace-nav-open')));
  nav.addEventListener('click',event=>{if(event.target.closest('button[data-t]'))setMenu(false);});
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!document.body.classList.contains('tm-locked')){
      event.preventDefault();if(matchMedia('(max-width:900px)').matches)setMenu(true);search.focus();search.select();
    }
    if(event.key==='Escape')setMenu(false);
  });
  try{density.value=localStorage.getItem('audit_workspace_density')==='compact'?'compact':'comfortable';}catch{}
  document.body.dataset.density=density.value;
  density.addEventListener('change',()=>{document.body.dataset.density=density.value;try{localStorage.setItem('audit_workspace_density',density.value);}catch{}});
  function update(tab=document.body.dataset.t){
    const button=nav.querySelector('button[data-t="'+String(tab).replace(/[^a-z-]/g,'')+'"]');
    const folder=button?.closest('.nav-folder');
    const category=folder?.querySelector('summary span:nth-child(2)')?.textContent||'Central de Auditoria';
    el('workspaceCategory').textContent=category;
    const name=button?button.textContent.replace(/[▦◈◉▤▥≡★⚙☎✉♙🏭🎧📊🕒🚨]/gu,'').replace(/\d+\s*$/,'').trim():'Início';
    el('workspaceCurrent').textContent=name;
    nav.querySelectorAll('button[data-t]').forEach(item=>{if(item===button)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
    // Local links group a long report into its existing sections; no duplicate data views.
    const panel=document.getElementById('t-'+tab),links=el('workspaceSections');links.replaceChildren();
    const sections=[...(panel?.querySelectorAll(':scope > .card h3')||[])].filter(h=>h.closest('.card')?.parentElement===panel);
    if(sections.length>=3){
      sections.slice(0,6).forEach((heading,index)=>{
        const card=heading.closest('.card');if(!card.id)card.id='workspace-section-'+tab+'-'+index;
        card.classList.add('workspace-section-target');
        const link=document.createElement('a');link.href='#'+card.id;link.textContent=heading.textContent;links.append(link);
      });
    }
    links.hidden=links.children.length===0;
    if(search.value){search.value='';filterModules();if(folder)folder.open=true;}
  }
  document.addEventListener('audit:tabchange',event=>update(event.detail.tab));
  const header=document.querySelector('body>header');
  if(header&&window.ResizeObserver)new ResizeObserver(()=>document.documentElement.style.setProperty('--workspace-header-height',header.offsetHeight+'px')).observe(header);
  update();
})();
