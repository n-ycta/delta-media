import { directUrl, newMedia, type Media } from "./model";
export function parsePlaylist(input: string, base?: string): Media[] {
  if (input.length > 5_000_000) throw Error("Playlist exceeds 5 MB.");
  const out: Media[] = [];
  const add = (url: string, title: string) => {
    try {
      const u = directUrl(url.trim(), base);
      const m = newMedia(
        "direct",
        u,
        title.trim() ||
          decodeURIComponent(new URL(u).pathname.split("/").pop() || "Media"),
      );
      m.url = u;
      out.push(m);
    } catch {
      /* Unsafe/unresolvable entries are omitted, not fabricated. */
    }
  };
  if (/^\s*\[playlist\]/im.test(input)) {
    const rows = new Map<number, { url?: string; title?: string }>();
    for (const line of input.split(/\r?\n/)) {
      const m = line.match(/^(File|Title)(\d+)=(.*)$/i);
      if (m) {
        const n = Number(m[2]);
        const row = rows.get(n) || {};
        if (m[1].toLowerCase() === "file") row.url = m[3];
        else row.title = m[3];
        rows.set(n, row);
      }
    }
    for (const [, r] of [...rows].sort((a, b) => a[0] - b[0]))
      if (r.url) add(r.url, r.title || "");
  } else {
    let title = "";
    for (const line of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      if (line.startsWith("#EXTINF:"))
        title = line.slice(line.indexOf(",") + 1);
      else if (line.trim() && !line.startsWith("#")) {
        add(line, title);
        title = "";
      }
    }
  }
  if (out.length > 10000) throw Error("Playlist exceeds 10,000 entries.");
  return out;
}
const clean = (s: string) => s.replace(/[\r\n]/g, " ");
export function exportPlaylist(
  media: Media[],
  format: "m3u" | "pls",
): { text: string; omitted: number } {
  const playable = media.filter((m) => m.url);
  return {
    omitted: media.length - playable.length,
    text:
      format === "m3u"
        ? "#EXTM3U\n" +
          playable
            .map(
              (m) =>
                `#EXTINF:${Math.floor(m.duration || -1)},${clean(m.title)}\n${m.url}\n`,
            )
            .join("")
        : "[playlist]\n" +
          playable
            .map(
              (m, i) =>
                `File${i + 1}=${m.url}\nTitle${i + 1}=${clean(m.title)}\nLength${i + 1}=${Math.floor(m.duration || -1)}\n`,
            )
            .join("") +
          `NumberOfEntries=${playable.length}\nVersion=2\n`,
  };
}
