import { test } from "node:test";
import assert from "node:assert/strict";
import { embedUrl } from "../src/embeds";
import { intentItems } from "../src/host";
test("provider pages normalise to official embed players only", () => {
  assert.equal(embedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1").url.split("?")[0], "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(embedUrl("https://youtu.be/dQw4w9WgXcQ").provider, "youtube");
  assert.equal(embedUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ").key, "dQw4w9WgXcQ");
  assert.equal(embedUrl("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC").url, "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=delta");
  assert.match(embedUrl("https://soundcloud.com/artist/song?si=x").url, /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fartist%2Fsong&/);
  for (const bad of ["http://youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.com/embed/x", "https://youtube.com/watch?v=<script>", "https://open.spotify.com/user/x", "javascript:alert(1)"])
    assert.throws(() => embedUrl(bad));
});
test("intents become bounded library items", () => {
  const [a, b] = intentItems({ items: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "Song", artist: "A", artwork: "http://x/a.png" }, { url: "https://cdn.example/a.mp3", title: "Direct" }] });
  assert.equal(a.source, "youtube");
  assert.ok(a.embed?.startsWith("https://www.youtube-nocookie.com/embed/"));
  assert.equal(a.artwork, undefined);
  assert.equal(b.source, "direct");
  assert.equal(b.url, "https://cdn.example/a.mp3");
  assert.deepEqual(intentItems({ url: "http://insecure.example/a.mp3" }), []);
  assert.deepEqual(intentItems("nope"), []);
  assert.equal(intentItems({ items: Array.from({ length: 500 }, (_, i) => ({ url: `https://cdn.example/${i}.mp3` })) }).length, 200);
});

test('official provider progress and seek use provider units, not local video', async () => {
  const {EmbedController}=await import('../src/embeds');
  const old=(globalThis as any).window,events=new EventTarget(),sent:any[]=[];
  (globalThis as any).window=events;
  const frame=Object.assign(new EventTarget(),{hidden:true,src:'',contentWindow:{postMessage:(message:any,origin:string)=>sent.push({message:typeof message==='string'?JSON.parse(message):message,origin})},removeAttribute:()=>{}}) as unknown as HTMLIFrameElement;
  const receive=(origin:string,data:unknown)=>{const e=new Event('message');Object.assign(e,{origin,data,source:frame.contentWindow});events.dispatchEvent(e)};
  try{
    const player=new EmbedController(frame,()=>{},()=>{});
    player.open('youtube',embedUrl('https://youtu.be/dQw4w9WgXcQ').url);
    receive('https://evil.example',{event:'infoDelivery',info:{currentTime:999,duration:999}});assert.equal(player.position,0);
    receive('https://www.youtube-nocookie.com',{event:'infoDelivery',info:{currentTime:12,duration:180,playerState:1}});
    assert.equal(player.position,12);assert.equal(player.duration,180);assert.equal(player.playing,true);
    player.seek(40);assert.deepEqual(sent.at(-1).message,{event:'command',func:'seekTo',args:[40,true]});assert.equal(player.position,12);
    player.volume(.4);assert.deepEqual(sent.at(-1).message,{event:'command',func:'setVolume',args:[40]});
    player.open('soundcloud','https://w.soundcloud.com/player/');receive('https://w.soundcloud.com',{method:'playProgress',value:{currentPosition:7500}});receive('https://w.soundcloud.com',{method:'getDuration',value:220000});assert.equal(player.position,7.5);assert.equal(player.duration,220);player.seek(8);assert.deepEqual(sent.at(-1).message,{method:'seekTo',value:8000});
    player.open('spotify','https://open.spotify.com/embed/track/example');receive('https://open.spotify.com',{type:'playback_update',payload:{position:9000,duration:160000,isPaused:false}});assert.equal(player.position,9);assert.equal(player.duration,160);player.seek(11);assert.deepEqual(sent.at(-1).message,{command:'seek',timestamp:11});
  }finally{(globalThis as any).window=old}
});
