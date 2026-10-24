'use strict';
const handler=require('../server');
// A rewrite supplies the original public path; preserve all other query filters.
module.exports=async function vercelHandler(req,res) {
  const url=new URL(req.url,'http://localhost');
  const originalPath=url.searchParams.get('__route');
  url.searchParams.delete('__route');
  if(originalPath && (/^\/api\//.test(originalPath) || /^\/media\//.test(originalPath) || originalPath==='/healthz')) {
    req.url=originalPath+(url.search?'?'+url.searchParams.toString():'');
  }
  return handler(req,res);
};
