'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {pathToFileURL}=require('node:url');
let child,base,cookie,temporary;
const password='integration-test-password-only';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYQAAAAASUVORK5CYII=';
async function request(url,{method='GET',body,auth=false,origin,raw}={}){
 const response=await fetch(base+url,{method,headers:{...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:raw!==undefined?raw:body!==undefined?JSON.stringify(body):undefined});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,headers:response.headers};
}
before(async()=>{
 temporary=fs.mkdtempSync(path.join(os.tmpdir(),'nafi-backend-test-'));
 const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
 base=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),ADMIN_PASSWORD:password,SESSION_SECRET:'test-secret-with-more-than-32-characters',DB_PATH:path.join(temporary,'test.db'),UPLOAD_DIR:path.join(temporary,'uploads'),NODE_ENV:'test',VERCEL:'',BLOB_READ_WRITE_TOKEN:'',TURSO_DATABASE_URL:process.env.TEST_LIBSQL ? pathToFileURL(path.join(temporary,'libsql.db')).href : '',TURSO_AUTH_TOKEN:''}});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('site running')){clearTimeout(timeout);resolve();}});child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${output}`));});});
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}if(temporary)fs.rmSync(temporary,{recursive:true,force:true});});
test('content lifecycle, media privacy, session revocation and appointment regression',async t=>{
 let image,entry;
 await t.test('public endpoints exclude private content and admin requires sign-in',async()=>{
  assert.equal((await request('/healthz')).status,200);
  assert.equal((await request('/api/admin/content')).status,401);
  assert.equal((await request('/api/admin/calendar?month=2092-02')).status,401);
  assert.equal((await request('/api/admin/media',{method:'POST',body:{data:png,alt:'Test diagram'}})).status,401);
  assert.deepEqual((await request('/api/content')).data.items,[]);
 });
 await t.test('login rejects foreign origins and creates an HttpOnly session',async()=>{
  assert.equal((await request('/api/admin/login',{method:'POST',body:{password},origin:'https://foreign.example'})).status,403);
  assert.equal((await request('/api/admin/login',{method:'POST',body:{password:'wrong'}})).status,401);
  const result=await request('/api/admin/login',{method:'POST',body:{password}});assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly/);cookie=result.headers.get('set-cookie').split(';')[0];
 });
 await t.test('validates image type, alt text and content size',async()=>{
  assert.equal((await request('/api/admin/media',{method:'POST',auth:true,body:{data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),alt:'SVG'}})).status,400);
  assert.equal((await request('/api/admin/media',{method:'POST',auth:true,body:{data:png,alt:''}})).status,400);
  assert.equal((await request('/api/admin/content',{method:'POST',auth:true,raw:'null'})).status,400);
  const large=await request('/api/admin/media',{method:'POST',auth:true,body:{data:Buffer.alloc(6*1024*1024+1).toString('base64'),alt:'Too large'}});assert.equal(large.status,413);
  const uploaded=await request('/api/admin/media',{method:'POST',auth:true,body:{data:png,alt:'A test diagram'}});assert.equal(uploaded.status,201);image=uploaded.data;
  assert.equal((await request(image.url)).status,404);assert.equal((await request(image.url,{auth:true})).status,200);
  assert.equal((await request('/api/admin/media/'+image.id,{method:'PATCH',auth:true,body:{alt:'Updated test diagram'}})).status,200);
  assert.equal((await request('/api/admin/media/'+image.id,{method:'PATCH',auth:true,body:{alt:''}})).status,400);
 });
 await t.test('creates a draft with bilingual structure, pathology and symptom labels',async()=>{
  const draft={kind:'anatomy',category:'ear',title:'Middle ear',title_bn:'মধ্যকর্ণ',body:'Educational image',image_id:image.id,status:'draft',hotspots:[{x:45,y:52,label:'Structure',label_bn:'অঙ্গ',description:'Description',pathology:'Pathology note',symptoms:'Symptom note'}]};
  const result=await request('/api/admin/content',{method:'POST',auth:true,body:draft});assert.equal(result.status,201);entry=result.data;
  assert.equal(entry.hotspots[0].pathology,'Pathology note');assert.equal((await request('/api/content')).data.total,0);assert.equal((await request('/api/content/'+entry.id)).status,404);
  assert.equal((await request('/api/admin/content/'+entry.id,{method:'PUT',auth:true,body:{...entry,hotspots:[{x:101,y:20,label:'Invalid'}]}})).status,400);
  assert.equal((await request('/api/admin/content/'+entry.id,{method:'PUT',auth:true,body:{...entry,status:'published'},origin:'https://foreign.example'})).status,403);
 });
 await t.test('publishes, filters, searches and paginates public content',async()=>{
  const result=await request('/api/admin/content/'+entry.id,{method:'PUT',auth:true,body:{...entry,status:'published'}});assert.equal(result.status,200);entry=result.data;
  const list=(await request('/api/content?kind=anatomy&category=ear&q=Middle&limit=1')).data;assert.equal(list.total,1);assert.equal(list.items[0].title_bn,'মধ্যকর্ণ');assert.equal(list.items[0].consent_confirmed,undefined);assert.equal((await request('/api/content?offset=1')).data.items.length,0);
  const media=await request(image.url);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');assert.match(media.headers.get('cache-control'),/no-store/);
  assert.equal((await request('/api/admin/media/'+image.id,{method:'DELETE',auth:true})).status,409);
 });
 await t.test('requires clinical publication consent and treats all clinical entries as sensitive',async()=>{
  const clinical={kind:'clinical',category:'ear',title:'Clinical image',image_id:image.id,status:'published',hotspots:[],consent_confirmed:false};
  assert.equal((await request('/api/admin/content',{method:'POST',auth:true,body:clinical})).status,400);
  const result=await request('/api/admin/content',{method:'POST',auth:true,body:{...clinical,consent_confirmed:true,sensitive:false}});assert.equal(result.status,201);assert.equal(result.data.sensitive,true);
  assert.equal((await request('/api/admin/content/'+result.data.id,{method:'DELETE',auth:true})).status,200);
 });
 await t.test('trivia requires a question and answer; text is stored without HTML interpretation',async()=>{
  const trivia={kind:'trivia',category:'nose',title:'<script>not executable</script>',body:'Test question',answer:'Test answer',status:'published',hotspots:[]};
  assert.equal((await request('/api/admin/content',{method:'POST',auth:true,body:{...trivia,answer:''}})).status,400);
  const result=await request('/api/admin/content',{method:'POST',auth:true,body:trivia});assert.equal(result.status,201);assert.equal((await request('/api/content?kind=trivia')).data.items[0].answer,'Test answer');
 });
 await t.test('unpublishing revokes public image access and deletion cleans up unused media',async()=>{
  assert.equal((await request('/api/admin/content/'+entry.id,{method:'PUT',auth:true,body:{...entry,status:'draft'}})).status,200);
  assert.equal((await request(image.url)).status,404);
  assert.equal((await request('/api/admin/content/'+entry.id,{method:'DELETE',auth:true})).status,200);
  assert.equal((await request('/api/admin/media/'+image.id,{method:'DELETE',auth:true})).status,200);
  assert.equal(fs.readdirSync(path.join(temporary,'uploads')).length,0);
 });
 await t.test('existing appointment create, search, update and export continue to work',async()=>{
  const appointment=await request('/api/appointments',{method:'POST',body:{name:'Integration Test',phone:'০১৭১২৩৪৫৬৭৮',area:'Ear',lang:'bn'}});assert.equal(appointment.status,201);assert.match(appointment.data.ref,/^NAF-/);
  const list=await request('/api/admin/appointments?q=Integration',{auth:true});assert.equal(list.data.rows.length,1);const id=list.data.rows[0].id;
  assert.equal((await request('/api/admin/appointments/'+id,{method:'PATCH',auth:true,body:{status:'confirmed',note:'Test note'}})).status,200);
  assert.match((await request('/api/admin/export.csv',{auth:true})).data,/Integration Test/);
  assert.equal((await request('/api/appointments',{method:'POST',body:{name:'',phone:'bad'}})).status,400);
  for (const date of ['2028-02-30','2020-01-01']) assert.equal((await request('/api/appointments',{method:'POST',body:{name:'Test Person',phone:'01712345678',date}})).status,400);
 });
 await t.test('calendar summary and day filters distinguish months, statuses and undated requests',async()=>{
  for(const [name,date] of [['Calendar First','2092-02-01'],['Calendar Leap','2092-02-29'],['Calendar Next','2092-03-01'],['Calendar Undated','']]) {
   assert.equal((await request('/api/appointments',{method:'POST',body:{name,phone:'01712345678',date}})).status,201);
  }
  const day=await request('/api/admin/appointments?date=2092-02-29',{auth:true});assert.equal(day.data.matchingCount,1);assert.equal(day.data.rows[0].name,'Calendar Leap');
  await request('/api/admin/appointments/'+day.data.rows[0].id,{method:'PATCH',auth:true,body:{status:'confirmed'}});
  const summary=await request('/api/admin/calendar?month=2092-02&q=Calendar',{auth:true});assert.equal(summary.status,200);assert.equal(summary.data.days.length,2);assert.equal(summary.data.undatedCount,1);assert.deepEqual(summary.data.days.map(day=>day.date),['2092-02-01','2092-02-29']);
  const confirmed=await request('/api/admin/calendar?month=2092-02&status=confirmed&q=Calendar',{auth:true});assert.deepEqual(confirmed.data.days,[{date:'2092-02-29',status:'confirmed',count:1}]);assert.equal(confirmed.data.undatedCount,0);
  const month=await request('/api/admin/appointments?month=2092-02&q=Calendar',{auth:true});assert.equal(month.data.rows.length,2);assert.equal(month.data.matchingCount,2);
  const undated=await request('/api/admin/appointments?undated=1&q=Calendar',{auth:true});assert.equal(undated.data.matchingCount,1);assert.equal(undated.data.rows[0].name,'Calendar Undated');
  assert.equal((await request('/api/admin/calendar?month=2092-13',{auth:true})).status,400);assert.equal((await request('/api/admin/calendar',{auth:true})).status,400);assert.equal((await request('/api/admin/appointments?date=2092-02-30',{auth:true})).status,400);
 });
 await t.test('logout revokes the existing session, including replayed cookies',async()=>{
  assert.equal((await request('/api/admin/logout',{method:'POST',auth:true})).status,200);
  assert.equal((await request('/api/admin/me',{auth:true})).status,401);
  assert.equal((await request('/api/admin/content',{auth:true})).status,401);
 });
});
