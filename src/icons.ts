/** Official Phosphor regular SVG assets; no icon font or hand-drawn substitutes. */
import svg0 from "@phosphor-icons/core/assets/regular/house.svg?raw";
import svg1 from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import svg2 from "@phosphor-icons/core/assets/regular/music-notes.svg?raw";
import svg3 from "@phosphor-icons/core/assets/regular/video.svg?raw";
import svg4 from "@phosphor-icons/core/assets/regular/microphone-stage.svg?raw";
import svg5 from "@phosphor-icons/core/assets/regular/book-open.svg?raw";
import svg6 from "@phosphor-icons/core/assets/regular/broadcast.svg?raw";
import svg7 from "@phosphor-icons/core/assets/regular/heart.svg?raw";
import svg8 from "@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw";
import svg9 from "@phosphor-icons/core/assets/regular/playlist.svg?raw";
import svg10 from "@phosphor-icons/core/assets/regular/diamonds-four.svg?raw";
import svg11 from "@phosphor-icons/core/assets/regular/chart-bar.svg?raw";
import svg12 from "@phosphor-icons/core/assets/regular/queue.svg?raw";
import svg13 from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import svg14 from "@phosphor-icons/core/assets/regular/shuffle.svg?raw";
import svg15 from "@phosphor-icons/core/assets/regular/repeat.svg?raw";
import svg16 from "@phosphor-icons/core/assets/regular/play.svg?raw";
import svg17 from "@phosphor-icons/core/assets/regular/pause.svg?raw";
import svg18 from "@phosphor-icons/core/assets/regular/skip-back.svg?raw";
import svg19 from "@phosphor-icons/core/assets/regular/skip-forward.svg?raw";
import svg20 from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import svg21 from "@phosphor-icons/core/assets/regular/x.svg?raw";
import svg22 from "@phosphor-icons/core/assets/regular/speaker-high.svg?raw";
import svg23 from "@phosphor-icons/core/assets/regular/upload-simple.svg?raw";
import svg24 from "@phosphor-icons/core/assets/regular/arrow-up.svg?raw";
import svg25 from "@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw";
import sun from "@phosphor-icons/core/assets/regular/sun.svg?raw";
import moon from "@phosphor-icons/core/assets/regular/moon.svg?raw";
import download from "@phosphor-icons/core/assets/regular/download-simple.svg?raw";
import hardDrive from "@phosphor-icons/core/assets/regular/hard-drive.svg?raw";
const icons: Record<string, string> = {
  sun,
  moon,
  download,
  "hard-drive": hardDrive,
  home: svg0,
  library: svg1,
  audio: svg2,
  video: svg3,
  podcast: svg4,
  audiobook: svg5,
  radio: svg6,
  favorites: svg7,
  history: svg8,
  playlists: svg9,
  sources: svg10,
  stats: svg11,
  queue: svg12,
  search: svg13,
  shuffle: svg14,
  repeat: svg15,
  play: svg16,
  pause: svg17,
  previous: svg18,
  next: svg19,
  plus: svg20,
  close: svg21,
  volume: svg22,
  upload: svg23,
  "arrow-up": svg24,
  "arrow-up-right": svg25,
};
export const icon = (name: string) =>
  (icons[name] || icons.audio).replace("<svg ", '<svg aria-hidden="true" ');
