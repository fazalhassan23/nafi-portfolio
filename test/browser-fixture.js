// Optional isolated browser fixture. All entries are synthetic interface tests.
// Run: node test/browser-fixture.js. Stop with Ctrl+C to remove the temporary data.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),zlib=require('node:zlib');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nafi-ui-'));
const port=process.env.QA_PORT || '3002';
const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:port,NODE_ENV:'test',ADMIN_PASSWORD:'local-ui-test-password',SESSION_SECRET:'isolated-browser-test-secret-32-characters',DB_PATH:path.join(directory,'test.db'),UPLOAD_DIR:path.join(directory,'uploads')}});
child.stderr.pipe(process.stderr);
function crc(buffer){let n=0xffffffff;for(const byte of buffer){n^=byte;for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([length,name,data,checksum]);}
const width=600,height=400,raw=Buffer.alloc((width*3+1)*height);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(width*3+1)+1+x*3;const circle=(x-300)**2+(y-200)**2<10000;raw[offset]=circle?52:237;raw[offset+1]=circle?104:239;raw[offset+2]=circle?82:227;}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(path.join(directory,'test-diagram.png'),image);
let seeded=false;
child.stdout.on('data',async data=>{
 process.stdout.write(data);
 if(seeded||!String(data).includes('site running'))return;seeded=true;
 try{
  const root=`http://127.0.0.1:${port}`;
  const login=await fetch(root+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'local-ui-test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,body)=>{const res=await fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});const result=await res.json();if(!res.ok)throw new Error(JSON.stringify(result));return result;};
  const media=await api('/api/admin/media',{alt:'Synthetic green circle on ivory, used only for interface testing.',data:image.toString('base64')});
  await api('/api/admin/content',{kind:'anatomy',category:'ear',title:'Interface test diagram',title_bn:'ইন্টারফেস পরীক্ষার ছবি',body:'Synthetic test content. This is not an anatomical illustration or medical advice.',image_id:media.id,status:'published',hotspots:[{x:50,y:50,label:'Test center',description:'The center of the test circle.',pathology:'Test pathology field.',symptoms:'Test symptom field.'},{x:20,y:30,label:'Test background',description:'The empty area of the test diagram.'}]});
  await api('/api/admin/content',{kind:'trivia',category:'nose',title:'Interface test trivia',body:'Can the answer be revealed?',answer:'Yes. The answer control is working.',status:'published',hotspots:[]});
  await api('/api/admin/content',{kind:'clinical',category:'throat',title:'Interface test clinical gate',body:'Synthetic test image to verify the opt-in control.',image_id:media.id,status:'published',consent_confirmed:true,hotspots:[]});
  console.log('Isolated browser fixture ready. Test image: '+path.join(directory,'test-diagram.png'));
 }catch(error){console.error(error);child.kill();}
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}fs.rmSync(directory,{recursive:true,force:true});process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
