import { directUrl, newMedia, type Media, type SourceId } from "./model";
export type Operation =
  | "search"
  | "metadata"
  | "stream"
  | "artwork"
  | "subtitles"
  | "lyrics"
  | "save";
export interface SourceAdapter {
  id: SourceId;
  label: string;
  status: "ready" | "planned";
  operations: Record<Operation, string | false>;
  reason: string;
}
const no: Record<Operation, string | false> = {
  search: false,
  metadata: false,
  stream: false,
  artwork: false,
  subtitles: false,
  lyrics: false,
  save: false,
};
export const adapters: SourceAdapter[] = [
  {
    id: "local",
    label: "Local files",
    status: "ready",
    operations: {
      ...no,
      search: "Imported library",
      metadata: "Editable; filename and browser duration",
      stream: "Browser codecs",
      artwork: "User-supplied HTTPS image",
      lyrics: "User-supplied plain text / LRC",
      save: "Original local file export",
    },
    reason:
      "Files are copied to IndexedDB. Codec and available storage depend on the device.",
  },
  {
    id: "direct",
    label: "Direct links / radio",
    status: "ready",
    operations: {
      ...no,
      search: "Saved links",
      metadata: "Editable; browser duration when available",
      stream:
        "Direct browser-supported HTTPS media; native HLS only if supported",
    },
    reason:
      "No web page extraction, DRM, authenticated URL handling or transcoding. Remote HTTP is rejected.",
  },
  {
    id: "rss",
    label: "RSS / Atom",
    status: "ready",
    operations: {
      ...no,
      search: "Imported episodes",
      metadata: "RSS enclosure / Atom enclosure",
      stream: "Direct enclosure playback",
      artwork: "Feed artwork if available",
    },
    reason:
      "Explicit import from file or HTTPS fetch with source CORS permission. No proxy. Only explicit enclosures are playable.",
  },
  ...(["youtube", "soundcloud", "spotify"] as const).map((id) => ({
    id,
    label: { youtube: "YouTube", soundcloud: "SoundCloud", spotify: "Spotify" }[
      id
    ],
    status: "ready" as const,
    operations: {
      ...no,
      search: "Via provider app intent (media.play / media.enqueue)",
      metadata: "Title/artist/artwork supplied by the provider app",
      stream: "Official embedded player",
    },
    reason:
      "Played through the provider's official embed. Search lives in separate provider apps that send media intents; no scraping, DRM or account bypass. Spotify plays previews unless signed in to Spotify.",
  })),
  ...(["nostr", "blossom", "vk", "rutube", "twitch"] as const).map(
    (id) => ({
      id,
      label: {
        nostr: "Nostr",
        blossom: "Blossom",
        vk: "VK Video",
        rutube: "RuTube",
        twitch: "Twitch",
      }[id],
      status: "planned" as const,
      operations: { ...no },
      reason:
        "Not implemented. Requires separate protocol/API, authorization, policy and host validation; no scraping or DRM bypass.",
    }),
  ),
];
const text = (node: Element, name: string) =>
  [...node.getElementsByTagName("*")]
    .find((e) => e.localName === name)
    ?.textContent?.trim() || "";
export function parseFeed(xml: string, base?: string): Media[] {
  if (xml.length > 5_000_000) throw Error("Feed exceeds 5 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("XML entity declarations are not accepted.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw Error("Invalid RSS / Atom XML.");
  const entries = [...doc.getElementsByTagName("*")].filter((e) =>
    ["item", "entry"].includes(e.localName),
  );
  if (entries.length > 5000) throw Error("Feed exceeds 5,000 entries.");
  const media: Media[] = [];
  for (const entry of entries) {
    const children = [...entry.getElementsByTagName("*")];
    const enclosure =
      children.find(
        (e) =>
          e.localName === "enclosure" &&
          (e.hasAttribute("url") || e.hasAttribute("href")),
      ) ||
      children.find(
        (e) => e.localName === "link" && e.getAttribute("rel") === "enclosure",
      );
    if (!enclosure) continue;
    try {
      const url = directUrl(
        enclosure.getAttribute("url") || enclosure.getAttribute("href") || "",
        base,
      );
      const mime = enclosure.getAttribute("type") || "";
      if (mime && !/^(audio|video)\//.test(mime)) continue;
      const m = newMedia(
        "rss",
        text(entry, "guid") || text(entry, "id") || url,
        text(entry, "title") || "Untitled episode",
        "podcast",
      );
      m.url = url;
      m.mime = mime;
      m.artist = text(entry, "author") || text(entry, "creator");
      m.album = text(doc.documentElement, "title");
      m.feed = base;
      m.sourceKey = (base || m.album || "feed") + ":" + m.sourceKey;
      const image = children.find(
        (e) => e.localName === "image" && e.hasAttribute("href"),
      );
      if (image)
        try {
          m.artwork = directUrl(image.getAttribute("href")!, base);
        } catch {}
      media.push(m);
    } catch {
      /* Invalid/unsafe enclosure is not imported. */
    }
  }
  return media;
}
export async function fetchFeed(
  url: string,
  signal?: AbortSignal,
): Promise<Media[]> {
  const u = directUrl(url);
  const response = await fetch(u, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: signal || AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error(`Feed HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw Error("Feed body unavailable.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5_000_000) throw Error("Feed exceeds 5 MB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseFeed(await new Blob(chunks as BlobPart[]).text(), u);
}
