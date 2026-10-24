'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { id:null, image:null, points:[], dirty:false, items:[], total:0, uploading:false };
  async function api(url, options={}) {
    const response = await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers},body:options.body ? JSON.stringify(options.body) : undefined});
    const result = await response.json().catch(()=>({}));
    if (!response.ok) {
      if (response.status===401) show(false);
      throw new Error(result.error || 'The request could not be completed.');
    }
    return result;
  }
  function node(tag,text,className) { const el=document.createElement(tag); if(text!=null)el.textContent=text;if(className)el.className=className;return el; }
  function message(id,text,error=false) { $(id).textContent=text;$(id).className=error?'error':'success'; }
  function show(loggedIn) { $('login').hidden=loggedIn;$('studio').hidden=!loggedIn;$('logout').hidden=!loggedIn; }
  $('login').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('login').querySelector('button');button.disabled=true;
    try { await api('/api/admin/login',{method:'POST',body:{password:$('password').value}});$('password').value='';show(true);await load(); }
    catch(error){message('login-error',error.message,true);}finally{button.disabled=false;}
  });
  $('logout').onclick=async()=>{if(!discard())return;try{await api('/api/admin/logout',{method:'POST'});state.dirty=false;show(false);}catch(error){message('save-status',error.message,true);}};
  function discard(){return !state.dirty || confirm('Discard your unsaved changes?');}
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  $('editor').addEventListener('input',()=>{state.dirty=true;});
  function mode() {
    const trivia=$('kind').value==='trivia';
    $('trivia-fields').hidden=!trivia;$('clinical-fields').hidden=$('kind').value!=='clinical';
    $('body-label').textContent=trivia?'Trivia question (English) *':'Description (English)';
    $('answer').required=trivia;$('body').required=trivia;
  }
  $('kind').onchange=mode;
  function reset(entry) {
    $('editor').reset();state.id=entry?.id || null;state.image=entry?.image || null;state.points=structuredClone(entry?.hotspots || []);state.dirty=false;
    for(const key of ['kind','category','title','body','answer','status']) if(entry)$(key).value=entry[key];
    for(const key of ['title','body','answer']) $(key+'-bn').value=entry?.[key+'_bn'] || '';
    $('order').value=entry?.sort_order || 0;$('consent').checked=!!entry?.consent_confirmed;$('image-alt').value=entry?.image?.alt || '';
    $('editor-title').textContent=entry?'Edit entry':'New entry';$('entry-state').textContent=entry?.status || 'Unsaved';
    $('delete').hidden=!entry;$('preview-link').hidden=entry?.status!=='published';$('preview-link').href=entry?`/learn.html?id=${entry.id}`:'/learn.html';
    message('save-status','');message('upload-status','');mode();renderImage();renderPoints();renderEntries();
  }
  $('new').onclick=()=>{if(discard())reset();};
  function renderImage(){
    $('image-workspace').hidden=!state.image;$('remove-image').hidden=!state.image;
    if(state.image){$('image-preview').src=state.image.url;$('image-preview').alt=state.image.alt;}
    else{$('image-preview').removeAttribute('src');}
  }
  function renderMarkers(){
    $('point-markers').replaceChildren();
    state.points.forEach((point,index)=>{
      const marker=node('button',String(index+1),'marker');marker.type='button';marker.style.left=point.x+'%';marker.style.top=point.y+'%';marker.setAttribute('aria-label',`Edit label ${index+1}: ${point.label || 'Untitled'}`);
      marker.onclick=event=>{event.stopPropagation();const input=$('point-list').querySelectorAll('.point-card')[index].querySelector('input');input.focus();};
      $('point-markers').append(marker);
    });
  }
  function field(card,point,key,label,type='text'){
    const id=`point-${state.points.indexOf(point)}-${key}`,caption=node('label',label);caption.htmlFor=id;
    const input=node(type==='textarea'?'textarea':'input');input.id=id;input.value=point[key] || '';if(type==='textarea'){input.rows=2;input.maxLength=1500;}else{input.type=type;input.maxLength=120;}
    if(type==='number'){input.min='0';input.max='100';input.step='0.1';input.value=point[key];input.required=true;}
    input.oninput=()=>{point[key]=type==='number'?Number(input.value):input.value;state.dirty=true;renderMarkers();};
    card.append(caption,input);
  }
  function renderPoints(){
    $('point-list').replaceChildren();renderMarkers();
    state.points.forEach((point,index)=>{
      const card=node('section',null,'point-card'),head=node('div',null,'point-heading'),remove=node('button','Remove');remove.type='button';remove.onclick=()=>{state.points.splice(index,1);state.dirty=true;renderPoints();};head.append(node('h3',`Label ${index+1}`),remove);card.append(head);
      const position=node('div',null,'two'),x=node('div'),y=node('div');field(x,point,'x','X position (%)','number');field(y,point,'y','Y position (%)','number');position.append(x,y);card.append(position);
      field(card,point,'label','Structure / label *');field(card,point,'description','What is this structure?','textarea');field(card,point,'pathology','Common pathology','textarea');field(card,point,'symptoms','Associated symptoms','textarea');
      const translations=node('details');translations.append(node('summary','বাংলা translations'));
      field(translations,point,'label_bn','Structure / label (বাংলা)');field(translations,point,'description_bn','Description (বাংলা)','textarea');field(translations,point,'pathology_bn','Pathology (বাংলা)','textarea');field(translations,point,'symptoms_bn','Symptoms (বাংলা)','textarea');card.append(translations);$('point-list').append(card);
    });
  }
  function addPoint(x,y){
    if(state.points.length>=30){message('upload-status','Each image supports up to 30 labels.',true);return;}
    state.points.push({x:Math.round(x*10)/10,y:Math.round(y*10)/10,label:'',label_bn:'',description:'',pathology:'',symptoms:''});state.dirty=true;renderPoints();
  }
  $('image-canvas').onclick=event=>{if(event.target.closest('button'))return;const rect=$('image-preview').getBoundingClientRect();addPoint((event.clientX-rect.left)/rect.width*100,(event.clientY-rect.top)/rect.height*100);};
  $('add-point').onclick=()=>addPoint(50,50);
  $('remove-image').onclick=()=>{if(state.points.length&&!confirm('Detach the image and remove its labels?'))return;state.image=null;state.points=[];state.dirty=true;$('image-file').value='';renderImage();renderPoints();};
  $('image-file').onchange=async()=>{
    const file=$('image-file').files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>6*1024*1024){message('upload-status','Choose a PNG, JPEG or WebP no larger than 6 MB.',true);$('image-file').value='';return;}
    if(!$('image-alt').value.trim()){message('upload-status','Add an image description before uploading.',true);$('image-file').value='';$('image-alt').focus();return;}
    if(state.points.length&&!confirm('Replacing the image will remove existing labels. Continue?')){$('image-file').value='';return;}
    state.uploading=true;$('save').disabled=true;message('upload-status','Preparing and uploading image…');
    try{
      const bitmap=await createImageBitmap(file);
      if(bitmap.width>12000||bitmap.height>12000){bitmap.close();throw new Error('Choose an image with dimensions no greater than 12,000 pixels.');}
      const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      let encoded=canvas.toDataURL('image/webp',.9);
      // Base64 adds one third: keep JSON safely below Vercel's 4.5 MB limit.
      let quality=.8;
      while(encoded.length>4*1024*1024 && quality>=.5){encoded=canvas.toDataURL('image/webp',quality);quality-=.1;}
      for(let attempt=0;encoded.length>4*1024*1024 && attempt<5;attempt++){
        const smaller=document.createElement('canvas');smaller.width=Math.max(1,Math.round(canvas.width*.8));smaller.height=Math.max(1,Math.round(canvas.height*.8));smaller.getContext('2d').drawImage(canvas,0,0,smaller.width,smaller.height);canvas.width=smaller.width;canvas.height=smaller.height;canvas.getContext('2d').drawImage(smaller,0,0);encoded=canvas.toDataURL('image/webp',.8);
      }
      if(encoded.length>4*1024*1024)throw new Error('This image is too large to upload. Please use a smaller version.');
      const data=encoded.split(',')[1];
      state.image=await api('/api/admin/media',{method:'POST',body:{data,alt:$('image-alt').value.trim()}});state.points=[];state.dirty=true;renderImage();renderPoints();message('upload-status','Image uploaded privately. Save the entry to attach it.');
    }catch(error){message('upload-status',error.message,true);}finally{state.uploading=false;$('save').disabled=false;$('image-file').value='';}
  };
  $('editor').onsubmit=async event=>{
    event.preventDefault();if(state.uploading)return;
    const payload={};for(const key of ['kind','category','title','body','answer','status'])payload[key]=$(key).value;
    for(const key of ['title','body','answer'])payload[key+'_bn']=$(key+'-bn').value;
    Object.assign(payload,{sort_order:Number($('order').value),image_id:state.image?.id || null,hotspots:state.points,consent_confirmed:$('consent').checked});
    $('save').disabled=true;message('save-status','Saving…');
    try{if(state.image && $('image-alt').value.trim()!==state.image.alt){await api('/api/admin/media/'+state.image.id,{method:'PATCH',body:{alt:$('image-alt').value.trim()}});}
    const entry=await api('/api/admin/content'+(state.id?'/'+state.id:''),{method:state.id?'PUT':'POST',body:payload});reset(entry);message('save-status',entry.status==='published'?'Published. This entry is now visible in the learning library.':'Draft saved. This entry is private.');await load();}
    catch(error){message('save-status',error.message,true);}finally{$('save').disabled=false;}
  };
  $('delete').onclick=async()=>{
    if(!state.id||!confirm('Delete this content entry? Its image remains in the private media library until removed separately.'))return;
    try{await api('/api/admin/content/'+state.id,{method:'DELETE'});reset();await load();message('save-status','Entry deleted.');}catch(error){message('save-status',error.message,true);}
  };
  function renderEntries(){
    $('entries').replaceChildren();
    if(!state.items.length)$('entries').append(node('p','No entries yet. Create a draft to get started.','muted'));
    state.items.forEach(entry=>{
      const button=node('button',null,'entry');button.setAttribute('aria-current',String(state.id===entry.id));button.append(node('strong',entry.title),node('small',`${entry.kind} · ${entry.category} · ${entry.status}`));button.onclick=()=>{if(discard())reset(entry);};$('entries').append(button);
    });
    $('library-count').textContent=`${state.items.length} of ${state.total} entries`;$('more').hidden=state.items.length>=state.total;
  }
  let loadSequence=0;
  async function load(append=false){
    const sequence=++loadSequence,params=new URLSearchParams({q:$('filter').value,kind:$('kind-filter').value,status:$('status-filter').value,limit:'30',offset:String(append?state.items.length:0)});
    try{const result=await api('/api/admin/content?'+params);if(sequence!==loadSequence)return;state.items=append?state.items.concat(result.items):result.items;state.total=result.total;renderEntries();}catch(error){message('library-count',error.message,true);}
  }
  let timer;$('filter').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(),250);};$('kind-filter').onchange=()=>load();$('status-filter').onchange=()=>load();$('more').onclick=()=>load(true);
  $('load-media').onclick=async()=>{
    try{const result=await api('/api/admin/media');$('media-list').replaceChildren();for(const media of result.items){const row=node('div',null,'media-row'),image=node('img');image.src=media.url;image.alt=media.alt;const remove=node('button','Delete unused image');remove.onclick=async()=>{if(!confirm('Delete this unused image permanently?'))return;try{await api('/api/admin/media/'+media.id,{method:'DELETE'});row.remove();}catch(error){message('library-count',error.message,true);}};row.append(image,node('span',media.alt),remove);$('media-list').append(row);}if(!result.items.length)$('media-list').append(node('p','No uploaded images.'));}catch(error){message('library-count',error.message,true);}
  };
  reset();api('/api/admin/me').then(()=>{show(true);return load();}).catch(()=>show(false));
})();
