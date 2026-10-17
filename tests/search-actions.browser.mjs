import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
const root=path.resolve('dist'),output=process.env.DELTA_TEST_OUTPUT||os.tmpdir();
const harness=`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style><iframe></iframe><script>
const frame=document.querySelector('iframe');frame.src='/index.html?embedded=1&parentOrigin='+encodeURIComponent(location.origin);
let state=JSON.parse(localStorage.getItem('test-host-state')||'{"library":[],"queue":[],"playlists":[]}');
addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;const d=e.data;
if(d.type==='delta:ready')frame.contentWindow.postMessage({type:'delta:initialize',channel:'test',context:{appId:'dev.delta.media',language:'en',theme:'light'}},location.origin);
if(d.request){const {capability:c,args:a}=d.request;let result={};
if(c==='media.search')result={items:[{provider:'youtube',title:'Aster search track',artist:'Aster',url:'https://youtu.be/M7lc1UVf-VE'}]};
if(c==='media.library'&&a.remove){state.library=state.library.filter(m=>m.id!==a.remove);state.queue=state.queue.filter(id=>id!==a.remove);localStorage.setItem('test-host-state',JSON.stringify(state));}
if(c==='media.providers')result=[{id:'youtube',name:'YouTube',connected:true,search:true}];
if(c==='media.sync'){for(const item of a.library||[]){const i=state.library.findIndex(m=>m.id===item.id);if(i<0)state.library.push(item);else state.library[i]=item;}if(a.queue)state.queue=a.queue;if(a.playlists)state.playlists=a.playlists;localStorage.setItem('test-host-state',JSON.stringify(state));result={...state,commands:[],settings:{}};}
frame.contentWindow.postMessage({channel:'test',id:d.id,ok:true,result},location.origin);}});
</script>`;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/test-host'){res.setHeader('content-type','text/html');res.end(harness);return;}const p=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!p.startsWith(root+path.sep))throw Error();const data=await fs.readFile(p);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
try{for(const width of [1440,390]){
const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test-host');const app=page.frameLocator('iframe');
await app.locator('#search').fill('Aster');const result=app.locator('.remote-result');await result.waitFor();
const like=result.locator('[data-action=provider-favorite]'),queue=result.locator('[data-action=provider-enqueue]');
await queue.click();await assertEventually(()=>queue.getAttribute('aria-pressed'),'true');assert.equal(await queue.getAttribute('aria-label'),'Remove from queue');
await queue.click();await assertEventually(()=>queue.getAttribute('aria-pressed'),'false');
await like.click();await assertEventually(()=>like.getAttribute('aria-pressed'),'true');
await app.locator('[data-view=library]').click();await assertEventually(()=>app.locator('.media-row').count(),1);
await app.locator('[data-view=favorites]').click();await assertEventually(()=>app.locator('.media-row').count(),1);
await app.locator('#search').fill('Aster');await result.waitFor();await queue.click();await assertEventually(()=>queue.getAttribute('aria-pressed'),'true');
await page.screenshot({path:path.join(output,`media-search-actions-${width}.png`)});
assert.equal(await result.evaluate(e=>e.scrollWidth<=e.clientWidth),true,'no overflowing action buttons');
await page.reload();await app.locator('#search').fill('Aster');await result.waitFor();for(const button of [like,queue])assert.equal(await button.getAttribute('aria-pressed'),'true','saved state survives reload');
await queue.click();await assertEventually(()=>queue.getAttribute('aria-pressed'),'false');await like.click();await assertEventually(()=>like.getAttribute('aria-pressed'),'false');
await app.locator('[data-view=library]').click();await app.locator('[data-action=choose-playlists]').click();await app.locator('input[name="new-name"]').fill('Night set');await app.locator('#choose-playlists [type=submit]').click();
await app.locator('[data-view=playlists]').click();await app.locator('[data-action=playlist]').click();await assertEventually(()=>app.locator('.media-row').count(),1);
await app.locator('[data-action=playlist-remove-item]').click();await assertEventually(()=>app.locator('.media-row').count(),0);
await app.locator('[data-action=choose-library]').click();await app.locator('#library-picker-search').fill('Aster');await app.locator('input[name=media]').check();await app.locator('#choose-library [type=submit]').click();await assertEventually(()=>app.locator('.media-row').count(),1);
await page.reload();await app.locator('[data-view=playlists]').click();await app.locator('[data-action=playlist]').click();assert.equal(await app.locator('.media-row').count(),1,'playlist survives reload');
await app.locator('[data-view=settings]').click();await app.locator('#seek-step').fill('0');await app.locator('#seek-step').dispatchEvent('change');assert.equal(await app.locator('#seek-step').getAttribute('aria-invalid'),'true');await app.locator('#seek-step').fill('30');await app.locator('#seek-step').dispatchEvent('change');await app.locator('#initial-volume').fill('75');await app.locator('#initial-volume').dispatchEvent('change');
for(const theme of ['light','dark']){await page.evaluate(t=>{const frame=document.querySelector('iframe');frame.contentWindow.postMessage({channel:'test',type:'delta:presentation',context:{theme:t}},location.origin);},theme);await app.locator('#theme-select').evaluate((el,t)=>{el.value=t;el.dispatchEvent(new Event('change',{bubbles:true}));},theme);await app.locator('.settings-fields').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(output,`media-fields-${theme}-${width}.png`)});}
await app.locator('[data-view=sources]').click();await app.locator('#provider-connections .source-card').waitFor();const gap=await app.locator('#provider-connections').evaluate(e=>e.getBoundingClientRect().top-e.previousElementSibling.getBoundingClientRect().bottom);assert.ok(gap>=16);await page.screenshot({path:path.join(output,`media-sources-spacing-${width}.png`)});
await app.locator('[data-view=library]').click();await app.locator('.delete-action').click();await app.locator('[data-action=confirm-delete]').click();await assertEventually(()=>app.locator('.media-row').count(),0);await page.waitForTimeout(2300);await page.reload();await app.locator('[data-view=library]').click();assert.equal(await app.locator('.media-row').count(),0,'delete survives sync and reload');
assert.deepEqual(errors,[]);console.log(`PASS ${width}: favorite/queue; library delete; playlist picker; persistence; fields validation; source spacing`);await context.close();
}}finally{await browser.close();server.close();}
async function assertEventually(read,value){for(let i=0;i<60;i++){if(await read()===value)return;await new Promise(r=>setTimeout(r,50));}assert.equal(await read(),value);}
