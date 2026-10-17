import { image, changes, applyChanges, type LibraryImage } from './reconcile';
import type { State } from './model';
import type { Player } from './player';
/** One audio owner per origin; all plugin panels share its state and controls. */
export async function sharedPlayback() {
  const channel = new BroadcastChannel('delta-media-session-v1');
  let primary = true;
  if (navigator.locks) {
    let acquired!: () => void;
    const ready = new Promise<void>(r => acquired = r);
    void navigator.locks.request('delta-media-audio-owner', { ifAvailable:true }, async lock => {
      primary = !!lock; acquired();
      if(lock) await new Promise<void>(resolve => addEventListener('pagehide', () => resolve(), {once:true}));
    });
    await ready;
  }
  const id=crypto.randomUUID();
  let player:Player, state:State, changed:(structure?:boolean)=>void, last=0;
  let spectrum:number[]|null=null;
  let baseline:LibraryImage={media:[],queue:[],playlists:[]};
  let extras:Record<string,unknown>={};
  const extraKeys=['volume','repeat','shuffle','history','pendingRemovals','pendingRestores','deletedIds'] as const;
  type Mutation={id:string;patch:ReturnType<typeof changes>;extras:Record<string,unknown>};
  let mutations:Mutation[]=[];
  const remember=()=>{baseline=image(state);extras=Object.fromEntries(extraKeys.map(k=>[k,structuredClone(state[k])]))};
  const pending=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const snapshot=(ack?:string)=>channel.postMessage({type:'snapshot',state, currentId:player?.current?.id,ack});
  const call=(command:string,args:unknown[])=>new Promise<void>((resolve,reject)=>{
    const request=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(request);reject(Error('Playback device is not responding. Reopen Media.'));},8000);
    pending.set(request,{resolve,reject,timer});channel.postMessage({type:'command',request,from:id,command,args});
  });
  const update=(next:State,currentId?:string)=>{
    const refs=new Map(state.media.map(m=>[m.id,m]));
    Object.assign(state,next);
    state.media=next.media.map(m=>{const ref=refs.get(m.id);if(ref){for(const key of Object.keys(ref))if(!Object.hasOwn(m,key))delete (ref as any)[key];Object.assign(ref,m);return ref;}return m;});
    for(const mutation of mutations){applyChanges(state,mutation.patch);Object.assign(state,mutation.extras);}
    player.current=state.media.find(m=>m.id===(currentId||player.current?.id));remember();changed?.();
  };
  channel.onmessage=async e=>{
    const m=e.data;if(!m||typeof m!=='object'||!player)return;
    if(m.type==='spectrum'&&!primary)spectrum=Array.isArray(m.bins)?m.bins:null;
    if(m.type==='hello'&&primary)snapshot();
    if(m.type==='snapshot'&&!primary){mutations=mutations.filter(v=>v.id!==m.ack);update(m.state,m.currentId);}
    if(m.type==='mutation'&&primary&&m.patch){applyChanges(state,m.patch);Object.assign(state,m.extras);player.current=state.media.find(v=>v.id===player.current?.id);remember();changed?.();snapshot(m.id);void player.save().catch(()=>{});}
    if(m.type==='playback'&&!primary){player.remotePlaying=m.playing;player.current=state.media.find(v=>v.id===m.currentId);if(player.current&&Number.isFinite(m.position)){player.current.position=m.position;const prior=baseline.media.find(v=>v.id===player.current?.id);if(prior)prior.position=m.position;}changed?.(false);}
    if(m.type==='command'&&primary&&['load','playId','play','pause','seek','next','previous','toggle','volume','stop'].includes(m.command)){
      try{await (player[m.command as keyof Player] as (...args:any[])=>unknown).apply(player,m.args);snapshot();channel.postMessage({type:'result',to:m.from,request:m.request});}catch(e){channel.postMessage({type:'result',to:m.from,request:m.request,error:(e as Error).message});}
    }
    if(m.type==='result'&&m.to===id){const p=pending.get(m.request);if(p){clearTimeout(p.timer);pending.delete(m.request);m.error?p.reject(Error(m.error)):p.resolve();}}
  };
  return {
    get primary(){return primary;},
    get spectrum(){return spectrum;},
    publishSpectrum(bins:number[]|null){if(primary){spectrum=bins;channel.postMessage({type:"spectrum",bins});}},
    attach(p:Player,s:State,onChange:(structure?:boolean)=>void){
      player=p;state=s;changed=onChange;remember();
      if(!primary){
        player.delegate=call;channel.postMessage({type:'hello'});
        const handshake=setInterval(()=>{if(primary)clearInterval(handshake);else channel.postMessage({type:'hello'});},3000);
        if(navigator.locks)void navigator.locks.request('delta-media-audio-owner',async()=>{
          primary=true;player.delegate=undefined;player.remotePlaying=false;clearInterval(handshake);
          if(state.currentId)await player.playId(state.currentId,false).catch(()=>{});
          else if(state.queue.length)await player.load(Math.max(0,state.queueIndex),false).catch(()=>{});
          snapshot();changed?.();
          await new Promise<void>(resolve=>addEventListener('pagehide',()=>resolve(),{once:true}));
        });
      }else snapshot();
    },
    saved(s:State){
      if(primary){remember();snapshot();}
      else {
        const patch=changes(baseline,s);
        const nextExtras=Object.fromEntries(extraKeys.filter(k=>JSON.stringify(extras[k])!==JSON.stringify(s[k])).map(k=>[k,structuredClone(s[k])]));
        if(patch.library.length||patch.removed.length||patch.queue||patch.playlists||Object.keys(nextExtras).length){
          const mutation={id:crypto.randomUUID(),patch,extras:nextExtras};mutations.push(mutation);remember();channel.postMessage({type:'mutation',...mutation});
        }
      }
    },
    report(){if(!primary||!player||performance.now()-last<200)return;last=performance.now();channel.postMessage({type:'playback',currentId:player.current?.id,playing:player.playing,position:player.position});},
  };
}
