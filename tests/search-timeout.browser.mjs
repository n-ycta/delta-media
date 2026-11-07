import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createMedia} from '../server/media.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'delta-search-'));
const media=await createMedia({call:async()=>[{id:'youtube',metadata:{mediaProvider:{id:'youtube',name:'YouTube'}}}]},{dataDir:dir,forward:async(cap,args)=>{if(cap==='youtube.status')return {provider:{connected:true,search:true}};if(cap==='youtube.search'){if(args.query==='slow')await new Promise(r=>setTimeout(r,5500));if(args.query==='broken')throw Object.assign(Error('unavailable'),{code:'unavailable'});return [{provider:'youtube',title:args.query+' result',url:'https://youtu.be/M7lc1UVf-VE'}];}throw Error('unknown');}});
const root=path.resolve('dist');
const harness=`<!doctype html><iframe></iframe><script>const frame=document.querySelector('iframe');frame.src='/index.html?embedded=1&parentOrigin='+encodeURIComponent(location.origin);addEventListener('message',async e=>{if(e.source!==frame.contentWindow)return;const d=e.data;if(d.type==='delta:ready')frame.contentWindow.postMessage({type:'delta:initialize',channel:'test',context:{appId:'dev.delta.media',language:'en',theme:'light'}},location.origin);if(d.request){try{const r=await fetch('/rpc',{method:'POST',body:JSON.stringify(d.request)});const result=await r.json();frame.contentWindow.postMessage({channel:'test',id:d.id,ok:true,result},location.origin);}catch{frame.contentWindow.postMessage({channel:'test',id:d.id,ok:false,error:{code:'unavailable',message:'Failure'}},location.origin);}}});</script>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/rpc'){let body='';for await(const b of req)body+=b;const {capability,args}=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify(await media[capability](args)));return;}if(url.pathname==='/test-host'){res.setHeader('content-type','text/html');res.end(harness);return;}const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))throw Error('invalid');const data=await readFile(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.statusCode=500;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/test-host`);const app=page.frameLocator('iframe');await app.locator('#search').fill('slow');await app.getByText('slow result').waitFor({timeout:9000});
 await app.locator('#search').fill('broken');await app.getByText('Search sources are unavailable. Try again.').waitFor();
 await app.locator('#search').fill('slow');await page.waitForTimeout(600);await app.locator('#search').fill('new');await app.getByText('new result').waitFor({timeout:9000});assert.equal(await app.getByText('slow result').count(),0);
 console.log('PASS embedded search waits >5s, reports errors, and ignores stale results');
}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
