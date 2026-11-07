import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningTracker, summarizeListening } from '../src/listening';
import { freshState, newMedia } from '../src/model';

test('sessions require confirmed playback and only confirmed forward progress counts',()=>{
 const state=freshState(),item=newMedia('youtube','key','Song','video');let now=1000;const tracker=new ListeningTracker(state,()=>now,()=>123456);
 tracker.update(item,false,0);assert.equal(item.plays,0);assert.equal(state.history.length,0);
 tracker.update(item,true,0);assert.equal(item.plays,1);assert.equal(state.history.length,1);
 now+=2000;tracker.update(item,true,2);assert.equal(item.listenedSeconds,2);
 now+=1000;tracker.update(item,false,3);assert.equal(item.listenedSeconds,3);
 now+=10000;tracker.update(item,true,3);assert.equal(item.plays,1);assert.equal(item.listenedSeconds,3);
 now+=1000;tracker.update(item,true,120);assert.equal(item.listenedSeconds,3,'a seek is not listening time');
 tracker.discontinuity();now+=1000;tracker.update(item,true,10);assert.equal(item.listenedSeconds,3);
 now+=1000;tracker.update(item,false,10);assert.equal(item.listenedSeconds,3,'buffering with no progress adds no time');
 now+=10000;tracker.update(item,true,10);now+=20000;tracker.update(item,true,30);assert.equal(item.listenedSeconds,3,'long unobserved gaps do not invent listening');
 assert.equal(state.history[0].seconds,3);assert.equal(state.history[0].at,123456);
 tracker.reset();tracker.update(item,true,30);assert.equal(item.plays,2,'new load is a new session');
});

test('period summaries use recorded local history, while all-time uses saved totals',()=>{
 const state=freshState(),a=newMedia('youtube','a','A','video'),b=newMedia('youtube','b','B','video');a.artist='Artist';b.artist='Artist';a.plays=8;a.listenedSeconds=120;b.plays=2;b.listenedSeconds=40;state.media=[a,b];
 const now=30*86400000;
 state.history=[{id:'1',mediaId:a.id,at:now-1000,position:0,seconds:10},{id:'2',mediaId:b.id,at:now-2*86400000,position:0,seconds:20},{id:'3',mediaId:a.id,at:now+1000,position:0,seconds:50}];
 const day=summarizeListening(state,'day',now);assert.equal(day.plays,1);assert.equal(day.seconds,10);assert.equal(day.artists[0].plays,1);
 const week=summarizeListening(state,'week',now);assert.equal(week.plays,2);assert.equal(week.artists[0].plays,2);
 const all=summarizeListening(state,'all',now);assert.equal(all.plays,10);assert.equal(all.seconds,160);assert.equal(all.tracks[0].item.id,a.id);
});
