// Presentation only: bounded voices, no simulation randomness or career mutations.
// Babylon uses +Z forward. Listener-local Web Audio uses -Z forward.
export function relativeSound(source, listener){
 const dx=source.x-listener.x,dz=source.z-listener.z,s=Math.sin(listener.yaw),c=Math.cos(listener.yaw);
 return {x:dx*c-dz*s,y:(source.y??0)-(listener.y??0),z:-(dx*s+dz*c)};
}
export function createSpatialAudio(context){
 const bus=context.createGain(),limiter=context.createDynamicsCompressor();bus.gain.value=0;
 limiter.threshold.value=-18;limiter.knee.value=18;limiter.ratio.value=6;
 bus.connect(limiter).connect(context.destination);
 const voices=new Set();let previousRace=null;
 const noise=context.createBuffer(1,context.sampleRate,context.sampleRate),data=noise.getChannelData(0);
 for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
 function panner(){const p=context.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=8;p.rolloffFactor=1.4;p.maxDistance=200;return p;}
 function position(p,source,listener){const v=relativeSound(source,listener);p.positionX.value=v.x;p.positionY.value=v.y;p.positionZ.value=v.z;}
 function stopVoices(){for(const v of voices){v.source.stop();v.source.disconnect();v.gain.disconnect();v.filter.disconnect();v.pan.disconnect();}voices.clear();}
 function event(e,listener){
  if(voices.size>=24||Math.hypot(e.x-listener.x,e.y-listener.y,e.z-listener.z)>180)return;
  const boom=e.type==='explosion'||e.type==='wreck',shot=e.type==='shot',service=e.type==='service';
  const tonal=service||shot&&[1,2,4].includes(e.weapon),duration=boom?.65:service?.45:shot&&e.weapon>=3?.22:.11;
  const source=tonal?context.createOscillator():context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain(),pan=panner(),t=context.currentTime;
  if(tonal){filter.frequency.value=4000;source.type=service?'sine':'triangle';source.frequency.setValueAtTime(service?440:e.weapon===1?1100:360,t);source.frequency.exponentialRampToValueAtTime(service?880:100,t+duration);}
  else{source.buffer=noise;filter.type='lowpass';filter.frequency.setValueAtTime(boom?700:shot?2200:1300,t);filter.frequency.exponentialRampToValueAtTime(boom?60:200,t+duration);}
  gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(boom?.24:service?.07:shot?.085:.12,t+.006);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  position(pan,e,listener);source.connect(filter).connect(gain).connect(pan).connect(bus);
  const voice={source,filter,gain,pan,point:e};voices.add(voice);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();voices.delete(voice);};source.start(t);source.stop(t+duration+.02);
 }
 // Fixed engine pool; only the player and nearest three running rivals are audible.
 const motors=Array.from({length:10},()=>{const source=context.createOscillator(),filter=context.createBiquadFilter(),gain=context.createGain(),pan=panner();source.type='sawtooth';filter.type='lowpass';filter.frequency.value=240;gain.gain.value=0;source.connect(filter).connect(gain).connect(pan).connect(bus);source.start();return {source,filter,gain,pan};});
 const missile=context.createOscillator(),missileGain=context.createGain(),missilePan=panner();missile.type='triangle';missile.frequency.value=520;missileGain.gain.value=0;missile.connect(missileGain).connect(missilePan).connect(bus);missile.start();
 return {update(race,status,events,enabled,volume){
  const t=context.currentTime,listener=race?.state;
  if(previousRace!==race){stopVoices();previousRace=race;}
  bus.gain.setTargetAtTime(enabled?volume:0,t,.015);
  if(!enabled||volume<=0||!listener){stopVoices();for(const m of motors)m.gain.gain.setTargetAtTime(0,t,.02);missileGain.gain.setTargetAtTime(0,t,.02);return;}
  for(const v of voices)position(v.pan,v.point,listener);
  // Preserve dramatic events when a crowded frame exhausts the voice budget.
  const priority=e=>e.type==='wreck'?0:e.type==='explosion'?1:e.type==='service'?2:e.type==='shot'?4:3;
  for(const e of [...events].sort((a,b)=>priority(a)-priority(b)))event(e,listener);
  const nearby=race.cars.map((c,id)=>({id,d:Math.hypot(c.state.x-listener.x,c.state.z-listener.z)})).filter(c=>c.id>0&&c.d<100&&!status.combat.states[c.id].disabled&&status.finishTimes[c.id]==null).sort((a,b)=>a.d-b.d).slice(0,3).map(c=>c.id);
  motors.forEach((m,id)=>{const car=race.cars[id]?.state,w=status.combat.states[id];if(!car)return;position(m.pan,car,listener);const live=status.phase==='racing'&&!w.disabled&&!w.servicing&&status.finishTimes[id]==null&&(id===0||nearby.includes(id));m.gain.gain.setTargetAtTime(live?(id===0?.018:.024):0,t,.06);m.source.frequency.setTargetAtTime(32+car.speed*2.5+id*.8,t,.08);m.filter.frequency.setTargetAtTime(150+car.speed*8,t,.08);});
  const incoming=status.combat.projectiles.filter(p=>p.kind===4&&p.target===0).sort((a,b)=>Math.hypot(a.x-listener.x,a.z-listener.z)-Math.hypot(b.x-listener.x,b.z-listener.z))[0];
  if(incoming){position(missilePan,incoming,listener);missile.frequency.setTargetAtTime(450+Math.max(0,80-Math.hypot(incoming.x-listener.x,incoming.z-listener.z))*6,t,.04);}
  missileGain.gain.setTargetAtTime(incoming&&status.phase==='racing'?.035:0,t,.03);
 },dispose(){stopVoices();for(const m of motors){m.source.stop();m.source.disconnect();m.filter.disconnect();m.gain.disconnect();m.pan.disconnect();}missile.stop();missile.disconnect();missileGain.disconnect();missilePan.disconnect();bus.disconnect();limiter.disconnect();}};
}
