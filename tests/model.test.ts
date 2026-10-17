import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newMedia,
  collections,
  playlistMedia,
  parseSmartRule,
  deduplicate,
  searchMedia,
  nextIndex,
  parseLrc,
  directUrl,
  freshState,
  removeQueued,
} from "../src/model";
import { parsePlaylist, exportPlaylist } from "../src/playlists";
import { adapters } from "../src/adapters";
test("dedup preserves original metadata and imported playlist order, including repeats", () => {
  const a = newMedia("direct", "https://a.test/song", "Edited title"),
    b = newMedia("direct", "https://b.test/song", "B");
  const duplicate = { ...a, id: "other", title: "Not authoritative" };
  const result = deduplicate([a], [b, duplicate, b]);
  assert.equal(result.media.length, 2);
  assert.deepEqual(result.ids, [b.id, a.id, b.id]);
  assert.equal(result.media[0].title, "Edited title");
});
test("search combines selected sources without conflating capabilities", () => {
  const a = newMedia("local", "x", "Dawn"),
    b = newMedia("rss", "y", "Dawn episode"),
    c = newMedia("direct", "z", "Evening");
  a.artist = "Aster";
  assert.equal(
    searchMedia([a, b, c], "dawn", new Set(["local", "rss"])).length,
    2,
  );
  assert.deepEqual(searchMedia([a, b], "aster", new Set(["local"])), [a]);
  assert.equal(searchMedia([a, b], "dawn", new Set(["direct"])).length, 0);
});
test("queue end, repeat and shuffle do not repeat current item accidentally", () => {
  const s = { ...freshState(), queue: ["a", "b"], queueIndex: 1 };
  assert.equal(nextIndex(s, true), null);
  assert.equal(nextIndex({ ...s, repeat: "all" }, true), 0);
  assert.equal(nextIndex({ ...s, repeat: "one" }, true), 1);
  assert.equal(
    nextIndex({ ...s, shuffle: true }, false, () => 0),
    0,
  );
  assert.equal(nextIndex({ ...s, queue: [] }), null);
});
test("M3U/PLS preserve order and repeats and reject unsafe/relative unresolvable sources", () => {
  const text =
    "#EXTM3U\n#EXTINF:12,First\nhttps://a.test/a.mp3\n#EXTINF:12,Again\nhttps://a.test/a.mp3\nfile:///etc/passwd\njavascript:alert(1)\n";
  const entries = parsePlaylist(text);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((m) => m.title),
    ["First", "Again"],
  );
  for (const format of ["m3u", "pls"] as const) {
    const out = exportPlaylist(entries, format);
    assert.deepEqual(
      parsePlaylist(out.text).map((m) => m.url),
      entries.map((m) => m.url),
    );
  }
  assert.equal(
    exportPlaylist([newMedia("local", "a", "Local")], "m3u").omitted,
    1,
  );
  assert.equal(
    parsePlaylist(
      "[playlist]\nFile2=https://a.test/2\nFile1=https://a.test/1",
    )[0].url,
    "https://a.test/1",
  );
});
test("URL policy rejects secrets, executable schemes and insecure remote links", () => {
  for (const u of [
    "http://example.org/media",
    "https://user:secret@example.org/a",
    "file:///tmp/a",
    "javascript:alert(1)",
    "data:audio/wav,test",
  ])
    assert.throws(() => directUrl(u));
  assert.equal(
    directUrl("/a", "https://example.org/feed"),
    "https://example.org/a",
  );
  assert.equal(directUrl("http://127.0.0.1:123/a"), "http://127.0.0.1:123/a");
});
test("LRC supports multiple timestamps and sorts lines", () => {
  assert.deepEqual(
    parseLrc("[00:12.50]B\n[00:02][00:05.2]A").map((l) => l.time),
    [2, 5.2, 12.5],
  );
});
test("unimplemented integrations never claim search, stream or download", () => {
  for (const a of adapters.filter((a) => a.status === "planned"))
    assert(Object.values(a.operations).every((v) => v === false));
  assert.equal(adapters.find((a) => a.id === "rss")!.operations.save, false);
});

import { importPortable, portableState } from "../src/portable";
test("portable metadata import rejects unsafe URLs, keeps playlist order and reports local files unavailable", () => {
  const state = freshState(),
    a = newMedia("direct", "a", "A");
  a.url = "https://a.test/a.mp3";
  const local = newMedia("local", "private-handle", "Local");
  local.fileId = "must-not-export";
  state.media = [a, local];
  state.playlists = [{ id: "p", name: "Order", items: [a.id, local.id, a.id] }];
  const exported = portableState(state);
  assert(!JSON.stringify(exported).includes("must-not-export"));
  const parsed = importPortable(JSON.stringify(exported));
  assert.equal(parsed.unavailable, 1);
  assert.equal(parsed.media.length, 1);
  assert.deepEqual(parsed.playlists[0].items, [
    parsed.media[0].id,
    parsed.media[0].id,
  ]);
  assert.throws(() =>
    importPortable('{"version":99,"media":[],"playlists":[]}'),
  );
});

test("artist/album collections preserve distinct artist releases and searchable metadata", () => {
  const a = newMedia("local", "a", "One"),
    b = newMedia("local", "b", "Two");
  a.artist = "Aster";
  b.artist = "Other";
  a.album = b.album = "Volume 1";
  assert.equal(collections([a, b], "album").length, 2);
  assert.equal(collections([a, b], "artist")[0].name, "Aster");
});
test("smart playlists recompute membership and manual playlists retain repeats", () => {
  const a = newMedia("local", "a", "One"),
    b = newMedia("local", "b", "Two");
  a.artist = "Aster";
  b.artist = "Aster";
  a.favorite = true;
  b.favorite = false;
  a.tags = ["Ambient"];
  const p = {
    id: "p",
    name: "Ambient",
    items: [],
    rule: { query: "aster", favorite: true, tag: "ambient" },
  };
  assert.deepEqual(playlistMedia(p, [a, b]), [a]);
  b.favorite = true;
  b.tags = ["ambient"];
  assert.equal(playlistMedia(p, [a, b]).length, 2);
  assert.deepEqual(
    playlistMedia({ id: "m", name: "Manual", items: [b.id, a.id, b.id] }, [
      a,
      b,
    ]),
    [b, a, b],
  );
  assert.deepEqual(
    parseSmartRule({ query: "x", favorite: true, eval: "no", minPlays: -1 }),
    { query: "x", favorite: true },
  );
});

test("queue membership removal removes duplicates and preserves the selected successor", () => {
  const s = {...freshState(),queue:['a','b','a','c'],queueIndex:3};
  removeQueued(s,'a');
  assert.deepEqual(s.queue,['b','c']); assert.equal(s.queueIndex,1);
  removeQueued(s,'c'); assert.deepEqual(s.queue,['b']); assert.equal(s.queueIndex,0);
  removeQueued(s,'b'); assert.deepEqual(s.queue,[]); assert.equal(s.queueIndex,0);
  const active={...freshState(),queue:['a','b','c'],queueIndex:1};
  removeQueued(active,'b'); assert.equal(active.queueIndex,0);
  assert.equal(nextIndex(active),1);
  const first={...freshState(),queue:['a','b'],queueIndex:0};
  removeQueued(first,'a'); assert.equal(first.queueIndex,-1); assert.equal(nextIndex(first),0);
});
test("removing one queued repeat does not remove other occurrences", () => {
  const s={...freshState(),queue:['a','a','b'],queueIndex:2};
  removeQueued(s,'a',1); assert.deepEqual(s.queue,['a','b']); assert.equal(s.queueIndex,1);
});
