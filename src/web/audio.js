// Browser audio for the emulated PC speaker: maps virtual time to the AudioContext clock with a fixed latency.
import {speaker} from '../game/bios.js';
import {PIT_HZ} from '../engine/host.js';
const LATENCY=0.12; // seconds of scheduling headroom
export function createAudio(){
 let ctx=null,node=null,base=null,muted=false,starting=null,analyser=null,peak=0;
 function start(){
  if(ctx)return ctx.resume();
  return starting??=(async()=>{
   const c=new AudioContext();
   await c.audioWorklet.addModule(new URL('./speaker-worklet.js',import.meta.url));
   node=new AudioWorkletNode(c,'pc-speaker');node.connect(c.destination);
   analyser=c.createAnalyser();analyser.fftSize=2048;node.connect(analyser);ctx=c;
  })();
 }
 // Called once per animation frame with the virtual time the host has reached.
 // Peak output level since the last call (for automated checks).
 function level(){const p=peak;peak=0;return p;}
 function pump(vNow){
  if(analyser){const b=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(b);for(const x of b)peak=Math.max(peak,Math.abs(x));}
  const evs=speaker.events.splice(0);
  if(!node||muted)return;
  // Anchor: virtual time vNow corresponds to audio time (now + latency); re-anchor if drift exceeds 50 ms.
  const now=ctx.currentTime+LATENCY,anchor=base??(base={v:vNow,a:now});
  if(Math.abs(anchor.a+(vNow-anchor.v)/PIT_HZ-now)>0.05)base={v:vNow,a:now};
  const sr=ctx.sampleRate;
  node.port.postMessage(evs.map(e=>({frame:Math.round((base.a+(e.t-base.v)/PIT_HZ)*sr),divisor:e.divisor,gate:e.gate})));
 }
 return {start,pump,level,setMuted:m=>{muted=m;if(m)node?.port.postMessage([{frame:0,divisor:0x14,gate:0}]);},get running(){return !!ctx&&ctx.state==='running';}};
}
