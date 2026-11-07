import { icon } from './icons';
import type { Media, State } from './model';

type Translate = (ru: string, en: string) => string;
export type PlaybackStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'error';
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function statusText(status: PlaybackStatus, t: Translate) {
  return ({idle:t('Готов к воспроизведению','Ready to play'),loading:t('Загрузка…','Loading…'),buffering:t('Буферизация…','Buffering…'),playing:t('Играет','Playing'),paused:t('На паузе','Paused'),error:t('Не удалось воспроизвести','Playback failed')})[status];
}
export function playerFooter(state: State, t: Translate) {
  return `<footer class="media-player" aria-label="${t('Плеер','Playback')}" data-state="idle">
    <button class="now" data-action="player-open" title="${t('Открыть плеер','Open player')}" aria-label="${t('Открыть плеер','Open player')}"><span class="mini-art">${icon('audio')}</span><span class="now-copy"><strong id="now-title">${t('Выберите трек','Choose a track')}</strong><small id="now-artist">Delta Media</small><span id="player-status" class="playback-status" role="status"></span></span></button>
    <div class="transport"><div class="transport-buttons">
      <button data-action="shuffle" id="shuffle" aria-label="${t('Перемешивание','Shuffle')}" title="${t('Перемешивание','Shuffle')}" aria-pressed="false">${icon('shuffle')}</button>
      <button data-action="previous" aria-label="${t('Назад','Previous')}" title="${t('Назад','Previous')}">${icon('previous')}</button>
      <button data-action="toggle" id="toggle" class="play" aria-label="${t('Воспроизвести','Play')}" title="${t('Воспроизвести','Play')}">${icon('play')}</button>
      <button data-action="next" aria-label="${t('Далее','Next')}" title="${t('Далее','Next')}">${icon('next')}</button>
      <button data-action="repeat" id="repeat" aria-label="${t('Повтор выключен','Repeat off')}" title="${t('Повтор выключен','Repeat off')}" aria-pressed="false">${icon('repeat')}</button>
      <button id="player-retry" data-action="retry-current" aria-label="${t('Повторить воспроизведение','Retry playback')}" title="${t('Повторить воспроизведение','Retry playback')}" hidden>${icon('refresh')}</button>
    </div><div class="timeline"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="${t('Позиция','Position')}"><span id="duration">0:00</span></div></div>
    <div class="volume"><button data-action="video-show" id="video-show" aria-label="${t('Показать видео','Show video')}" title="${t('Показать видео','Show video')}" hidden>${icon('video')}</button><button data-action="mute" id="mute" aria-label="${t('Выключить звук','Mute')}" title="${t('Выключить звук','Mute')}" aria-pressed="false">${icon('volume')}</button><input id="volume" type="range" min="0" max="1" step="0.01" value="${state.volume}" aria-label="${t('Громкость','Volume')}"><button class="queue-toggle" data-action="queue" aria-label="${t('Далее по списку','Up next')}">${icon('queue')}<span class="queue-label">${t('Далее','Up next')}</span><span id="queue-count" class="queue-count">${state.queue.length}</span></button></div>
  </footer>`;
}
export function playerSurface(current: Media | undefined, state: State, t: Translate) {
  const next = state.queue.slice(Math.max(0,state.queueIndex+1)).map(id=>state.media.find(m=>m.id===id)).filter((m):m is Media=>!!m).slice(0,3);
  return `<section class="player-surface"><div class="player-surface-top"><button data-action="player-back">${icon('arrow-left')} ${t('К медиатеке','Back to library')}</button><span class="eyebrow">${t('Сейчас играет','Now playing')}</span></div>
    <div class="player-surface-content"><div class="player-surface-art">${current?.artwork?`<img src="${esc(current.artwork)}" alt="" referrerpolicy="no-referrer">`:icon('audio')}</div><div class="player-surface-copy"><h1 id="surface-title">${esc(current?.title||t('Выберите трек','Choose a track'))}</h1><p id="surface-artist">${esc(current?.artist||'')}</p><p class="surface-playback-status playback-status" role="status"></p><p class="surface-playback-error" role="alert" hidden></p>${current?`<p class="source-tag">${esc(current.source)}</p>${current.embed||current.kind==='video'?`<button data-action="video-show">${icon('video')} ${t('Показать видео','Show video')}</button>`:''}`:`<p class="hint">${t('Откройте медиатеку и нажмите на запись, чтобы начать.','Open your library and choose an item to start listening.')}</p><button class="primary" data-action="player-back">${t('Открыть медиатеку','Open library')}</button>`}</div></div>
    ${next.length?`<section class="up-next"><div class="up-next-heading"><h2>${t('Далее по списку','Up next')}</h2><button data-action="queue">${t('Весь список','See all')} ${icon('arrow-up-right')}</button></div>${next.map(m=>`<button class="up-next-item" data-action="play-next" data-id="${m.id}">${icon('play')}<span><strong>${esc(m.title)}</strong><small>${esc(m.artist||m.source)}</small></span></button>`).join('')}</section>`:''}
  </section>`;
}
