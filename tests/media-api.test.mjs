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
test('deletions survive stale sync, restart, queue and playlist updates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-delete-'));const client={call:async()=>[]};
 try{const h=await createMedia(client,{dataDir:dir});const item={id:'removed-track',title:'Track'};
 await h['media.sync']({deviceId:'a',library:[item],queue:[item.id],playlists:[{id:'p',items:[item.id]}]});
 await h['media.library']({remove:item.id});
 const stale=await h['media.sync']({deviceId:'b',library:[item],queue:[item.id],playlists:[{id:'p',items:[item.id]}]});
 assert.deepEqual(stale.library,[]);assert.deepEqual(stale.queue,[]);assert.deepEqual(stale.playlists[0].items,[]);
 assert.deepEqual((await h['media.queue']({items:[item.id]})).items,[]);await h['media.playlists']({playlist:{id:'direct',name:'Direct',items:[item.id]}});assert.deepEqual((await h['media.playlists']({})).items.find(p=>p.id==='direct').items,[]);
 const restarted=await createMedia(client,{dataDir:dir});assert.equal((await restarted['media.sync']({deviceId:'b',library:[item]})).library.length,0);
 await restarted['media.library']({item});assert.equal((await restarted['media.library']({})).total,1,'explicit API reimport can restore an item');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('search returns partial results within deadline and recovers after failures',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-search-'));let broken=true;
 try{const h=await createMedia({call:async()=>['youtube','spotify'].map(id=>({id,metadata:{mediaProvider:{id,name:id}}}))},{dataDir:dir,searchTimeoutMs:20,forward:async(cap,args)=>{if(cap==='spotify.search')return new Promise(()=>{});if(broken)throw Object.assign(Error('Rate limited'),{code:'unavailable'});return [{title:args.query,provider:'youtube'}];}});
 const first=await h['media.search']({query:'First'});assert.equal(first.items.length,0);assert.ok(first.providers.every(p=>p.error));broken=false;
 const next=await h['media.search']({query:'Next'});assert.equal(next.items[0].title,'Next');assert.equal(next.providers.find(p=>p.provider==='spotify').error,'timeout');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('real service merges field patches without clobbering favorite or queue across devices',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-fields-'));
 try {const h=await createMedia({call:async()=>[]},{dataDir:dir});
 const item={id:'yt',source:'youtube',sourceKey:'abcdefghijk',title:'Track',favorite:false,position:0};
 await h['media.sync']({deviceId:'a',library:[item]});
 await h['media.sync']({deviceId:'a',library:[{...item,favorite:true}],fields:{yt:['favorite']}});
 const result=await h['media.sync']({deviceId:'b',library:[{...item,position:20}],fields:{yt:['position']},queue:['yt']});
 assert.equal(result.library[0].favorite,true);assert.equal(result.library[0].position,20);assert.deepEqual(result.queue,['yt']);
 const again=await createMedia({call:async()=>[]},{dataDir:dir});const saved=await again['media.sync']({deviceId:'a'});assert.equal(saved.library[0].favorite,true);assert.equal(saved.syncProtocol,2);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('radio and YouTube deletion also blocks stale alternate IDs with identical source identity',async()=>{
 for(const source of ['direct','youtube']){
 const dir=await mkdtemp(join(tmpdir(),'media-identity-delete-'));
 try {let h=await createMedia({call:async()=>[]},{dataDir:dir});
 const item={id:'original',source,sourceKey:source==='youtube'?'abcdefghijk':'https://radio.example/live',title:'Track'};
 await h['media.sync']({deviceId:'a',library:[item]});await h['media.library']({remove:item.id});
 h=await createMedia({call:async()=>[]},{dataDir:dir});
 const stale=await h['media.sync']({deviceId:'b',library:[{...item,id:'other-device-id'}],queue:['other-device-id'],playlists:[{id:'p',name:'P',items:['other-device-id']}]});assert.deepEqual(stale.library,[],source+' must stay deleted');assert.deepEqual(stale.queue,[]);assert.deepEqual(stale.playlists[0].items,[]);
 }finally{await rm(dir,{recursive:true,force:true})}
 }
});
test('JSON field deletion does not break synchronization or resurrect removed metadata',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'media-unset-'));try{const h=await createMedia({call:async()=>[]},{dataDir:dir});await h['media.library']({item:{id:'a',title:'Song',artist:'Artist'}});const r=await h['media.sync']({deviceId:'a',library:[{id:'a',title:'Song',artist:null}],fields:{a:['artist']}});assert.equal(r.library[0].artist,undefined);}finally{await rm(dir,{recursive:true,force:true})}
});
