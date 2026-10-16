# Delta Media

A portable, local-first media engine and standalone web UI for Delta. The client has no Node.js runtime dependency: its modules and browser player are intended for Web, Desktop WebView and Android WebView. Node.js is a development/build tool only.

**Current delivery:** working portable client and experimental `delta-app-v1` package, with real isolated Plugin UI SDK embedding tests. Native package installation/decoder acceptance is being integrated separately; native background playback and Delta synchronization are not implemented. A browser test is not APK/EXE acceptance.

## Run

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run package:app
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Serve `dist/` from a static HTTPS host or bundle it in a compatible isolated native app view. The generated UI uses relative assets. Do not load the plugin into Delta's credential-privileged root or disable its CSP to embed it.

## Available

- Artist and album collections generated from editable library metadata.
- Smart playlists evaluated against the current library (search, tags and favorites), with validated portable rule import/export.

- Import local audio/video Blobs into IndexedDB without sending file bytes through JSON IPC. The browser streams from the Blob; import does not read the whole media file into JS memory.
- Direct HTTPS audio/video links, browser-supported radio/live streams; no web page extraction or DRM bypass.
- RSS/Atom file import and bounded HTTPS feed fetch, explicit media enclosures only. Remote fetch requires CORS. HTTP streams are rejected except loopback development URLs. There is no proxy.
- Search saved media across any selected combination of sources. This is library search, not a fabricated remote-service search API.
- Editable metadata, genres, tags, favorites, HTTPS artwork, plain lyrics and synchronized LRC.
- One decoder/player with persistent queue, shuffle, repeat, volume, seek, history, play/skip counters, elapsed listening time and saved position.
- Audiobook classification, manually editable chapters and position bookmarks.
- Named playlists; M3U/M3U8 and PLS import/export with order and duplicate references retained. Invalid URLs are omitted; local-only entries without portable URLs are reported on export.
- Versioned JSON metadata import/export. Original files are not included; unavailable local entries are reported on import. Download local originals separately for backup.
- Actual Delta UI color/spacing/type tokens, IBM Plex fonts, light/dark themes, Phosphor Icons, RU/EN navigation and adaptive layout.

Library metadata and files belong to the current browser/WebView origin. Storage quota, eviction and codec support depend on the device. Persistent-storage permission is best-effort, not a backup guarantee. Concurrent independent tabs are not a supported editing mode. Source outages are shown as playback errors; local files remain playable without a network after the app is loaded. A versioned service worker caches the hosted HTTPS app shell for cold offline startup after one successful load. Native app assets are installed locally; custom-protocol hosts do not depend on service workers.

## Sources

| Source | Search | Metadata | Playback | Covers | Lyrics | Subtitles | File saving |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Local | Library | Editable / filename / decoder duration | Browser codecs | User HTTPS artwork | User text/LRC | Not implemented | Export original |
| Direct / radio | Saved links | Editable / decoder duration | Direct HTTPS, native HLS only if browser supports it | User HTTPS artwork | User text/LRC | Not implemented | Not implemented |
| RSS / Atom | Imported episodes | Feed title/author/enclosure | Direct enclosures | Episode HTTPS artwork | User text/LRC | Not implemented | Not implemented |
| YouTube | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented |
| Nostr / Blossom | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented |
| VK / RuTube / Twitch | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented |

The UI shows the same operation-level statuses. No unavailable integration returns demo results. Nostr publication/discovery and Blossom storage require verified protocol implementations, authorization and explicit upload consent. YouTube and other commercial sources need separate approved-access and playback-policy validation.

## Structure and Delta boundary

- `model.ts`: source-independent catalog, deduplication, search, queue and LRC rules.
- `adapters.ts`: independent source capability descriptors and RSS/Atom reader.
- `storage.ts`: IndexedDB metadata and separate binary Blob store.
- `player.ts`: browser decoder, progress, listening events and optional Media Session hooks.
- `playlists.ts` / `portable.ts`: link and metadata interchange.
- `main.ts`: UI orchestration, no access to Delta owner credentials.

The inspected Host Bridge 1.0 has a 64 KiB JSON request bound. Its current Plugin UI SDK is a source/origin-pinned, grant-limited message broker, not an app installer or a large-file transport. Native hosts currently disable arbitrary plugin frames. The generic host now has a separately verified portable static app package format, per-app origins and an empty-grant SDK channel; this client uses `connectPlugin` for launch context and receives no root transport or credentials. Native acceptance, streaming file handles, platform background/audio-session adapters and compatible Delta replication still require completion before synchronized native libraries can be claimed. Android must not depend on desktop Node.js process installation.

Artist/album pages, smart playlists, collection mounts, full-text remote search, authenticated integrations and synchronized multi-device libraries are not part of this build. They must be implemented behind real adapter contracts rather than UI-only placeholders.
