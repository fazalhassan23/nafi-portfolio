'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'nafi-serverless-test-'));
Object.assign(process.env,{ADMIN_PASSWORD:'test-serverless-password',SESSION_SECRET:'serverless-test-secret-at-least-32-characters',DB_PATH:path.join(temporary,'test.db'),UPLOAD_DIR:path.join(temporary,'uploads'),NODE_ENV:'test',VERCEL:'',TURSO_DATABASE_URL:'',BLOB_READ_WRITE_TOKEN:''});
const handler=require('../api/index');
const activeHandlers=new Set([require('../server')]);
async function invoke(route,method='GET',body,cookie=''){
 const req={url:'/api/index?'+route,method,headers:{host:'example.test',cookie,...(body!==undefined?{'content-type':'application/json'}:{})},body,socket:{remoteAddress:'127.0.0.1'},resume(){}};
 let status,headers,data;
 const res={writeHead(s,h){status=s;headers=h;},end(value){data=value;this.writableEnded=true;}};
 await handler(req,res);
 return {status,headers,data:data?JSON.parse(data):null};
}
after(async()=>{for(const app of activeHandlers)await app.close();fs.rmSync(temporary,{recursive:true,force:true});});
test('Vercel entry point preserves rewrites and accepts pre-parsed request bodies',async()=>{
 assert.equal((await invoke('__route=/healthz')).status,200);
 const signedIn=await invoke('__route=/api/admin/login','POST',{password:'test-serverless-password'});assert.equal(signedIn.status,200);const cookie=signedIn.headers['Set-Cookie'].split(';')[0];
 const draft=await invoke('__route=/api/admin/content','POST',{kind:'trivia',category:'ear',title:'Serverless test',body:'Question',answer:'Answer',status:'draft',hotspots:[]},cookie);assert.equal(draft.status,201);
 const list=await invoke('__route=/api/admin/content&kind=trivia&q=Serverless','GET',undefined,cookie);assert.equal(list.data.items.length,1);
 assert.equal((await invoke('__route=/api/content')).data.total,0);
 assert.equal((await invoke('__route=/api/admin/login','POST',null)).status,400);
});
test('database rate limits survive a separate serverless handler instance',async()=>{
 const first=require('../server');delete require.cache[require.resolve('../server')];const second=require('../server');activeHandlers.add(second);
 async function attempt(app){const req={url:'/api/admin/login',method:'POST',headers:{host:'example.test','content-type':'application/json'},body:{password:'wrong'},socket:{remoteAddress:'198.51.100.42'},resume(){}};let status;const res={writeHead(value){status=value;},end(){this.writableEnded=true;}};await app(req,res);return status;}
 const responses=[];for(let index=0;index<9;index++)responses.push(await attempt(index%2?first:second));assert.equal(responses.filter(value=>value===401).length,8);assert.equal(responses[8],429);
});
