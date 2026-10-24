'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const createStorage=require('../media-storage');
test('Blob adapter always uses private storage and keeps reads behind the media API',async()=>{
 const saved=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN='test-only-token';
 try{
  const calls=[];const bytes=Buffer.from('test-image');
  const storage=await createStorage('/unused',{blobSDK:{
   async put(name,data,options){calls.push({name,data,options});return {pathname:name};},
   async get(name,options){calls.push({name,options});return {statusCode:200,stream:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};},
   async del(name){calls.push({delete:name});}
  }});
  const key=await storage.write('example.png',bytes,'image/png');assert.equal(key,'ent-library/example.png');assert.equal(calls[0].options.access,'private');assert.equal(calls[0].options.addRandomSuffix,false);
  assert.deepEqual(await storage.read(key),bytes);assert.equal(calls[1].options.access,'private');await storage.remove(key);assert.equal(calls[2].delete,key);
 }finally{if(saved===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=saved;}
});
