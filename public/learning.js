'use strict';
(() => {
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),bn=params.get('lang')==='bn';
  const strings={role:'নাক, কান ও গলা বিশেষজ্ঞ ও সার্জন',home:'মূল ওয়েবসাইট',eyebrow:'ইএনটি স্বাস্থ্য সম্পর্কে জানুন',title:'আরও কাছ থেকে জানুন।',intro:'ডা. নাফির প্রকাশিত অ্যানাটমি, ইএনটি ট্রিভিয়া ও ক্লিনিক্যাল ছবি দেখুন। ছবির নম্বরযুক্ত অংশে চাপ দিয়ে বিস্তারিত জানুন।',search:'লাইব্রেরিতে খুঁজুন',type:'বিষয়ের ধরন',allTypes:'সব বিষয়',anatomy:'অ্যানাটমি',trivia:'ইএনটি ট্রিভিয়া',clinical:'ক্লিনিক্যাল গ্যালারি',category:'অঙ্গ',allAreas:'সব অঙ্গ',ear:'কান',nose:'নাক',throat:'গলা',headNeck:'হেড ও নেক',apply:'খুঁজুন',showAll:'সব বিষয় দেখুন',more:'আরও দেখুন',note:'শুধু সাধারণ শিক্ষার জন্য। এসব ছবি ও তথ্য দিয়ে রোগ নির্ণয় করা যায় না এবং এগুলো ব্যক্তিগত চিকিৎসা পরামর্শের বিকল্প নয়।',booking:'চিকিৎসকের সাক্ষাৎ চান ↗'};
  const t=(en,bangla)=>bn?bangla:en;
  if(bn){document.documentElement.lang='bn';document.body.classList.add('bn');document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=strings[el.dataset.i18n]);$('search').placeholder='বিষয় বা প্রশ্ন খুঁজুন';$('back-home').href='/bn.html';$('learning-booking').href='/bn.html#appointment';$('learn-language').textContent='English';$('learn-language').lang='en';}
  const languageParams=new URLSearchParams(location.search);if(bn)languageParams.delete('lang');else languageParams.set('lang','bn');$('learn-language').href='?'+languageParams;
  function node(tag,text,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;}
  function localized(item,key){return bn&&item[key+'_bn']?item[key+'_bn']:item[key] || '';}
  function url(id){return '/learn.html?'+new URLSearchParams({id,...(bn?{lang:'bn'}:{})});}
  let items=[],total=0,sequence=0,single=params.get('id');
  const areas={ear:t('Ear','কান'),nose:t('Nose','নাক'),throat:t('Throat','গলা'),'head-neck':t('Head & neck','হেড ও নেক')},types={anatomy:t('Anatomy','অ্যানাটমি'),trivia:t('ENT trivia','ইএনটি ট্রিভিয়া'),clinical:t('Clinical gallery','ক্লিনিক্যাল গ্যালারি')};
  function renderImage(entry,target){
    if(!entry.image)return;
    const wrapper=node('div'),layout=node('div',null,entry.hotspots.length?'anatomy-layout':''),figure=node('div',null,'learning-figure'),image=node('img');image.src=entry.image.url;image.alt=entry.image.alt;image.loading='lazy';figure.append(image);layout.append(figure);
    image.onerror=()=>{image.remove();figure.append(node('p',t('This image could not be loaded. Please try again later.','ছবিটি লোড করা যায়নি। পরে আবার চেষ্টা করুন।'),'learning-body'));};
    if(entry.hotspots.length){
      const markers=node('div',null,'learning-hotspots'),panel=node('section',null,'structure-panel'),list=node('ul',null,'structure-list'),buttons=[];panel.setAttribute('aria-live','polite');panel.id=`structure-${entry.id}`;
      function select(index){
        const point=entry.hotspots[index];panel.replaceChildren(node('h3',localized(point,'label')));
        for(const [key,heading] of [['description',t('Structure','অঙ্গের বিবরণ')],['pathology',t('Common pathology','সাধারণ রোগ')],['symptoms',t('Associated symptoms','সংশ্লিষ্ট উপসর্গ')]])if(localized(point,key)){panel.append(node('h4',heading),node('p',localized(point,key)));}
        buttons.forEach(({button,i})=>button.setAttribute('aria-pressed',String(i===index)));
      }
      entry.hotspots.forEach((point,index)=>{
        const marker=node('button',String(index+1),'learning-point');marker.type='button';marker.style.left=point.x+'%';marker.style.top=point.y+'%';marker.setAttribute('aria-label',`${index+1}. ${localized(point,'label')}`);marker.setAttribute('aria-controls',panel.id);marker.onclick=()=>select(index);markers.append(marker);buttons.push({button:marker,i:index});
        const li=node('li'),button=node('button',`${index+1}. ${localized(point,'label')}`);button.type='button';button.setAttribute('aria-controls',panel.id);button.onclick=()=>select(index);li.append(button);list.append(li);buttons.push({button,i:index});
      });figure.append(markers);layout.append(panel);wrapper.append(layout,list);select(0);
    }else wrapper.append(layout);
    target.append(wrapper);
  }
  function render(entry){
    const article=node('article',null,'learning-entry');article.id='entry-'+entry.id;
    article.append(node('p',`${types[entry.kind]} · ${areas[entry.category]}`,'learning-meta'),node('h2',localized(entry,'title')));
    if(bn&&!entry.title_bn)article.append(node('p','বাংলা অনুবাদ এখনও যোগ করা হয়নি। মূল ইংরেজি তথ্য দেখানো হচ্ছে।','learning-meta'));
    if(localized(entry,'body'))article.append(node('p',localized(entry,'body'),'learning-body'));
    if(entry.kind==='clinical'){
      const gate=node('div',null,'clinical-gate'),content=node('div');content.hidden=true;
      gate.append(node('h3',t('Clinical photograph','ক্লিনিক্যাল ছবি')),node('p',t('This entry contains medical imagery, which may include surgical cases, specimens or diseased tissue. Choose whether you would like to view it.','এখানে চিকিৎসা-সংক্রান্ত ছবি রয়েছে, যার মধ্যে অস্ত্রোপচার, নমুনা বা রোগাক্রান্ত টিস্যু থাকতে পারে। আপনি চাইলে ছবিটি দেখতে পারেন।')));
      const reveal=node('button',t('Show clinical image','ক্লিনিক্যাল ছবি দেখুন'),'btn btn-secondary');reveal.type='button';reveal.setAttribute('aria-expanded','false');
      const hide=node('button',t('Hide image','ছবিটি আড়াল করুন'),'btn btn-secondary');hide.type='button';
      reveal.onclick=()=>{content.replaceChildren();const tools=node('div',null,'clinical-image-tools');tools.append(hide);content.append(tools);renderImage(entry,content);gate.hidden=true;content.hidden=false;reveal.setAttribute('aria-expanded','true');hide.focus();};
      hide.onclick=()=>{content.replaceChildren();content.hidden=true;gate.hidden=false;reveal.setAttribute('aria-expanded','false');reveal.focus();};gate.append(reveal);article.append(gate,content);
    }else renderImage(entry,article);
    if(entry.kind==='trivia'){
      const answer=node('details',null,'trivia-answer');answer.append(node('summary',t('Reveal answer & explanation','উত্তর ও ব্যাখ্যা দেখুন')),node('p',localized(entry,'answer')));article.append(answer);
    }
    const link=node('a',t('Link to this entry ↗','এই বিষয়ের লিংক ↗'),'learning-entry-link');link.href=url(entry.id);article.append(link);return article;
  }
  function updateURL(){const query=new URLSearchParams();if(bn)query.set('lang','bn');for(const [key,id] of [['q','search'],['kind','type'],['category','category']])if($(id).value)query.set(key,$(id).value);history.replaceState(null,'','/learn.html'+(query.size?'?'+query:''));}
  async function load(append=false){
    const ticket=++sequence;$('load-more').disabled=true;$('library-status').textContent=t('Loading library…','লাইব্রেরি লোড হচ্ছে…');
    try{
      const query=new URLSearchParams({q:$('search').value,kind:$('type').value,category:$('category').value,limit:'12',offset:String(append?items.length:0)});
      const response=await fetch(single?'/api/content/'+encodeURIComponent(single):'/api/content?'+query);
      if(!response.ok)throw new Error(single?t('This entry is unavailable or has not been published.','বিষয়টি পাওয়া যায়নি অথবা এখনও প্রকাশিত হয়নি।'):t('The library is unavailable. Please try again.','লাইব্রেরি এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।'));
      const result=await response.json();if(ticket!==sequence)return;
      const next=single?[result]:result.items;items=append?items.concat(next):next;total=single?1:result.total;
      if(!append)$('learning-items').replaceChildren();next.forEach(item=>$('learning-items').append(render(item)));
      $('library-status').textContent=single?'':t(`${items.length} of ${total} entries`,`${total}টি বিষয়ের মধ্যে ${items.length}টি দেখানো হচ্ছে`);
      if(!items.length){const empty=node('div',null,'learning-empty');empty.append(node('h2',t('New things to discover, soon.','শিগগিরই নতুন বিষয় আসছে।')),node('p',t('No published entries match this selection. Try a different search or check back for updates from Dr. Nafi.','এখানে এখনও কোনো প্রকাশিত বিষয় নেই। অন্যভাবে খুঁজুন অথবা পরে আবার দেখুন।')));$('learning-items').append(empty);}
      $('load-more').hidden=items.length>=total;$('show-all').hidden=!single;
    }catch(error){if(ticket!==sequence)return;$('library-status').textContent=error.message;$('load-more').hidden=true;$('show-all').hidden=!single;}
    finally{if(ticket===sequence)$('load-more').disabled=false;}
  }
  $('search').value=params.get('q')||'';if(['anatomy','trivia','clinical'].includes(params.get('kind')))$('type').value=params.get('kind');if(Object.hasOwn(areas,params.get('category')))$('category').value=params.get('category');
  $('learning-filters').onsubmit=event=>{event.preventDefault();single=null;updateURL();load();};$('show-all').onclick=()=>{single=null;updateURL();load();};$('load-more').onclick=()=>load(true);load();
})();
