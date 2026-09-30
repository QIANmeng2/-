'use strict';
(() => {
  let category='basics', group='basics', workspace='schedule', editing=false, dirty=false, lastRaw=null, blocked=false, trainingRole='none';
  let catalog=updateTrainingBlockCatalog(trainingCatalog), history=[], sharedVersion=null, sharedCatalog=null, latestSharedVersion=0;
  const draftKey='bp-training-system:draft:v2';
  const revision=6;
  const book=document.getElementById('book'), search=document.getElementById('project-search');
  const status=document.getElementById('status'), openProjects=new Set();
  function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
  function message(text){status.textContent=text;status.hidden=!text;}
  function valid(value){
    if(!value||!['skills','basics','scenes'].every(key=>Array.isArray(value[key])))return false;
    const items=['skills','basics','scenes'].flatMap(key=>value[key]);
    return items.length<=500&&new Set(items.map(item=>item?.id)).size===items.length&&items.every(item=>item&&['id','title','scene','acceptance'].every(key=>typeof item[key]==='string'&&item[key].length<50000)&&/^[a-zA-Z0-9-]+$/.test(item.id)&&Array.isArray(item.rules)&&item.rules.length<=100&&item.rules.every(rule=>typeof rule==='string'&&rule.length<50000)&&(item.replays===undefined||typeof item.replays==='boolean')&&(item.sections===undefined||(Array.isArray(item.sections)&&item.sections.length<=50&&item.sections.every(section=>section&&typeof section.title==='string'&&typeof section.text==='string'&&section.title.length<200&&section.text.length<50000))));
  }
  function snapshot(){history.push({at:new Date().toISOString(),catalog:JSON.parse(JSON.stringify(catalog))});history=history.slice(-8);}
  function save(){
    dirty=true;
    try{
      if(blocked)throw Error('本机草稿不可用');
      if(localStorage.getItem(draftKey)!==lastRaw)throw Error('另一窗口已修改内容，请先导出本窗口备份');
      const raw=JSON.stringify({version:2,revision,catalog,history,sharedVersion});
      localStorage.setItem(draftKey,raw);lastRaw=raw;dirty=false;message('已保存');
    }catch(error){message('自动保存失败：'+error.message+'。请导出备份。');}
  }
  function download(raw,name){const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));const link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
  try{
    lastRaw=localStorage.getItem(draftKey);
    if(lastRaw){const value=JSON.parse(lastRaw);if(value.version!==2||!valid(value.catalog))throw Error('草稿格式异常');catalog=value.catalog;sharedVersion=Number.isInteger(value.sharedVersion)?value.sharedVersion:null;history=Array.isArray(value.history)?value.history.filter(item=>item&&valid(item.catalog)).slice(-8):[];
      if((value.revision||0)<revision){
        // Archive the complete previous draft before applying the requested meeting revision.
        localStorage.setItem(draftKey+':before-meeting:'+Date.now(),lastRaw);
        snapshot();
        if((value.revision||0)<3)catalog=updateTrainingMeetingCatalog(catalog,trainingCatalog);
        catalog=updateTrainingBlockCatalog(catalog);
        const reaction=catalog.skills.find(item=>item.id==='warmup');
        if(reaction&&['身体启动','反应/手速榜','反应与手速榜','反应手速榜'].includes(reaction.title))reaction.title='反应训练';
        save();
      }
    }
  }catch{blocked=true;message('已保留无法读取的草稿，本次展示默认内容。编辑后请导出备份。');}
  function tabs(container,items,selected,onSelect){
    container.replaceChildren();
    for(const [id,label] of items){const button=el('button',label);button.type='button';button.dataset.value=id;button.setAttribute('aria-pressed',String(id===selected));button.onclick=()=>onSelect(id);container.append(button);}
  }
  let dragging=null;
  function clearDrag(){document.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(node=>node.classList.remove('drop-before','drop-after','dragging'));dragging=null;}
  function moveItem(items,item,target,after){
    const from=items.indexOf(item),to=items.indexOf(target);
    if(from<0||to<0||from===to)return;
    const next=to+(after?1:0)-(from<to?1:0);
    if(next===from)return;
    snapshot();items.splice(from,1);items.splice(next,0,item);save();render();
  }
  function sortable(node,heading,items,item,label){
    const handle=el('button','⠿','icon-button drag-handle');handle.type='button';handle.draggable=true;
    handle.title='拖动排序';handle.setAttribute('aria-label','拖动排序：'+label);
    handle.onclick=event=>{event.preventDefault();event.stopPropagation();};
    handle.onkeydown=event=>{
      event.stopPropagation();
      if(!['ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const index=items.indexOf(item),offset=event.key==='ArrowUp'?-1:1;
      if(!items[index+offset])return;
      moveItem(items,item,items[index+offset],offset>0);
      [...book.querySelectorAll('.drag-handle')].find(button=>button.getAttribute('aria-label')==='拖动排序：'+label)?.focus();
    };
    handle.ondragstart=event=>{event.stopPropagation();dragging={items,item};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',label);node.classList.add('dragging');};
    handle.ondragend=clearDrag;
    node.ondragover=event=>{
      if(!dragging||dragging.items!==items)return;
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
      document.querySelectorAll('.drop-before,.drop-after').forEach(other=>other.classList.remove('drop-before','drop-after'));
      const box=node.getBoundingClientRect();node.classList.add(event.clientY<box.top+box.height/2?'drop-before':'drop-after');
      if(event.clientY<110)window.scrollBy(0,-18);else if(event.clientY>innerHeight-70)window.scrollBy(0,18);
    };
    node.ondrop=event=>{
      if(!dragging||dragging.items!==items)return;
      event.preventDefault();event.stopPropagation();const source=dragging.item,after=node.classList.contains('drop-after');clearDrag();moveItem(items,source,item,after);
    };
    heading.prepend(handle);
  }
  function courseContent(item,content){
    content.classList.add('course-content');
    const sections=item.sections||[];
    sections.forEach((section,index)=>{
      const chapter=el('section',undefined,'course-chapter'),heading=el('div',undefined,'chapter-heading');
      heading.append(el('span',String(index+1).padStart(2,'0'),'chapter-number'));
      if(editing){
        const title=el('input');title.className='chapter-title';title.value=section.title;title.setAttribute('aria-label','章节标题');title.oninput=()=>{section.title=title.value;save();};heading.append(title);
        const actions=el('div',undefined,'chapter-actions');
        const button=el('button','×','icon-button');button.title='删除内容';button.setAttribute('aria-label','删除内容');
        button.onclick=()=>{if(!confirm('删除“'+section.title+'”？'))return;snapshot();sections.splice(index,1);save();render();};actions.append(button);
        heading.append(actions);
        sortable(chapter,heading,sections,section,section.title||'空白内容');
      }else heading.append(el('h2',section.title));
      chapter.append(heading);
      if(editing){const body=el('textarea');body.className='chapter-body';body.setAttribute('aria-label','章节正文：'+section.title);body.value=section.text;body.rows=8;body.oninput=()=>{section.text=body.value;body.style.height='auto';body.style.height=Math.max(220,body.scrollHeight)+'px';save();};chapter.append(body);}
      else{
        const body=el('div',undefined,'chapter-text');
        for(const paragraph of section.text.split(/\n+/).filter(Boolean)){
          const line=el('p');const match=paragraph.match(/^(对抗路|打野|中路|发育路|游走|收口|回应示例|指令示例|决策收口)：(.*)$/);
          if(match){line.append(el('strong',match[1]+'：'),document.createTextNode(match[2]));}else line.textContent=paragraph;
          body.append(line);
        }
        chapter.append(body);
      }
      content.append(chapter);
    });
    if(editing){const add=el('button','添加内容','add-chapter');add.onclick=()=>{if(sections.length>=50){message('每个项目最多50段内容');return;}snapshot();item.sections??=[];item.sections.push({title:'新章节',text:''});save();render();const titles=book.querySelector(`[data-id="${item.id}"]`).querySelectorAll('.chapter-title');titles[titles.length-1].focus();};content.append(add);}
  }
  function render(){
    window.trainingReaction?.hide();
    const inCatalog=workspace==='catalog';
    book.hidden=!inCatalog;
    for(const [id,view] of [['catalog-open','catalog'],['schedule-open','schedule'],['players-open','players']])document.getElementById(id).setAttribute('aria-pressed',String(workspace===view));
    document.getElementById('edit').hidden=!inCatalog||trainingRole!=='planner';
    document.getElementById('publish-catalog').hidden=trainingRole!=='planner';
    document.getElementById('category-tabs').hidden=!inCatalog;
    document.querySelector('.toolbar').hidden=!inCatalog;
    if(!inCatalog){book.replaceChildren();window.trainingReaction?.create(book,workspace);return;}
    tabs(document.getElementById('category-tabs'),[['basics','基本功'],['scenes','情景训练'],['skills','反应测试']],category,id=>{category=id;search.value='';render();window.scrollTo({top:0});});
    const sub=document.getElementById('group-tabs');sub.hidden=true;
    const terms=search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    document.getElementById('clear-search').hidden=!terms.length;
    const items=category==='skills'&&!editing?catalog.skills.filter(item=>item.id==='warmup'||item.id.startsWith('custom-')):catalog[category];
    book.replaceChildren();
    if(editing){const add=el('button','添加训练项目','add-project');add.onclick=()=>{snapshot();const item={id:'custom-'+crypto.randomUUID(),title:'新训练项目',scene:'',rules:[],acceptance:'',format:'blocks',sections:[]};items.push(item);search.value='';openProjects.clear();openProjects.add(item.id);save();render();book.querySelector(`[data-id="${item.id}"] input`).focus();};book.append(add);}
    let found=0;
    for(const item of items){
      const text=[item.title,item.scene,...item.rules,item.acceptance,...(item.sections||[]).flatMap(section=>[section.title,section.text])].join(' ').toLocaleLowerCase();
      if(!terms.every(term=>text.includes(term)))continue;
      found++;
      const detail=el('details',undefined,'project');detail.dataset.id=item.id;detail.open=openProjects.has(item.id);
      const summary=el('summary');
      if(editing){const input=el('input');input.value=item.title;input.className='title-input';input.setAttribute('aria-label','项目名称');input.onclick=event=>event.stopPropagation();input.onkeydown=event=>event.stopPropagation();input.oninput=()=>{item.title=input.value;save();};summary.append(input);}
      else summary.append(el('span',item.title));detail.append(summary);
      const content=el('div',undefined,'project-content');
      if(item.id==='warmup'&&!editing){
        const notes=el('details',undefined,'reaction-notes'),heading=el('summary','训练内容'),body=el('div');
        notes.append(heading,body);courseContent(item,body);content.append(notes);
      }else courseContent(item,content);
      if(item.id==='warmup'&&!editing&&detail.open)window.trainingReaction?.create(content);
      if(editing)sortable(detail,summary,items,item,item.title);
      if(editing){
        const options=el('div',undefined,'edit-actions'),label=el('label'),check=el('input');check.type='checkbox';check.checked=!!item.replays;check.onchange=()=>{item.replays=check.checked;save();};label.append(check,document.createTextNode('KPL 回放入口'));
        const remove=el('button','删除项目');remove.onclick=()=>{if(!confirm('删除“'+item.title+'”？可在更多中恢复。'))return;snapshot();items.splice(items.indexOf(item),1);openProjects.delete(item.id);save();render();};options.append(label,remove);content.append(options);
      }
      if(item.replays&&window.trainingAPI){
        const actions=el('div',undefined,'replay-actions'),select=el('select');select.setAttribute('aria-label','第一视角分路');
        for(const name of ['全部分路','对抗路','打野','中路','发育路','游走']){const option=el('option',name);option.value=name==='全部分路'?'':name;select.append(option);}
        const button=el('button','查看 KPL 回放');button.type='button';button.onclick=async()=>{button.disabled=true;try{const result=await window.trainingAPI.openReplays(select.value);if(!result?.ok)message(result?.message||'回放暂时无法打开');}catch{message('回放暂时无法打开，请重试');}finally{button.disabled=false;}};
        actions.append(select,button);content.append(actions);
      }
      detail.append(content);
      detail.addEventListener('toggle',()=>{
        if(!detail.isConnected)return;
        if(!detail.open){openProjects.delete(item.id);if(item.id==='warmup')window.trainingReaction?.hide();return;}
        if(item.id==='warmup'&&!editing&&!content.querySelector('.reaction-embed'))window.trainingReaction?.create(content);
        openProjects.add(item.id);
        book.querySelectorAll('.project').forEach(other=>{if(other!==detail&&other.open){other.open=false;openProjects.delete(other.dataset.id);}});
        requestAnimationFrame(()=>{const box=detail.getBoundingClientRect();if(box.top<75||box.bottom>innerHeight)detail.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});
      });
      book.append(detail);
    }
    if(!found)book.append(el('p','没有匹配的训练项目','empty'));
  }
  search.addEventListener('input',render);
  document.getElementById('clear-search').onclick=()=>{search.value='';render();search.focus();};
  document.getElementById('schedule-open').onclick=()=>{workspace='schedule';message('');render();};
  document.getElementById('players-open').onclick=()=>{workspace='players';message('');render();};
  document.getElementById('catalog-open').onclick=()=>{workspace='catalog';message('');render();};
  window.addEventListener('bp-training-navigate',event=>{if(['schedule','players'].includes(event.detail)){workspace=event.detail;for(const [id,view] of [['catalog-open','catalog'],['schedule-open','schedule'],['players-open','players']])document.getElementById(id).setAttribute('aria-pressed',String(workspace===view));}});
  document.getElementById('phone-open').onclick=()=>{document.getElementById('more').open=false;document.getElementById('phone-dialog').showModal();};
  document.getElementById('phone-close').onclick=()=>document.getElementById('phone-dialog').close();
  document.getElementById('phone-copy').onclick=async()=>{try{await navigator.clipboard.writeText('https://app.neondream.cn/reaction-training/');message('已复制链接');}catch{message('复制失败，请使用弹窗中的链接。');}};
  document.getElementById('publish-catalog').onclick=()=>{workspace='schedule';render();window.trainingReaction?.publishCatalog(catalog,sharedVersion).then(()=>message('已发布到团队')).catch(error=>message(error.message));document.getElementById('more').open=false;};
  document.getElementById('load-shared').onclick=()=>{if(!sharedCatalog||!valid(sharedCatalog)){message('请先打开训练安排读取团队内容。');return;}if(!confirm('载入团队内容？当前本地内容会保留恢复点。'))return;snapshot();catalog=JSON.parse(JSON.stringify(sharedCatalog));sharedVersion=latestSharedVersion;save();workspace='catalog';render();};
  document.getElementById('edit').onclick=()=>{if(trainingRole!=='planner')return;if(!editing)snapshot();editing=!editing;document.getElementById('edit').textContent=editing?'完成':'编辑';document.getElementById('edit').setAttribute('aria-pressed',String(editing));document.body.classList.toggle('editing',editing);render();};
  document.getElementById('backup').onclick=()=>download(JSON.stringify({format:'training-system',version:2,revision,catalog,history},null,2),'训练系统_内容备份_'+Date.now()+'.json');
  document.getElementById('restore').onclick=()=>document.getElementById('importfile').click();
  document.getElementById('importfile').onchange=async event=>{
    try{const file=event.target.files[0];if(!file)return;if(file.size>5000000)throw Error('备份超过5MB');const value=JSON.parse(await file.text());if(value.format!=='training-system'||value.version!==2||!valid(value.catalog))throw Error('请选择两大类新版训练内容备份，旧版草稿不会被覆盖');if(!confirm('用备份替换当前训练内容？当前内容将保留恢复点。'))return;snapshot();catalog=updateTrainingBlockCatalog(value.catalog);openProjects.clear();save();render();}catch(error){message('导入失败：'+error.message);}finally{event.target.value='';}
  };
  document.getElementById('history').onclick=()=>{if(!history.length){message('还没有可恢复的内容');return;}if(!confirm('恢复最近一次编辑或删除之前的内容？'))return;const previous=history.pop();catalog=updateTrainingBlockCatalog(previous.catalog);openProjects.clear();save();render();};
  // Keep the original v1 draft untouched while the redesigned editor uses its own key.
  try{
    const legacy=localStorage.getItem('bp-training-system:draft:v1');
    if(legacy){const button=document.getElementById('legacy-export');button.hidden=false;button.onclick=()=>{const url=URL.createObjectURL(new Blob([legacy],{type:'application/json;charset=utf-8'}));const a=el('a');a.href=url;a.download='训练系统_旧版原始草稿.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};}
  }catch{message('旧内容暂时无法读取；本页训练内容仍可查看。');}
  window.trainingAPI?.onTheme(theme=>document.body.classList.toggle('theme-light',theme==='light'));
  window.addEventListener('bp-training-role',event=>{if(trainingRole===event.detail)return;trainingRole=event.detail;document.getElementById('publish-catalog').hidden=trainingRole!=='planner';if(workspace==='catalog')render();});
  window.addEventListener('bp-training-catalog',event=>{latestSharedVersion=event.detail.version||0;sharedCatalog=event.detail.catalog;if(sharedVersion===null)sharedVersion=latestSharedVersion;if(trainingRole==='planner'||!valid(sharedCatalog))return;catalog=sharedCatalog;if(workspace==='catalog')render();});
  window.addEventListener('bp-training-published',event=>{sharedVersion=event.detail;save();});
  (async()=>{try{const result=window.trainingAPI?.reactionSession ? await window.trainingAPI.reactionSession() : window.trainingWebAuthorization ? {ok:true,session:await window.trainingWebAuthorization.session()} : null;if(result?.ok){trainingRole=result.session?.role||'none';if(workspace==='catalog')render();}}catch{}})();
  function closeTraining(){if(dirty&&!confirm('修改尚未保存，建议先导出备份。仍要关闭？'))return;window.trainingAPI?.close();}
  const close=document.getElementById('training-close');close.hidden=!window.trainingAPI?.close;close.onclick=closeTraining;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(document.getElementById('more').open)document.getElementById('more').open=false;else closeTraining();}});
  document.addEventListener('click',event=>{if(!event.target.closest('#more'))document.getElementById('more').open=false;});
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  render();
})();
