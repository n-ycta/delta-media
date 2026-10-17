import { directUrl, newMedia, type Media, type MediaKind } from "./model";
import { embedUrl } from "./embeds";
/** Items other Delta apps hand over through `media.play` / `media.enqueue` intents. */
const text = (v: unknown, max = 300) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
const KINDS: MediaKind[] = ["audio", "video", "podcast", "audiobook", "radio", "live"];
export function intentItems(payload: unknown): Media[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const list = Array.isArray(p.items) ? p.items.slice(0, 200) : [p];
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const o = raw as Record<string, unknown>;
    const title = text(o.title) || "Untitled";
    const kind = KINDS.includes(o.kind as MediaKind) ? (o.kind as MediaKind) : "audio";
    try {
      let m: Media;
      const page = text(o.embed, 2048) || text(o.url, 8192);
      let embed: ReturnType<typeof embedUrl> | undefined;
      try {
        embed = page ? embedUrl(page) : undefined;
      } catch {
        embed = undefined;
      }
      if (embed) {
        m = newMedia(embed.provider, embed.key, title, kind);
        m.embed = embed.url;
        if (text(o.url, 8192) && !text(o.embed)) m.feed = text(o.url, 8192);
      } else {
        const url = directUrl(text(o.url, 8192));
        m = newMedia("direct", url, title, kind);
        m.url = url;
      }
      m.artist = text(o.artist) || undefined;
      if(text(o.channelUrl,2048))try{const u=new URL(String(o.channelUrl));if(u.protocol==='https:'&&u.hostname==='www.youtube.com')m.channelUrl=u.href;}catch{}
      m.album = text(o.album) || undefined;
      if (typeof o.duration === "number" && o.duration > 0 && o.duration < 1e6) m.duration = o.duration;
      if (text(o.artwork, 2048)) {
        try {
          m.artwork = directUrl(text(o.artwork, 2048));
        } catch {}
      }
      const provider = text(o.provider, 40);
      if (provider) m.tags = [provider];
      return [m];
    } catch {
      return [];
    }
  });
}
