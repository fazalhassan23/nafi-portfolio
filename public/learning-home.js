'use strict';
(async()=>{
  const container=document.getElementById('home-learning');if(!container)return;
  const bn=document.documentElement.lang==='bn';
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  try{
    const response=await fetch('/api/content?limit=3');if(!response.ok)throw new Error('Unavailable');const data=await response.json();
    for(const item of data.items){
      const card=node('article');card.className='learning-teaser';const meta=node('div',({anatomy:bn?'অ্যানাটমি':'Anatomy',trivia:bn?'ইএনটি ট্রিভিয়া':'ENT trivia',clinical:bn?'ক্লিনিক্যাল গ্যালারি':'Clinical gallery'})[item.kind]);meta.className='learning-teaser-meta';
      const description=bn&&item.body_bn?item.body_bn:item.body,title=bn&&item.title_bn?item.title_bn:item.title;
      const link=node('a',bn?'বিস্তারিত দেখুন ↗':'Explore this entry ↗');link.href='/learn.html?'+new URLSearchParams({id:item.id,...(bn?{lang:'bn'}:{})});card.append(meta,node('h3',title),node('p',description.length>170?description.slice(0,167)+'…':description),link);container.append(card);
    }
    if(!data.items.length){const note=node('p',bn?'ডা. নাফির শিক্ষামূলক বিষয়গুলো শিগগিরই এখানে প্রকাশিত হবে।':'Anatomy guides and ENT trivia will appear here as Dr. Nafi publishes them.');container.append(note);}
  }catch{container.append(node('p',bn?'লাইব্রেরি এখন লোড করা যাচ্ছে না। পরে আবার চেষ্টা করুন।':'The learning library could not be loaded. Please try again later.'));}
})();
