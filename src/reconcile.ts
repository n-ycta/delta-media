import type { Media, State } from './model';
export interface LibraryImage { media: Media[]; queue: string[]; playlists: State['playlists'] }
export const image = (state: LibraryImage): LibraryImage => structuredClone({media:state.media,queue:state.queue,playlists:state.playlists});
const equal = (a: unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
export function changes(before: LibraryImage, after: LibraryImage) {
  const old = new Map(before.media.map(m=>[m.id,m]));
  const library:Media[]=[]; const fields:Record<string,string[]>={};
  for(const m of after.media) {
    const prior=old.get(m.id);
    const keys=[...new Set([...Object.keys(prior||{}),...Object.keys(m)])].filter(key=>key !== 'id' && (!prior || !equal(prior[key as keyof Media],m[key as keyof Media])));
    if(keys.length){const item=structuredClone(m);for(const key of keys)if((item as any)[key]===undefined)(item as any)[key]=null;library.push(item);fields[m.id]=keys;}
  }
  return {library,fields,removed:before.media.filter(m=>!after.media.some(v=>v.id===m.id)).map(m=>m.id),
    ...(!equal(before.queue,after.queue)?{queue:[...after.queue]}:{}),
    ...(!equal(before.playlists,after.playlists)?{playlists:structuredClone(after.playlists)}:{})};
}
/** Preserve object identity: the decoder must never retain a detached Media record. */
export function reconcile(state: LibraryImage, remote: LibraryImage, before: LibraryImage, removed: string[] = []) {
  const local=changes(before,state), blocked=new Set([...removed,...local.removed]);
  const refs=new Map(state.media.map(m=>[m.id,m]));
  const media=remote.media.filter(m=>!blocked.has(m.id)).map(m=>{
    const ref=refs.get(m.id); if(ref){for(const key of Object.keys(ref))if(!Object.hasOwn(m,key))delete (ref as any)[key];Object.assign(ref,m);return ref;}return structuredClone(m);
  });
  for(const m of local.library){
    if(blocked.has(m.id))continue;
    let ref=media.find(v=>v.id===m.id);
    if(!ref){ref=structuredClone(m);media.push(ref);}
    else for(const key of local.fields[m.id]) {if((m as any)[key]===null)delete (ref as any)[key];else (ref as any)[key]=(m as any)[key];}
  }
  state.media=media;
  state.queue=(local.queue||remote.queue).filter(id=>!blocked.has(id));
  state.playlists=structuredClone(local.playlists||remote.playlists).map(p=>({...p,items:p.items.filter(id=>!blocked.has(id))}));
}
export function applyChanges(state: LibraryImage, patch: ReturnType<typeof changes>) {
  state.media=state.media.filter(m=>!patch.removed.includes(m.id));
  for(const item of patch.library){
    const ref=state.media.find(m=>m.id===item.id);
    if(!ref)state.media.push(structuredClone(item));
    else for(const key of patch.fields[item.id] || []){if((item as any)[key]===null)delete (ref as any)[key];else (ref as any)[key]=(item as any)[key];}
  }
  if(patch.queue)state.queue=[...patch.queue];
  if(patch.playlists)state.playlists=structuredClone(patch.playlists);
  state.queue=state.queue.filter(id=>!patch.removed.includes(id));
  for(const p of state.playlists)p.items=p.items.filter(id=>!patch.removed.includes(id));
}
