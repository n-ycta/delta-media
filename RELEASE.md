## 0.3.4

- Media remains the only media UI plugin. YouTube, SoundCloud and Spotify connect as headless provider plugins. Unified search and provider selection live inside Media.
- Process plugin API: providers, search, resolve, library, playlists, queue, settings, statistics and playback-device commands, discoverable through MCP with explicit input schemas.
- Independent player/library/playlist/statistics panels coordinate one audio owner across the host; local file playback survives UI navigation.
- Fixed startup play/pause races, repeated Links tabs, progress controls, icon-only import and player contrast. Added resume/autoplay/speed/seek-step/initial-volume/display preferences.

Install `delta-media.tar.gz` on a Delta node for the API and `delta-media.delta-app` in the host for the interface. Core >=0.4.3 and the current host UI are required.

Limitations: browser autoplay and third-party embed/account restrictions still apply. The Spotify embed is not a full unrestricted playback API. Public YouTube search services may be unavailable. Native codec/background playback and audio effects are not claimed.

Dedicated panels no longer duplicate the player footer. An audio spectrum surface uses actual decoded audio capture when the browser permits it; no synthetic animation substitutes for audio data.

Provider page links can be added directly in the common import dialog. Large libraries sync in bounded batches.

Official provider progress and duration now drive the common timeline and MCP session reports. Seeking uses the provider API. YouTube/SoundCloud volume controls are forwarded; Spotify has no public iframe volume API, so its misleading shared volume slider is disabled. Provider restrictions can prevent playback even when link resolution succeeds.

Search and library actions now show persistent favorite/queue state, confirmation and reversible queue membership. Playlist membership can be edited from library rows or with a searchable multi-select library picker. Library rows expose deletion directly, with confirmation; deletion tombstones prevent stale devices from resurrecting deleted tracks. Playback settings use styled, validated numeric inputs (volume shown as a percentage), and source cards have consistent spacing.

Video now has compact, expanded, hidden/restore modes and a keyboard/pointer-resizable height. Presentation changes preserve the current decoder rather than reloading the source.

Optional source and offline plugins are declared as installation dependencies. Offline copies use the headless YouTube Offline service, then a bounded chunk transfer into the device cache. The format preference supports matching the item, audio-only, or video with audio. Local cached playback is preferred over an online embed, including after an offline restart. Offline files are device-local, not magically synchronized between devices. The download node requires Python 3.10+; YouTube restrictions can still prevent a download.

Search failures are actionable and retryable; concurrent typing does not flood providers and late results do not replace the latest query. Individual provider deadlines keep a hung source from exhausting the UI request timeout.
