import { freshState, newMedia, type State, type Media } from "./model";
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || Error("Storage transaction aborted."));
    tx.onerror = () => reject(tx.error);
  });
export class Storage {
  private db!: IDBDatabase;
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("delta-media", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("state");
        r.result.createObjectStore("files");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(Error("Close other Delta Media tabs to upgrade storage."));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async load(): Promise<State> {
    const s = await request(
      this.db.transaction("state").objectStore("state").get("current"),
    );
    if (!s) return freshState();
    if (
      s.version !== 1 ||
      !Array.isArray(s.media) ||
      !Array.isArray(s.queue) ||
      !Array.isArray(s.playlists)
    )
      throw Error(
        "Unsupported or damaged library. Existing data has not been overwritten.",
      );
    return s;
  }
  async save(s: State) {
    const tx = this.db.transaction("state", "readwrite");
    const done = completed(tx);
    tx.objectStore("state").put(s, "current");
    await done;
  }
  async file(id: string): Promise<Blob> {
    const file = await request(
      this.db.transaction("files").objectStore("files").get(id),
    );
    if (!(file instanceof Blob))
      throw Error("Local file unavailable. Reimport it from your device.");
    return file;
  }
  async import(file: File): Promise<Media> {
    if (
      !/^(audio|video)\//.test(file.type) &&
      !file.name.match(/\.(mp3|m4a|aac|wav|ogg|flac|opus|mp4|m4v|webm|mkv)$/i)
    )
      throw Error("Choose an audio or video file.");
    // The original Blob is stored directly; media bytes are never base64 JSON / host bridge data.
    // Bounded sample identity avoids loading a multi-GB file into RAM. Exact full-file dedup is not claimed.
    const sample = await file.slice(0, 65536).arrayBuffer();
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", sample)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = `${file.size}:${file.lastModified}:${file.name}:${hash}`;
    const m = newMedia(
      "local",
      key,
      file.name.replace(/\.[^.]+$/, ""),
      file.type.startsWith("video/") || /\.(mp4|webm|mkv|m4v)$/i.test(file.name)
        ? "video"
        : "audio",
    );
    m.fileId = key;
    m.mime = file.type;
    const tx = this.db.transaction("files", "readwrite");
    const done = completed(tx);
    tx.objectStore("files").put(file, key);
    await done;
    return m;
  }
  async cache(id:string,blob:Blob) {
    const tx=this.db.transaction('files','readwrite'),done=completed(tx);tx.objectStore('files').put(blob,id);await done;
  }
  async removeFile(id: string) {
    const tx = this.db.transaction("files", "readwrite");
    const done = completed(tx);
    tx.objectStore("files").delete(id);
    await done;
  }
}
