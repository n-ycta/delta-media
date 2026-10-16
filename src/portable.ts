import {
  directUrl,
  parseSmartRule,
  newMedia,
  type State,
  type Media,
  type Playlist,
} from "./model";
/** Versioned link-only interchange. Never exports host credentials, Blob URLs or filesystem paths. */
export function importPortable(text: string): {
  media: Media[];
  playlists: Playlist[];
  unavailable: number;
} {
  if (text.length > 10_000_000) throw Error("Metadata import exceeds 10 MB.");
  const data = JSON.parse(text);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.media) ||
    !Array.isArray(data.playlists) ||
    data.media.length > 10000 ||
    data.playlists.length > 1000
  )
    throw Error("Unsupported library format.");
  const media: Media[] = [],
    remap = new Map<string, string>();
  let unavailable = 0;
  for (const row of data.media) {
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      !row.title.trim()
    )
      throw Error("Invalid media metadata.");
    if (typeof row.url !== "string") {
      unavailable++;
      continue;
    }
    let url: string;
    try {
      url = directUrl(row.url);
    } catch {
      unavailable++;
      continue;
    }
    const kind = [
      "audio",
      "video",
      "podcast",
      "audiobook",
      "radio",
      "live",
    ].includes(row.kind)
      ? row.kind
      : "audio";
    const m = newMedia("direct", url, row.title.slice(0, 512), kind);
    m.url = url;
    for (const field of ["artist", "album", "genre", "lyrics"] as const)
      if (typeof row[field] === "string")
        m[field] = row[field].slice(0, field === "lyrics" ? 100000 : 512);
    if (typeof row.artwork === "string")
      try {
        m.artwork = directUrl(row.artwork);
      } catch {}
    m.tags = Array.isArray(row.tags)
      ? row.tags
          .filter((v: unknown) => typeof v === "string")
          .slice(0, 100)
          .map((v: string) => v.slice(0, 100))
      : [];
    m.favorite = row.favorite === true;
    m.position =
      Number.isFinite(row.position) && row.position >= 0 ? row.position : 0;
    m.chapters = Array.isArray(row.chapters)
      ? row.chapters
          .filter(
            (c: any) =>
              Number.isFinite(c?.start) &&
              c.start >= 0 &&
              typeof c.title === "string",
          )
          .slice(0, 1000)
          .map((c: any) => ({ start: c.start, title: c.title.slice(0, 512) }))
          .sort((a: any, b: any) => a.start - b.start)
      : [];
    remap.set(row.id, m.id);
    media.push(m);
  }
  const playlists = data.playlists
    .filter(
      (p: any) =>
        typeof p?.name === "string" &&
        Array.isArray(p.items) &&
        p.items.length <= 10000,
    )
    .map((p: any) => ({
      id: crypto.randomUUID(),
      name: p.name.slice(0, 512),
      items: p.items.map((id: string) => remap.get(id)).filter(Boolean),
      ...(parseSmartRule(p.rule) ? { rule: parseSmartRule(p.rule) } : {}),
    }));
  return { media, playlists, unavailable };
}
export function portableState(state: State) {
  return {
    version: 1,
    media: state.media.map(({ fileId, ...m }) => m),
    playlists: state.playlists,
  };
}
