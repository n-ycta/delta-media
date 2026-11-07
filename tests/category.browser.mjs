import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))throw Error('invalid path');const body=await readFile(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#files').setInputFiles('tests/fixtures/picture.webm');
 await page.locator('[data-action=view][data-view=video]').click();await page.locator('.media-row').waitFor();
 await page.locator('[data-action=track-menu]').click();await page.locator('[data-action=details]').click();await page.locator('select[name=category]').selectOption('music');await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('[data-action=view][data-view=audio]').click();await page.locator('.media-row').waitFor();
 await page.locator('.art[data-action=play]').click();await page.waitForFunction(()=>document.querySelector('video').videoWidth>0&&document.querySelector('video').currentTime>0);
 await page.locator('[data-action=view][data-view=video]').click();assert.equal(await page.locator('.media-row').count(),0);
 console.log('Category change moves a video source into Music while video decoding still plays');
}finally{await browser.close();server.close();}
