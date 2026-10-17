import { nextIndex, uid, type State, type Media } from "./model";
import { Storage } from "./storage";
import { EmbedController, embedUrl } from "./embeds";
export class Player extends EventTarget {
  private objectUrl = "";
  private session = false;
  private lastTick = 0;
  private lastSave = 0;
  private generation = 0;
  private historyId = "";
  private metadataReady = false;
  private restorePosition = 0;
  delegate?: (command:string,args:unknown[])=>Promise<void>;
  remotePlaying = false;
  current?: Media;
  resume = true;
  autoplayNext = true;
  readonly embed?: EmbedController;
  constructor(
    readonly element: HTMLVideoElement,
    readonly state: State,
    readonly storage: Storage,
    readonly save: () => Promise<void>,
    embedFrame?: HTMLIFrameElement,
  ) {
    super();
    if (embedFrame)
      this.embed = new EmbedController(
        embedFrame,
        () => {
          if(this.usingEmbed){if(this.embed!.hasPosition)this.current!.position=this.embed!.position;if(this.embed!.duration>0)this.current!.duration=this.embed!.duration;}
          this.change();
        },
        () =>
          void this.next(true).catch((e) =>
            this.dispatchEvent(new CustomEvent("failure", { detail: e.message })),
          ),
        (message) => this.dispatchEvent(new CustomEvent("failure",{detail:message})),
      );
    element.volume = state.volume;
    element.addEventListener("loadedmetadata", () => {
      const m = this.current;
      if (!m) return;
      this.metadataReady = true;
      if (Number.isFinite(element.duration)) m.duration = element.duration;
      if (
        this.restorePosition > 0 &&
        (!Number.isFinite(element.duration) ||
          this.restorePosition < element.duration - 1)
      ) {
        try {
          element.currentTime = this.restorePosition;
        } catch {}
      }
      this.change();
    });
    element.addEventListener("playing", () => {
      if (!this.current) return;
      if (!this.session) {
        this.current.plays++;
        this.current.lastPlayed = Date.now();
        this.historyId = uid();
        state.history.unshift({
          id: this.historyId,
          mediaId: this.current.id,
          at: Date.now(),
          position: this.current.position,
          seconds: 0,
        });
        state.history = state.history.slice(0, 1000);
        this.session = true;
      }
      this.lastTick = performance.now();
      this.change();
    });
    element.addEventListener("timeupdate", () => {
      const m = this.current;
      if (!m || !this.metadataReady) return;
      const now = performance.now();
      const delta = (now - this.lastTick) / 1000;
      if (
        !element.paused &&
        !element.seeking &&
        this.lastTick &&
        delta > 0 &&
        delta < 3
      ) {
        m.listenedSeconds += delta;
        const h = state.history.find((h) => h.id === this.historyId);
        if (h) h.seconds += delta;
      }
      this.lastTick = now;
      if (Number.isFinite(element.currentTime))
        m.position = element.currentTime;
      const h = state.history.find((h) => h.id === this.historyId);
      if (h) h.position = m.position;
      this.change();
      if (now - this.lastSave > 5000) {
        this.lastSave = now;
        void save().catch(() => {});
      }
    });
    element.addEventListener("pause", () => {
      this.lastTick = 0;
      void save().catch(() => {});
      this.change();
    });
    element.addEventListener("seeking", () => {
      this.lastTick = 0;
    });
    element.addEventListener("ended", () => {
      if (this.current) this.current.position = 0;
      void save().catch(() => {});
      void this.next(true).catch((e) =>
        this.dispatchEvent(new CustomEvent("failure", { detail: e.message })),
      );
    });
    element.addEventListener("error", () => {
      this.dispatchEvent(
        new CustomEvent("failure", {
          detail:
            "Playback failed: unavailable link, network restriction, unsupported codec or protected media. Try a supported local file or direct HTTPS media URL.",
        }),
      );
      this.change();
    });
    if ("mediaSession" in navigator) {
      for (const [action, handler] of Object.entries({
        play: (): void => {
          void this.play().catch(() => {});
        },
        pause: (): void => this.pause(),
        nexttrack: (): void => {
          void this.next().catch(() => {});
        },
        previoustrack: (): void => {
          void this.previous().catch(() => {});
        },
        seekbackward: () => this.seek(this.position - 15),
        seekforward: () => this.seek(this.position + 15),
      }))
        try {
          navigator.mediaSession.setActionHandler(
            action as MediaSessionAction,
            handler,
          );
        } catch {}
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void save().catch(() => {});
    });
    window.addEventListener("pagehide", () => void save().catch(() => {}));
  }
  private change() {
    this.dispatchEvent(new Event("change"));
  }
  async load(index: number, autoplay = true): Promise<void> {
    if (this.delegate) { if (autoplay) await this.delegate('load',[index,autoplay]); return; }
    return this.playId(this.state.queue[index], autoplay);
  }
  /** Immediate playback is independent of the user-managed queue. */
  async playId(id: string, autoplay = true): Promise<void> {
    if (this.delegate) { await this.delegate('playId',[id,autoplay]); return; }
    const m = this.state.media.find((m) => m.id === id);
    if (!m)
      throw Error("Queue item is unavailable. Remove it or reimport the file.");
    const generation = ++this.generation;
    this.element.pause();
    this.metadataReady = false;
    this.restorePosition = this.resume ? m.position : 0;
    this.current = m;
    this.state.currentId = m.id;
    this.state.queueIndex = this.state.queue.indexOf(id);
    this.session = false;
    this.historyId = "";
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
    this.element.removeAttribute("src");
    this.element.load();
    let cached:Blob|undefined;
    if(m.fileId&&(!m.offlineDeviceId||m.offlineDeviceId===localStorage.getItem('delta-media.device')))try{cached=await this.storage.file(m.fileId);}catch{if(!m.embed&&!m.url)throw Error('Local file unavailable. Reimport it from your device.');}
    if (generation !== this.generation) return;
    if (m.embed && this.embed && !cached) {
      this.embed.close();
      const e = embedUrl(m.embed);
      this.element.hidden = true;
      if ("mediaSession" in navigator)
        navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: m.artist || "", album: m.album || "", artwork: m.artwork ? [{src:m.artwork}] : [] });
      m.lastPlayed = Date.now();
      m.plays++;
      if (autoplay) this.embed!.open(e.provider, e.url);
      await this.save();
      this.change();
      return;
    }
    this.embed?.close();
    const source = cached || m.url;
    if (generation !== this.generation) return;
    if (!source) throw Error("This item has no playable source.");
    if (source instanceof Blob) {
      this.objectUrl = URL.createObjectURL(source);
      this.element.src = this.objectUrl;
    } else this.element.src = source;
    this.element.hidden = !["video", "live"].includes(m.kind);
    this.element.load();
    if ("mediaSession" in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: m.title,
        artist: m.artist || "",
        album: m.album || "",
        artwork: m.artwork ? [{src:m.artwork}] : [],
      });
    await this.save();
    if (generation !== this.generation) return;
    this.change();
    if (autoplay) await this.play();
  }
  private get usingEmbed(): boolean { return !!this.current?.embed && !!this.embed && !this.element.getAttribute('src'); }
  get position():number { return this.delegate ? this.current?.position || 0 : this.usingEmbed ? (this.embed?.hasPosition ? this.embed.position : this.current?.position || 0) : this.element.currentTime || 0; }
  get duration():number { return this.delegate ? this.current?.duration || 0 : this.usingEmbed ? this.embed?.duration || this.current?.duration || 0 : Number.isFinite(this.element.duration) ? this.element.duration : 0; }
  volume(value:number){if(this.delegate){void this.delegate('volume',[value]);return;}this.element.volume=value;this.embed?.volume(value);}
  /** True while audio/video or a provider player is playing. */
  get playing(): boolean {
    if(this.delegate)return this.remotePlaying;
    return this.usingEmbed ? this.embed!.playing : !this.element.paused;
  }
  pause() {
    if(this.delegate){void this.delegate('pause',[]);return;}
    this.generation++;
    if (this.usingEmbed) this.embed!.pause();
    else this.element.pause();
  }
  async stop(): Promise<void> {
    if (this.delegate) { await this.delegate('stop', []); this.current = undefined; this.remotePlaying = false; return; }
    this.generation++;
    this.element.pause();
    this.embed?.close();
    this.current = undefined;
    this.state.currentId = undefined;
    this.element.removeAttribute('src'); this.element.load(); this.element.hidden = true;
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = ''; }
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    this.change();
  }
  async play(): Promise<void> {
    if(this.delegate)return this.delegate('play',[]);
    if (this.usingEmbed) {
      if (!this.embed!.provider) {
        const e = embedUrl(this.current!.embed!);
        this.embed!.open(e.provider, e.url);
      } else this.embed!.play();
      return;
    }
    const generation = this.generation;
    try {
      await this.element.play();
    } catch (e) {
      // A newer load/pause owns playback now; a cancelled older play is not a user error.
      if (generation !== this.generation && (e as DOMException).name === 'AbortError') return;
      if ((e as DOMException).name === "NotAllowedError")
        throw Error("Press Play to allow playback on this device.");
      throw e;
    }
  }
  async toggle(): Promise<void> {
    if (!this.playing) await this.play();
    else this.pause();
  }
  seek(time: number) {
    if(this.delegate){void this.delegate('seek',[time]);return;}
    if (!Number.isFinite(time)) return;
    if(this.usingEmbed){this.embed!.seek(time);return;}
    const max = Number.isFinite(this.element.duration)
      ? this.element.duration
      : Infinity;
    try {
      this.element.currentTime = Math.max(0, Math.min(max, time));
    } catch {
      throw Error("Seeking is unavailable for this stream.");
    }
  }
  async next(ended = false): Promise<void> {
    if(this.delegate)return this.delegate('next',[ended]);
    if (ended && !this.autoplayNext) { this.pause(); this.change(); return; }
    if (ended && this.state.repeat === "one" && this.current) {
      this.current.position = 0;
      await this.playId(this.current.id);
      return;
    }
    const next = nextIndex(this.state, ended);
    if (next === null) {
      this.pause();
      this.change();
      return;
    }
    if (!ended && this.current) this.current.skips++;
    if (next === this.state.queueIndex && ended && this.current)
      this.current.position = 0;
    await this.load(next);
  }
  async previous(): Promise<void> {
    if(this.delegate)return this.delegate('previous',[]);
    if (this.position > 3) {
      this.seek(0);
      return;
    }
    if (this.state.queueIndex > 0) await this.load(this.state.queueIndex - 1);
  }
}
