import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeltaError } from './delta-sdk.mjs';
export const operations=['providers','search','resolve','library','play','pause','seek','next','previous','queue','playlists','settings','stats','session','sync'];
const bad=m=>{throw new DeltaError('bad_request',m)};
export async function createMedia(client,options={}) {
 const path=resolve(options.dataDir||process.env.DATA_DIR||process.env.DELTA_DATA||'data','media.json');
 let data={version:1,media:[],removed:[],playlists:[],queue:[],settings:{resume:true,autoplayNext:true,seekStep:15,playbackRate:1,defaultVolume:1,compact:false,showArtwork:true,showSource:true,showLyrics:true,searchProviders:['youtube','soundcloud','spotify'],offlineFormat:'auto'}};
 try {data={...data,...JSON.parse(await readFile(path,'utf8'))}}catch(e){if(e.code!=='ENOENT')throw e}
 let tail=Promise.resolve();
 const save=()=>{const snapshot=JSON.stringify(data);const job=tail.then(async()=>{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',snapshot,{mode:0o600});await rename(path+'.tmp',path)});tail=job.catch(()=>{});return job};
 const forget=id=>{data.removed=[...new Set([...data.removed,id])];data.media=data.media.filter(m=>m.id!==id);data.queue=data.queue.filter(v=>v!==id);for(const p of data.playlists)p.items=p.items.filter(v=>v!==id)};
 const sessions=new Map(), commands=new Map();
 const providers=async()=>{const cs=await client.call('core.components');return cs.filter(c=>c.metadata?.mediaProvider).map(c=>({...c.metadata.mediaProvider,component:c.id}));};
 const provider=async id=>{const p=(await providers()).find(p=>p.id===id);if(!p||!['youtube','soundcloud','spotify'].includes(p.component))throw new DeltaError('not_found','Provider not connected');return p};
 const invoke=options.forward||((cap,args)=>client.forward(cap,args));
 const searchDeadline=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Search timeout'),{code:'timeout'})),options.searchTimeoutMs||3800);})]);}finally{clearTimeout(timer);}};
 const resolveItem=async a=>{
  if(typeof a.url!=='string'||a.url.length>8192)bad('URL required');
  const u=new URL(a.url);if(u.protocol!=='https:'||u.username||u.password)bad('HTTPS media URL required');
  const id=a.provider||(/(^|\.)youtu(be\.com|be-nocookie\.com)$|^youtu\.be$/.test(u.hostname)?'youtube':/(^|\.)soundcloud\.com$/.test(u.hostname)?'soundcloud':u.hostname==='open.spotify.com'?'spotify':null);
  if(id){const p=await provider(id);return invoke(p.component+'.resolve',{url:a.url})}
  return {provider:'direct',url:u.href,title:String(a.title||u.pathname.split('/').pop()||'Media').slice(0,300),kind:a.kind==='video'?'video':'audio'};
 };
 const command=async(name,args)=>{
  const live=[...sessions.values()].filter(s=>Date.now()-s.at<20000);
  let target=args.deviceId?live.find(s=>s.id===args.deviceId):live.length===1?live[0]:null;
  if(!target)throw new DeltaError(live.length>1?'conflict':'unavailable',live.length>1?'Choose deviceId from media.session':'Open Media on a playback device first');
  const list=commands.get(target.id)||[];if(list.length>=100)throw new DeltaError('busy','Playback command queue is full');
  const item={id:randomUUID(),command:name,args,at:Date.now()};list.push(item);commands.set(target.id,list);
  return {accepted:true,commandId:item.id,deviceId:target.id,status:'queued'};
 };
 const h={
  'media.providers':async()=>{const ps=await providers();return Promise.all(ps.map(async p=>{try{const s=await invoke(p.component+'.status',{});return {...p,...s.provider}}catch{return {...p,connected:false,search:false}}}));},
  'media.resolve':resolveItem,
  'media.search':async a=>{if(typeof a.query!=='string'||!a.query.trim()||a.query.length>200)bad('Query required');const ids=Array.isArray(a.providers)?a.providers:data.settings.searchProviders;if(ids.length>10)bad('Too many providers');const ps=(await providers()).filter(p=>ids.includes(p.id));const results=await Promise.all(ps.map(async p=>{try{return {provider:p.id,items:await searchDeadline(invoke(p.component+'.search',{query:a.query}))}}catch(e){return {provider:p.id,items:[],error:e.code||'unavailable'}}}));return {items:results.flatMap(r=>r.items),providers:results.map(({items,...r})=>r)};},
  'media.library':async a=>{if(a.remove){if(typeof a.remove!=='string'||a.remove.length>200)bad('Invalid media id');forget(a.remove);await save()}if(a.item){if(typeof a.item.id!=='string'||JSON.stringify(a.item).length>20000)bad('Invalid media item');data.removed=data.removed.filter(id=>id!==a.item.id);const i=data.media.findIndex(m=>m.id===a.item.id);if(i<0)data.media.push(a.item);else data.media[i]=a.item;await save()}return {items:data.media,total:data.media.length};},
  'media.queue':async a=>{if(a.items){if(!Array.isArray(a.items)||a.items.length>5000||a.items.some(i=>typeof i!=='string'))bad('Invalid queue');data.queue=a.items.filter(id=>!data.removed.includes(id));await save();if(a.deviceId)await command('queue',{...a})}return {items:data.queue};},
  'media.playlists':async a=>{if(a.remove){data.playlists=data.playlists.filter(p=>p.id!==a.remove);await save()}if(a.playlist){const p=a.playlist;if(typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.items)||p.items.length>5000)bad('Invalid playlist');data.playlists=[...data.playlists.filter(v=>v.id!==p.id),{...p,items:p.items.filter(id=>!data.removed.includes(id))}];await save()}return {items:data.playlists};},
  'media.settings':async a=>{if(a.values){for(const[k,v]of Object.entries(a.values)){if(!Object.hasOwn(data.settings,k))bad('Unknown setting');const base=data.settings[k];if(k==='offlineFormat'&&!['auto','audio','video'].includes(v))bad('Invalid offline format');if(Array.isArray(base)){if(!Array.isArray(v)||v.length>10||v.some(x=>!['youtube','soundcloud','spotify'].includes(x)))bad('Invalid provider list')}else if(typeof v!==typeof base||(typeof v==='number'&&(!Number.isFinite(v)||v<(k==='playbackRate'?.5:k==='seekStep'?1:0)||v>(k==='playbackRate'?2:k==='defaultVolume'?1:120))))bad('Invalid setting');data.settings[k]=v;}await save()}return data.settings;},
  'media.stats':async()=>({items:data.media.length,plays:data.media.reduce((n,m)=>n+(m.plays||0),0),listenedSeconds:data.media.reduce((n,m)=>n+(m.listenedSeconds||0),0)}),
  'media.session':async()=>[...sessions.values()].filter(s=>Date.now()-s.at<20000),
  'media.sync':async a=>{
   if(typeof a.deviceId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(a.deviceId))bad('Invalid device');
   if(a.library){if(!Array.isArray(a.library)||a.library.length>10000||JSON.stringify(a.library).length>800000)bad('Library limit');for(const m of a.library){if(typeof m.id!=='string')bad('Invalid item');if(data.removed.includes(m.id))continue;const i=data.media.findIndex(v=>v.id===m.id);if(i<0)data.media.push(m);else data.media[i]=m;}if(Array.isArray(a.playlists))data.playlists=a.playlists.map(p=>({...p,items:p.items.filter(id=>!data.removed.includes(id))}));if(Array.isArray(a.queue))data.queue=a.queue.filter(id=>!data.removed.includes(id));await save()}
   sessions.set(a.deviceId,{id:a.deviceId,name:String(a.name||'Media').slice(0,100),at:Date.now(),report:a.report||null});
   const ack=new Set(Array.isArray(a.ack)?a.ack:[]),list=(commands.get(a.deviceId)||[]).filter(c=>!ack.has(c.id)&&Date.now()-c.at<60000);commands.set(a.deviceId,list);
   return {commands:list,settings:data.settings,library:data.media,playlists:data.playlists,queue:data.queue};
  },
  'media.play':async a=>command('play',{...a,...(a.url?{item:await resolveItem(a)}:{})}),
 };
 for(const op of ['pause','seek','next','previous'])h['media.'+op]=async a=>{if(op==='seek'&&(!Number.isFinite(a.position)||a.position<0))bad('Invalid position');return command(op,a)};
 return h;
}
