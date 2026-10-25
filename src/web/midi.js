// MIDI output for the MT-32 option: the MPU-401 UART bytes the game writes to port 330h go to a Web MIDI output.
// The MT-32 itself (or Munt, a virtual MT-32) must be connected: the port ships no synthesizer and no ROMs.
import {mpu} from '../game/devices.js';
import {PIT_HZ} from '../engine/host.js';
const LATENCY=120; // ms of scheduling headroom, same as the audio path
export function createMidi(onStatus){
 let out=null,base=null,failed=null;
 async function start(){
  if(out||failed)return;
  try{
   if(!navigator.requestMIDIAccess)throw Error('this browser has no Web MIDI');
   const acc=await navigator.requestMIDIAccess({sysex:true}),ports=[...acc.outputs.values()];
   out=ports.find(p=>/mt-?32|munt|roland/i.test(p.name))||ports[0];
   if(!out)throw Error('no MIDI output is connected');
   onStatus(`MT-32 selected: sending MIDI to "${out.name}"`);
  }catch(e){failed=e;onStatus(`MT-32 selected, but no MIDI output is available (${e.message}); music is silent.`);}
 }
 // Called once per animation frame; bytes are grouped per message and time-stamped from virtual time.
 function pump(vNow){
  const evs=mpu.events.splice(0);
  if(!out||!evs.length)return;
  const now=performance.now()+LATENCY;
  if(!base||Math.abs(base.a+(vNow-base.v)/PIT_HZ*1000-now)>50)base={v:vNow,a:now};
  let msg=[],t=0;
  const flush=()=>{if(msg.length){try{out.send(msg,base.a+(t-base.v)/PIT_HZ*1000);}catch{}msg=[];}};
  for(const e of evs){
   const b=e.b;
   if(b>=0x80&&b<0xf8&&!(msg[0]===0xf0&&b!==0xf7)){flush();}
   if(!msg.length)t=e.t;
   msg.push(b);
   if(b===0xf7)flush();
  }
  flush();
 }
 return {start,pump};
}
