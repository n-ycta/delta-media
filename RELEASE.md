Experimental portable Delta Media client — not full service parity.

- Real local audio/video, direct HTTPS/radio and RSS/Atom playback where the host decoder and source permissions allow it.
- Persistent local library, queue, history, progress, editable metadata/LRC, audiobook chapters/bookmarks and playlist interchange.
- Artist/album collections and dynamic smart playlists with validated portable rules.
- Delta-style Phosphor interface, light/dark themes, adaptive desktop/mobile layout and Settings-only language selection.
- Fifteen cliamp radio presets, station filtering, published track catalog search and actual shared-player playback.
- Declarative shared Media surfaces for the workbench, hideable tabs and styled form controls.
- Verified portable delta-app-v1 package; isolated SDK context, no Delta owner credential access.

Browser tests exercise actual WAV/WebM playback, restore, RSS, playlists and cold offline startup. Native-host package install/UI startup has been tested separately; it is not proof of native codec or background playback support. Browser/WebView storage is device/origin-local and subject to quota/eviction.

YouTube, Nostr/Blossom, VK/RuTube/Twitch, multi-device Delta synchronization, mounted external collections and native background playback are not implemented. No DRM, authentication or CORS bypass is provided. Verify SHA256SUMS before importing the .delta-app package.

Composable surfaces require a host with UI 0.2.0 or later. V1 uses one shared Media runtime; simultaneous independent Media panes are not implemented. Spotify/SoundCloud account adapters, Radio Browser discovery and an equalizer are not included. See docs/RADIO.md for the public catalog contract and limitations.
