## 0.3.0

- Media remains the only media UI plugin. YouTube, SoundCloud and Spotify connect as headless provider plugins. Unified search and provider selection live inside Media.
- Process plugin API: providers, search, resolve, library, playlists, queue, settings, statistics and playback-device commands, discoverable through MCP with explicit input schemas.
- Independent player/library/playlist/statistics panels coordinate one audio owner across the host; local file playback survives UI navigation.
- Fixed startup play/pause races, repeated Links tabs, progress controls, icon-only import and player contrast. Added resume/autoplay/speed/seek-step/initial-volume/display preferences.

Install `delta-media.tar.gz` on a Delta node for the API and `delta-media.delta-app` in the host for the interface. Core >=0.4.3 and the current host UI are required.

Limitations: browser autoplay and third-party embed/account restrictions still apply. The Spotify embed is not a full unrestricted playback API. Public YouTube search services may be unavailable. Native codec/background playback and audio effects are not claimed.
