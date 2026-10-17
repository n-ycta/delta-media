import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createMedia}from'../server/media.mjs';
test('discover providers, search, persistent library and queued device control',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-api-'));
 const client={call:async()=>[{id:'youtube',metadata:{mediaProvider:{id:'youtube',name:'YouTube'}}}]};
 const forward=async(cap,args)=>cap==='youtube.status'?{provider:{connected:true,search:true}}:cap==='youtube.search'?[{provider:'youtube',title:args.query,url:'https://youtu.be/abcdefghijk'}]:{provider:'youtube',title:'Track',url:args.url};
 try{const h=await createMedia(client,{dataDir:dir,forward});
 assert.equal((await h['media.providers']({}))[0].search,true);assert.equal((await h['media.search']({query:'Music'})).items[0].title,'Music');
 await assert.rejects(()=>h['media.play']({url:'https://youtu.be/abcdefghijk'}),e=>e.code==='unavailable');
 await h['media.sync']({deviceId:'test-device',report:{playing:false}});
 const command=await h['media.play']({url:'https://youtu.be/abcdefghijk'});assert.equal(command.status,'queued');
 const sync=await h['media.sync']({deviceId:'test-device'});assert.equal(sync.commands[0].args.item.provider,'youtube');
 assert.equal((await h['media.sync']({deviceId:'test-device',ack:[command.commandId]})).commands.length,0);
 await h['media.library']({item:{id:'a',title:'Track',plays:2,listenedSeconds:10}});assert.equal((await h['media.stats']({})).plays,2);
 const reloaded=await createMedia(client,{dataDir:dir,forward});assert.equal((await reloaded['media.library']({})).items[0].title,'Track');
 await assert.rejects(()=>h['media.settings']({values:{unknown:true}}),e=>e.code==='bad_request');
 await h['media.sync']({deviceId:'another'});await assert.rejects(()=>h['media.pause']({}),e=>e.code==='conflict');
 }finally{await rm(dir,{recursive:true,force:true})}
});
