import test from "node:test";
import assert from "node:assert/strict";
import {
  radioPresets,
  matchStations,
  stationMedia,
  stationTracks,
  loadRadioStations,
} from "../src/radio";
test("bundled stations are HTTPS, distinct and searchable by name or genre", () => {
  assert.equal(radioPresets.length, 15);
  assert.equal(new Set(radioPresets.map((s) => s.id)).size, 15);
  for (const s of radioPresets) {
    assert.equal(new URL(s.stream).protocol, "https:");
    assert(s.name);
    assert.equal(stationMedia(s).kind, "radio");
  }
  assert.equal(matchStations(radioPresets, "LOFI").length, 1);
  assert.equal(
    matchStations(radioPresets, "no-station-with-this-name").length,
    0,
  );
});
test("remote catalogs omit credentials and discard unsafe media URLs", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.credentials, "omit");
      return new Response(
        JSON.stringify({
          tracks: [
            {
              title: "Safe",
              artist: "Artist",
              url: "https://example.org/audio.mp3",
            },
            { title: "Bad", url: "http://example.org/file" },
            { url: "javascript:alert(1)" },
            null,
          ],
        }),
      );
    };
    const tracks = await stationTracks(radioPresets[0]);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, "Safe");
    assert.equal(tracks[0].artist, "Artist");
  } finally {
    globalThis.fetch = original;
  }
});
test("station catalog skips invalid transports and rejects invalid payloads", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          stations: [
            { id: "ok", name: "Safe", stream: "https://example.org/live" },
            { id: "bad", name: "Bad", stream: "file:///etc/passwd" },
            null,
          ],
        }),
      );
    assert.equal((await loadRadioStations()).length, 1);
    globalThis.fetch = async () => new Response("{}");
    await assert.rejects(loadRadioStations(), /Invalid radio catalog/);
  } finally {
    globalThis.fetch = original;
  }
});
