// Segment 2524: game UI glue. Title/TTM player, credits, attract script, sound glue, hardware init,
// shop/inventory helpers, file picker, transitions. Translated function by function from the disassembly.
// Analysis: docs/re/gameflow.md, docs/re/input-timer-sound.md, docs/re/resources.md (TTM), docs/re/race.md.
//
// Conventions used in this module:
// - Parameters are one JS parameter per 16-bit word the original pushes, in C order. A far pointer
//   parameter is therefore (off, seg) and a long parameter (lo, hi), as in timer.js/sfx.js.
// - Return values: 16-bit numbers; far pointers and longs (DX:AX) as one packed 32-bit number.
// - Generators exactly per src/game/blocking.json (0534 0584 0624 0720 0bb6 0bee 0c34 0c66 3c2c 4584
//   4612 469a 478a 4850). Calls into them use yield*.
// - Cross-module calls go through F (link.js), within the module directly.
import {rb,rsb,wb,rw,rsw,ww,rd,frb,frw,fwb,fww,fp,pseg,poff,gseg,gaddr,DGROUP,salloc,sfree,strAt} from '../engine/mem.js';
import {s8,u8,s16,u16,u32,imul16} from '../engine/int.js';
import {unsupported,register,callFar,callFarG} from '../engine/host.js';
import {int21,outp,inp,vstatus} from './bios.js';
import {F,provide} from './link.js';

const CS=gseg(0x2524);
// Test/diagnostic hooks. ttmUnknown(op) is called when the TTM interpreter meets an opcode it does not
// handle (it then ends the script with 0, as the original does at 2524:1109).
export const hooks={ttmUnknown:null};

// QUIRK: 2524:010f/0124/01d0 (fatal paths of loadFonts/loadBitmaps) use a NEAR call to 2524:033c, which is the
// middle of an instruction inside 2524:0260 (bytes 52 92 ...). It looks like a near/far fixup defect of the
// original fatal handler (1000:0344). Executing it is undefined, so the port reports it.
function nearCall033c(msg){unsupported(`2524:033c near call on a fatal path: "${strAt(msg)}"`);}

// 2524:0008 computeSpriteAnchors: anchors for frames 0..12 of the bitmap set [9a80].
export function f2524_0008(){
 let si=0,di=0;
 for(;si<4;si++,di+=2)f2524_0054(si,rw(rw(0x9a80)+di&0xffff));
 for(si=4,di=8;si<0xd;si++,di+=2)f2524_007a(si,rw(rw(0x9a80)+di&0xffff));
}
// 2524:0054 anchorCentre(i, frameRec): [990a+2i] = -(w>>1), [999e+2i] = -(h>>1) (SAR then NEG).
export function f2524_0054(i,rec){
 const si=u16(i<<1);
 ww(si+0x990a,-(rsw(rec+6)>>1));
 ww(si+0x999e,-(rsw(rec+8)>>1));
}
// 2524:007a anchorBottom(i, frameRec): [990a+2i] = -(w>>1), [999e+2i] = -h.
export function f2524_007a(i,rec){
 const si=u16(i<<1);
 ww(si+0x990a,-(rsw(rec+6)>>1));
 ww(si+0x999e,-rsw(rec+8));
}
// 2524:009e loadFonts: fonts.blk -> [8e72] (4x5), [8e98] (6x6), [8eb4] (8x8); selects [8eb4].
export function f2524_009e(){
 f2524_2be8(0x138);
 const f=F.f1ff8_4a48(0x99ec);
 if(u16(f)!==0){
  ww(0x8e72,F.f1ff8_356e(f));
  ww(0x8e98,F.f1ff8_356e(f));
  ww(0x8eb4,F.f1ff8_356e(f));
  F.f1ff8_4da4(f);
  if(rw(0x8e72)===0||rw(0x8e98)===0||rw(0x8eb4)===0)nearCall033c(0x142);
  F.f1ff8_3692(rw(0x8eb4));
 }else nearCall033c(0x163);
}
// 2524:012e loadBitmaps: bitmaps.blk -> [965a], [9a80], [9aea], [9bbe], [8dc0].
export function f2524_012e(){
 f2524_2be8(0x184);
 const f=F.f1ff8_4a48(0x99ec);
 if(u16(f)===0){nearCall033c(0x1b4);return;}
 ww(0x965a,F.f1ff8_0006(f));
 ww(0x9a80,F.f1ff8_0006(f));
 ww(0x9aea,F.f1ff8_0006(f));
 ww(0x9bbe,F.f1ff8_0006(f));
 ww(0x8dc0,F.f1ff8_0006(f));
 F.f1ff8_4da4(f);
 if(rw(0x965a)===0||rw(0x9a80)===0||rw(0x9aea)===0||rw(0x9bbe)===0||rw(0x8dc0)===0)nearCall033c(0x190);
}
// 2524:01da loadTraxMusic: heap compaction call, 128 KiB DOS-memory probe; trax.mus or music off.
export function f2524_01da(){
 F.f1000_c272(0xffff);
 const p=F.f1ff8_3a88(0,2,1)>>>0; // DosAlloc(0x20000); the third pushed word (1) is ignored by the callee
 if(p!==0){
  F.f1ff8_3ae2(poff(p),pseg(p));
  f2524_2be8(0x1d7);
  const m=f2524_4b34(0x99ec)>>>0;
  ww(0x8f02,poff(m));ww(0x8f04,pseg(m));
  return;
 }
 f2524_4c8a(rw(0x8f06),rw(0x8f08));
 ww(0x8f06,0);ww(0x8f08,0);ww(0x8f02,0);ww(0x8f04,0);ww(0x1fb2,0);
}
// 2524:0260 hardwareInit: page setup, keyboard ISR, mouse, clip, INT 24h handler, joystick calibration,
// then the sound timer and the tick callback (this order: 1ff8:3dd1 runs before the timer install,
// docs/re/input-timer-sound.md "Keyboard" row 2524:0260).
export function f2524_0260(){
 F.f2f73_05d8();
 F.f1ff8_40c7(1);
 F.f1ff8_3af2();
 if(rb(0x385d)===4){
  unsupported('2524:0285 Tandy pointer limits'); // [1fc2]=0x128, [1fc4]=0xc5
 }else ww(0xaa9a,F.f1ff8_3fee());
 f2524_3ada();
 wb(0x384b,1);wb(0x384c,1);
 ww(0x3843,0);ww(0x3847,0);ww(0x3849,0xc7);ww(0x3845,0x13f);
 wb(0x384f,0xf);
 ww(0x3858,rw(0x3852));ww(0x3856,rw(0x3854));
 if(rw(0x1fc0)!==0)F.f1ff8_3dd1();
 f2524_4956(0xd);
 f2524_4942(0xa3be,gseg(0x1000),0xd);
 if(rb(0x385d)===1||rb(0x385d)===4){
  unsupported('2524:030a CGA/Tandy dither tables'); // [896c]=1, DS:1cf0/1cdc/9252.. tables
  return;
 }
 ww(0x896c,0);
}
// 2524:0382 menuMusicKeepAlive: restart danger.mus when the sequencer is idle.
export function f2524_0382(){
 if(u16(f2524_4cd4())===0)f2524_03f2(rw(0x8f06),rw(0x8f08));
}
// 2524:039c toggleMusic
export function f2524_039c(){
 if((rw(0x8f06)|rw(0x8f08))===0){ww(0x1fb2,0);return;}
 if(rw(0x1fb2)!==0){ww(0x1fb2,0);f2524_4cbc();return;}
 ww(0x1fb2,1);
 if(s16(f2524_4b00())<=2)F.f1000_c54a();
 f2524_4cc2();
}
// 2524:03dc toggleEffects: [1fb0] = [1fb0] ? 0 : 1
export function f2524_03dc(){ww(0x1fb0,rw(0x1fb0)!==0?0:1);}
// 2524:03f2 playMusic(off, seg): stop; play if music is on and the pointer is not null.
export function f2524_03f2(off,seg){
 f2524_4cb6();
 if(rw(0x1fb2)!==0&&((off|seg)&0xffff)!==0)f2524_4c9e(off,seg);
}
// 2524:041a playEffect(n): if effects are on and the bank is loaded.
export function f2524_041a(n){
 if(rw(0x1fb0)!==0&&rw(0x8f9c)!==0)f2524_4cfa(n,1);
}
// 2524:043c parseCmdline(argc, argv): DEMO, G<adapter>, J<n>, M<n>/T<n>, S<n>; then adapter detection.
// QUIRK: the digit is the raw second character minus '0' (CBW), so a bare "M" gives 0xffd0.
export function f2524_043c(argc,argv){
 ww(0x95d6,0xf);
 if(s16(argc)>1){
  let di=u16(argv+2),n=u16(argc-1);
  for(;;){
   const si=rw(di);
   if(u16(F.f1000_c132(si,0x1f4))===0)ww(0x1fa8,1);
   else{
    const c1=rb(si+1),up=c1&0x5f;
    switch(rb(si)&0x5f){
     case 0x47:
      if(up===0x43)ww(0x95d6,1);else if(up===0x45)ww(0x95d6,2);
      else if(up===0x48)ww(0x95d6,8);else if(up===0x54)ww(0x95d6,4);
      break;
     case 0x4a:ww(0x1fc0,s8(c1)-0x30);break;
     case 0x4d:case 0x54:ww(0x1fb2,s8(c1)-0x30);break;
     case 0x53:ww(0x1fb0,s8(c1)-0x30);break;
    }
   }
   di=u16(di+2);n=u16(n-1);
   if(n===0)break;
  }
 }
 ww(0x95d6,F.f1ff8_20ff(0,rw(0x95d6)));
}
// 2524:0534 anyInputPending: a key with ASCII != 0 (OR AL,AL: extended keys are dequeued but do not count),
// mouse button 0/1, or joystick button 0/1.
export function* f2524_0534(){
 if((yield* F.f1ff8_4457())&0xff)return 1;
 if(u16(yield* F.f1ff8_4068(0)))return 1;
 if(u16(yield* F.f1ff8_4068(1)))return 1;
 if(u16(yield* F.f1ff8_3fc2(0)))return 1;
 if(u16(yield* F.f1ff8_3fc2(1)))return 1;
 return 0;
}
// 2524:0584 playTitleTtm: TITLE.TTM, one step per call of 0bb6 until it returns 0. Returns 1 on input.
export function* f2524_0584(){
 f2524_089c();
 f2524_2be8(0x1fa);
 const slot=f2524_08de(0x99ec);
 f2524_0a7c(slot);
 let si=0;
 for(;;){
  const r=yield* f2524_0bb6(si);si=u16(si+1);
  if(u16(r)===0)break;
  f2524_0382();
  if(u16(yield* f2524_0534())!==0||rw(0x8eba)!==0){ww(0x8eba,1);return 1;}
 }
 f2524_120e();
 f2524_1292(slot);
 f2524_14a2();
 F.f1000_c272(0xffff);
 ww(0x3843,0);ww(0x3847,0);ww(0x3849,0xc7);ww(0x3845,0x13f);
 return 0; // AX from the final SUB AX,AX
}
// 2524:0624 demoScriptStep: one character of the attract script DS:18d2 (0x4e chars, index [1faa]).
export function* f2524_0624(){
 const op=rsb(rw(0x1faa)+0x18d2);
 switch(op){
  case 0x44:yield* f2524_4584();break;                       // 'D' next button
  case 0x45:ww(0x8dae,0x7d);break;                            // 'E' press for 125 polls
  case 0x39:{                                                  // '9' (rand+1) mod 9 times next
   // The high word is pushed as 0 explicitly (2524:0673), then 1000:c0a8 = unsigned long mod.
   let n=u16(F.f1000_c144()+1);
   n=u16(F.f1000_c0a8(n,0,9,0));
   if(n>=1){let si=n;do{yield* f2524_4584();si=u16(si-1);}while(si!==0);}
   break;
  }
  case 0x58:yield* f2524_3c2c(0xa0,0x82,0);break;            // 'X' pointer to (160,130)
  case 0x57:for(let si=0x12c;;){yield* F.f1000_a3aa(1);si--;if(si===0)break;}break; // 'W'
  case 0x24:for(let si=9;si;si--)yield* f2524_4584();         // '$' 9x next, then falls into '#'
  // fall through
  case 0x23:for(let si=10;si;si--)yield* f2524_4584();break;  // '#' 10x next
 }
 ww(0x1faa,rw(0x1faa)+1);
 if(rw(0x1faa)===0x4e)ww(0x1faa,0);
}
// 2524:0720 creditsScroll: 0x55 lines from DS:0530 scrolled up 2 px per pass in (10,10,300,135).
// Returns 1 (and [8eba]=1) on input, 0 when the offset passes -600.
export function* f2524_0720(){
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3850));
 F.f1ff8_2545(0,0,0x140,0xc8);
 wb(0x3842,1);
 ww(0x3849,0xa0);
 let top=0xb4;
 for(;;){
  ww(0x3858,rw(0x3852));
  F.f1ff8_3810(10,10,0x12c,0x87);
  f2524_0382();
  let tp=0x530,y=top,tp2=0x530;
  for(let n=0x55;n;n--){
   let si=rw(tp);
   wb(0x3840,rb(si)===0x40?0xb:3);
   const di=s16(y);
   if(di<0xc8&&di>0){
    if(rb(si)===0x7e){
     F.f1ff8_3692(rw(0x8e98));
     si=u16(si+1);
     const len=F.f1000_c058(si);
     const half=s16(len*6)>>1;                          // (len*3)<<1, SAR 1
     F.f1ff8_23ba(u16(rw(tp2)+1),u16(0xa0-half),di);
    }else{
     F.f1ff8_3692(rw(0x8eb4));
     if(rb(si)===0x40)si=u16(si+1);
     const half=s16(F.f1000_c058(si)<<3)>>1;
     F.f1ff8_23ba(si,u16(0xa0-half),di);
    }
   }
   tp=u16(tp+2);y=u16(y+8);tp2=u16(tp2+2);
  }
  ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
  F.f1ff8_2545(10,10,0x12c,0x87);
  if(u16(yield* f2524_0534())!==0){ww(0x8eba,1);return 1;}
  top=s16(top-2);
  if(top<=-0x258)break;
 }
 ww(0x3843,0);ww(0x3847,0);ww(0x3849,0xc7);ww(0x3845,0x13f);
 return 0;
}
// 2524:089c ttmReset: dirty-rect buffers, the 5 script slots, [578c]=-1, then allocate and swap rect lists.
export function f2524_089c(){
 ww(0x616,0);ww(0x614,0);
 for(let i=0;i<5;i++){ww(0x5e4+2*i,0);ww(0x5da+2*i,0);}
 ww(0x578c,0xffff);
 f2524_12b0();
 f2524_136a();
}
// 2524:08de loadTtm(fpOrName): TTM: leaf into a near heap buffer; registered in the first free of 5 slots.
// Returns the slot, -1 on a failed open/seek/stream, or 0 when the heap or the table is full.
// QUIRK: with all 5 slots used it returns 0 and leaks the buffer (docs/re/resources.md).
export function f2524_08de(name){
 let f,own;
 if(u16(F.f1ff8_4de0(name))===0){f=F.f1ff8_4a48(name);own=1;}else{f=name;own=0;}
 if(u16(f)===0)return 0xffff;
 if((F.f1ff8_4ade(f,0x618,0)>>>0)===0xffffffff){if(own)F.f1ff8_4da4(f);return 0xffff;}
 const len=F.f1ff8_4d72(f)>>>0;
 const h=F.f1ff8_0d47(0xffff,f,0x61d,len&0xffff,len>>>16);
 if(s16(h)<0){if(own)F.f1ff8_4da4(f);return h;}
 const size=F.f1ff8_1310(h)&0xffff;
 const buf=u16(F.f1000_c272(size));
 if(buf===0){F.f1ff8_100d(h);if(own)F.f1ff8_4da4(f);return 0;}
 const got=u16(F.f1ff8_11f0(h,buf,DGROUP,size));
 F.f1ff8_100d(h);
 if(own)F.f1ff8_4da4(f);
 if(got!==size){
  // QUIRK: closes the stream and the chunk file a second time, frees the buffer, returns -1 (via 0952).
  F.f1ff8_100d(h);
  if(own)F.f1ff8_4da4(f);
  F.f1000_c280(buf);
  return 0xffff;
 }
 for(let cx=0;cx<5;cx++){
  if(rw(0x5da+2*cx)===0){ww(0x5da+2*cx,buf);ww(0x5e4+2*cx,size+buf-1);return cx;}
 }
 return 0;
}
// 2524:0a7c ttmIndex(slot): split the script into parts at '/' into DS:5790[0..299].
// Returns 1, 0 for an empty slot, or -1 at a byte it cannot size. Byte compares are signed (JL/JLE).
export function f2524_0a7c(slot){
 const bx=u16(slot<<1);
 if(rw(bx+0x5da)===0)return 0;
 const start=rw(bx+0x5da);
 for(let i=0;i<0x12c;i++)ww(0x5790+2*i,0);
 let dx=0;
 const end=rw(bx+0x5e4);
 let tab=0x5790,di=start,si;
 for(;;){
  ww(tab,di);
  si=di;
  for(;;){
   if(!(end>si))return 1;                                  // CMP CX,SI / JA (unsigned)
   const b=rsb(si);
   if((b>=0x31&&b<=0x34)||(b>=1&&b<=9)||b===0x37||b===0x6c){
    while(rb(si)!==0)si=u16(si+1);                          // opcode + NUL-terminated string
    si=u16(si+1);continue;
   }
   if(b===0x2b||b===0x3a||b===0x23||b===0x68||b===0x72||b<=0xd){si=u16(si+1);continue;}
   if(b===0x2d||b===0x26||b===0x24||b===0x40||b===0x3b||b===0x38||b===0x39||b===0x60){si=u16(si+3);continue;}
   if(b===0x2a||b===0x5e){si=u16(si+5);continue;}
   if((b>=0x42&&b<=0x5c)||b===0x3f){si=u16(si+9);continue;}
   if(b===0x2f)break;
   return 0xffff;
  }
  si=u16(si+1);di=si;
  tab=u16(tab+2);dx++;
  if(dx>=0x12c)return 1;
 }
}
// 2524:0bb6 ttmStep(entry): restore dirty rects, run one part, present and run the part's delays.
export function* f2524_0bb6(entry){
 f2524_0bd8();
 const r=yield* f2524_0bee(entry);
 yield* f2524_0c34();
 return r;
}
// 2524:0bd8 ttmBeginFrame
export function f2524_0bd8(){
 f2524_1392();
 f2524_136a();
 ww(0x578a,rw(0x9234));
 ww(0x5ee,0);
}
// 2524:0bee ttmRunEntry(entry): 0 when the entry is out of range or empty, else ttmRun(entry).
export function* f2524_0bee(entry){
 if(rw(0x5ee)!==0)f2524_0bd8();
 const e=s16(entry);
 if(e>=0x12c||e<0||rw(0x5790+(u16(e<<1)))===0)return 0;
 return yield* f2524_0c66(entry);
}
// 2524:0c34 ttmPresentAndDelay: present dirty rects, then delayTicks([59e8]) and delayTicks([5782]).
export function* f2524_0c34(){
 f2524_13e2();
 ww(0x5ee,1);
 if(rw(0x59e8)!==0)yield* F.f1000_c070(rw(0x59e8));
 if(rw(0x5782)!==0)yield* F.f1000_c070(rw(0x5782));
}
// 2524:0c66 ttmRun(entry): TTM interpreter for one part (until '/'). Opcodes are ASCII bytes; ops 'A'..'\\'
// take 4 words and first record a dirty rectangle. Returns 1 at '/', 0 at any unhandled opcode.
export function* f2524_0c66(entry){
 let op=0;
 let p=rw(0x5790+u16(entry<<1));
 for(;;){
  if(op===0x2f){                                            // 11d8: part finished
   if(rw(0x59f2)!==0){
    ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
    F.f1ff8_2545(0,0,0x140,0xc8);
    ww(0x59f2,0);
   }
   return 1;
  }
  ww(0x3858,rw(0x3852));ww(0x3856,rw(0x3852));
  op=rsb(p);p=u16(p+1);
  const a=p;
  let w0=rw(p),w1=rw(p+2),w2=rw(p+4),w3=rw(p+6);          // read even for ops without operands
  if(op>=0x41&&op<=0x5c){
   p=u16(p+8);
   if(op===0x44||op===0x43)f2524_12e6(u16(w0-0x14),w1,u16(w2+0x30),u16(w3+1));
   else if(op!==0x4c)f2524_12e6(w0,w1,u16(w2+8),u16(w3+2));
   else{
    const x=s16(w0)>s16(w2)?w2:w0, y=s16(w1)>s16(w3)?w3:w1;
    const dx=Math.abs(s16(w0-w2)), dy=Math.abs(s16(w1-w3)); // CWD/XOR/SUB: |0x8000| stays 0x8000
    f2524_12e6(x,y,u16(dx+8),u16(dy+2));
   }
  }
  const skipStr=()=>{while(rb(p)!==0)p=u16(p+1);p=u16(p+1);};
  switch(op){
   case 0x37:                                               // '7' name: load palette into the current slot
    skipStr();
    F.f1ff8_3ca6(rw(0x59ee));
    f2524_2be8(a);
    ww(0x59ee,F.f1ff8_3b7a(0x99ec));
    F.f1ff8_3c64(rw(0x59ee));
    ww(0x5fc+u16(rw(0x578e)<<1),rw(0x59ee));
    continue;
   case 0x42:F.f1ff8_2541(rw(0x9a9a),w0,w1);continue;     // 'B' x,y: draw the selected frame
   case 0x38:                                               // '8' n: select bitmap slot
    p=u16(p+2);ww(0x5786,w0);
    ww(0x9234,rw(0x608+u16(w0<<1)));ww(0x578a,rw(0x9234));
    continue;
   case 0x39:                                               // '9' n: select palette slot
    p=u16(p+2);ww(0x578e,w0);
    ww(0x59ee,rw(0x5fc+u16(w0<<1)));
    F.f1ff8_3c64(rw(0x59ee));
    continue;
   case 0x3b:p=u16(p+2);ww(0x5788,w0);continue;           // ';' n
   case 0x3f:                                               // '?' x0,y0,x1,y1: clip rectangle
    ww(0x3843,w0);ww(0x3847,w1);ww(0x3845,w2);ww(0x3849,w3);
    continue;
   case 0x40:p=u16(p+2);ww(0x9a9a,rw(u16(rw(0x578a)+u16(w0<<1))));continue; // '@' n: select frame n
   case 0x4c:F.f1ff8_2454(w0,w1,w2,w3);continue;          // 'L' line
   case 0x43:{                                              // 'C' x,y,_,d: circle outline at (x+r,y+r)
    w3=s16(w3)>>1;w0=u16(w0+w3);w1=u16(w1+w3);
    F.f1ff8_3194(u16(w3),w0,w1);continue;
   }
   case 0x44:{                                              // 'D' x,y,_,d: filled circle ([384c]=0 around it)
    w3=s16(w3)>>1;w0=u16(w0+w3);w1=u16(w1+w3);
    wb(0x384c,0);F.f1ff8_3194(u16(w3),w0,w1);wb(0x384c,1);continue;
   }
   case 0x52:                                               // 'R' x,y,w,h: fill rectangle
    if(rb(0x384d)===3){
     if(rw(0x896c)!==0){F.f1000_c03e(0,0,0x140,0x64,5);F.f1000_c03e(0,0x64,0x140,0x64,5);}
     else F.f1ff8_3810(0,0,0x140,0xc8);
    }else F.f1ff8_3810(w0,w1,w2,w3);
    continue;
   case 0x53:wb(0x384c,0);F.f1ff8_3810(w0,w1,w2,w3);wb(0x384c,1);continue; // 'S'
   case 0x5e:p=u16(p+4);wb(0x384e,w0);wb(0x3840,w0);wb(0x384d,w1);continue; // '^' fg,bg colours
   case 0x60:                                               // '`' n: select font slot
    p=u16(p+2);ww(0x59f0,w0);
    ww(0x5784,rw(0x5f0+u16(w0<<1)));
    F.f1ff8_3692(rw(0x5784));
    continue;
   case 0x26:p=u16(p+2);F.f1ff8_3cf1(w0);continue;        // '&' n: border colour
   case 0x2a:p=u16(p+4);yield* f2524_4850();continue;      // '*' Activision logo
   case 0x2b:f2524_14d4();continue;                         // '+' present the page
   case 0x2d:p=u16(p+2);continue;                           // '-' n: no operation
   case 0x31:                                               // '1' name: screen
    skipStr();f2524_2be8(a);F.f1ff8_2fca(0x99ec);f2524_14d4();continue;
   case 0x32:                                               // '2' name: bitmap into the current slot
    skipStr();
    F.f1ff8_0476(rw(0x9234));
    f2524_2be8(a);
    ww(0x9234,F.f1ff8_0006(0x99ec));ww(0x578a,rw(0x9234));
    ww(0x608+u16(rw(0x5786)<<1),rw(0x9234));
    continue;
   case 0x34:                                               // '4' name: font into the current slot
    skipStr();
    if(rw(0x5784)!==0)F.f1ff8_3722(rw(0x5784));
    f2524_2be8(a);
    ww(0x5784,F.f1ff8_356e(0x99ec));
    ww(0x5f0+u16(rw(0x59f0)<<1),rw(0x5784));
    continue;
   case 0x0b:                                               // free the current palette slot
    F.f1ff8_3ca6(rw(0x5fc+u16(rw(0x578e)<<1)));
    ww(0x59ee,0);ww(0x5fc+u16(rw(0x578e)<<1),0);continue;
   case 0x0c:                                               // free the current bitmap slot
    F.f1ff8_0476(rw(0x608+u16(rw(0x5786)<<1)));
    ww(0x9234,0);ww(0x608+u16(rw(0x5786)<<1),0);continue;
   case 0x0d:                                               // free the current font slot
    F.f1ff8_3722(rw(0x5f0+u16(rw(0x59f0)<<1)));
    ww(0x5784,0);ww(0x5f0+u16(rw(0x59f0)<<1),0);continue;
   case 0x23:F.f1ff8_44b4(0,0,0x140,0xc8,1);continue;     // '#' whole screen
   case 0x24:p=u16(p+2);ww(0x59e8,w0);continue;           // '$' n: per-step delay
  }
  if(op>=0x47&&op<=0x51){f2524_1528(w0,w1,w2,w3,op);continue;} // 'G'..'Q' transitions
  if(op===0x2f)continue;
  hooks.ttmUnknown?.(op);
  return 0;
 }
}
// 2524:120e ttmFreeResources: free the 6 font, bitmap and palette slots; reset the slot indices.
export function f2524_120e(){
 ww(0x59f0,0);ww(0x578e,0);ww(0x5786,0);
 for(let i=0;i<6;i++){
  const si=0x5f0+2*i,di=0x608+2*i,bx=0x5fc+2*i;
  if(rw(si)!==0){F.f1ff8_3722(rw(si));ww(si,0);}
  if(rw(di)!==0){F.f1ff8_0476(rw(di));ww(di,0);}
  if(rw(bx)!==0){F.f1ff8_3ca6(rw(bx));ww(bx,0);}
 }
}
// 2524:1292 ttmFreeScript(slot)
export function f2524_1292(slot){
 const si=u16(u16(slot<<1)+0x5da);
 F.f1000_c280(rw(si));
 ww(si,0);
}
// 2524:12b0 ttmAllocRects: two 100-entry rect lists [614]/[616] (0x320 bytes each), counts cleared.
export function f2524_12b0(){
 if(rw(0x614)===0)ww(0x614,F.f1000_c272(0x320));
 if(rw(0x616)===0)ww(0x616,F.f1000_c272(0x320));
 ww(0x59ea,0);ww(0x59ec,0);
}
// 2524:12e6 ttmAddRect(x,y,w,h): clip to 320x200 and append to list [614] (count [59ea], no bound check).
export function f2524_12e6(x,y,w,h){
 x=s16(x);y=s16(y);w=s16(w);h=s16(h);
 if(x<0){w=s16(w+x);x=0;}
 if(y<0){h=s16(h+y);y=0;}
 if(s16(x+w)>0x140)w=s16(0x140-x);
 if(s16(y+h)>0xc8)h=s16(0xc8-y);
 if(w===0||h===0)return;
 const si=u16(u16(rw(0x59ea)<<3)+rw(0x614));
 ww(si,x);ww(si+2,y);ww(si+4,w);ww(si+6,h);
 ww(0x59ea,rw(0x59ea)+1);
}
// 2524:136a ttmSwapRects: swap the lists; previous count = current count; current count = 0.
export function f2524_136a(){
 const t=rw(0x616);ww(0x616,rw(0x614));ww(0x614,t);
 ww(0x59ec,rw(0x59ea));ww(0x59ea,0);
}
// 2524:1392 ttmRestoreRects: copy each current rect from page [3850] to page [3852].
export function f2524_1392(){
 ww(0x3856,rw(0x3850));ww(0x3858,rw(0x3852));
 for(let i=0,di=0;s16(rw(0x59ea))>0&&i<s16(rw(0x59ea));i++,di+=8){
  const si=u16(di+rw(0x614));
  F.f1ff8_2545(rw(si),rw(si+2),rw(si+4),rw(si+6));
 }
}
// 2524:13e2 ttmPresentRects: copy current and previous rects from page [3852] to page [3854]; previous count 0.
export function f2524_13e2(){
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
 for(let i=0,di=0;s16(rw(0x59ea))>0&&i<s16(rw(0x59ea));i++,di+=8){
  const si=u16(di+rw(0x614));
  F.f1ff8_2545(rw(si),rw(si+2),rw(si+4),rw(si+6));
 }
 for(let i=0,di=0;s16(rw(0x59ec))>0&&i<s16(rw(0x59ec));i++,di+=8){
  const si=u16(di+rw(0x616));
  F.f1ff8_2545(rw(si),rw(si+2),rw(si+4),rw(si+6));
 }
 ww(0x59ec,0);
}
// 2524:146c ttmMoveRect: pop the last current rect and push it onto the previous list.
export function f2524_146c(){
 if(rw(0x59ea)===0)return;
 ww(0x59ea,rw(0x59ea)-1);
 const src=u16(u16(rw(0x59ea)<<3)+rw(0x614));
 const dst=u16(u16(rw(0x59ec)<<3)+rw(0x616));
 for(let i=0;i<8;i+=2)ww(dst+i,rw(src+i));
 ww(0x59ec,rw(0x59ec)+1);
}
// 2524:14a2 ttmFreeRects: free both lists, heap compaction call, counts 0, free the resources.
export function f2524_14a2(){
 F.f1000_c280(rw(0x614));
 F.f1000_c280(rw(0x616));
 F.f1000_c272(0xffff);
 ww(0x59ea,0);ww(0x59ec,0);
 f2524_120e();
}
// 2524:14d4 ttmPresentPage: copy page [3852] to [3850] (blit dst/src saved), move all rects to the
// previous list, [59f2]++.
export function f2524_14d4(){
 const d=rw(0x3856),s=rw(0x3858);
 ww(0x3858,rw(0x3850));ww(0x3856,rw(0x3852));
 F.f1ff8_2545(0,0,0x140,0xc8);
 ww(0x3856,d);ww(0x3858,s);
 while(rw(0x59ea)!==0)f2524_146c();
 ww(0x59f2,rw(0x59f2)+1);
}
//@@CHUNK2
