/**
 * Provider embeds for sources that cannot be streamed directly (YouTube, SoundCloud,
 * Spotify). Only exact HTTPS player origins are accepted; the official players run in
 * their own frames — no scraping, no DRM bypass.
 */
export type EmbedProvider = "youtube" | "soundcloud" | "spotify";
export const EMBED_ORIGINS: Record<EmbedProvider, string> = {
  youtube: "https://www.youtube-nocookie.com",
  soundcloud: "https://w.soundcloud.com",
  spotify: "https://open.spotify.com",
};
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const SP_KIND = /^(track|album|playlist|episode|show|artist)$/;
const SP_ID = /^[A-Za-z0-9]{10,40}$/;
/** Normalises a provider page or embed URL to a safe embed URL, or throws. */
export function embedUrl(input: string): { provider: EmbedProvider; url: string; key: string } {
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password || u.href.length > 2048) throw Error("unsupported_embed");
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (["youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) {
    const id =
      host === "youtu.be"
        ? u.pathname.slice(1)
        : u.pathname.startsWith("/embed/")
          ? u.pathname.slice(7)
          : u.pathname.startsWith("/shorts/")
            ? u.pathname.slice(8)
            : u.searchParams.get("v") || "";
    if (!YT_ID.test(id)) throw Error("unsupported_embed");
    return {
      provider: "youtube",
      key: id,
      url: `${EMBED_ORIGINS.youtube}/embed/${id}?enablejsapi=1&autoplay=1&playsinline=1&rel=0`,
    };
  }
  if (host === "soundcloud.com" || host === "w.soundcloud.com") {
    const track = host === "w.soundcloud.com" ? u.searchParams.get("url") || "" : u.href;
    const t = new URL(track);
    if (t.protocol !== "https:" || !/^(www\.|m\.)?soundcloud\.com$|^api\.soundcloud\.com$/.test(t.hostname)) throw Error("unsupported_embed");
    const clean = t.origin + t.pathname;
    return {
      provider: "soundcloud",
      key: clean,
      url: `${EMBED_ORIGINS.soundcloud}/player/?url=${encodeURIComponent(clean)}&auto_play=true&visual=true&show_comments=false`,
    };
  }
  if (host === "open.spotify.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed") parts.shift();
    if (/^intl-/.test(parts[0] || "")) parts.shift();
    const [kind, id] = parts;
    if (!SP_KIND.test(kind || "") || !SP_ID.test(id || "")) throw Error("unsupported_embed");
    return { provider: "spotify", key: kind + ":" + id, url: `${EMBED_ORIGINS.spotify}/embed/${kind}/${id}?utm_source=delta` };
  }
  throw Error("unsupported_embed");
}
/** Best-effort remote control of the official players through their postMessage APIs. */
export class EmbedController {
  provider?: EmbedProvider;
  playing = false;
  position = 0;
  hasPosition = false;
  duration = 0;
  constructor(
    readonly frame: HTMLIFrameElement,
    readonly onChange: () => void,
    readonly onEnded: () => void,
    readonly onError: (message:string) => void = () => {},
  ) {
    window.addEventListener("message", (e) => {
      if (!this.provider || e.source !== frame.contentWindow || e.origin !== EMBED_ORIGINS[this.provider]) return;
      let d = e.data;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          return;
        }
      }
      if (!d || typeof d !== "object") return;
      if(this.provider==='youtube'&&d.event==='onReady'){this.handshake();this.play();}
      if(this.provider==='youtube'&&d.event==='onError'){this.set(false);onError('YouTube could not play this video. Open it on YouTube or choose another item.');}
      if(this.provider==='spotify'&&d.type==='ready'){this.frame.contentWindow?.postMessage({command:'load_complete_ack'},EMBED_ORIGINS.spotify);this.play();}
      if(this.provider==='spotify'&&d.type==='error'){this.set(false);onError('Spotify could not play this item. Check access in the embedded player.');}

      if(this.provider==='youtube' && d.event==='infoDelivery' && d.info){
        if(Number.isFinite(d.info.currentTime)){this.position=d.info.currentTime;this.hasPosition=true;}
        if(Number.isFinite(d.info.duration))this.duration=d.info.duration;
        this.onChange();
      }
      if(this.provider==='soundcloud' && ['playProgress','getPosition','getDuration'].includes(d.method)){
        const v=d.value;
        if(d.method==='getDuration' && Number.isFinite(v))this.duration=v/1000;
        else if(Number.isFinite(v?.currentPosition ?? v)){this.position=(v?.currentPosition ?? v)/1000;this.hasPosition=true;}
        this.onChange();
      }
      if (this.provider === "youtube" && d.event === "infoDelivery" && typeof d.info?.playerState === "number") {
        const s = d.info.playerState;
        if (s === 1) this.set(true);
        else if (s === 2) this.set(false);
        else if (s === 0) {
          this.set(false);
          onEnded();
        }
      }
      if (this.provider === "soundcloud") {
        if (d.method === "play") {this.set(true);this.post({method:"getDuration"});}
        if (d.method === "pause") this.set(false);
        if (d.method === "finish") {
          this.set(false);
          onEnded();
        }
      }
      if (this.provider === "spotify" && d.type === "playback_update" && d.payload) {
        if(Number.isFinite(d.payload.position)){this.position=d.payload.position/1000;this.hasPosition=true;}
        if(Number.isFinite(d.payload.duration))this.duration=d.payload.duration/1000;
        this.set(!d.payload.isPaused);this.onChange();
        if (d.payload.duration && d.payload.position >= d.payload.duration - 500 && d.payload.isPaused) onEnded();
      }
    });
    frame.addEventListener("load", () => this.handshake());
  }
  private set(v: boolean) {
    if (this.playing === v) return;
    this.playing = v;
    this.onChange();
  }
  private post(message: unknown) {
    if (!this.provider) return;
    this.frame.contentWindow?.postMessage(typeof message === "string" ? message : JSON.stringify(message), EMBED_ORIGINS[this.provider]);
  }
  private handshake() {
    if (this.provider === "youtube") {
      this.post({event:"listening",id:1,channel:"widget"});
      for(const event of ['onStateChange','onError'])this.post({event:'command',func:'addEventListener',args:[event]});
    }
    if (this.provider === "soundcloud")
      for (const value of ["play", "pause", "finish", "playProgress"]) this.post({ method: "addEventListener", value });
  }
  open(provider: EmbedProvider, url: string) {
    this.provider = provider;
    this.playing = false;
    this.position=0;this.duration=0;this.hasPosition=false;
    this.frame.src = url;
    this.frame.hidden = false;
    this.onChange();
  }
  close() {
    this.provider = undefined;
    this.playing = false;
    this.frame.hidden = true;
    this.frame.removeAttribute("src");
  }
  play() {
    if (this.provider === "youtube") this.post({ event: "command", func: "playVideo", args: [] });
    if (this.provider === "soundcloud") this.post({ method: "play" });
    if (this.provider === "spotify") this.frame.contentWindow?.postMessage({ command: "play" }, EMBED_ORIGINS.spotify);
  }
  pause() {
    if (this.provider === "youtube") this.post({ event: "command", func: "pauseVideo", args: [] });
    if (this.provider === "soundcloud") this.post({ method: "pause" });
    if (this.provider === "spotify") this.frame.contentWindow?.postMessage({ command: "pause" }, EMBED_ORIGINS.spotify);
    this.set(false);
  }
  seek(seconds:number) {
    if(!Number.isFinite(seconds))return;
    seconds=Math.max(0,seconds);
    if(this.provider==='youtube')this.post({event:'command',func:'seekTo',args:[seconds,true]});
    if(this.provider==='soundcloud')this.post({method:'seekTo',value:seconds*1000});
    if(this.provider==='spotify')this.frame.contentWindow?.postMessage({command:'seek',timestamp:seconds},EMBED_ORIGINS.spotify);
    // Position remains provider-confirmed, never an optimistic seek acknowledgement.
  }
  volume(value:number){
    value=Math.max(0,Math.min(1,value));
    if(this.provider==='youtube')this.post({event:'command',func:'setVolume',args:[value*100]});
    if(this.provider==='soundcloud')this.post({method:'setVolume',value:value*100});
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
}
