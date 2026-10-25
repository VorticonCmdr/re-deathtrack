// Segment 1ff8 input: joystick stub and readers, mouse (INT 33h), keyboard install/restore, the INT 9 handler 41ca,
// the INT 1Ch virtual-stick integrator 43a9 and the keyboard readers. Static, from the raw-byte disassembly.
// Readers listed in blocking.json are poll points: generators that start with `yield* idle()`.
import {rb,rw,rsw,wb,ww,frb,fwb,frw,fww,gseg} from '../../engine/mem.js';
import {u16,s16} from '../../engine/int.js';
import {idle,register,unsupported} from '../../engine/host.js';
import {int21,int33,inp,outp} from '../bios.js';
import {F,provide} from '../link.js';
import {f1ff8_528a} from './draw.js';

const BIOS=0x40, CS=()=>gseg(0x1ff8);

// ---- joystick ----
// 1ff8:3dd1 joyCalibrate: stub for "no joystick" (docs/re/input-timer-sound.md, Required stub). The original times
// 1000 polls of port 201h with PIT latch reads and divides by the elapsed count without a guard.
// APPROX: the 201h polls, latch reads and axis probes are skipped; [4bab] (read only by 3d5d) is set to 1.
// Both PIT channel 0 writes are kept (divisor 0, then [9bc0]), which reproduces the Alt+C rate hazard.
export function f1ff8_3dd1(){
 outp(0x43,0x36);outp(0x40,0);outp(0x40,0);
 const bx=rw(0x9bc0);outp(0x43,0x36);outp(0x40,bx&0xff);outp(0x40,bx>>8);
 ww(0x4bab,1);wb(0x4b9a,0);wb(0x4b9b,0);
 return (rb(0x4b9b)<<1|rb(0x4b9a))&0xff;
}
// 1ff8:3ee5 joyRead(stick, &x, &y): returns 0 without touching x/y when the stick is absent.
export function* f1ff8_3ee5(stick,px,py){
 yield* idle();
 if(!(stick?rb(0x4b9b):rb(0x4b9a)))return 0;
 unsupported('1ff8:3ee5 joystick hardware');return 0;
}
// 1ff8:3f62 joyDir(stick): direction bits 1 up, 2 down, 4 left, 8 right; absent stick returns AX with AL = 0.
export function* f1ff8_3f62(stick){
 yield* idle();
 if(!(stick?rb(0x4b9b):rb(0x4b9a)))return u16(stick)&0xff00;
 unsupported('1ff8:3f62 joystick hardware');return 0;
}
// 1ff8:3fc2 joyButton(b): button state (1 = pressed). Absent: AL = 0 and AH keeps the caller's AX high byte;
// APPROX: MSC callers load the argument through AX, so AH = b >> 8.
export function* f1ff8_3fc2(b){
 yield* idle();
 if(!((b&2)?rb(0x4b9b):rb(0x4b9a)))return u16(b)&0xff00;
 unsupported('1ff8:3fc2 joystick hardware');return 0;
}

// ---- mouse (INT 33h) ----
// 1ff8:3fee mouseInit: reset (AX=0) when not yet present; present flag [4bb2] = -AX (1 when the driver returns FFFFh);
// then AX=0Fh (16,16) and AX=4 (0,0). Returns AX as left by the last call.
export function f1ff8_3fee(){
 if(rb(0x4bb2))return 0;
 let r={ax:0};int33(r);const ax=u16(-r.ax);wb(0x4bb2,ax&0xff);
 if(!r.ax)return ax;
 r={ax:0xf,cx:0x10,dx:0x10};int33(r);
 r={ax:4,cx:0,dx:0};int33(r);
 return r.ax;
}
// 1ff8:4014 mouseShutdown: INT 33h AX=0 when present; returns 1, or 0 when absent.
export function f1ff8_4014(){if(!rb(0x4bb2))return 0;wb(0x4bb2,0);int33({ax:0});return 1;}
// 1ff8:4025 mouseGetPos(&x, &y): x = CX >> 1 (the driver's 640-wide space), y = DX; 0,0 without a mouse. Returns 1 or 0.
export function* f1ff8_4025(px,py){
 yield* idle();
 let ax=u16(-rb(0x4bb2)),cx=0,dx=0;
 if(rb(0x4bb2)){const r={ax:3};int33(r);ax=1;cx=r.cx>>>1;dx=r.dx;}
 ww(px,cx);ww(py,dx);return ax;
}
// 1ff8:404b mouseSetPos(x, y): AX=4 with CX = 2x, DX = y when present. Returns 1 or 0.
export function f1ff8_404b(x,y){
 if(!rb(0x4bb2))return 0;
 int33({ax:4,cx:u16(x<<1),dx:u16(y)});return 1;
}
// 1ff8:4068 mouseButton(which): AX=3; which = 0 -> BX bit 0, else BX bit 1. 0 without a mouse.
export function* f1ff8_4068(which){
 yield* idle();
 let bx=u16(-rb(0x4bb2));
 if(rb(0x4bb2)){const r={ax:3};int33(r);bx=r.bx;if(which)bx>>>=1;}
 return bx&1;
}
// 1ff8:408a mouseRaw(&ax, &bx, &cx, &dx): INT 33h pass-through. No callers (static).
export function f1ff8_408a(pa,pb,pc,pd){
 const r={ax:rw(pa),bx:rw(pb),cx:rw(pc),dx:rw(pd),es:CS()};int33(r);
 ww(pa,r.ax);ww(pc,r.cx);ww(pd,r.dx);ww(pb,r.bx);
}

// ---- keyboard ----
// 1ff8:40c7 kbdInstall(hook1c): saves INT 9/1Ch into CS:40bf..40c5, INT 9 = 1ff8:41ca, INT 1Ch = 1ff8:43a9 when
// hook1c != 0. Clears NumLock in 0040:0017 and sets CapsLock when [4bb5]. Returns [4bb4] (1).
export function f1ff8_40c7(hook1c){
 if(!rb(0x4bb4)){
  let r={ax:0x3509};int21(r);fww(CS(),0x40bf,r.bx);fww(CS(),0x40c1,r.es);
  r={ax:0x351c};int21(r);fww(CS(),0x40c3,r.bx);fww(CS(),0x40c5,r.es);
  int21({ax:0x2509,ds:CS(),dx:0x41ca});
  if(hook1c)int21({ax:0x251c,ds:CS(),dx:0x43a9});
  wb(0x4d43,0);
  if(f1ff8_528a())unsupported('1ff8:40c7 Tandy keyboard set-up (INT 15h, self-modifying fix-ups)');
  wb(0x4bb4,1);
 }
 fwb(BIOS,0x17,frb(BIOS,0x17)&0xdf);
 if(rb(0x4bb5))fwb(BIOS,0x17,frb(BIOS,0x17)|0x40);
 return rb(0x4bb4);
}
// 1ff8:418c kbdRestore: flushes the BIOS ring (head = tail) and restores INT 9 and INT 1Ch. Returns 1, or 0 if not installed.
export function f1ff8_418c(){
 if(!rb(0x4bb4))return 0;
 wb(0x4bb4,0);
 fww(BIOS,0x1a,frw(BIOS,0x1c));
 int21({ax:0x2509,ds:frw(CS(),0x40c1),dx:frw(CS(),0x40bf)});
 int21({ax:0x251c,ds:frw(CS(),0x40c5),dx:frw(CS(),0x40c3)});
 return 1;
}
// 1ff8:41ca int9Handler (ISR, IRET; never chains to the BIOS). Per-scancode state DS:4cb4[0x59] (bit 0 held, bit 2
// letter, bit 3 stick index, bits 4-7 stick direction), unshifted/shifted ASCII tables DS:4c02/4c5b, BIOS ring 001e-003c.
export function f1ff8_41ca(){
 let al=inp(0x60)&0xff;
 const p61=inp(0x61)&0xff;outp(0x61,p61|0x80);outp(0x61,p61);
 if(rb(0x385c)===1)unsupported('1ff8:41ca Tandy scancode remapping');
 const sc=al&0x7f;
 if(sc>=0x59){outp(0x20,0x20);return;}
 const old=rb(0x4cb4+sc);
 wb(0x4cb4+sc,(old&(0xfe|al>>7))^1);
 if(rb(0x4d43)===1)unsupported('1ff8:41ca Tandy keyboard keys');
 if(al&0x80){
  if(old&0xf8){const di=old>>3&1,cl=old>>4;if(rb(0x4bb8+di)===cl)wb(0x4bb8+di,0);}
  ww(0x4bb6,0);
  let a=rb(0x4c02+sc);
  if((a&0x80)&&!(a&0x70))fwb(BIOS,0x17,frb(BIOS,0x17)&(a^0x7f));
  outp(0x20,0x20);return;
 }
 if(old&0xf8)wb(0x4bb8+(old>>3&1),old>>4);
 let a=rb(0x4c02+sc);
 if(a&0x80){
  a&=0x7f;
  if(!(a&0x70))fwb(BIOS,0x17,frb(BIOS,0x17)|a);
  else if(!((a&0x40)&&rb(0x4bb5))&&!(old&1))fwb(BIOS,0x17,frb(BIOS,0x17)^a);
  outp(0x20,0x20);return;
 }
 const sh=frb(BIOS,0x17);
 if(sh&4){a|=0x80;if(old&4)a=(a-0x20)&0xff;}
 else if((sh&0x40)&&(old&4))a=(a-0x20)&0xff;
 else if(sh&3)a=rb(0x4c5b+sc);
 const ax=sc<<8|a;ww(0x4bb6,ax);
 // QUIRK: "full" is tested as tail == next(head), so a key is dropped whenever exactly one key is pending
 // (docs/re/input-timer-sound.md, Input step 5). The ring bounds 1e..3c are hard-coded here.
 const head=frw(BIOS,0x1a);let di=frw(BIOS,0x1c),full;
 if(head===0x3c)full=di===0x1e;else full=u16(head+2)===di;
 if(!full){fww(BIOS,di,ax);if(di===0x3c)di=0x1c;di+=2;fww(BIOS,0x1c,di);}
 if((ax>>8)===0x20&&(frb(BIOS,0x17)&4)){outp(0x20,0x20);return;}
 if(ax===0x019b&&(frb(BIOS,0x17)&4)){
  // Ctrl+Esc: undo the last ring word (QUIRK: when the key was dropped this clears the previous one), flush, fatal exit.
  di-=2;if(di===0x1c)di=0x3c;fww(BIOS,di,0);fww(BIOS,0x1a,frw(BIOS,0x1c));
  outp(0x20,0x20);F.f1000_044a(0);return;
 }
 outp(0x20,0x20);
}
// 1ff8:43a9 int1cVirtualStick (ISR, IRET, no chain): integrates the stick directions DS:4bb8[0..1] into the axes
// DS:4d0d/4d0f (x) and 4d11/4d13 (y), saturating at +-0x7f, step [4d19], via the direction table DS:4d1b.
// Its output has no readers (static).
export function f1ff8_43a9(){
 const step=rw(0x4d19);
 for(let si=2;si>=0;si-=2){
  const d=rb(0x4bb8+(si>>1));let bl=(d-1)&0xff;
  if(bl&0x80){if(rw(0x4d15+si)){ww(0x4d0d+si,0);ww(0x4d11+si,0);}continue;}
  if(bl===8){ww(0x4d0d+si,0);ww(0x4d11+si,0);continue;}
  bl=rb(0x4d1b+bl);
  const axis=(o,bits)=>{ // bits: current BL after the test shift; sign from its bit 7
   const v=rsw(o),cur=v<0?-1:0,mag=u16(Math.abs(v)),want=(bits&0x80)?-1:0,dx=want^cur;
   let ax=s16(((step^dx)&0xffff)-(dx&0xffff)+mag);
   if(ax>0x7f)ax=0x7f;
   ww(o,((ax^cur)-cur)&0xffff);
  };
  let cf=bl&0x80;bl=bl<<1&0xff;
  if(cf){const ah=bl;bl=bl<<1&0xff;axis(0x4d0d+si,ah);}
  cf=bl&0x80;bl=bl<<1&0xff;
  if(cf)axis(0x4d11+si,bl);
 }
}
// 1ff8:4457 kbdGetKey: dequeues one BIOS ring word (scan<<8 | ascii) using the ring bounds at 0040:0080/0082; 0 if empty.
export function* f1ff8_4457(){
 yield* idle();
 let bx=frw(BIOS,0x1a);
 if(bx===frw(BIOS,0x1c))return 0;
 const ax=frw(BIOS,bx);bx=u16(bx+2);if(bx===frw(BIOS,0x82))bx=frw(BIOS,0x80);fww(BIOS,0x1a,bx);
 return ax;
}
// 1ff8:4486 kbdStickDir(stick): DS:4d23[DS:4bb8[stick != 0]]: bit 1 up, 2 down, 4 left, 8 right (AH = 0).
export function* f1ff8_4486(stick){
 yield* idle();
 return rb(0x4d23+rb(0x4bb8+(u16(stick)?1:0)));
}
// 1ff8:44a0 kbdIsHeld(sc): DS:4cb4[sc] & 1 (no bounds check).
export function* f1ff8_44a0(sc){
 yield* idle();
 return rb(0x4cb4+u16(sc))&1;
}
export {f1ff8_4457 as kbdGetKey,f1ff8_44a0 as kbdIsHeld,f1ff8_4486 as kbdStickDir,f1ff8_41ca as int9Handler,
 f1ff8_4025 as mouseGetPos,f1ff8_4068 as mouseButton};
provide({f1ff8_3dd1,f1ff8_3ee5,f1ff8_3f62,f1ff8_3fc2,f1ff8_3fee,f1ff8_4014,f1ff8_4025,f1ff8_404b,f1ff8_4068,f1ff8_408a,
 f1ff8_40c7,f1ff8_418c,f1ff8_41ca,f1ff8_43a9,f1ff8_4457,f1ff8_4486,f1ff8_44a0});
// Interrupt vector targets installed by 40c7.
register(0x1ff8,0x41ca,f1ff8_41ca);
register(0x1ff8,0x43a9,f1ff8_43a9);
