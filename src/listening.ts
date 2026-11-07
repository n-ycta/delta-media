import { uid, type Media, type State } from './model';

/** Records only intervals confirmed by forward progress of the active player. */
export class ListeningTracker {
  private item?: Media;
  private historyId = '';
  private active = false;
  private lastAt = 0;
  private lastPosition?: number;
  constructor(private readonly state: State, private readonly clock = () => performance.now(), private readonly date = () => Date.now()) {}
  reset() { this.item=undefined; this.historyId=''; this.active=false; this.lastAt=0; this.lastPosition=undefined; }
  discontinuity() { this.lastAt=0; this.lastPosition=undefined; }
  update(item: Media, playing: boolean, position: number | undefined, rate = 1) {
    if (this.item !== item) { this.reset(); this.item=item; }
    const now=this.clock();
    let started=false, seconds=0;
    if (playing && !this.historyId) {
      started=true; item.plays++; item.lastPlayed=this.date(); this.historyId=uid();
      this.state.history.unshift({id:this.historyId,mediaId:item.id,at:item.lastPlayed,position:item.position,seconds:0});
      this.state.history=this.state.history.slice(0,1000);
    }
    if (this.active && this.lastAt && Number.isFinite(position) && this.lastPosition !== undefined) {
      const elapsed=(now-this.lastAt)/1000, advance=position!-this.lastPosition;
      const speed=Number.isFinite(rate)&&rate>0?rate:1;
      // Ignore seeks, clock discontinuities, and long unobserved background intervals.
      if (elapsed>0 && elapsed<=15 && advance>0 && advance<=elapsed*speed+2) {
        seconds=Math.min(elapsed,advance/speed);
        item.listenedSeconds+=seconds;
        const entry=this.state.history.find(h=>h.id===this.historyId);if(entry)entry.seconds+=seconds;
      }
    }
    const stopped=this.active&&!playing;
    this.active=playing;this.lastAt=now;this.lastPosition=Number.isFinite(position)?position:undefined;
    const entry=this.state.history.find(h=>h.id===this.historyId);if(entry&&Number.isFinite(position))entry.position=position!;
    return {started,stopped,seconds};
  }
}

export type ListeningPeriod = 'day' | 'week' | 'month' | 'all';
export function summarizeListening(state: State, period: ListeningPeriod, now = Date.now()) {
  const durations={day:86400000,week:7*86400000,month:30*86400000};
  const counts=new Map<string,number>();
  let seconds=0, plays=0;
  if(period==='all'){
    for(const item of state.media){const count=Math.max(0,Number(item.plays)||0);counts.set(item.id,count);plays+=count;seconds+=Math.max(0,Number(item.listenedSeconds)||0);}
  }else{
    const cutoff=now-durations[period];
    for(const entry of state.history){if(entry.at<cutoff||entry.at>now)continue;plays++;seconds+=Math.max(0,Number(entry.seconds)||0);counts.set(entry.mediaId,(counts.get(entry.mediaId)||0)+1);}
  }
  const tracks=state.media.map(item=>({item,plays:counts.get(item.id)||0})).filter(row=>row.plays>0).sort((a,b)=>b.plays-a.plays);
  const artists=new Map<string,number>();
  for(const {item,plays} of tracks){const name=item.artist?.trim();if(name)artists.set(name,(artists.get(name)||0)+plays);}
  return {seconds,plays,tracks,artists:[...artists].map(([name,plays])=>({name,plays})).sort((a,b)=>b.plays-a.plays)};
}
