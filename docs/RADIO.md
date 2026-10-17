# Radio and composable Media views

Media uses the public cliamp radio catalog at `https://radio.cliamp.stream/stations` and station `tracks_url` catalogs. Fifteen preset station descriptors are bundled as a startup fallback. The catalog can be refreshed explicitly. Station names/genres and published track titles/artists can be searched. Playback uses the existing Media player and queue; saved custom live streams remain visible.

Reference implementation researched: [bjarneo/cliamp](https://github.com/bjarneo/cliamp), commit `ce8c65f1bfa207384cf7be6b1b39bcd7a457f9d5` (MIT). No Go player code or media recordings are redistributed. Catalog availability, stream URLs and codecs are controlled by their providers. Network access and browser codec support are required. Requests omit credentials, validate HTTPS, time out and enforce a response size limit.

Track search means a station's **published catalog**, not recognition of its currently airing track. Spotify, SoundCloud, YouTube extraction, account integration, DRM playback, Radio Browser discovery, an equalizer and transcoding are not implemented by this change. Native cliamp support does not make those features available in a browser; they need separate authorized adapters and host capability review.

## Surfaces

`app.manifest.json` declares v1 shared surfaces for library, music, video, podcasts, audiobooks, radio, playlists, queue and listening statistics. Open a surface with `?surface=radio&chrome=0`. Within Delta, presentation changes require the existing parent origin/source and SDK channel. Navigation and theme changes reuse the same player. Navigation tabs can be hidden in Settings without deleting data. Settings remains accessible.

One shared app instance is supported. Multiple simultaneous independent plugin panels are not promised. Standalone Delta workbench HTML provides local-file playback, not the full Media app. Install Media `0.2.0` or later for these declared surfaces.

## Verification

`npm test` checks model/player/storage invariants. `node tests/radio.browser.mjs` checks presets, filtering, the real remote catalog, actual track playback, custom selectors, hidden tabs and mobile overflow against the production preview on port 5193. Do not use the Vite development stylesheet injector as visual evidence: production CSP deliberately disallows inline styles.
