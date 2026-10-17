import {test} from 'node:test';import assert from 'node:assert/strict';
import {newMedia} from '../src/model';import {image,changes,reconcile,applyChanges} from '../src/reconcile';
const setup=()=>({media:[newMedia('youtube','abcdefghijk','Track')],queue:[] as string[],playlists:[]});
test('field changes never resend stale favorite when changing queue or playback',()=>{
 const state=setup(),base=image(state);state.media[0].position=12;state.queue.push(state.media[0].id);
 const patch=changes(base,state);assert.deepEqual(patch.fields[state.media[0].id],['position']);
 const primary=structuredClone(base);primary.media[0].favorite=true;applyChanges(primary,patch);
 assert.equal(primary.media[0].favorite,true);assert.equal(primary.media[0].position,12);assert.equal(primary.queue.length,1);
});
test('response racing a user like preserves local changes and decoder object identity',()=>{
 const state=setup(),before=image(state),current=state.media[0];state.media[0].favorite=true;state.queue.push(current.id);
 reconcile(state,before,before);assert.equal(state.media[0],current);assert.equal(current.favorite,true);assert.deepEqual(state.queue,[current.id]);
});
test('deletion during request cannot be resurrected by stale server state',()=>{
 const state=setup(),before=image(state),id=state.media[0].id;state.media=[];
 reconcile(state,{...before,queue:[id],playlists:[{id:'p',name:'P',items:[id]}]},before,[id]);
 assert.deepEqual(state.media,[]);assert.deepEqual(state.queue,[]);assert.deepEqual(state.playlists[0].items,[]);
});
test('optional field deletion survives JSON transport instead of invalidating a patch',()=>{
 const before={media:[{id:'a',title:'Song',artist:'Artist'} as any],queue:[],playlists:[]};const after=structuredClone(before);after.media[0].artist=undefined;
 const patch=JSON.parse(JSON.stringify(changes(before,after)));assert.equal(patch.library[0].artist,null);assert(patch.fields.a.includes('artist'));applyChanges(before,patch);assert.equal(before.media[0].artist,undefined);
});

test('remote optional-field removal preserves decoder identity without stale metadata',()=>{
 const state=setup();state.media[0].artist='Old';const before=image(state),ref=state.media[0],remote=image(state);delete remote.media[0].artist;reconcile(state,remote,before);assert.equal(state.media[0],ref);assert.equal(ref.artist,undefined);
});
