import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});
try{const page=await browser.newPage();await page.route('https://www.youtube-nocookie.com/**',r=>r.abort());await page.goto(origin);await page.evaluate(async()=>{
 const {Player}=await import('/src/player.ts');const {freshState,newMedia}=await import('/src/model.ts');
 const state=freshState(),m=newMedia('youtube','abcdefghijk','Song','video');m.embed='https://www.youtube.com/watch?v=abcdefghijk';state.media.push(m);
 const video=document.createElement('video'),frame=document.createElement('iframe');document.body.append(video,frame);let saves=0;
 let snapshot;const player=new Player(video,state,{file:async()=>undefined},async()=>{saves++;snapshot=structuredClone(state);},frame);window.statsTest={player,state,m,frame,get saves(){return saves},get snapshot(){return snapshot}};
 await player.playId(m.id,false);
 });
 let status=await page.evaluate(()=>({plays:statsTest.m.plays,history:statsTest.state.history.length}));assert.deepEqual(status,{plays:0,history:0},'restoring an embed does not count a play');
 await page.evaluate(()=>statsTest.player.play());
 const send=async info=>page.evaluate(info=>{const frame=statsTest.frame;window.dispatchEvent(new MessageEvent('message',{origin:'https://www.youtube-nocookie.com',source:frame.contentWindow,data:JSON.stringify(info)}));},info);
 await send({event:'onError'});assert.equal(await page.evaluate(()=>statsTest.m.plays),0,'failed playback does not count');
 await send({event:'infoDelivery',info:{currentTime:0,playerState:1}});await page.waitForTimeout(400);await send({event:'infoDelivery',info:{currentTime:0.35,playerState:1}});
 status=await page.evaluate(()=>({plays:statsTest.m.plays,seconds:statsTest.m.listenedSeconds,history:statsTest.state.history.length,saves:statsTest.saves}));assert.equal(status.plays,1);assert.equal(status.history,1);assert.ok(status.seconds>0.2&&status.seconds<1);assert.ok(status.saves>0);
 await send({event:'infoDelivery',info:{currentTime:0.35,playerState:3}});const before=await page.evaluate(()=>statsTest.m.listenedSeconds);await page.waitForTimeout(300);await send({event:'infoDelivery',info:{currentTime:0.35,playerState:1}});await send({event:'infoDelivery',info:{currentTime:60,playerState:1}});assert.equal(await page.evaluate(()=>statsTest.m.listenedSeconds),before,'buffering and seek add no listening time');assert.equal(await page.evaluate(()=>statsTest.m.plays),1,'resume remains same session');
 await page.waitForTimeout(300);await send({event:'infoDelivery',info:{currentTime:60.25,playerState:1}});await page.evaluate(async()=>{const m=statsTest.m;const other={...m,id:'second',sourceKey:'123456789ab',embed:'https://www.youtube.com/watch?v=123456789ab',plays:0,listenedSeconds:0,position:0};statsTest.state.media.push(other);await statsTest.player.playId(other.id,false);});
 status=await page.evaluate(()=>({seconds:statsTest.snapshot.media[0].listenedSeconds,history:statsTest.snapshot.history[0].seconds,secondPlays:statsTest.snapshot.media[1].plays}));assert.ok(status.seconds>before,'switching tracks saves the final observed interval');assert.equal(status.seconds,status.history);assert.equal(status.secondPlays,0);
 console.log('PASS YouTube confirmed playback, failed/restore count, progress, buffering, seeking and persistence');
}finally{await browser.close();await server.close();}
