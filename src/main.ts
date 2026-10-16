import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./base.css";
import { importPortable, portableState } from "./portable";
import { icon } from "./icons";
import "./style.css";
import { Storage } from "./storage";
import { Player } from "./player";
import { adapters, parseFeed, fetchFeed } from "./adapters";
import {
  deduplicate,
  directUrl,
  newMedia,
  searchMedia,
  uid,
  parseLrc,
  type State,
  type Media,
  type MediaKind,
} from "./model";
import { parsePlaylist, exportPlaylist } from "./playlists";
const app = document.querySelector<HTMLDivElement>("#app")!;
let language = localStorage.getItem("delta-media.language") || "en";
const t = (ru: string, en: string) => (language === "ru" ? ru : en);
const preference = localStorage.getItem("delta-media.theme");
let theme =
  preference === "light" || preference === "dark"
    ? preference
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.lang = language;
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const time = (n = 0) =>
  Number.isFinite(n)
    ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`
    : "LIVE";
const icons = Object.fromEntries(
  [
    "home",
    "library",
    "audio",
    "video",
    "podcast",
    "audiobook",
    "radio",
    "favorites",
    "history",
    "playlists",
    "sources",
    "stats",
    "queue",
    "settings",
  ].map((name) => [name, icon(name)]),
);
let state: State,
  storage: Storage,
  player: Player,
  view = "home",
  query = "",
  selectedSources = new Set<string>(),
  sort = "added",
  playlistId = "",
  selectedId = "",
  saving = Promise.resolve(),
  saveError = false;
function notify(message: string, error = false) {
  const box = document.querySelector<HTMLElement>("#notice")!;
  box.textContent = message;
  box.className = error ? "notice error" : "notice";
  box.hidden = false;
  if (!error)
    setTimeout(() => {
      if (box.textContent === message) box.hidden = true;
    }, 5000);
}
function run(fn: () => Promise<unknown> | unknown) {
  Promise.resolve()
    .then(fn)
    .catch((e) => notify(e instanceof Error ? e.message : String(e), true));
}
async function persist() {
  const snapshot = structuredClone(state);
  saving = saving.catch(() => {}).then(() => storage.save(snapshot));
  try {
    await saving;
    saveError = false;
  } catch (e) {
    saveError = true;
    notify(
      t(
        "Не удалось сохранить. Проверьте свободное место. Экспортируйте библиотеку до закрытия.",
        "Could not save. Check available storage. Export your library before closing.",
      ),
      true,
    );
    throw e;
  }
}
function labels(): Record<string, string> {
  return {
    home: t("Главная", "Home"),
    library: t("Медиатека", "Library"),
    audio: t("Музыка", "Music"),
    video: t("Видео", "Video"),
    podcast: t("Подкасты", "Podcasts"),
    audiobook: t("Аудиокниги", "Audiobooks"),
    radio: t("Эфиры", "Live"),
    favorites: t("Избранное", "Favorites"),
    history: t("История", "History"),
    playlists: t("Плейлисты", "Playlists"),
    sources: t("Источники", "Sources"),
    stats: t("Статистика", "Listening"),
    queue: t("Очередь", "Queue"),
    settings: t("Настройки", "Settings"),
  };
}
function shell() {
  app.innerHTML = `<aside><a class="brand" href="#home"><img src="./delta-logo.svg" alt="Delta"><span class="brand-text"><strong>Delta</strong><small>media 0.1</small></span></a><nav id="nav"></nav></aside><section class="workspace"><header><div class="breadcrumbs">delta / <span id="breadcrumb">media</span></div><label class="search"><span>${icon("search")}</span><input id="search" type="search" placeholder="${t("Поиск в выбранных источниках", "Search selected sources")}" aria-label="${t("Поиск", "Search")}"></label><button data-action="theme" title="${t("Тема", "Theme")}" aria-label="Theme">${icon(theme === "dark" ? "sun" : "moon")}</button><button data-action="import" class="primary">${icon("plus")} ${t("Импорт", "Import")}</button></header><div id="notice" class="notice" hidden role="status"></div><div id="stage"><video id="media" playsinline preload="metadata" referrerpolicy="no-referrer" hidden></video></div><main id="view"></main></section><footer><div class="now"><div class="mini-art">${icon("audio")}</div><div><strong id="now-title">${t("Пауза", "Paused")}</strong><small id="now-artist">Delta Media</small></div></div><div class="transport"><div class="transport-buttons"><button data-action="shuffle" id="shuffle" aria-label="${t("Перемешивание", "Shuffle")}">${icon("shuffle")}</button><button data-action="previous" aria-label="${t("Назад", "Previous")}">${icon("previous")}</button><button data-action="toggle" id="toggle" class="play" aria-label="${t("Воспроизведение / пауза", "Play / pause")}">${icon("play")}</button><button data-action="next" aria-label="${t("Далее", "Next")}">${icon("next")}</button><button data-action="repeat" id="repeat" aria-label="${t("Повтор", "Repeat")}">${icon("repeat")}</button></div><div class="timeline"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${t("Позиция", "Position")}"><span id="duration">0:00</span></div></div><div class="volume"><span aria-hidden="true">${icon("volume")}</span><input id="volume" type="range" min="0" max="1" step="0.01" value="${state.volume}" aria-label="${t("Громкость", "Volume")}"><button data-action="queue" aria-label="${t("Очередь", "Queue")}">${icon("queue")}</button></div></footer><dialog id="dialog"></dialog><input id="files" type="file" multiple accept="audio/*,video/*,.json,.m3u,.m3u8,.pls,.xml,.rss,.atom" hidden>`;
  document
    .querySelector<HTMLInputElement>("#search")!
    .addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value;
      render();
    });
  document
    .querySelector<HTMLInputElement>("#seek")!
    .addEventListener("input", (e) =>
      run(() => player.seek(Number((e.target as HTMLInputElement).value))),
    );
  document
    .querySelector<HTMLInputElement>("#volume")!
    .addEventListener("input", (e) => {
      state.volume = Number((e.target as HTMLInputElement).value);
      player.element.volume = state.volume;
      run(persist);
    });
  document
    .querySelector<HTMLInputElement>("#files")!
    .addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      const files = [...(el.files || [])];
      el.value = "";
      run(() => importFiles(files));
    });
}
function filtered() {
  let rows = searchMedia(state.media, query, selectedSources);
  if (view === "favorites") rows = rows.filter((m) => m.favorite);
  if (["audio", "video", "podcast", "audiobook"].includes(view))
    rows = rows.filter((m) => m.kind === view);
  if (view === "radio")
    rows = rows.filter((m) => ["radio", "live"].includes(m.kind));
  if (view === "home")
    rows = rows
      .filter((m) => m.position > 0)
      .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  else if (view === "history")
    rows = state.history
      .map((h) => rows.find((m) => m.id === h.mediaId))
      .filter((m): m is Media => !!m)
      .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
  else if (view === "queue")
    rows = state.queue
      .map((id) => rows.find((m) => m.id === id))
      .filter((m): m is Media => !!m);
  else if (view === "playlists" && playlistId) {
    const p = state.playlists.find((p) => p.id === playlistId);
    rows = (p?.items || [])
      .map((id) => rows.find((m) => m.id === id))
      .filter((m): m is Media => !!m);
  } else
    rows.sort(
      sort === "title"
        ? (a, b) => a.title.localeCompare(b.title)
        : sort === "plays"
          ? (a, b) => b.plays - a.plays
          : (a, b) => b.addedAt - a.addedAt,
    );
  return rows;
}
function row(m: Media, index: number) {
  return `<article class="media-row" data-id="${m.id}"><button class="art ${m.kind}" data-action="play" data-id="${m.id}" aria-label="${t("Воспроизвести", "Play")} ${esc(m.title)}">${m.artwork ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(m.artwork)}">` : icons[m.kind as keyof typeof icons] || "▷"}</button><button class="media-title" data-action="details" data-id="${m.id}"><strong>${esc(m.title)}</strong><span>${esc(m.artist || m.album || "—")}</span>${m.position > 0 ? `<small>${t("Продолжить с", "Resume at")} ${time(m.position)}</small>` : ""}</button><span class="source-tag">${esc(m.source)}</span><span class="row-time">${m.kind === "radio" || m.kind === "live" ? "LIVE" : time(m.duration)}</span><button data-action="favorite" data-id="${m.id}" aria-pressed="${m.favorite}" aria-label="${t("Избранное", "Favorite")}">${icon("favorites")}</button><button data-action="enqueue" data-id="${m.id}" aria-label="${t("В очередь", "Add to queue")}">${icon("plus")}</button>${view === "queue" ? `<button data-action="queue-up" data-index="${index}" aria-label="Move up">${icon("arrow-up")}</button><button data-action="queue-remove" data-index="${index}" aria-label="Remove from queue">${icon("close")}</button>` : ""}</article>`;
}
function render() {
  const label = labels();
  const crumb = document.querySelector("#breadcrumb");
  if (crumb) crumb.textContent = label[view] || "media";
  document.querySelector("#nav")!.innerHTML = Object.entries(label)
    .filter(([id]) => id !== "queue")
    .map(
      ([id, name]) =>
        `<button class="${view === id ? "active" : ""}" data-action="view" data-view="${id}"><span>${icons[id as keyof typeof icons]}</span>${name}${id === "library" ? `<small>${state.media.length}</small>` : ""}</button>`,
    )
    .join("");
  const target = document.querySelector("#view")!;
  if (view === "settings") {
    target.innerHTML = `<div class="heading"><h1>${label.settings}</h1></div><section class="settings-panel"><label for="language-select">${t("Язык", "Language")}</label><select id="language-select"><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="ru" ${language === "ru" ? "selected" : ""}>Русский</option></select><label for="theme-select">${t("Тема", "Theme")}</label><select id="theme-select"><option value="light" ${theme === "light" ? "selected" : ""}>${t("Светлая", "Light")}</option><option value="dark" ${theme === "dark" ? "selected" : ""}>${t("Тёмная", "Dark")}</option></select></section>`;
    target.querySelector<HTMLSelectElement>("#language-select")!.onchange = (
      e,
    ) => {
      localStorage.setItem(
        "delta-media.language",
        (e.target as HTMLSelectElement).value,
      );
      location.reload();
    };
    target.querySelector<HTMLSelectElement>("#theme-select")!.onchange = (
      e,
    ) => {
      theme = (e.target as HTMLSelectElement).value;
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("delta-media.theme", theme);
      document.querySelector("[data-action=theme]")!.innerHTML = icon(
        theme === "dark" ? "sun" : "moon",
      );
    };
    return;
  }
  if (view === "sources") {
    target.innerHTML = `<div class="heading"><div><h1>${label.sources}</h1></div></div><div class="source-grid">${adapters
      .map(
        (a) =>
          `<article class="source-card"><div class="source-card-head"><h2>${a.label}</h2><span class="status ${a.status}">${a.status === "ready" ? t("Работает", "Available") : t("Не реализовано", "Not implemented")}</span></div><p>${a.reason}</p><dl>${Object.entries(
            a.operations,
          )
            .map(([key, value]) => `<dt>${key}</dt><dd>${value || "—"}</dd>`)
            .join("")}</dl></article>`,
      )
      .join("")}</div>`;
    return;
  }
  if (view === "stats") {
    const listened = state.media.reduce((n, m) => n + m.listenedSeconds, 0);
    target.innerHTML = `<div class="heading"><div><h1>${label.stats}</h1></div></div><div class="metrics"><article><strong>${Math.floor(listened / 60)}</strong><span>${t("минут воспроизведения", "minutes played")}</span></article><article><strong>${state.media.reduce((n, m) => n + m.plays, 0)}</strong><span>${t("запусков", "play sessions")}</span></article><article><strong>${state.media.reduce((n, m) => n + m.skips, 0)}</strong><span>${t("пропусков", "skips")}</span></article></div><h2>${t("Чаще всего", "Most played")}</h2>${[
      ...state.media,
    ]
      .sort((a, b) => b.plays - a.plays)
      .filter((m) => m.plays)
      .slice(0, 20)
      .map(row)
      .join("")}`;
    return;
  }
  const rows = filtered(),
    title =
      view === "playlists" && playlistId
        ? state.playlists.find((p) => p.id === playlistId)?.name
        : label[view];
  target.innerHTML = `<div class="heading"><div><h1>${view === "home" ? t("Продолжить", "Continue listening") : esc(title)}</h1><p>${rows.length} ${t("записей", "items")}${view === "queue" ? " · " + t("Порядок сохраняется", "Order is saved") : ""}</p></div><div class="heading-actions">${view === "playlists" ? `<button data-action="new-playlist">${icon("plus")} ${t("Создать", "Create")}</button>${playlistId ? `<button data-action="export-playlist">${icon("download")} M3U</button><button data-action="export-playlist" data-format="pls">${icon("download")} PLS</button>` : ""}` : ""}${rows.length ? `<button class="primary" data-action="play-all">${icon("play")} ${t("Слушать", "Play")}</button>` : ""}</div></div>
 ${view === "playlists" ? `<div class="chips">${state.playlists.map((p) => `<button class="${playlistId === p.id ? "selected" : ""}" data-action="playlist" data-id="${p.id}">${esc(p.name)} · ${p.items.length}</button>`).join("")}</div>` : ""}
 <div class="filters"><div class="chips">${adapters
   .filter((a) => a.status === "ready")
   .map(
     (a) =>
       `<button class="${selectedSources.has(a.id) ? "selected" : ""}" data-action="source" data-id="${a.id}" aria-pressed="${selectedSources.has(a.id)}">${icon(a.id === "local" ? "hard-drive" : a.id === "rss" ? "podcast" : "sources")} ${a.id === "local" ? t("Файлы", "Local") : a.id === "rss" ? "RSS" : t("Ссылки", "Links")}</button>`,
   )
   .join(
     "",
   )}</div><select id="sort" aria-label="${t("Сортировка", "Sort")}"><option value="added" ${sort === "added" ? "selected" : ""}>${t("По дате", "Recent")}</option><option value="title" ${sort === "title" ? "selected" : ""}>${t("По названию", "Title")}</option><option value="plays" ${sort === "plays" ? "selected" : ""}>${t("По запускам", "Most played")}</option></select></div>
 ${rows.length ? `<div class="media-list">${rows.map((m, i) => row(m, view === "queue" ? state.queue.map((id, index) => ({ id, index })).filter((item) => rows.some((row) => row.id === item.id))[i].index : i)).join("")}</div>` : `<div class="empty"><span>${icon("library")}</span><h2>${query ? t("Не найдено", "No results") : t("Пусто", "Empty")}</h2><button data-action="import">${icon("plus")} ${t("Импорт", "Import")}</button></div>`}
 <div class="library-tools"><button data-action="export-library" title="${t("Экспорт метаданных", "Export metadata")}" aria-label="${t("Экспорт метаданных", "Export metadata")}">${icon("download")}</button><button data-action="persist" title="${t("Постоянное хранилище", "Persistent storage")}" aria-label="${t("Постоянное хранилище", "Persistent storage")}">${icon("hard-drive")}</button></div>`;
  target.querySelector("#sort")?.addEventListener("change", (e) => {
    sort = (e.target as HTMLSelectElement).value;
    render();
  });
}
function updatePlayer() {
  const el = player.element,
    m = player.current;
  document.querySelector("#now-title")!.textContent =
    m?.title || t("Пауза", "Paused");
  document.querySelector("#now-artist")!.textContent =
    m?.artist || m?.source || "Delta Media";
  document.querySelector("#toggle")!.innerHTML = icon(
    el.paused ? "play" : "pause",
  );
  document.querySelector("#elapsed")!.textContent = time(el.currentTime);
  document.querySelector("#duration")!.textContent =
    m?.kind === "radio" || m?.kind === "live" ? "LIVE" : time(el.duration || 0);
  const range = document.querySelector<HTMLInputElement>("#seek")!;
  range.disabled = !Number.isFinite(el.duration) || el.duration === 0;
  range.max = String(Number.isFinite(el.duration) ? el.duration : 100);
  range.value = String(el.currentTime || 0);
  document
    .querySelector("#shuffle")!
    .classList.toggle("selected", state.shuffle);
  document
    .querySelector("#repeat")!
    .classList.toggle("selected", state.repeat !== "off");
  document.querySelector("#repeat")!.innerHTML =
    icon("repeat") + (state.repeat === "one" ? "<small>1</small>" : "");
  document
    .querySelector("#repeat")!
    .setAttribute("aria-label", "Repeat: " + state.repeat);
  const lyrics = document.querySelector("#synced-lyrics");
  if (lyrics && m) {
    const lines = parseLrc(m.lyrics || "");
    const current = [...lines].reverse().find((l) => l.time <= el.currentTime);
    lyrics.textContent =
      current?.text || m.lyrics || t("Нет текста", "No lyrics");
  }
}
function modal(content: string) {
  const d = document.querySelector<HTMLDialogElement>("#dialog")!;
  d.innerHTML = `<button class="close" data-action="close" aria-label="${t("Закрыть", "Close")}">${icon("close")}</button>${content}`;
  if (!d.open) d.showModal();
}
function input(name: string, label: string, value = "", type = "text") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "text" ? 'maxlength="512"' : ""}></label>`;
}
function importDialog() {
  modal(
    `<h2>${t("Импорт", "Import")}</h2><button class="primary full" data-action="choose-files">${t("Файлы", "Files")} ${icon("upload")}</button><hr><form id="add-link">${input("url", t("HTTPS-ссылка", "HTTPS URL"), "", "url")}${input("title", t("Название", "Title"))}<label>${t("Тип", "Type")}<select name="kind"><option value="audio">${t("Аудио", "Audio")}</option><option value="video">${t("Видео", "Video")}</option><option value="radio">${t("Радио", "Radio")}</option><option value="live">${t("Эфир", "Live")}</option><option value="audiobook">${t("Аудиокнига", "Audiobook")}</option><option value="rss">RSS / Atom</option></select></label><p class="hint">${t("RSS требует CORS. Альтернатива — импорт XML.", "RSS requires CORS; XML import is available.")}</p><button type="submit" class="primary">${icon("plus")} ${t("Добавить", "Add")}</button><p id="form-error" role="alert"></p></form>`,
  );
  document.querySelector<HTMLFormElement>("#add-link")!.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const form = e.target as HTMLFormElement,
        button = form.querySelector("button")!;
      button.disabled = true;
      try {
        const data = new FormData(form);
        const u = directUrl(String(data.get("url"))),
          kind = String(data.get("kind"));
        if (kind === "rss") {
          notify(t("Загрузка ленты…", "Loading feed…"));
          await addMedia(await fetchFeed(u));
        } else {
          if (
            /(^|\.)(youtube\.com|youtu\.be|twitch\.tv)$/.test(
              new URL(u).hostname,
            )
          )
            throw Error(
              "This service adapter is not implemented. Use a direct playable media URL.",
            );
          const m = newMedia(
            "direct",
            u,
            String(data.get("title")) ||
              new URL(u).pathname.split("/").pop() ||
              "Stream",
            kind as MediaKind,
          );
          m.url = u;
          await addMedia([m]);
        }
        document.querySelector<HTMLDialogElement>("#dialog")!.close();
      } catch (e) {
        form.querySelector("#form-error")!.textContent = (e as Error).message;
      } finally {
        button.disabled = false;
      }
    });
  };
}
async function addMedia(incoming: Media[], playlistName?: string) {
  if (!incoming.length)
    throw Error(
      t(
        "Поддерживаемые записи не найдены.",
        "No supported playable entries found.",
      ),
    );
  const result = deduplicate(state.media, incoming);
  state.media = result.media;
  if (playlistName)
    state.playlists.push({ id: uid(), name: playlistName, items: result.ids });
  await persist();
  view = "library";
  render();
  notify(
    t(
      `Добавлено / найдено: ${incoming.length}`,
      `Imported / matched ${incoming.length} items`,
    ),
  );
}
async function importFiles(files: File[]) {
  for (const file of files) {
    notify(t(`Импорт: ${file.name}`, `Importing ${file.name}`));
    if (/\.json$/i.test(file.name)) {
      if (file.size > 10_000_000) throw Error("Metadata exceeds 10 MB.");
      const imported = importPortable(await file.text());
      const result = deduplicate(state.media, imported.media);
      const mapping = new Map(
        imported.media.map((m, i) => [m.id, result.ids[i]]),
      );
      state.media = result.media;
      for (const p of imported.playlists) {
        p.items = p.items.map((id) => mapping.get(id)!).filter(Boolean);
        state.playlists.push(p);
      }
      await persist();
      view = "library";
      render();
      notify(
        t(
          `Недоступных локальных файлов и ссылок: ${imported.unavailable}`,
          `Unavailable local files / URLs: ${imported.unavailable}`,
        ),
      );
    } else if (/\.(m3u8?|pls)$/i.test(file.name)) {
      if (file.size > 5_000_000) throw Error("Playlist exceeds 5 MB.");
      await addMedia(parsePlaylist(await file.text()), file.name);
    } else if (/\.(xml|rss|atom)$/i.test(file.name)) {
      if (file.size > 5_000_000) throw Error("Feed exceeds 5 MB.");
      await addMedia(parseFeed(await file.text()));
    } else await addMedia([await storage.import(file)]);
  }
}
function details(id: string) {
  const m = state.media.find((m) => m.id === id);
  if (!m) return;
  selectedId = id;
  modal(
    `<div class="eyebrow">${esc(m.source)} · ${esc(m.kind)}</div><h2>${esc(m.title)}</h2><form id="edit-media">${input("title", t("Название", "Title"), m.title)}${input("artist", t("Исполнитель / автор", "Artist / author"), m.artist)}${input("album", t("Альбом / серия", "Album / series"), m.album)}${input("genre", t("Жанр", "Genre"), m.genre)}${input("tags", t("Теги через запятую", "Comma-separated tags"), m.tags.join(", "))}${input("artwork", t("Обложка: HTTPS URL", "Artwork: HTTPS URL"), m.artwork, "url")}<label>${t("Тип", "Type")}<select name="kind">${(["audio", "video", "podcast", "audiobook", "radio", "live"] as const).map((k) => `<option ${m.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><label>${t("Текст / LRC", "Lyrics / LRC")}<textarea name="lyrics" maxlength="100000">${esc(m.lyrics)}</textarea></label><label>${t("Главы: секунды | название, одна на строку", "Chapters: seconds | title, one per line")}<textarea name="chapters">${esc(m.chapters.map((c) => c.start + " | " + c.title).join("\n"))}</textarea></label><button type="submit" class="primary">${icon("save")} ${t("Сохранить", "Save")}</button><p id="form-error" role="alert"></p></form><hr><h3>${t("Воспроизведение", "Playback")}</h3><button data-action="play" data-id="${m.id}">${icon("play")} ${t("Продолжить", "Resume")}</button><p id="synced-lyrics" class="lyrics">${esc(m.lyrics || t("Нет текста", "No lyrics"))}</p>${m.chapters.map((c) => `<button data-action="chapter" data-id="${m.id}" data-time="${c.start}">${time(c.start)} · ${esc(c.title)}</button>`).join("")}<h3>${t("Закладки", "Bookmarks")}</h3><button data-action="bookmark" data-id="${m.id}">${icon("plus")} ${t("Закладка", "Bookmark")}</button>${m.bookmarks.map((b) => `<button data-action="chapter" data-id="${m.id}" data-time="${b.position}">${time(b.position)} · ${esc(b.note)}</button>`).join("")}<h3>${t("Плейлисты", "Playlists")}</h3>${state.playlists.map((p) => `<button data-action="add-playlist" data-id="${p.id}" data-media="${m.id}">${icon("plus")} ${esc(p.name)}</button>`).join("")}<hr><button data-action="download-local" data-id="${m.id}" ${m.fileId ? "" : "disabled"}>${icon("download")} ${t("Файл", "File")}</button><button data-action="delete" data-id="${m.id}" class="danger">${icon("trash")} ${t("Удалить", "Delete")}</button>`,
  );
  document.querySelector<HTMLFormElement>("#edit-media")!.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const data = new FormData(e.target as HTMLFormElement);
      try {
        const changes: Partial<Media> = {};
        for (const key of [
          "title",
          "artist",
          "album",
          "genre",
          "lyrics",
        ] as const)
          changes[key] = String(data.get(key) || "").trim();
        if (!changes.title) throw Error("Title is required.");
        const art = String(data.get("artwork") || "");
        changes.artwork = art ? directUrl(art) : undefined;
        changes.tags = String(data.get("tags"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 100);
        changes.kind = String(data.get("kind")) as MediaKind;
        changes.chapters = String(data.get("chapters"))
          .split("\n")
          .filter((s) => s.trim())
          .map((line) => {
            const [start, ...title] = line.split("|");
            if (
              !Number.isFinite(Number(start)) ||
              Number(start) < 0 ||
              !title.join("|").trim()
            )
              throw Error("Invalid chapter; use seconds | title.");
            return { start: Number(start), title: title.join("|").trim() };
          })
          .sort((a, b) => a.start - b.start);
        Object.assign(m, changes);
        await persist();
        document.querySelector<HTMLDialogElement>("#dialog")!.close();
        render();
      } catch (e) {
        document.querySelector("#form-error")!.textContent = (
          e as Error
        ).message;
      }
    });
  };
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const actionHandlers: Record<
  string,
  (el: HTMLElement) => Promise<unknown> | unknown
> = {
  theme: () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("delta-media.theme", theme);
    const button = document.querySelector("[data-action=theme]")!;
    button.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  },
  view: (el) => {
    view = el.dataset.view!;
    query = "";
    document.querySelector<HTMLInputElement>("#search")!.value = "";
    render();
  },
  import: importDialog,
  close: () => document.querySelector<HTMLDialogElement>("#dialog")!.close(),
  "choose-files": () => {
    document.querySelector<HTMLDialogElement>("#dialog")!.close();
    document.querySelector<HTMLInputElement>("#files")!.click();
  },
  source: (el) => {
    const id = el.dataset.id!;
    selectedSources.has(id)
      ? selectedSources.delete(id)
      : selectedSources.add(id);
    render();
  },
  play: async (el) => {
    const id = el.dataset.id!;
    let i = state.queue.indexOf(id);
    if (i < 0) {
      state.queue.push(id);
      i = state.queue.length - 1;
    }
    await player.load(i);
    render();
  },
  "play-all": async () => {
    state.queue = filtered().map((m) => m.id);
    if (state.queue.length) await player.load(0);
    render();
  },
  toggle: async () => {
    if (!player.current) {
      if (state.queue.length) await player.load(state.queueIndex);
      else
        throw Error(
          t("Сначала добавьте медиа.", "Add media to start listening."),
        );
    } else await player.toggle();
  },
  next: () => player.next(),
  previous: () => player.previous(),
  shuffle: async () => {
    state.shuffle = !state.shuffle;
    await persist();
    updatePlayer();
  },
  repeat: async () => {
    state.repeat =
      state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    await persist();
    updatePlayer();
  },
  favorite: async (el) => {
    const m = state.media.find((m) => m.id === el.dataset.id)!;
    m.favorite = !m.favorite;
    await persist();
    render();
  },
  enqueue: async (el) => {
    state.queue.push(el.dataset.id!);
    await persist();
    notify(t("Добавлено в очередь", "Added to queue"));
  },
  queue: () => {
    view = "queue";
    render();
  },
  "queue-up": async (el) => {
    const i = Number(el.dataset.index);
    if (i > 0) {
      [state.queue[i - 1], state.queue[i]] = [
        state.queue[i],
        state.queue[i - 1],
      ];
      if (state.queueIndex === i) state.queueIndex--;
      else if (state.queueIndex === i - 1) state.queueIndex++;
      await persist();
      render();
    }
  },
  "queue-remove": async (el) => {
    const i = Number(el.dataset.index);
    if (i === state.queueIndex && player.current)
      throw Error("Stop or change the active item before removing it.");
    state.queue.splice(i, 1);
    if (i < state.queueIndex) state.queueIndex--;
    await persist();
    render();
  },
  details: (el) => details(el.dataset.id!),
  "new-playlist": () => {
    modal(
      `<h2>${t("Плейлист", "Playlist")}</h2><form id="playlist-form">${input("name", t("Название", "Name"))}<button type="submit" class="primary">${icon("plus")} ${t("Создать", "Create")}</button></form>`,
    );
    document.querySelector<HTMLFormElement>("#playlist-form")!.onsubmit = (
      e,
    ) => {
      e.preventDefault();
      run(async () => {
        const name = String(
          new FormData(e.target as HTMLFormElement).get("name"),
        ).trim();
        if (!name) throw Error("Name required.");
        playlistId = uid();
        state.playlists.push({ id: playlistId, name, items: [] });
        await persist();
        document.querySelector<HTMLDialogElement>("#dialog")!.close();
        render();
      });
    };
  },
  playlist: (el) => {
    playlistId = el.dataset.id!;
    render();
  },
  "add-playlist": async (el) => {
    state.playlists
      .find((p) => p.id === el.dataset.id)!
      .items.push(el.dataset.media!);
    await persist();
    notify(t("Добавлено в плейлист", "Added to playlist"));
  },
  "export-playlist": (el) => {
    const p = state.playlists.find((p) => p.id === playlistId);
    if (!p) return;
    const rows = p.items
      .map((id) => state.media.find((m) => m.id === id))
      .filter((m): m is Media => !!m);
    const format = el.dataset.format === "pls" ? "pls" : "m3u";
    const out = exportPlaylist(rows, format);
    download(
      new Blob([out.text], {
        type: format === "pls" ? "audio/x-scpls" : "audio/x-mpegurl",
      }),
      p.name + (format === "pls" ? ".pls" : ".m3u8"),
    );
    notify(
      t(
        `Локальных файлов без переносимой ссылки пропущено: ${out.omitted}`,
        `Local files without portable URLs omitted: ${out.omitted}`,
      ),
    );
  },
  "export-library": () =>
    download(
      new Blob([JSON.stringify(portableState(state), null, 2)], {
        type: "application/json",
      }),
      "delta-media-library.json",
    ),
  persist: async () => {
    const ok = await navigator.storage?.persist?.();
    const estimate = await navigator.storage?.estimate?.();
    notify(
      `${ok ? t("Постоянное хранилище разрешено", "Persistent storage granted") : t("Система не гарантирует постоянное хранение. Сделайте резервную копию.", "Storage persistence is not guaranteed. Keep backups.")} · ${Math.round((estimate?.usage || 0) / 1048576)} MB`,
    );
  },
  chapter: async (el) => {
    if (player.current?.id !== el.dataset.id) {
      const id = el.dataset.id!;
      let index = state.queue.indexOf(id);
      if (index < 0) {
        state.queue.push(id);
        index = state.queue.length - 1;
      }
      await player.load(index, false);
      await new Promise<void>((resolve) => {
        if (player.element.readyState >= 1) resolve();
        else
          player.element.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
      });
    }
    player.seek(Number(el.dataset.time));
    await player.play();
  },
  bookmark: async (el) => {
    const m = state.media.find((m) => m.id === el.dataset.id)!;
    m.bookmarks.push({
      id: uid(),
      position: m.position,
      note: t("Закладка", "Bookmark"),
    });
    await persist();
    details(m.id);
  },
  "download-local": async (el) => {
    const m = state.media.find((m) => m.id === el.dataset.id)!;
    if (m.fileId)
      download(
        await storage.file(m.fileId),
        m.title + "." + (m.mime?.split("/")[1] || "media"),
      );
  },
  delete: (el) => {
    const id = el.dataset.id!;
    modal(
      `<h2>${t("Удалить запись и локальную копию?", "Delete item and its local copy?")}</h2><p>${t("Это действие нельзя отменить.", "This cannot be undone.")}</p><button data-action="confirm-delete" data-id="${id}" class="danger">${icon("trash")} ${t("Удалить", "Delete")}</button>`,
    );
  },
  "confirm-delete": async (el) => {
    const id = el.dataset.id!,
      m = state.media.find((m) => m.id === id)!;
    if (player.current?.id === id) {
      player.element.pause();
      player.current = undefined;
      player.element.removeAttribute("src");
      player.element.load();
    }
    state.media = state.media.filter((m) => m.id !== id);
    const removedBefore = state.queue
      .slice(0, state.queueIndex)
      .filter((x) => x === id).length;
    state.queue = state.queue.filter((x) => x !== id);
    state.queueIndex = Math.max(
      0,
      Math.min(state.queueIndex - removedBefore, state.queue.length - 1),
    );
    for (const p of state.playlists) p.items = p.items.filter((x) => x !== id);
    await persist();
    if (m.fileId) await storage.removeFile(m.fileId);
    document.querySelector<HTMLDialogElement>("#dialog")!.close();
    render();
    updatePlayer();
  },
};
app.addEventListener("click", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-action]");
  if (el) {
    e.preventDefault();
    run(() => actionHandlers[el.dataset.action!]?.(el));
  }
});
async function boot() {
  storage = await new Storage().open();
  state = await storage.load();
  shell();
  player = new Player(
    document.querySelector<HTMLVideoElement>("#media")!,
    state,
    storage,
    persist,
  );
  player.addEventListener("change", updatePlayer);
  player.addEventListener("failure", (e) =>
    notify((e as CustomEvent).detail, true),
  );
  render();
  updatePlayer();
  if (state.queue.length) {
    try {
      await player.load(
        Math.min(state.queueIndex, state.queue.length - 1),
        false,
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  window.addEventListener("offline", () =>
    notify(
      t(
        "Нет сети. Локальные файлы доступны.",
        "Offline. Imported local files remain available.",
      ),
    ),
  );
  window.addEventListener("online", () =>
    notify(t("Сеть восстановлена.", "Online.")),
  );
}
boot().catch((e) => {
  app.innerHTML = `<main class="fatal"><h1>Delta Media</h1><p>${esc(e.message)}</p><p>${t("Хранилище недоступно. Данные не перезаписаны. Разрешите хранилище или выйдите из приватного режима.", "Storage unavailable. Existing data was not overwritten. Allow storage or leave private browsing.")}</p></main>`;
});
