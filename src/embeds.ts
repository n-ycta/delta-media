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
  constructor(
    readonly frame: HTMLIFrameElement,
    readonly onChange: () => void,
    readonly onEnded: () => void,
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
        if (d.method === "play") this.set(true);
        if (d.method === "pause") this.set(false);
        if (d.method === "finish") {
          this.set(false);
          onEnded();
        }
      }
      if (this.provider === "spotify" && d.type === "playback_update" && d.payload) {
        this.set(!d.payload.isPaused);
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
    if (this.provider === "youtube") this.post({ event: "listening", id: 1, channel: "widget" });
    if (this.provider === "soundcloud")
      for (const value of ["play", "pause", "finish"]) this.post({ method: "addEventListener", value });
  }
  open(provider: EmbedProvider, url: string) {
    this.provider = provider;
    this.playing = true;
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
    if (this.provider === "spotify") this.frame.contentWindow?.postMessage({ command: "resume" }, EMBED_ORIGINS.spotify);
    this.set(true);
  }
  pause() {
    if (this.provider === "youtube") this.post({ event: "command", func: "pauseVideo", args: [] });
    if (this.provider === "soundcloud") this.post({ method: "pause" });
    if (this.provider === "spotify") this.frame.contentWindow?.postMessage({ command: "pause" }, EMBED_ORIGINS.spotify);
    this.set(false);
  }
  toggle() {
    this.playing ? this.pause() : this.play();
  }
}
