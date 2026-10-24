'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports = async function mediaStorage(dataDirectory, options={}) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const {put,get,del}=options.blobSDK || require('@vercel/blob');
    return {
      async write(filename,buffer,mime) {
        const blob=await put('ent-library/'+filename,buffer,{access:'private',contentType:mime,addRandomSuffix:false});
        return blob.pathname;
      },
      async read(filename) {
        const result=await get(filename,{access:'private'});
        if(!result || result.statusCode!==200)throw Object.assign(new Error('Image not found'),{code:'ENOENT'});
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      },
      async remove(filename) { await del(filename); },
    };
  }
  if(process.env.VERCEL)throw new Error('Connect a private Vercel Blob store and set BLOB_READ_WRITE_TOKEN.');
  const directory=path.resolve(process.env.UPLOAD_DIR||path.join(dataDirectory,'uploads'));
  await fs.mkdir(directory,{recursive:true});
  return {
    async write(filename,buffer) { await fs.writeFile(path.join(directory,filename),buffer,{flag:'wx'});return filename; },
    async read(filename) { return fs.readFile(path.join(directory,filename)); },
    async remove(filename) { await fs.rm(path.join(directory,filename),{force:true}); },
  };
};
