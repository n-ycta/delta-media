/** Capture the decoded audio without routing the playback element through Web Audio. */
export function analysePlayback(element:HTMLMediaElement, publish:(bins:number[]|null)=>void) {
 let context:AudioContext|undefined,source:MediaStreamAudioSourceNode|undefined,stream:MediaStream|undefined,timer:ReturnType<typeof setInterval>|undefined;
 const start=async()=>{
  if(timer)return;
  try{
   const capture=(element as HTMLMediaElement&{captureStream?:()=>MediaStream}).captureStream;
   if(!capture)throw Error('unsupported');
   stream=capture.call(element);if(!stream.getAudioTracks().length)throw Error('protected');
   context??=new AudioContext();await context.resume();
   const analyser=context.createAnalyser();analyser.fftSize=128;analyser.smoothingTimeConstant=.8;
   source=context.createMediaStreamSource(stream);source.connect(analyser);
   const silent=context.createGain();silent.gain.value=0;analyser.connect(silent);silent.connect(context.destination);
   const bins=new Uint8Array(analyser.frequencyBinCount);
   timer=setInterval(()=>{if(element.paused){publish(null);return;}try{analyser.getByteFrequencyData(bins);publish(Array.from(bins));}catch{publish(null)}},80);
  }catch{publish(null);}
 };
 const stop=()=>{if(timer)clearInterval(timer);timer=undefined;source?.disconnect();source=undefined;stream?.getTracks().forEach(t=>t.stop());publish(null);};
 element.addEventListener('playing',()=>void start());element.addEventListener('emptied',stop);
 addEventListener('pagehide',()=>{stop();void context?.close();},{once:true});
}
