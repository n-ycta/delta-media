import {OfflineCache} from "./offline";
import {analysePlayback} from "./visualizer";
import { sharedPlayback } from "./shared";
import { styledControls } from "./controls";
import { RadioView } from "./radio-view";
import {
  mediaSurfaces,
  validSurface,
  hiddenSurfaces,
  watchPresentation,
} from "./surfaces";
import { connectPlugin, applyThemeTokens, type AppContext } from "@delta/ui/sdk/client";
import { intentItems } from "./host";
import "./fonts";
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
  removeQueued,
  collections,
  playlistMedia,
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
const launch = new URL(location.href).searchParams;
let hostContext: AppContext | undefined;
let host: Awaited<ReturnType<typeof connectPlugin>> | undefined;
let sdkError = "";
if (parent !== window && launch.get("embedded") === "1") {
  try {
    const parentOrigin = launch.get("parentOrigin");
    if (!parentOrigin) throw Error("missing_parent_origin");
    const connection = await connectPlugin(parentOrigin);
    hostContext = connection.context;
    host = connection;
    applyThemeTokens(hostContext.tokens);
    connection.onPresentation((c) => {
      applyThemeTokens(c.tokens);
      if (c.tokens) document.documentElement.dataset.theme = theme = c.tokens.scheme;
    });
    window.addEventListener("pagehide", () => connection.close(), {
      once: true,
    });
  } catch (e) {
    sdkError = "Delta SDK: " + (e as Error).message;
  }
}
const shared = await sharedPlayback();
let remoteItems: Record<string, any>[] = [], providerRows: Record<string, any>[] = [], searchBusy = false;
let videoMode = localStorage.getItem('delta-media.video-mode') || 'normal';
let videoHeight = Math.max(160,Math.min(640,Number(localStorage.getItem('delta-media.video-height'))||320));
function videoPresentation() {
  const stage=document.querySelector<HTMLElement>('#stage');if(!stage)return;
  stage.dataset.mode=videoMode;stage.style.setProperty('--video-height',videoHeight+'px');
  const show=stage.querySelector<HTMLButtonElement>('[data-action="video-restore"]');if(show)show.hidden=videoMode!=='hidden';
  stage.querySelectorAll<HTMLElement>('[data-video-controls]').forEach(el=>el.hidden=videoMode==='hidden');
  localStorage.setItem('delta-media.video-mode',videoMode);localStorage.setItem('delta-media.video-height',String(videoHeight));
}
let searchInFlight = false, searchMessage = "";
let searchTimer: ReturnType<typeof setTimeout>;
let libraryDirty = true, syncBusy = false;
let offline: OfflineCache | undefined;
const deviceId = localStorage.getItem('delta-media.device') || crypto.randomUUID();
localStorage.setItem('delta-media.device', deviceId);
let acknowledgements: string[] = [];
const prefDefaults = { resume:true, autoplayNext:true, seekStep:15, playbackRate:1, defaultVolume:1, compact:false, showArtwork:true, showSource:true, showLyrics:true, searchProviders:['youtube','soundcloud','spotify'],offlineFormat:'auto' };
let preferences = { ...prefDefaults, ...JSON.parse(localStorage.getItem('delta-media.preferences') || '{}') };
function applyPreferences() {
  document.documentElement.classList.toggle('media-compact', preferences.compact);
  document.documentElement.classList.toggle('media-no-artwork', !preferences.showArtwork);
  document.documentElement.classList.toggle('media-no-source', !preferences.showSource);
  document.documentElement.classList.toggle('media-no-lyrics', !preferences.showLyrics);
  if (player) { player.element.playbackRate = preferences.playbackRate; player.resume = preferences.resume; player.autoplayNext = preferences.autoplayNext; }
}
async function savePreferences() {
  localStorage.setItem('delta-media.preferences',JSON.stringify(preferences)); applyPreferences();
  if(host) try { await host.call('media.settings',{values:preferences}); } catch {}
}
async function renderProviders() {
  const el=document.querySelector('#provider-connections'); if(!el)return;
  if(!host){el.textContent=t('Подключите Delta, чтобы выбрать плагины-источники.','Connect Delta to choose provider plugins.');return;}
  try { providerRows=await host.call('media.providers') as Record<string,any>[];
    el.innerHTML=providerRows.length?`<div class="source-grid">${providerRows.map(p=>`<article class="source-card"><h2>${esc(p.name)}</h2><label><input type="checkbox" data-provider="${esc(p.id)}" ${preferences.searchProviders.includes(p.id)?'checked':''}>${t('Искать в этом источнике','Include in search')}</label><p class="hint">${p.connected ? (p.search ? t('Подключён','Connected') : t('Для поиска требуется авторизация в настройках плагина','Sign in through plugin settings to search')) : t('Недоступен','Unavailable')}</p></article>`).join('')}</div>`:t('Подключите YouTube, SoundCloud или Spotify в списке плагинов.','Connect YouTube, SoundCloud or Spotify in Plugins.');
    el.querySelectorAll<HTMLInputElement>('[data-provider]').forEach(input=>input.onchange=()=>{preferences.searchProviders=input.checked?[...new Set([...preferences.searchProviders,input.dataset.provider!])]:preferences.searchProviders.filter((id:string)=>id!==input.dataset.provider);void savePreferences();});
  }catch{el.textContent=t('Подключите плагин Media на узле Delta.','Connect the Media plugin on your Delta node.');}
}
async function searchProviders(value: string) {
  if(!host || value.trim().length<2 || searchInFlight)return;
  searchInFlight=true;searchBusy=true;searchMessage='';render();
  try {
    const result=await host.call('media.search',{query:value,providers:preferences.searchProviders}) as {items:Record<string,any>[];providers?:{provider:string;error?:string}[]};
    if(query!==value)return;
    remoteItems=result.items||[];
    if(result.providers?.some(p=>p.error))searchMessage=t('Часть источников не ответила. Можно повторить поиск.','Some sources did not respond. You can retry the search.');
    else if(!remoteItems.length)searchMessage=t('В источниках ничего не найдено.','No results from connected sources.');
  } catch {
    if(query===value){remoteItems=[];searchMessage=t('Поиск временно недоступен. Повторите попытку.','Search is temporarily unavailable. Try again.');}
  } finally {
    searchInFlight=false;searchBusy=false;
    if(query===value)render();else if(query.trim().length>=2)void searchProviders(query);else render();
  }
}
async function synchronize() {
  if(!host||syncBusy||!shared.primary)return;syncBusy=true;
  try {
    if (state.pendingRemovals?.length) {
      for (const id of [...state.pendingRemovals]) {
        await host.call('media.library', {remove:id});
        state.pendingRemovals = state.pendingRemovals.filter(v => v !== id);
      }
      await persist();
    }
    const snapshot=libraryDirty;libraryDirty=false;
    let batches:typeof state.media[]=[];
    if(snapshot){let batch:typeof state.media=[];let bytes=0;for(const item of state.media){const size=JSON.stringify(item).length;if(bytes+size>40000&&batch.length){batches.push(batch);batch=[];bytes=0;}batch.push(item);bytes+=size;}if(batch.length)batches.push(batch);}
    for(const batch of batches.slice(0,-1))await host.call('media.sync',{deviceId,library:batch});
    const result=await host.call('media.sync',{deviceId,name:navigator.userAgent.includes('Android')?'Android':'Media',ack:acknowledgements,report:{playing:player.playing,title:player.current?.title,position:player.position},...(snapshot?{library:batches.at(-1)||[],playlists:state.playlists,queue:state.queue}:{})}) as {commands:{id:string;command:string;args:Record<string,any>}[];settings:typeof preferences;library:typeof state.media;playlists:typeof state.playlists;queue:string[]};
    if(!libraryDirty){state.media=result.library;state.playlists=result.playlists;state.queue=result.queue;preferences={...preferences,...result.settings};applyPreferences();shared.saved(state);}
    acknowledgements=[];
    for(const c of result.commands){try{if(c.command==='play'){if(c.args.item)await receiveMedia(true,c.args.item);else if(c.args.id){const index=state.queue.indexOf(c.args.id);if(index>=0)await player.load(index);}else await player.play();}else if(c.command==='pause')player.pause();else if(c.command==='next')await player.next();else if(c.command==='previous')await player.previous();else if(c.command==='seek')player.seek(c.args.position);else if(c.command==='queue'){state.queue=c.args.items;await persist();}acknowledgements.push(c.id);}catch(e){acknowledgements.push(c.id);notify(t('Не удалось выполнить команду воспроизведения.','Playback command failed.'),true);}}
  }catch{libraryDirty=true;}finally{syncBusy=false;}
}
let language =
  localStorage.getItem("delta-media.language") || hostContext?.language || "en";
const t = (ru: string, en: string) => (language === "ru" ? ru : en);
/** Inside Delta the one global theme wins; the app's own toggle is for standalone use. */
const hostThemed = !!hostContext?.tokens;
if (hostThemed) document.documentElement.classList.add("host-themed");
const preference = hostThemed
  ? hostContext!.tokens!.scheme
  : localStorage.getItem("delta-media.theme") || hostContext?.theme;
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
    "artists",
    "albums",
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
  view: string = validSurface(launch.get("surface"))
    ? launch.get("surface")!
    : "home",
  query = "",
  selectedSources = new Set<string>(),
  sort = "added",
  playlistId = "",
  collectionId = "",
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
  libraryDirty = true;
  const snapshot = structuredClone(state);
  saving = saving.catch(() => {}).then(() => storage.save(snapshot));
  try {
    await saving;
    shared.saved(state);
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
    player: t("Плеер", "Player"),
    visualizer: t("Визуализатор", "Visualizer"),
    library: t("Медиатека", "Library"),
    audio: t("Музыка", "Music"),
    artists: t("Исполнители", "Artists"),
    albums: t("Альбомы", "Albums"),
    video: t("Видео", "Video"),
    podcast: t("Подкасты", "Podcasts"),
    audiobook: t("Аудиокниги", "Audiobooks"),
    radio: t("Радио", "Radio"),
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
  app.innerHTML = `<aside><a class="brand" href="#home"><img src="./delta-logo.svg" alt="Delta"><span class="brand-text"><strong>Delta</strong><small>Media</small></span></a><nav id="nav"></nav></aside><section class="workspace"><header><div class="breadcrumbs">delta / <span id="breadcrumb">media</span></div><label class="search"><span>${icon("search")}</span><input id="search" type="search" placeholder="${t("Поиск в выбранных источниках", "Search selected sources")}" aria-label="${t("Поиск", "Search")}"></label><button data-action="theme" title="${t("Тема", "Theme")}" aria-label="Theme">${icon(theme === "dark" ? "sun" : "moon")}</button><button data-action="import" class="primary" title="${t("Импорт", "Import")}" aria-label="${t("Импорт", "Import")}">${icon("upload")}</button></header><div id="notice" class="notice" hidden role="status"></div><div id="stage"><div class="video-tools"><button data-action="video-restore" aria-label="${t('Показать видео','Show video')}" title="${t('Показать видео','Show video')}" hidden>${icon('video')}</button><span data-video-controls><button data-action="video-compact" aria-label="${t('Уменьшить видео','Compact video')}" title="${t('Уменьшить видео','Compact video')}">${icon('minus')}</button><button data-action="video-normal" aria-label="${t('Развернуть видео','Expand video')}" title="${t('Развернуть видео','Expand video')}">${icon('expand')}</button><button data-action="video-hide" aria-label="${t('Скрыть видео','Hide video')}" title="${t('Скрыть видео','Hide video')}">${icon('close')}</button></span></div><video id="media" playsinline preload="metadata" referrerpolicy="no-referrer" hidden></video><iframe id="embed" title="Player" hidden allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="video-resize" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="${t('Высота видео','Video height')}"></div></div><main id="view"></main></section><footer><div class="now"><div class="mini-art">${icon("audio")}</div><div><strong id="now-title">${t("Пауза", "Paused")}</strong><small id="now-artist">Delta Media</small></div></div><div class="transport"><div class="transport-buttons"><button data-action="shuffle" id="shuffle" aria-label="${t("Перемешивание", "Shuffle")}">${icon("shuffle")}</button><button data-action="previous" aria-label="${t("Назад", "Previous")}">${icon("previous")}</button><button data-action="toggle" id="toggle" class="play" aria-label="${t("Воспроизведение / пауза", "Play / pause")}">${icon("play")}</button><button data-action="next" aria-label="${t("Далее", "Next")}">${icon("next")}</button><button data-action="repeat" id="repeat" aria-label="${t("Повтор", "Repeat")}">${icon("repeat")}</button></div><div class="timeline"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${t("Позиция", "Position")}"><span id="duration">0:00</span></div></div><div class="volume"><span aria-hidden="true">${icon("volume")}</span><input id="volume" type="range" min="0" max="1" step="0.01" value="${state.volume}" aria-label="${t("Громкость", "Volume")}"><button data-action="queue" aria-label="${t("Очередь", "Queue")}">${icon("queue")}</button></div></footer><dialog id="dialog"></dialog><input id="files" type="file" multiple accept="audio/*,video/*,.json,.m3u,.m3u8,.pls,.xml,.rss,.atom" hidden>`;
  videoPresentation();
  const videoResize=document.querySelector<HTMLElement>('.video-resize')!;
  videoResize.addEventListener('pointerdown',e=>{const start=e.clientY,height=videoHeight;videoMode='normal';videoResize.setPointerCapture(e.pointerId);const move=(event:PointerEvent)=>{videoHeight=Math.max(160,Math.min(640,height+event.clientY-start));videoPresentation();};const stop=()=>{videoResize.removeEventListener('pointermove',move);videoResize.removeEventListener('pointerup',stop);videoResize.removeEventListener('pointercancel',stop);};videoResize.addEventListener('pointermove',move);videoResize.addEventListener('pointerup',stop);videoResize.addEventListener('pointercancel',stop);});
  videoResize.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();videoMode='normal';videoHeight=Math.max(160,Math.min(640,videoHeight+(e.key==='ArrowUp'?-20:20)));videoPresentation();});
  document
    .querySelector<HTMLInputElement>("#search")!
    .addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value;
      view = query.trim() ? 'search' : 'home'; remoteItems = []; searchMessage=''; clearTimeout(searchTimer);
      render(); searchTimer = setTimeout(() => void searchProviders(query), 450);
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
      player.volume(state.volume);
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
  if (["artists", "albums"].includes(view) && collectionId) {
    const group = collections(
      state.media,
      view === "artists" ? "artist" : "album",
    ).find((g) => g.key === collectionId);
    rows = rows.filter((m) => group?.items.some((item) => item.id === m.id));
  }
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
    rows = (p ? playlistMedia(p, state.media).map((m) => m.id) : [])
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
// Search results use provider identity, never their transient result index, for state.
function savedResult(raw: Record<string, any>): Media | undefined {
  const item = intentItems(raw)[0];
  return item && state.media.find(m => m.source === item.source && m.sourceKey === item.sourceKey);
}
function importResult(raw: Record<string, any>): Media {
  const items = intentItems(raw);
  if (!items.length) throw Error(t('Ссылка не поддерживается.', 'Unsupported link.'));
  const result = deduplicate(state.media, items);
  state.media = result.media;
  return state.media.find(m => m.id === result.ids[0])!;
}
const actionFeedback = new Map<string, number>();
function trackActions(m: Media | undefined, attrs: string, prefix = '') {
  const favorite = !!m?.favorite, queued = !!m && state.queue.includes(m.id);
  const likeLabel = favorite ? t('Убрать из избранного', 'Remove from favorites') : t('В избранное', 'Add to favorites');
  const queueLabel = queued ? t('Убрать из очереди', 'Remove from queue') : t('Добавить в очередь', 'Add to queue');
  const fresh = (kind: string) => m && Date.now() - (actionFeedback.get(m.id + kind) || 0) < 600 ? ' action-feedback' : '';
  return `<button class="track-action favorite-action${fresh('favorite')}" data-action="${prefix}favorite" ${attrs} aria-pressed="${favorite}" aria-label="${likeLabel}" title="${likeLabel}">${icon(favorite ? 'heart-filled' : 'favorites')}</button><button class="track-action queue-action${fresh('queue')}" data-action="${prefix}enqueue" ${attrs} aria-pressed="${queued}" aria-label="${queueLabel}" title="${queueLabel}"><span class="queue-state">${icon(queued ? 'check' : 'plus')}</span>${queued ? `<span class="queue-remove-icon" aria-hidden="true">${icon('close')}</span>` : ''}</button>`;
}
async function toggleFavorite(m: Media) {
  m.favorite = !m.favorite;
  actionFeedback.set(m.id + 'favorite', Date.now());
  await persist(); render();
  notify(m.favorite ? t('Добавлено в избранное', 'Added to favorites') : t('Убрано из избранного', 'Removed from favorites'));
}
async function toggleQueue(m: Media) {
  const queued = state.queue.includes(m.id);
  if (queued) removeQueued(state, m.id);
  else state.queue.push(m.id);
  actionFeedback.set(m.id + 'queue', Date.now());
  await persist(); render(); updatePlayer();
  notify(queued ? t('Убрано из очереди', 'Removed from queue') : t('Добавлено в очередь', 'Added to queue'));
}
function row(m: Media, index: number) {
  return `<article class="media-row" data-id="${m.id}"><button class="art ${m.kind}" data-action="play" data-id="${m.id}" aria-label="${t("Воспроизвести", "Play")} ${esc(m.title)}">${m.artwork ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(m.artwork)}">` : icons[m.kind as keyof typeof icons] || "▷"}</button><button class="media-title" data-action="details" data-id="${m.id}"><strong>${esc(m.title)}</strong><span>${esc(m.artist || m.album || "—")}</span>${m.position > 0 ? `<small>${t("Продолжить с", "Resume at")} ${time(m.position)}</small>` : ""}</button><span class="source-tag">${esc(m.source)}</span><span class="row-time">${m.kind === "radio" || m.kind === "live" ? "LIVE" : time(m.duration)}</span>${m.source==='youtube'?`<button class="track-action offline-action" data-action="offline" data-id="${m.id}" title="${offline?.available(m)?t('Доступно офлайн','Available offline'):offline?.progress.has(m.id)?t('Отменить офлайн-загрузку','Cancel offline caching'):t('Сделать доступным офлайн','Make available offline')}" aria-label="${offline?.available(m)?t('Доступно офлайн','Available offline'):offline?.progress.has(m.id)?t('Отменить офлайн-загрузку','Cancel offline caching'):t('Сделать доступным офлайн','Make available offline')}" aria-pressed="${!!offline?.available(m)}" ${offline?.available(m)?'disabled':''}>${icon(offline?.available(m)?'offline-ready':offline?.progress.has(m.id)?'close':'offline')}${offline?.progress.has(m.id)?`<small>${offline.progress.get(m.id)}%</small>`:''}</button>`:''}${trackActions(m, `data-id="${m.id}"`)}<button class="track-action" data-action="choose-playlists" data-id="${m.id}" title="${t("В плейлист", "Add to playlist")}" aria-label="${t("В плейлист", "Add to playlist")}">${icon("playlists")}</button>${view === "playlists" && playlistId && !state.playlists.find(p=>p.id===playlistId)?.rule ? `<button class="track-action" data-action="playlist-remove-item" data-id="${m.id}" title="${t("Убрать из плейлиста", "Remove from playlist")}" aria-label="${t("Убрать из плейлиста", "Remove from playlist")}">${icon("close")}</button>` : ""}<button class="track-action delete-action" data-action="delete" data-id="${m.id}" title="${t("Удалить из медиатеки", "Delete from library")}" aria-label="${t("Удалить из медиатеки", "Delete from library")}">${icon("trash")}</button>${view === "queue" ? `<button data-action="queue-up" data-index="${index}" aria-label="Move up">${icon("arrow-up")}</button><button data-action="queue-remove" data-index="${index}" aria-label="Remove from queue">${icon("close")}</button>` : ""}</article>`;
}
function choosePlaylists(id: string) {
  const m = state.media.find(m => m.id === id); if (!m) return;
  const lists = state.playlists.filter(p => !p.rule);
  modal(`<h2>${t('В плейлист','Add to playlist')}</h2><p>${esc(m.title)}</p><form id="choose-playlists"><div class="picker-list">${lists.map(p=>`<label class="picker-row"><input type="checkbox" name="playlist" value="${p.id}" ${p.items.includes(id)?'checked':''}><span>${esc(p.name)}</span></label>`).join('')}</div><label>${t('Новый плейлист','New playlist')}<input name="new-name" maxlength="120" placeholder="${t('Название (необязательно)','Name (optional)')}"></label><button class="primary" type="submit">${icon('check')} ${t('Сохранить','Save')}</button></form>`);
  document.querySelector<HTMLFormElement>('#choose-playlists')!.onsubmit=e=>{e.preventDefault();run(async()=>{
    const data=new FormData(e.target as HTMLFormElement),chosen=new Set(data.getAll('playlist').map(String));
    for(const p of lists){if(chosen.has(p.id)){if(!p.items.includes(id))p.items.push(id);}else p.items=p.items.filter(v=>v!==id);}
    const name=String(data.get('new-name')||'').trim();if(name)state.playlists.push({id:uid(),name,items:[id]});
    await persist();document.querySelector<HTMLDialogElement>('#dialog')!.close();render();notify(t('Плейлисты обновлены','Playlists updated'));
  });};
}
function chooseLibrary() {
  const p=state.playlists.find(p=>p.id===playlistId);if(!p||p.rule)return;
  const items=state.media.filter(m=>!p.items.includes(m.id));
  modal(`<h2>${t('Добавить из медиатеки','Add from library')}</h2><p>${esc(p.name)}</p><form id="choose-library"><label>${t('Поиск','Search')}<input id="library-picker-search" type="search" placeholder="${t('Название или исполнитель','Title or artist')}"></label><div class="picker-list">${items.map(m=>`<label class="picker-row" data-search="${esc((m.title+' '+(m.artist||'')).toLocaleLowerCase())}"><input type="checkbox" name="media" value="${m.id}"><span><strong>${esc(m.title)}</strong><small>${esc(m.artist||m.source)}</small></span></label>`).join('')}</div><p id="picker-empty" ${items.length?'hidden':''}>${t('Все записи уже добавлены или медиатека пуста.','All tracks have been added, or your library is empty.')}</p><button class="primary" type="submit" disabled>${icon('plus')} <span id="picker-submit-label">${t('Добавить выбранное','Add selected')}</span></button></form>`);
  const form=document.querySelector<HTMLFormElement>('#choose-library')!;
  form.querySelector<HTMLInputElement>('#library-picker-search')!.oninput=e=>{const q=(e.target as HTMLInputElement).value.trim().toLocaleLowerCase();let shown=0;form.querySelectorAll<HTMLElement>('.picker-row').forEach(row=>{row.hidden=!row.dataset.search!.includes(q);if(!row.hidden)shown++;});form.querySelector<HTMLElement>('#picker-empty')!.hidden=shown>0;};
  form.onchange=()=>{const n=form.querySelectorAll('input[name="media"]:checked').length;form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled=!n;form.querySelector('#picker-submit-label')!.textContent=t(`Добавить выбранное (${n})`,`Add selected (${n})`);};
  form.onsubmit=e=>{e.preventDefault();run(async()=>{const ids=new FormData(form).getAll('media').map(String);p.items=[...new Set([...p.items,...ids])];await persist();document.querySelector<HTMLDialogElement>('#dialog')!.close();render();notify(t(`Добавлено в плейлист: ${ids.length}`,`Added to playlist: ${ids.length}`));});};
}
const hiddenViews = hiddenSurfaces();
const radio = new RadioView(
  t,
  () => render(),
  async (m) => {
    const existing = state.media.find(
      (v) => v.source === m.source && v.sourceKey === m.sourceKey,
    );
    if (!existing) state.media.push(m);
    const id = existing?.id || m.id;
    let i = state.queue.indexOf(id);
    if (i < 0) {
      state.queue.push(id);
      i = state.queue.length - 1;
    }
    await persist();
    await player.load(i);
    render();
  },
);
watchPresentation((surface, nextTheme, compact) => {
  if (nextTheme) {
    theme = nextTheme;
    document.documentElement.dataset.theme = theme;
  }
  if (surface) {
    view = surface;
    query = "";
    collectionId = "";
  }
  document.documentElement.classList.toggle("media-fragment", compact);
  if (state) render();
});
document.documentElement.classList.toggle(
  "media-fragment",
  launch.get("chrome") === "0" && validSurface(launch.get("surface")),
);
function render() {
  document.documentElement.dataset.mediaSurface=view;
  const label = labels();
  const crumb = document.querySelector("#breadcrumb");
  if (crumb) crumb.textContent = label[view] || "media";
  document.querySelector("#nav")!.innerHTML = Object.entries(label)
    .filter(([id]) => !["queue","player","visualizer"].includes(id) && !hiddenViews.has(id))
    .map(
      ([id, name]) =>
        `<button class="${view === id ? "active" : ""}" data-action="view" data-view="${id}"><span>${icons[id as keyof typeof icons]}</span>${name}${id === "library" ? `<small>${state.media.length}</small>` : ""}</button>`,
    )
    .join("");
  const target = document.querySelector("#view")!;
  if (["artists", "albums"].includes(view) && !collectionId) {
    const groups = collections(
      searchMedia(state.media, query, selectedSources),
      view === "artists" ? "artist" : "album",
    );
    target.innerHTML = `<div class="heading"><h1>${label[view]}</h1></div><div class="collection-grid">${groups.map((g) => `<button class="collection-card" data-action="collection" data-id="${esc(encodeURIComponent(g.key))}"><span class="collection-art">${g.artwork ? `<img src="${esc(g.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon(view)}</span><strong>${esc(g.name)}</strong><small>${esc(g.artist || "")}${g.artist ? " · " : ""}${g.items.length}</small></button>`).join("")}</div>${groups.length ? "" : `<div class="empty"><span>${icon(view)}</span><h2>${t("Пусто", "Empty")}</h2></div>`}`;
    return;
  }
  if (view === "radio") {
    target.innerHTML = radio.render(query, row, filtered());
    return;
  }
  if(view==='visualizer'){
    target.innerHTML=`<div class="visualizer"><canvas aria-label="${t('Спектр аудио','Audio spectrum')}"></canvas><p>${t('Спектр доступен для воспроизводимого аудио. Защищённые внешние плееры не передают звук.','Audio spectrum is available for decoded audio. Protected external players do not share their audio.')}</p></div>`;
    return;
  }
  if (view === 'player') {
    const m=player.current;
    target.innerHTML=`<div class="player-surface"><div class="player-surface-art">${m?.artwork?`<img src="${esc(m.artwork)}" alt="">`:icon('audio')}</div><h1>${esc(m?.title||t('Выберите трек','Choose a track'))}</h1><p>${esc(m?.artist||'')}</p></div>`;
    return;
  }
  if (view === 'search') {
    target.innerHTML = `<div class="heading"><h1>${t('Поиск','Search')}</h1></div>${searchBusy?`<p role="status">${t('Ищем…','Searching…')}</p>`:''}${searchMessage?`<div class="search-status" role="status"><p>${esc(searchMessage)}</p><button data-action="retry-search" aria-label="${t('Повторить поиск','Retry search')}" title="${t('Повторить поиск','Retry search')}">${icon('refresh')}</button></div>`:''}${remoteItems.length?`<div class="media-list">${remoteItems.map((m,i)=>`<article class="media-row remote-result"><button class="art" data-action="provider-play" data-index="${i}" aria-label="${t('Воспроизвести','Play')}">${m.artwork?`<img src="${esc(m.artwork)}" alt="" loading="lazy">`:icon('play')}</button><div class="media-title"><strong>${esc(m.title)}</strong><span>${esc(m.artist||m.provider)}</span></div>${trackActions(savedResult(m), `data-index="${i}"`, "provider-")}</article>`).join('')}</div>`:''}<h2>${t('В медиатеке','In your library')}</h2><div class="media-list">${filtered().map(row).join('')}</div>`;
    return;
  }
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
    if(hostThemed){target.querySelector('label[for="theme-select"]')?.remove();target.querySelector("#theme-select")?.remove();}
    else target.querySelector<HTMLSelectElement>("#theme-select")!.onchange = (
      e,
    ) => {
      theme = (e.target as HTMLSelectElement).value;
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("delta-media.theme", theme);
      document.querySelector("[data-action=theme]")!.innerHTML = icon(
        theme === "dark" ? "sun" : "moon",
      );
    };
    const panel = document.createElement("section");
    panel.className = "surface-settings";
    panel.innerHTML = `<h2>${t("Вкладки", "Tabs")}</h2><div>${mediaSurfaces
      .filter((id) => !["settings", "queue", "player", "visualizer"].includes(id))
      .map(
        (id) =>
          `<label><input type="checkbox" data-surface="${id}" ${hiddenViews.has(id) ? "" : "checked"}><span>${label[id] || id}</span></label>`,
      )
      .join("")}</div>`;
    panel.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (!el.dataset.surface) return;
      el.checked
        ? hiddenViews.delete(el.dataset.surface)
        : hiddenViews.add(el.dataset.surface);
      localStorage.setItem(
        "delta-media.hidden-views",
        JSON.stringify([...hiddenViews]),
      );
      render();
    });
    target.append(panel);
    const playback=document.createElement('section');playback.className='settings-panel playback-settings';
    playback.innerHTML=`<h2>${t('Воспроизведение','Playback')}</h2><div class="settings-toggles">${(['resume','autoplayNext','compact','showArtwork','showSource','showLyrics'] as const).map((key,i)=>`<label><input type="checkbox" data-pref="${key}" ${preferences[key]?'checked':''}>${[t('Продолжать с сохранённой позиции','Resume saved position'),t('Следующий трек автоматически','Autoplay next'),t('Компактный список','Compact list'),t('Обложки','Artwork'),t('Метки источников','Source labels'),t('Текст песни','Lyrics')][i]}</label>`).join('')}</div><div class="settings-fields"><label for="playback-rate">${t('Скорость','Speed')}</label><select id="playback-rate" aria-label="${t('Скорость','Speed')}" data-pref="playbackRate">${[.5,.75,1,1.25,1.5,1.75,2].map(n=>`<option value="${n}" ${preferences.playbackRate===n?'selected':''}>${n}×</option>`).join('')}</select><label for="offline-format">${t('Офлайн-копии','Offline copies')}</label><select id="offline-format" data-pref="offlineFormat" aria-label="${t('Офлайн-копии','Offline copies')}">${(['auto','audio','video'] as const).map((v,i)=>`<option value="${v}" ${preferences.offlineFormat===v?'selected':''}>${[t('По типу записи','Match item type'),t('Только звук','Audio only'),t('Видео со звуком','Video with audio')][i]}</option>`).join('')}</select><label for="seek-step">${t('Шаг перемотки','Seek step')}</label><div class="settings-number"><input id="seek-step" type="number" data-pref="seekStep" min="1" max="120" step="1" required value="${preferences.seekStep}" aria-describedby="seek-unit preference-error"><span id="seek-unit">${t('с','sec')}</span></div><label for="initial-volume">${t('Начальная громкость','Initial volume')}</label><div class="settings-number"><input id="initial-volume" type="number" data-pref="defaultVolume" min="0" max="100" step="5" required value="${Math.round(preferences.defaultVolume*100)}" aria-describedby="volume-unit preference-error"><span id="volume-unit">%</span></div></div><p id="preference-error" class="field-error" role="status" hidden></p>`;
    playback.oninput=e=>{const input=e.target as HTMLInputElement;input.removeAttribute('aria-invalid');};
    playback.onchange=e=>{const input=e.target as HTMLInputElement;const key=input.dataset.pref!;if(!key)return;
      const error=playback.querySelector<HTMLElement>('#preference-error')!;
      if(key==='offlineFormat'){preferences.offlineFormat=input.value;void savePreferences();return;}
      if(input.type!=='checkbox'&&(!input.checkValidity()||!Number.isFinite(Number(input.value)))){input.setAttribute('aria-invalid','true');error.textContent=key==='seekStep'?t('Введите целое число от 1 до 120 секунд.','Enter a whole number from 1 to 120 seconds.'):t('Введите громкость от 0 до 100% с шагом 5%.','Enter volume from 0 to 100%, in steps of 5%.');error.hidden=false;return;}
      input.removeAttribute('aria-invalid');error.hidden=true;
      (preferences as Record<string,unknown>)[key]=input.type==='checkbox'?input.checked:Number(input.value)/(key==='defaultVolume'?100:1);void savePreferences();};
    target.append(playback);
    return;
  }
  if (view === "sources") {
    target.innerHTML = `<div class="heading"><h1>${label.sources}</h1></div><div class="source-grid">${adapters.filter(a => ['local','direct','rss'].includes(a.id)).map(a => `<article class="source-card"><h2>${a.id === 'local' ? t('Файлы','Files') : a.id === 'direct' ? t('Ссылки и радио','Links & radio') : 'RSS'}</h2><button data-action="import" aria-label="${t('Добавить','Add')}">${icon('plus')}</button></article>`).join('')}</div><div id="provider-connections"></div>`;
    void renderProviders();
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
        : collectionId && ["artists", "albums"].includes(view)
          ? collections(
              state.media,
              view === "artists" ? "artist" : "album",
            ).find((g) => g.key === collectionId)?.name
          : label[view];
  target.innerHTML = `<div class="heading"><div>${collectionId && ["artists", "albums"].includes(view) ? `<button data-action="collection-back" aria-label="${t("Назад", "Back")}">${icon("arrow-left")}</button>` : ""}<h1>${view === "home" ? t("Продолжить", "Continue listening") : esc(title)}</h1><p>${rows.length} ${t("записей", "items")}${view === "queue" ? " · " + t("Порядок сохраняется", "Order is saved") : ""}</p></div><div class="heading-actions">${view === "playlists" ? `<button data-action="new-playlist">${icon("plus")} ${t("Создать", "Create")}</button>${playlistId ? `${!state.playlists.find(p=>p.id===playlistId)?.rule ? `<button data-action="choose-library" class="primary">${icon("plus")} ${t("Добавить из медиатеки", "Add from library")}</button>` : ""}<button data-action="export-playlist">${icon("download")} M3U</button><button data-action="export-playlist" data-format="pls">${icon("download")} PLS</button>` : ""}` : ""}${rows.length ? `<button class="primary" data-action="play-all">${icon("play")} ${t("Слушать", "Play")}</button>` : ""}</div></div>
 ${view === "playlists" ? `<div class="chips">${state.playlists.map((p) => `<button class="${playlistId === p.id ? "selected" : ""}" data-action="playlist" data-id="${p.id}">${esc(p.name)} · ${playlistMedia(p, state.media).length}</button>`).join("")}</div>` : ""}
 <div class="filters"><div class="chips">${adapters
   .filter((a) => a.status === "ready" && (['local', 'direct', 'rss'].includes(a.id) || state.media.some(m => m.source === a.id)))
   .map(
     (a) =>
       `<button class="${selectedSources.has(a.id) ? "selected" : ""}" data-action="source" data-id="${a.id}" aria-pressed="${selectedSources.has(a.id)}">${icon(a.id === "local" ? "hard-drive" : a.id === "rss" ? "podcast" : "sources")} ${a.id === "local" ? t("Файлы", "Local") : a.id === "direct" ? t("Ссылки", "Links") : a.label}</button>`,
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
    player.playing ? "pause" : "play",
  );
  document.querySelector("#elapsed")!.textContent = time(player.position);
  document.querySelector("#duration")!.textContent =
    m?.kind === "radio" || m?.kind === "live" ? "LIVE" : time(player.duration);
  document.querySelector<HTMLInputElement>("#volume")!.disabled = !!m?.embed && m.source === "spotify";
  const range = document.querySelector<HTMLInputElement>("#seek")!;
  range.disabled = player.duration === 0;
  range.max = String(player.duration || 100);
  range.value = String(player.position);
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
          const hostName=new URL(u).hostname;
          if(/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|soundcloud\.com|spotify\.com)$/.test(hostName)){
            const item=host ? await host.call('media.resolve',{url:u}) : {url:u,title:String(data.get('title'))||hostName,kind:kind==='video'?'video':'audio'};
            await addMedia(intentItems(item));
            document.querySelector<HTMLDialogElement>('#dialog')!.close();return;
          }
          if(/(^|\.)twitch\.tv$/.test(hostName))throw Error(t('Этот источник пока не подключён.','This provider is not connected yet.'));
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
    `<div class="eyebrow">${esc(m.source)} · ${esc(m.kind)}</div><h2>${esc(m.title)}</h2><form id="edit-media">${input("title", t("Название", "Title"), m.title)}${input("artist", t("Исполнитель / автор", "Artist / author"), m.artist)}${input("album", t("Альбом / серия", "Album / series"), m.album)}${input("genre", t("Жанр", "Genre"), m.genre)}${input("tags", t("Теги через запятую", "Comma-separated tags"), m.tags.join(", "))}${input("artwork", t("Обложка: HTTPS URL", "Artwork: HTTPS URL"), m.artwork, "url")}<label>${t("Тип", "Type")}<select name="kind">${(["audio", "video", "podcast", "audiobook", "radio", "live"] as const).map((k) => `<option ${m.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><label>${t("Текст / LRC", "Lyrics / LRC")}<textarea name="lyrics" maxlength="100000">${esc(m.lyrics)}</textarea></label><label>${t("Главы: секунды | название, одна на строку", "Chapters: seconds | title, one per line")}<textarea name="chapters">${esc(m.chapters.map((c) => c.start + " | " + c.title).join("\n"))}</textarea></label><button type="submit" class="primary">${icon("save")} ${t("Сохранить", "Save")}</button><p id="form-error" role="alert"></p></form><hr><h3>${t("Воспроизведение", "Playback")}</h3><button data-action="play" data-id="${m.id}">${icon("play")} ${t("Продолжить", "Resume")}</button><p id="synced-lyrics" class="lyrics">${esc(m.lyrics || t("Нет текста", "No lyrics"))}</p>${m.chapters.map((c) => `<button data-action="chapter" data-id="${m.id}" data-time="${c.start}">${time(c.start)} · ${esc(c.title)}</button>`).join("")}<h3>${t("Закладки", "Bookmarks")}</h3><button data-action="bookmark" data-id="${m.id}">${icon("plus")} ${t("Закладка", "Bookmark")}</button>${m.bookmarks.map((b) => `<button data-action="chapter" data-id="${m.id}" data-time="${b.position}">${time(b.position)} · ${esc(b.note)}</button>`).join("")}<h3>${t("Плейлисты", "Playlists")}</h3>${state.playlists
      .filter((p) => !p.rule)
      .map(
        (p) =>
          `<button data-action="add-playlist" data-id="${p.id}" data-media="${m.id}">${icon("plus")} ${esc(p.name)}</button>`,
      )
      .join(
        "",
      )}<hr><button data-action="download-local" data-id="${m.id}" ${m.fileId ? "" : "disabled"}>${icon("download")} ${t("Файл", "File")}</button><button data-action="delete" data-id="${m.id}" class="danger">${icon("trash")} ${t("Удалить", "Delete")}</button>`,
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
  "radio-refresh": () => radio.act("radio-refresh"),
  "radio-back": () => {
    query = "";
    document.querySelector<HTMLInputElement>("#search")!.value = "";
    return radio.act("radio-back");
  },
  "radio-play": (el) => radio.act("radio-play", el.dataset.id),
  "radio-tracks": (el) => {
    query = "";
    document.querySelector<HTMLInputElement>("#search")!.value = "";
    return radio.act("radio-tracks", el.dataset.id);
  },
  theme: () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("delta-media.theme", theme);
    const button = document.querySelector("[data-action=theme]")!;
    button.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  },
  view: (el) => {
    view = el.dataset.view!;
    collectionId = "";
    query = "";
    document.querySelector<HTMLInputElement>("#search")!.value = "";
    render();
  },
  collection: (el) => {
    collectionId = decodeURIComponent(el.dataset.id!);
    render();
  },
  "collection-back": () => {
    collectionId = "";
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
    const track = radio.find(id);
    if (track && !state.media.some((m) => m.id === id)) {
      state.media.push(track);
      await persist();
    }
    let i = state.queue.indexOf(id);
    if (i < 0) {
      state.queue.push(id);
      i = state.queue.length - 1;
    }
    await player.load(i);
    render();
  },
  'video-compact': () => {videoMode='compact';videoPresentation();},
  'video-normal': () => {videoMode='normal';videoPresentation();},
  'video-hide': () => {videoMode='hidden';videoPresentation();},
  'video-restore': () => {videoMode='normal';videoPresentation();},
  'retry-search': () => searchProviders(query),
  'provider-play': async el => receiveMedia(true, remoteItems[Number(el.dataset.index)]),
  'provider-enqueue': async el => toggleQueue(importResult(remoteItems[Number(el.dataset.index)])),
  'provider-favorite': async el => toggleFavorite(importResult(remoteItems[Number(el.dataset.index)])),
  "play-all": async () => {
    state.queue = filtered().map((m) => m.id);
    if (state.queue.length) await player.load(0);
    render();
  },
  toggle: async () => {
    if (!player.current) {
      if (state.queue.length) await player.load(Math.max(0,state.queueIndex));
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
  favorite: async el => toggleFavorite(state.media.find(m => m.id === el.dataset.id)!),
  enqueue: async el => toggleQueue(state.media.find(m => m.id === el.dataset.id)!),
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
    removeQueued(state, state.queue[i], i);
    await persist();
    render();
  },
  offline: async el => offline?.toggle(state.media.find(m=>m.id===el.dataset.id)!),
  details: (el) => details(el.dataset.id!),
  'choose-playlists': el => choosePlaylists(el.dataset.id!),
  'choose-library': () => chooseLibrary(),
  'playlist-remove-item': async el => {const p=state.playlists.find(p=>p.id===playlistId);if(!p||p.rule)return;p.items=p.items.filter(id=>id!==el.dataset.id);await persist();render();notify(t('Убрано из плейлиста','Removed from playlist'));},
  "new-playlist": () => {
    modal(
      `<h2>${t("Плейлист", "Playlist")}</h2><form id="playlist-form">${input("name", t("Название", "Name"))}<label class="check"><input type="checkbox" name="smart">${t("Авто", "Smart")}</label><fieldset id="smart-fields" hidden disabled>${input("query", t("Поиск", "Search"))}${input("tag", t("Тег", "Tag"))}<label class="check"><input type="checkbox" name="favorite">${t("Избранное", "Favorites")}</label></fieldset><button type="submit" class="primary">${icon("plus")} ${t("Создать", "Create")}</button></form>`,
    );
    document.querySelector<HTMLInputElement>(
      "#playlist-form [name=smart]",
    )!.onchange = (e) => {
      const enabled = (e.target as HTMLInputElement).checked,
        fields = document.querySelector<HTMLFieldSetElement>("#smart-fields")!;
      fields.hidden = !enabled;
      fields.disabled = !enabled;
    };
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
        const data = new FormData(e.target as HTMLFormElement);
        state.playlists.push({
          id: playlistId,
          name,
          items: [],
          ...(data.has("smart")
            ? {
                rule: {
                  query: String(data.get("query") || "").slice(0, 512),
                  tag: String(data.get("tag") || "").slice(0, 100),
                  favorite: data.has("favorite"),
                },
              }
            : {}),
        });
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
    const rows = playlistMedia(p, state.media);
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
    if (player.current?.id === id) await player.stop();
    state.pendingRemovals = [...new Set([...(state.pendingRemovals || []), id])];
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
    notify(t("Удалено из медиатеки", "Deleted from library"));
  },
};
app.addEventListener("click", (e) => {
  const el = (e.target as Element).closest<HTMLElement>("[data-action]");
  if (el) {
    e.preventDefault();
    run(async () => {
      const track = el.dataset.id && radio.find(el.dataset.id);
      if (track && !state.media.some((m) => m.id === track.id)) {
        state.media.push(track);
        await persist();
      }
      return actionHandlers[el.dataset.action!]?.(el);
    });
  }
});
let lastReport = "",
  lastReportAt = 0;
/** The shell's dock mini-player and desktops show what plays here. */
function reportToHost() {
  if (!host) return;
  const m = player.current;
  if (!m) {
    if (lastReport !== "idle") host.reportMedia(null);
    lastReport = "idle";
    return;
  }
  const el = player.element;
  const state_ = {
    playing: player.playing,
    title: m.title,
    subtitle: m.artist || m.album || "",
    canNext: state.queue.length > 1,
    canPrev: state.queueIndex > 0,
  };
  const key = JSON.stringify(state_);
  const now = Date.now();
  if (key === lastReport && now - lastReportAt < 5000) return;
  lastReport = key;
  lastReportAt = now;
  host.reportMedia({
    ...state_,
    position: shared.primary ? (Math.floor(player.position)) : m.position,
    duration: player.duration ? Math.floor(player.duration) : m.duration,
  });
}
/** media.play / media.enqueue from source apps (YouTube, SoundCloud, Spotify…). */
async function receiveMedia(play: boolean, payload: unknown) {
  const items = intentItems(payload);
  if (!items.length) throw Error(t("Ссылка не поддерживается.", "Unsupported link."));
  const result = deduplicate(state.media, items);
  state.media = result.media;
  if (play) {
    const at = state.queue.length ? state.queueIndex + 1 : 0;
    state.queue.splice(at, 0, ...result.ids);
    await persist();
    await player.load(at);
  } else {
    state.queue.push(...result.ids);
    await persist();
    notify(t(`В очереди: ${result.ids.length}`, `Queued: ${result.ids.length}`));
  }
  render();
}
async function boot() {
  if (
    "serviceWorker" in navigator &&
    ["http:", "https:"].includes(location.protocol) &&
    !location.hostname.startsWith("deltaapp-")
  ) {
    void navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  storage = await new Storage().open();
  state = await storage.load();
  offline=new OfflineCache(host,storage,()=>state,deviceId,persist,render,notify,t,()=>preferences.offlineFormat);
  setInterval(()=>{if(shared.primary)void offline?.poll();},1800);
  if (!state.media.length) state.volume = preferences.defaultVolume;
  shell();
  styledControls();
  player = new Player(
    document.querySelector<HTMLVideoElement>("#media")!,
    state,
    storage,
    persist,
    document.querySelector<HTMLIFrameElement>("#embed")!,
  );
  player.addEventListener("change", updatePlayer);
  player.addEventListener("change", reportToHost);
  player.addEventListener('change', () => shared.report());
  shared.attach(player,state,(structure=true)=>{updatePlayer();if(structure&&view!=='visualizer')render();});
  analysePlayback(player.element,bins=>shared.publishSpectrum(bins));
  setInterval(()=>{
    if(view!=='visualizer')return;
    const canvas=document.querySelector<HTMLCanvasElement>('.visualizer canvas');if(!canvas)return;
    const bins=shared.spectrum,ctx=canvas.getContext('2d');if(!ctx)return;
    canvas.width=Math.round(canvas.clientWidth*devicePixelRatio);canvas.height=Math.round(canvas.clientHeight*devicePixelRatio);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(bins){ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent');const w=canvas.width/bins.length;bins.forEach((v,i)=>{const h=v/255*canvas.height;ctx.fillRect(i*w,canvas.height-h,Math.max(1,w-2),h);});}
    const hint=canvas.nextElementSibling as HTMLElement;hint.hidden=!!bins;
  },80);
  host?.onMediaCommand((c) => {
    const go = { toggle: () => player.toggle(), play: () => player.play(), pause: () => player.pause(), next: () => player.next(), prev: () => player.previous() }[c];
    void Promise.resolve(go?.()).catch((e) => notify((e as Error).message, true));
  });
  host?.onIntent((intent, payload) => {
    if (intent !== "media.play" && intent !== "media.enqueue") return;
    void receiveMedia(intent === "media.play", payload).catch((e) => notify((e as Error).message, true));
  });
  player.addEventListener("failure", (e) =>
    notify((e as CustomEvent).detail, true),
  );
  if (shared.primary && state.queue.length) {
    try {
      await player.load(
        Math.max(0, Math.min(state.queueIndex, state.queue.length - 1)),
        false,
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  applyPreferences();
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if(e.code==='Space'){e.preventDefault();void player.toggle().catch(()=>{});}
    if(e.code==='ArrowRight'||e.code==='ArrowLeft'){e.preventDefault();player.seek(Math.max(0,player.position+(e.code==='ArrowRight'?1:-1)*preferences.seekStep));}
  });
  render(); updatePlayer();
  void synchronize(); setInterval(() => void synchronize(), 2000);
  if (sdkError) notify(sdkError, true);
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
