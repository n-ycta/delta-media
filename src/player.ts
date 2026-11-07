import { nextIndex, type State, type Media } from "./model";
import { ListeningTracker } from "./listening";
import { Storage } from "./storage";
import { EmbedController, embedUrl } from "./embeds";
import type { PlaybackStatus } from './player-view';
export class Player extends EventTarget {
  private objectUrl = "";
  private readonly listening: ListeningTracker;
  private lastSave = 0;
  private generation = 0;
  private metadataReady = false;
  private restorePosition = 0;
  private lastError = '';
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
    this.listening = new ListeningTracker(state);
    if (embedFrame)
      this.embed = new EmbedController(
        embedFrame,
        () => {
          if(this.usingEmbed){if(this.embed!.hasPosition)this.current!.position=this.embed!.position;if(this.embed!.duration>0)this.current!.duration=this.embed!.duration;this.observe(this.embed!.playing,this.embed!.hasPosition?this.embed!.position:undefined);}
          this.change();
        },
        () =>
          void this.next(true).catch((e) =>
            this.dispatchEvent(new CustomEvent("failure", { detail: e.message })),
          ),
        (message) => {this.lastError=message;this.change();this.dispatchEvent(new CustomEvent("failure",{detail:message}));},
      );
    element.volume = state.volume;
    for(const event of ['loadstart','waiting','canplay','stalled','emptied'])element.addEventListener(event,()=>this.change());
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
      if (!this.current || this.usingEmbed) return;
      this.observe(true,element.currentTime,element.playbackRate);
      this.change();
    });
    element.addEventListener("timeupdate", () => {
      const m = this.current;
      if (!m || !this.metadataReady) return;
      if (Number.isFinite(element.currentTime))
        m.position = element.currentTime;
      this.observe(!element.paused&&!element.seeking,element.currentTime,element.playbackRate);
      this.change();
    });
    element.addEventListener("pause", () => {
      if (!this.usingEmbed) this.observe(false,element.currentTime,element.playbackRate);
      void save().catch(() => {});
      this.change();
    });
    element.addEventListener("seeking", () => {
      this.listening.discontinuity();
    });
    element.addEventListener("ended", () => {
      if (!this.usingEmbed) this.observe(false,element.currentTime,element.playbackRate);
      if (this.current) this.current.position = 0;
      void save().catch(() => {});
      void this.next(true).catch((e) =>
        this.dispatchEvent(new CustomEvent("failure", { detail: e.message })),
      );
    });
    element.addEventListener("error", () => {
      this.lastError = 'Playback failed: unavailable link, network restriction, unsupported codec or protected media.';
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
  private observe(playing:boolean,position?:number,rate=1) {
    if(!this.current)return;
    const result=this.listening.update(this.current,playing,position,rate),now=performance.now();
    if(result.started||result.stopped||(result.seconds>0&&now-this.lastSave>5000)){
      this.lastSave=now;void this.save().catch(()=>{});
    }
  }
  async load(index: number, autoplay = true): Promise<void> {
    if (this.delegate) { if (autoplay) await this.delegate('load',[index,autoplay]); return; }
    return this.playId(this.state.queue[index], autoplay);
  }
  /** Immediate playback is independent of the user-managed queue. */
  async playId(id: string, autoplay = true): Promise<void> {
    this.lastError='';
    try { await this.startId(id,autoplay); }
    catch(error) {this.lastError=error instanceof Error?error.message:String(error);this.change();throw error;}
  }
  private async startId(id: string, autoplay = true): Promise<void> {
    if (this.delegate) { await this.delegate('playId',[id,autoplay]); return; }
    const m = this.state.media.find((m) => m.id === id);
    if (!m)
      throw Error("Queue item is unavailable. Remove it or reimport the file.");
    if(this.current)this.observe(false,this.usingEmbed?(this.embed!.hasPosition?this.embed!.position:undefined):this.element.currentTime,this.element.playbackRate);
    this.listening.reset();
    const generation = ++this.generation;
    this.element.pause();
    this.metadataReady = false;
    this.restorePosition = this.resume ? m.position : 0;
    this.current = m;
    this.state.currentId = m.id;
    this.state.queueIndex = this.state.queue.indexOf(id);
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
  get errorMessage(): string { return this.lastError || this.embed?.error || ''; }
  get status(): PlaybackStatus {
    if(!this.current)return 'idle';
    if(this.delegate)return this.remotePlaying?'playing':'paused';
    if(this.errorMessage||this.element.error)return 'error';
    if(this.usingEmbed){if(this.embed?.provider&&!this.embed.ready)return 'loading';return this.playing?'playing':'paused';}
    if(this.element.networkState===HTMLMediaElement.NETWORK_LOADING&&this.element.readyState<2)return 'loading';
    if(!this.element.paused&&this.element.readyState<3)return 'buffering';
    return this.playing?'playing':'paused';
  }
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
    if(this.current)this.observe(false,this.usingEmbed?(this.embed!.hasPosition?this.embed!.position:undefined):this.element.currentTime,this.element.playbackRate);
    this.listening.reset();
    this.generation++;
    this.element.pause();
    this.embed?.close();
    this.current = undefined;
    this.lastError='';
    this.state.currentId = undefined;
    this.element.removeAttribute('src'); this.element.load(); this.element.hidden = true;
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = ''; }
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    this.change();
  }
  async play(): Promise<void> {
    if(this.delegate)return this.delegate('play',[]);
    this.lastError='';
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
      this.lastError=(e as DOMException).name==='NotAllowedError'?'Press Play to allow playback on this device.':e instanceof Error?e.message:String(e);
      this.change();
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
    this.listening.discontinuity();
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
