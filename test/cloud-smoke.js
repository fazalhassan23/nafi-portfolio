'use strict';
// Opt-in smoke test for a configured, staged Vercel deployment.
// Uses only synthetic content and removes the records/images it creates.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const deployment=process.env.SMOKE_DEPLOYMENT;
if(process.env.SMOKE_ALLOW_WRITE!=='1'||!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(deployment||''))throw new Error('Set SMOKE_DEPLOYMENT and SMOKE_ALLOW_WRITE=1 explicitly.');
if(!process.env.ADMIN_PASSWORD)throw new Error('Load the existing admin password through the environment.');
const cookie=path.resolve('.vercel','smoke-cookies-'+process.pid+'.txt');
let contentId,mediaId,triviaId;
function request(route,{method='GET',body,auth=false}={}){
 if(!/^\/(api|media|healthz)[A-Za-z0-9/?.=&%-]*$/.test(route))throw new Error('Unexpected route');
 const args=['npx --yes vercel@65.2.0 curl',route,'--deployment',deployment,'--scope its-just-me9 -- --silent --show-error','--request',method,'--write-out "HTTPSTATUS:%{http_code}"'];
 if(auth)args.push('--cookie "'+cookie+'"','--cookie-jar "'+cookie+'"');
 if(body!==undefined)args.push('--header "Content-Type: application/json"','--data-binary @-');
 const result=spawnSync('cmd.exe',['/d','/s','/c',args.join(' ')],{encoding:'utf8',windowsVerbatimArguments:true,input:body!==undefined?JSON.stringify(body):undefined,maxBuffer:10*1024*1024,timeout:60000});
 if(result.error||result.status!==0)throw new Error('CLI request failed for '+route+': '+(result.error?.message||result.stderr));
 const output=result.stdout.trim(),match=output.match(/HTTPSTATUS:(\d{3})$/);if(!match)throw new Error('Missing HTTP status for '+route);
 const raw=output.slice(0,match.index);let data;try{data=JSON.parse(raw);}catch{data=raw;}
 return {status:Number(match[1]),data};
}
try{
 assert.equal(request('/healthz').status,200);
 assert.equal(request('/api/admin/login',{method:'POST',body:{password:process.env.ADMIN_PASSWORD},auth:true}).status,200);
 console.log('Admin sign-in: passed');
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYQAAAAASUVORK5CYII=';
 const media=request('/api/admin/media',{method:'POST',auth:true,body:{data:png,alt:'Synthetic deployment smoke-test pixel.'}});assert.equal(media.status,201,JSON.stringify(media.data));mediaId=media.data.id;
 assert.equal(request('/media/'+mediaId).status,404);
 assert.equal(request('/media/'+mediaId,{auth:true}).status,200);
 console.log('Private Blob upload and draft privacy: passed');
 const payload={kind:'anatomy',category:'ear',title:'Deployment smoke test (temporary)',body:'Synthetic interface test. Not clinical content.',image_id:mediaId,status:'draft',hotspots:[{x:50,y:50,label:'Test point',pathology:'Test field',symptoms:'Test field'}]};
 const draft=request('/api/admin/content',{method:'POST',auth:true,body:payload});assert.equal(draft.status,201,JSON.stringify(draft.data));contentId=draft.data.id;
 assert.equal(request('/api/content/'+contentId).status,404);
 assert.equal(request('/api/admin/content/'+contentId,{method:'PUT',auth:true,body:{...payload,status:'published'}}).status,200);
 const published=request('/api/content/'+contentId);assert.equal(published.status,200);assert.equal(published.data.hotspots[0].label,'Test point');assert.equal(request('/media/'+mediaId).status,200);
 assert.equal(request('/api/admin/content/'+contentId,{method:'PUT',auth:true,body:payload}).status,200);assert.equal(request('/media/'+mediaId).status,404);
 console.log('Anatomy draft, publication, labels and withdrawal: passed');
 const trivia=request('/api/admin/content',{method:'POST',auth:true,body:{kind:'trivia',category:'ear',title:'Temporary trivia smoke test',body:'Test question',answer:'Test answer',status:'published',hotspots:[]}});assert.equal(trivia.status,201);triviaId=trivia.data.id;assert.equal(request('/api/content/'+triviaId).data.answer,'Test answer');
 console.log('Trivia publication: passed');
}finally{
 for(const id of [contentId,triviaId])if(id){const result=request('/api/admin/content/'+id,{method:'DELETE',auth:true});assert.equal(result.status,200);}
 if(mediaId){const result=request('/api/admin/media/'+mediaId,{method:'DELETE',auth:true});assert.equal(result.status,200);}
 try{request('/api/admin/logout',{method:'POST',auth:true});}finally{fs.rmSync(cookie,{force:true});}
 console.log('Synthetic content, upload and admin session cleaned up.');
}
