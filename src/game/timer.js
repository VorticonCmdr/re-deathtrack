// Timer: the 1000:a390-a3be tick helpers and the PIT channel-0 ISR with its install/slot API (1000:c356-c542).
// Slot table, user callback, phase and counter live in code-segment memory at their original CS offsets
// (docs/re/input-timer-sound.md "Timer ISR on a virtual clock"). DS = DGROUP throughout.
import {rb,wb,rw,ww,frb,fwb,frw,fww,gseg,fp} from '../engine/mem.js';
import {idle,register,callFar,callVector} from '../engine/host.js';
import {int21,outp,inp} from './bios.js';
import {F,provide} from './link.js';

const CS=gseg(0x1000);
// CS:c328 u32 counter, CS:c32c 9 far slots, CS:c350 user callback, CS:c354 phase step, CS:c355 phase.
const CNT=0xc328, SLOTS=0xc32c, UCB=0xc350, STEP=0xc354, PHASE=0xc355;
const slotPtr=n=>fp(frw(CS,SLOTS+4*n+2),frw(CS,SLOTS+4*n));
const addCounter=()=>{const lo=frw(CS,CNT)+0x1c2;fww(CS,CNT,lo);if(lo>0xffff)fww(CS,CNT+2,frw(CS,CNT+2)+1);};

// 1000:a390 timerSet: [5a9e] = n
export function f1000_a390(n){ww(0x5a9e,n);}
// 1000:a39c timerGet: AX = [5a9e]. Poll point.
export function* f1000_a39c(){yield* idle();return rw(0x5a9e);}
// 1000:a3a0 timerWait: loops while s16([5a9e]) > 0 (JG). Yields once per iteration through a39c.
export function* f1000_a3a0(){for(;;){const ax=yield* f1000_a39c();if(!((ax<<16>>16)>0))return;}}
// 1000:a3aa delayTicks(n): timerSet(n); timerWait()
export function* f1000_a3aa(n){f1000_a390(n);yield* f1000_a3a0();}
// 1000:a3be timerTickCallback: user callback CS:c350; if ([5a9e] != 0) [5a9e]--
export function f1000_a3be(){if(rw(0x5a9e)!==0)ww(0x5a9e,rw(0x5a9e)-1);}

// 1000:c356 timerIsr: INT 8 handler, called by the host through the INT 8 vector.
export function f1000_c356(){
 // c35d-c3aa: effect tick on every interrupt.
 const c=rb(0x2d2e)-1&0xff;wb(0x2d2e,c);
 if(c===0){
  wb(0x2d2e,rb(0x2d30));
  if(rw(0x365f)!==0){
   ww(0x2d26,1);
   F.f334e_0000();
   if(rw(0x2d34)!==0){
    if(rw(0x365f)!==0)ww(0x2d26,0);
    else if(rb(0x1fb2)!==0){outp(0x61,inp(0x61)|3);F.f1000_d1e8();}
   }
  }
 }
 // c3ac: AL = step, AH = phase before the add.
 const step=frb(CS,STEP),old=frb(CS,PHASE);
 fwb(CS,PHASE,old+step&0xff);
 if(old===0){addCounter();callVector(slotPtr(0));return;} // JMPF to the saved BIOS INT 8 (it sends the EOI)
 outp(0x20,0x20);
 if(old&0x1f){if(rw(0x2d26)!==0)callFar(slotPtr(8));return;} // c42c: CALLF [c34c] without a null check
 addCounter();
 const ucb=fp(frw(CS,UCB+2),frw(CS,UCB));
 if(ucb)callFar(ucb);
 const s=slotPtr((old&0xe0)>>5);
 if(s)callFar(s);
}

// 1000:c442 timerInstall: clear slots and callback, save INT 8 into slot 0, hook INT 8, PIT ch0 divisor 0x2000.
export function f1000_c442(){
 for(let i=0;i<0x12;i++)fww(CS,SLOTS+2*i,0);
 fww(CS,UCB,0);fww(CS,UCB+2,0);
 const r={ax:0x3508,bx:0,cx:0,dx:0,si:0,di:0,ds:CS,es:0};int21(r);
 fww(CS,SLOTS,r.bx);fww(CS,SLOTS+2,r.es);
 const s={ax:0x2508,bx:r.bx,cx:0,dx:0xc356,si:0,di:0,ds:CS,es:r.es};int21(s);
 outp(0x43,0x36);outp(0x40,0);
 fwb(CS,PHASE,0);fww(CS,CNT,0);fww(CS,CNT+2,0);
 outp(0x40,0x20);fwb(CS,STEP,0x20);
}
// 1000:c48d timerRestore: INT 8 = slot 0, PIT ch0 divisor 0 (65536).
export function f1000_c48d(){
 const r={ax:0x2508,bx:0,cx:0,dx:frw(CS,SLOTS),si:0,di:0,ds:frw(CS,SLOTS+2),es:0};int21(r);
 outp(0x43,0x36);outp(0x40,0);outp(0x40,0);
}
// 1000:c4ab timerGetSlot(n): DX:AX = slot n for n < 9, else 0. No callers (not a Ghidra function).
export function f1000_c4ab(n){n&=0xffff;return n<9?slotPtr(n):0;}
// 1000:c4cc timerSetSlot(n, off, seg, shift). shift is read only for n == 8 with a non-null pointer.
export function f1000_c4cc(n,off,seg,shift){
 n&=0xffff;if(n>=9)return;
 fww(CS,SLOTS+4*n,off);fww(CS,SLOTS+4*n+2,seg);
 if(n!==8)return;
 fwb(CS,PHASE,(frb(CS,PHASE)+0x1f&0xff)&0xe0);
 let ah=0x20;
 if(((off|seg)&0xffff)!==0){const cx=(shift??0)&0xffff;if(cx!==0&&cx<=5)ah=0x20>>cx;}
 fwb(CS,STEP,ah);
 outp(0x43,0x36);outp(0x40,0);outp(0x40,ah);
}
// 1000:c523 timerGetCounter: DX:AX = CS:c32a:c328. No callers.
export function f1000_c523(){return (frw(CS,CNT)|frw(CS,CNT+2)<<16)>>>0;}
// 1000:c52d timerSetUserCallback(off, seg)
export function f1000_c52d(off,seg){fww(CS,UCB,off);fww(CS,UCB+2,seg);}

export {f1000_a390 as timerSet,f1000_a39c as timerGet,f1000_a3a0 as timerWait,f1000_a3aa as delayTicks,f1000_c356 as timerIsr,f1000_c442 as timerInstall,f1000_c48d as timerRestore,f1000_c4cc as timerSetSlot};

register(0x1000,0xc356,f1000_c356,{name:'timerIsr'});
register(0x1000,0xa3be,f1000_a3be,{name:'timerTickCallback'});
provide({f1000_a390,f1000_a39c,f1000_a3a0,f1000_a3aa,f1000_a3be,f1000_c356,f1000_c442,f1000_c48d,f1000_c4ab,f1000_c4cc,f1000_c523,f1000_c52d});
