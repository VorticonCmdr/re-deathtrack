// MIDI output for the MT-32 option: the MPU-401 UART bytes the game writes to port 330h go to a Web MIDI output.
// The MT-32 itself (or Munt, a virtual MT-32) is best; without one (or with ?synth=builtin) a small built-in synth plays instead.
import {mpu} from '../game/devices.js';
import {PIT_HZ} from '../engine/host.js';
import synthUrl from './midi-worklet.js?worker&url';
const LATENCY=120; // ms of scheduling headroom, same as the audio path
export function createMidi(onStatus,forceBuiltin=false){
 let out=null,base=null,failed=null,ctx=null,node=null;
 async function builtin(why){
  ctx=new AudioContext();
  await ctx.audioWorklet.addModule(synthUrl);
  node=new AudioWorkletNode(ctx,'midi-synth',{outputChannelCount:[2]});node.connect(ctx.destination);
  await ctx.resume();
  onStatus(`MT-32 selected: ${why}; playing MIDI on the built-in approximate synth (not MT-32 timbres).`);
 }
 async function start(){
  if(out||node||failed)return;
  try{
   if(forceBuiltin)return await builtin('built-in synth requested');
   if(!navigator.requestMIDIAccess)throw Error('this browser has no Web MIDI');
   const acc=await navigator.requestMIDIAccess({sysex:true}),ports=[...acc.outputs.values()];
   out=ports.find(p=>/mt-?32|munt|roland/i.test(p.name))||ports[0];
   if(!out)throw Error('no MIDI output is connected');
   onStatus(`MT-32 selected: sending MIDI to "${out.name}"`);
  }catch(e){
   try{await builtin(e.message);}catch(e2){failed=e2;onStatus(`MT-32 selected, but no MIDI output is available (${e.message}; ${e2.message}); music is silent.`);}
  }
 }
 // Called once per animation frame; bytes are grouped per message and time-stamped from virtual time.
 function pump(vNow){
  const evs=mpu.events.splice(0);
  if(!(out||node)||!evs.length)return;
  const now=(node?ctx.currentTime*1000:performance.now())+LATENCY;
  if(!base||Math.abs(base.a+(vNow-base.v)/PIT_HZ*1000-now)>50)base={v:vNow,a:now};
  const batch=[];
  let msg=[],t=0;
  const flush=()=>{
   if(!msg.length)return;
   const at=base.a+(t-base.v)/PIT_HZ*1000;
   if(node)batch.push({frame:Math.round(at/1000*ctx.sampleRate),bytes:msg});else{try{out.send(msg,at);}catch{}}
   msg=[];
  };
  for(const e of evs){
   const b=e.b;
   if(b>=0x80&&b<0xf8&&!(msg[0]===0xf0&&b!==0xf7)){flush();}
   if(!msg.length)t=e.t;
   msg.push(b);
   if(b===0xf7)flush();
  }
  flush();
  if(batch.length)node.port.postMessage(batch);
 }
 return {start,pump};
}
