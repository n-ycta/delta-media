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
