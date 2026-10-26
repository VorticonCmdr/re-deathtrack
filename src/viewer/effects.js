// Audition the actual translated 334e voice interpreter, isolated from the game page.
import {createMachine} from '../engine/machine.js';
import {B,rw,ww,wb,fww} from '../engine/mem.js';
import {f334e_01d3,f334e_0078} from '../game/sfx.js';
import {PIT_HZ} from '../engine/host.js';
import {sha256} from '../engine/sha256.js';
import manifest from '../data/manifest.json' with {type:'json'};
export const EFFECT_HZ=PIT_HZ/4096;
export function effectTrace(exe,original,bank,index,hz=EFFECT_HZ){
 const expected=manifest.files['pals.blk']||manifest.files['PALS.BLK'];
 if(sha256(original)!==expected.sha256)throw Error('Effect playback requires the supported PALS.BLK (other files can still be inspected).');
 createMachine({assets:new Map([['DTRACK.EXE',exe]])});
 const seg=0x7000;B.set(bank.data,seg*16);
 // The real bank loader relocates every far pointer. ITM is absent; wave(0) reads table[0].
 for(const e of bank.effects)fww(seg,e.index*4+2,seg);
 const e=bank.effects[index];if(!e)throw Error('Unknown effect');
 const di=rw(0x3789);ww(0x35f6,0);wb(0x35ef,1);f334e_01d3(e.offset,seg,0,0,0);
 const samples=[];
 for(let tick=0;tick<Math.ceil(hz*15);tick++){
  f334e_0078(di,seg);samples.push({time:tick/hz,divisor:rw(di+8)||65536,gate:rw(di+10)!==0});
  if(rw(di)===0)return {samples,duration:(tick+1)/hz,hz};
 }
 throw Error('Effect exceeds 15-second audition limit');
}
// Same square-wave / low-pass approximation as web/speaker-worklet.js, rendered offline for WAV export.
export function effectPCM(trace,sampleRate=44100){
 const pcm=new Float32Array(Math.ceil((trace.duration+.03)*sampleRate));let index=0,phase=0,lp=0;
 for(let i=0;i<pcm.length;i++){
  const t=i/sampleRate;while(index+1<trace.samples.length&&trace.samples[index+1].time<=t)index++;
  const e=trace.samples[index],hz=PIT_HZ/e.divisor;let v=0;
  if(t<trace.duration&&e.gate&&hz<15000){phase=(phase+hz/sampleRate)%1;v=phase<.5?.25:-.25;}
  lp+=.35*(v-lp);pcm[i]=lp;
 }return pcm;
}
export function wav(pcm,sampleRate=44100){
 const b=new Uint8Array(44+pcm.length*2),v=new DataView(b.buffer);const text=(p,s)=>{for(let i=0;i<s.length;i++)b[p+i]=s.charCodeAt(i);};
 text(0,'RIFF');v.setUint32(4,b.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++)v.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);return b;
}
