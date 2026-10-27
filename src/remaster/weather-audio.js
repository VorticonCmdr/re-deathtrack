// One continuous rain voice and at most one thunder voice; uses Effects volume.
export function createWeatherAudio(context){
 const bus=context.createGain();bus.gain.value=0;bus.connect(context.destination);
 const noise=context.createBuffer(2,context.sampleRate*4,context.sampleRate);
 for(let channel=0;channel<2;channel++){const data=noise.getChannelData(channel);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}
 const rain=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();rain.buffer=noise;rain.loop=true;filter.type='lowpass';filter.frequency.value=2600;gain.gain.value=0;rain.connect(filter).connect(gain).connect(bus);rain.start();
 let serial=null,voice=null;
 function stopThunder(){if(!voice)return;voice.source.stop();voice.source.disconnect();voice.filter.disconnect();voice.gain.disconnect();voice=null;}
 return {update(state,enabled,volume){
  const t=context.currentTime,next=state?.thunder??0,fresh=serial!==null&&next>serial;serial=next;
  bus.gain.setTargetAtTime(enabled?volume:0,t,.04);
  gain.gain.setTargetAtTime(enabled?(state?.wetness??0)*.09*(state?.exposure??1):0,t,.3);
  filter.frequency.setTargetAtTime((state?.exposure??1)<.5?650:2600,t,.25);
  if(!enabled||volume<=0){stopThunder();return;}
  if(fresh){stopThunder();const source=context.createBufferSource(),low=context.createBiquadFilter(),level=context.createGain();source.buffer=noise;low.type='lowpass';low.frequency.setValueAtTime(320,t);low.frequency.exponentialRampToValueAtTime(65,t+3.8);level.gain.setValueAtTime(0,t);level.gain.linearRampToValueAtTime(.35,t+.25);level.gain.exponentialRampToValueAtTime(.0001,t+3.8);source.connect(low).connect(level).connect(bus);const current={source,filter:low,gain:level};voice=current;source.onended=()=>{source.disconnect();low.disconnect();level.disconnect();if(voice===current)voice=null;};source.start();source.stop(t+4);}
 },dispose(){stopThunder();rain.stop();rain.disconnect();filter.disconnect();gain.disconnect();bus.disconnect();}};
}
