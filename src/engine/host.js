// Virtual machine host: virtual time, interrupt delivery, function registry and the generator scheduler.
// Translated game code only touches this through idle()/retrace(), callFar() and the vector API.
import {B,fp,pseg,poff,fww,frw,gaddr} from './mem.js';

export const PIT_HZ=1193182;
export const IDLE=Symbol('idle'), RETRACE=Symbol('retrace');
// Level-triggered device IRQ sources (e.g. the MPU-401): called after every time step, they raise their interrupt while pending.
export const irqSources=[];
// A busy-wait poll point: the host advances virtual time before resuming.
export function* idle(){yield IDLE;}
// Wait for the start of the next vertical retrace.
export function* retrace(){yield RETRACE;}

export class UnsupportedError extends Error{}
export const state={
 clock:0,            // virtual time in PIT input clocks
 pitDivisor:0x10000, // channel 0 reload (0 means 65536)
 nextTick:0x10000,
 retraceHz:70.086,   // DOSBox default machine (VGA) shows mode 0Dh at 70 Hz; EGA hardware is 60 Hz
 quantum:512,        // clocks consumed per idle() poll
 strict:true,
 workMeter:null,     // returns PIT clocks of CPU work done since the last call (game-provided cost model)
 diagnostics:[],
 events:[],          // pending input events {t,type,...} sorted by t
 log:null,           // when an array, consumed environment values are appended here
 port60:0,
 inIrq:0,
};
export function unsupported(what){
 if(state.strict)throw new UnsupportedError(`Unsupported path: ${what}`);
 state.diagnostics.push({t:state.clock,what});
}
export function record(kind,data){if(state.log)state.log.push({t:state.clock,kind,...data});}

// Translated functions callable through far pointers stored in memory, keyed by live packed address.
const registry=new Map();
export function register(gseg,goff,fn,{gen=false,name=''}={}){registry.set(gaddr(gseg,goff),{fn,gen,name:name||fn.name});}
export function lookup(ptr){return registry.get(ptr>>>0);}
export function callFar(ptr,...args){
 const e=registry.get(ptr>>>0);if(!e)return unsupported(`far call to untranslated ${hex(ptr)}`);
 if(e.gen)throw Error(`callFar of generator ${e.name} from non-generator context`);
 return e.fn(...args);
}
export function* callFarG(ptr,...args){
 const e=registry.get(ptr>>>0);if(!e)return unsupported(`far call to untranslated ${hex(ptr)}`);
 return e.gen?yield* e.fn(...args):e.fn(...args);
}
export const hex=p=>`${(p>>>16).toString(16).padStart(4,'0')}:${(p&0xffff).toString(16).padStart(4,'0')}`;

// Interrupt vector table lives in memory; host-provided handlers use pseudo-addresses in segment F000.
const BIOS_SEG=0xf000;
const biosHandlers=new Map();
export function biosVector(n,fn){const p=fp(BIOS_SEG,0x1000+n*16);biosHandlers.set(p,fn);setVector(n,p);}
export const getVector=n=>fp(frw(0,n*4+2),frw(0,n*4));
export function setVector(n,p){fww(0,n*4,poff(p));fww(0,n*4+2,pseg(p));}
// Calls whatever handler the vector points at (game ISR or emulated BIOS). ISRs never block.
export function callVector(p){
 const b=biosHandlers.get(p>>>0);if(b)return b();
 return callFar(p);
}
export function interrupt(n){state.inIrq++;try{callVector(getVector(n));}finally{state.inIrq--;}}

export function setPitDivisor(d){state.pitDivisor=d||0x10000;}
const retracePeriod=()=>PIT_HZ/state.retraceHz;
export function nextRetrace(t){const p=retracePeriod();return Math.floor(t/p+1)*p;}
// Vertical retrace is active for roughly the first 1.4 ms of each frame (VGA 70 Hz timing, approximate).
export function inRetrace(t=state.clock){const p=retracePeriod();return t%p<0.1*p;}

// Advance virtual time, firing PIT ticks (IRQ0 -> INT 8) and delivering due input events.
export function advanceTo(t){
 while(state.nextTick<=t){
  state.clock=state.nextTick;deliverEvents(state.clock);
  interrupt(8);
  state.nextTick+=state.pitDivisor;
  for(const f of irqSources)f();
 }
 state.clock=Math.max(state.clock,t);deliverEvents(state.clock);
 for(const f of irqSources)f();
}
const inputHandlers={};
export function onInput(type,fn){inputHandlers[type]=fn;}
function deliverEvents(t){
 while(state.events.length&&state.events[0].t<=t){const e=state.events.shift();record('input',e);inputHandlers[e.type]?.(e);}
}
export function queueEvent(e){state.events.push(e);state.events.sort((a,b)=>a.t-b.t);}

// Runs the game generator until virtual time reaches `until` or the game ends.
export function runUntil(gen,until){
 for(;;){
  if(state.clock>=until)return {done:false};
  const r=gen.next();
  if(r.done)return {done:true,value:r.value};
  const debt=state.workMeter?state.workMeter():0;
  if(r.value===IDLE)advanceTo(state.clock+state.quantum+debt);
  else if(r.value===RETRACE)advanceTo(nextRetrace(state.clock+debt));
  else throw Error(`Unknown yield ${String(r.value)}`);
 }
}
export function resetHost(){Object.assign(state,{frameStart:undefined,clock:0,pitDivisor:0x10000,nextTick:0x10000,diagnostics:[],events:[],port60:0,inIrq:0});biosHandlers.clear();}
