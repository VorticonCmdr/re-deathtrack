// Sound hardware behind the ports the music drivers use: AdLib OPL2 (388h/389h) and MPU-401 in UART mode (330h/331h).
// Selected by the host (hw.sound); the translated detection code (1000:c8e5, cb3e) then runs unchanged against it.
// Analysis: docs/re/hardware-paths.md. Reference behaviour: DOSBox mpu401 (ACK 0FEh for every command, status 3Fh|80h
// when no data) and the OPL timer protocol (reg 4: bit 7 clears the flags, 6/5 mask T1/T2, 1/0 start T2/T1).
import {state,PIT_HZ,getVector,interrupt,irqSources} from '../engine/host.js';

export const hw={sound:'speaker'};        // 'speaker' (default) | 'adlib' | 'mt32'
export const SOUNDS=['speaker','adlib','mt32'];
// APPROX: virtual cost of one port access on the device buses; `devNow()` adds it to the clock so busy-wait loops on
// status ports see time pass. Calibrated against the OPL detection count in DOSBox (docs/re/environment.md).
export const cost={usPerPort:2.4};
export const io={clocks:0};
export const devNow=()=>state.clock+io.clocks;
const charge=()=>{io.clocks+=cost.usPerPort*PIT_HZ/1e6;};
// The work meter (pacing.js) hands the accumulated port time to the host clock.
export function takeIo(){const c=io.clocks;io.clocks=0;return c;}

// ---- OPL2 ----
// `events` is the time-stamped register write stream for the audio renderer; timers follow virtual time.
export const opl={regs:new Uint8Array(256),index:0,events:[],count:0,
 t1:{on:0,masked:0,over:0,exp:0},t2:{on:0,masked:0,over:0,exp:0}};
const T1_US=80,T2_US=320;
const period=(t,r)=>(256-r)*(t?T2_US:T1_US)*PIT_HZ/1e6;
function oplTimers(){
 const now=devNow(),r=opl.regs;
 for(const [k,t,reg] of [[0,opl.t1,2],[1,opl.t2,3]]){
  if(!t.on)continue;
  const p=period(k,r[reg]);
  while(now>=t.exp){if(!t.masked)t.over=1;t.exp+=p;}
 }
}
export function oplReset(){opl.regs.fill(0);opl.index=0;opl.count=0;opl.events.length=0;for(const t of [opl.t1,opl.t2])Object.assign(t,{on:0,masked:0,over:0,exp:0});}
export function oplStatus(){
 oplTimers();
 return (opl.t1.over?0x40:0)|(opl.t2.over?0x20:0)|(opl.t1.over||opl.t2.over?0x80:0);
}
function oplWriteReg(reg,v){
 const now=devNow();
 if(reg===4){
  if(v&0x80){opl.t1.over=opl.t2.over=0;}
  else{
   opl.t1.masked=v>>6&1;opl.t2.masked=v>>5&1;
   if(opl.t1.masked)opl.t1.over=0;if(opl.t2.masked)opl.t2.over=0;
   for(const [k,t,bit,rr] of [[0,opl.t1,1,2],[1,opl.t2,2,3]]){
    const on=v&bit?1:0;
    if(on&&!t.on)t.exp=now+period(k,opl.regs[rr]);
    t.on=on;if(!on)t.over=0;
   }
  }
 }
 opl.regs[reg]=v;opl.count++;
 if(opl.events.length<200000)opl.events.push({t:now,reg,v});
}

// ---- MPU-401 (UART mode) ----
export const mpu={queue:[],uart:0,last:0,events:[],count:0};   // events: {t,b} MIDI bytes written to 330h in UART mode
export function mpuReset(){mpu.queue.length=0;mpu.uart=0;mpu.last=0;mpu.count=0;mpu.events.length=0;}
const mpuCmd=v=>{
 if(v===0x3f)mpu.uart=1;else if(v===0xff)mpu.uart=0;
 mpu.queue.push(0xfe);                    // every command is acknowledged (DOSBox)
};
// IRQ 2 (INT 0Ah) is level-triggered while data is queued; the game installs its handler (1000:cc2d) at init.
export function irqPending(){return hw.sound==='mt32'&&mpu.queue.length>0&&getVector(0x0a)!==0;}
export function deliverIrqs(){if(irqPending())interrupt(0x0a);}
irqSources.push(deliverIrqs);

export function hasPort(port){return port===0x330||port===0x331||port===0x388||port===0x389;}
export function portIn(port){
 charge();
 switch(port){
  case 0x331:return hw.sound==='mt32'?(mpu.queue.length?0x3f:0xbf):0xff;
  case 0x330:if(hw.sound!=='mt32')return 0xff;if(mpu.queue.length)mpu.last=mpu.queue.shift();return mpu.last;
  case 0x388:return hw.sound==='adlib'?oplStatus():0xff;
  case 0x389:return 0xff;
 }
 return 0xff;
}
export function portOut(port,v){
 charge();v&=0xff;
 switch(port){
  case 0x331:if(hw.sound==='mt32')mpuCmd(v);return;
  case 0x330:if(hw.sound==='mt32'&&mpu.uart){mpu.count++;if(mpu.events.length<500000)mpu.events.push({t:devNow(),b:v});}return;
  case 0x388:if(hw.sound==='adlib')opl.index=v;return;
  case 0x389:if(hw.sound==='adlib')oplWriteReg(opl.index,v);return;
 }
}
export function setSound(kind){
 if(!SOUNDS.includes(kind))throw Error(`Unknown sound device "${kind}" (expected ${SOUNDS.join(', ')})`);
 hw.sound=kind;oplReset();mpuReset();io.clocks=0;
}
