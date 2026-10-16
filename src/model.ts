export type MediaKind =
  "audio" | "video" | "podcast" | "audiobook" | "radio" | "live";
export type SourceId =
  | "local"
  | "direct"
  | "rss"
  | "youtube"
  | "nostr"
  | "blossom"
  | "vk"
  | "rutube"
  | "twitch";
export interface Chapter {
  title: string;
  start: number;
}
export interface Bookmark {
  id: string;
  position: number;
  note: string;
}
export interface Media {
  id: string;
  source: SourceId;
  sourceKey: string;
  kind: MediaKind;
  title: string;
  url?: string;
  fileId?: string;
  mime?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: string;
  lyrics?: string;
  duration?: number;
  tags: string[];
  favorite: boolean;
  addedAt: number;
  position: number;
  chapters: Chapter[];
  bookmarks: Bookmark[];
  plays: number;
  skips: number;
  listenedSeconds: number;
  lastPlayed?: number;
  feed?: string;
}
export interface Playlist {
  id: string;
  name: string;
  items: string[];
}
export interface HistoryEntry {
  id: string;
  mediaId: string;
  at: number;
  position: number;
  seconds: number;
}
export interface State {
  version: 1;
  media: Media[];
  playlists: Playlist[];
  queue: string[];
  queueIndex: number;
  repeat: "off" | "one" | "all";
  shuffle: boolean;
  volume: number;
  history: HistoryEntry[];
}
export const freshState = (): State => ({
  version: 1,
  media: [],
  playlists: [],
  queue: [],
  queueIndex: 0,
  repeat: "off",
  shuffle: false,
  volume: 1,
  history: [],
});
export const uid = () => crypto.randomUUID();
export function directUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  if (url.username || url.password || url.href.length > 8192)
    throw Error("Credentials in URLs are not supported.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
  )
    throw Error("Use HTTPS. Insecure remote media is not supported.");
  return url.href;
}
export function newMedia(
  source: SourceId,
  sourceKey: string,
  title: string,
  kind: MediaKind = "audio",
): Media {
  return {
    id: uid(),
    source,
    sourceKey,
    kind,
    title,
    tags: [],
    favorite: false,
    addedAt: Date.now(),
    position: 0,
    chapters: [],
    bookmarks: [],
    plays: 0,
    skips: 0,
    listenedSeconds: 0,
  };
}
export function deduplicate(
  existing: Media[],
  incoming: Media[],
): { media: Media[]; ids: string[] } {
  const media = [...existing],
    keys = new Map(existing.map((m) => [`${m.source}:${m.sourceKey}`, m.id])),
    ids: string[] = [];
  for (const item of incoming) {
    const key = `${item.source}:${item.sourceKey}`;
    let id = keys.get(key);
    if (!id) {
      id = item.id;
      media.push(item);
      keys.set(key, id);
    }
    ids.push(id);
  }
  return { media, ids };
}
export function searchMedia(
  media: Media[],
  query: string,
  sources: ReadonlySet<string>,
  kind?: string,
): Media[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return media.filter(
    (m) =>
      (sources.size === 0 || sources.has(m.source)) &&
      (!kind || m.kind === kind) &&
      words.every((w) =>
        [m.title, m.artist, m.album, m.genre, ...m.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(w),
      ),
  );
}
export function nextIndex(
  state: Pick<State, "queue" | "queueIndex" | "shuffle" | "repeat">,
  ended = false,
  random = Math.random,
): number | null {
  if (!state.queue.length) return null;
  if (ended && state.repeat === "one") return state.queueIndex;
  if (state.shuffle && state.queue.length > 1) {
    const step =
      1 +
      Math.floor(
        Math.min(0.999999, Math.max(0, random())) * (state.queue.length - 1),
      );
    return (state.queueIndex + step) % state.queue.length;
  }
  if (state.queueIndex + 1 < state.queue.length) return state.queueIndex + 1;
  return state.repeat === "all" ? 0 : null;
}
export function parseLrc(input: string): { time: number; text: string }[] {
  return input
    .split(/\r?\n/)
    .flatMap((line) => {
      const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
      return [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].map((m) => ({
        time: Number(m[1]) * 60 + Number(m[2]),
        text,
      }));
    })
    .sort((a, b) => a.time - b.time);
}
