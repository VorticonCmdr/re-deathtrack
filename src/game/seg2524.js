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
import {rb,rsb,wb,rw,rsw,ww,rd,rsd,wd,frb,frw,fwb,fww,fp,pseg,poff,gseg,gaddr,DGROUP,salloc,sfree,strAt} from '../engine/mem.js';
import {s8,u8,s16,u16,u32,imul16,idiv16} from '../engine/int.js';
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
    p=u16(p+8);ww(0x3843,w0);ww(0x3847,w1);ww(0x3845,w2);ww(0x3849,w3);
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
// 2524:1528 screenTransition(x, y, w, h, mode): copy a rectangle from page [3854] to the blit destination
// with an effect chosen by mode 'G'..'Q' (jump table CS:1874). The original's switch cases are the
// gap-filled Ghidra functions 156a, 1718, 172c, 1748, 17a6, 17c4, 1816 and the epilogue 188a.
// Out-of-range modes take the 1816 case (JBE on mode-0x47 > 10).
export function f2524_1528(x,y,w,h,mode){
 const save=rw(0x3858);
 ww(0x3858,rw(0x3854));
 x=s16(x);y=s16(y);w=s16(w);h=s16(h);mode=u16(mode);
 const x0=x,x1=s16(x+w),y0=y,y1=s16(y+h);
 const m=u16(mode-0x47);
 const tab=m<=10?[0x172c,0x1718,0x156a,0x17a6,0x1816,0x1816,0x1748,0x1748,0x1816,0x1816,0x156a][m]:0x1816;
 const blinds=()=>{                                         // 17c4: ten interleaved passes of 1-line copies
  for(let i=1;i<=0xa;i++){
   for(let j=0;;j=s16(j+10)){
    if(s16(y0+i+j)>y1)break;
    if(w!==0)F.f1ff8_2545(x0,u16(y0+i+j),w,1);
    f2524_1896();
   }
  }
 };
 switch(tab){
  case 0x156a:{                                             // 'I' shrink to centre / 'Q' grow from centre
   w=s16(w)>>1;h=s16(h)>>1;
   const cx=s16(x+w),cy=s16(y+h);
   const mx=w>=h?w:h;
   const sx=F.f1000_c080(...lw32(F.f1000_c094(...lw(w),...lw(1000))),...lw(mx));
   const sy=F.f1000_c080(...lw32(F.f1000_c094(...lw(h),...lw(1000))),...lw(mx));
   let k=mode===0x49?mx:1;
   const w20=s16(y1-y0);
   let di=w,si=x;
   for(;;){
    if(!((k>=1&&mode===0x49)||(k<=mx&&mode===0x51)))break;
    k=s16(mode===0x49?k-1:k+1);
    const dx=s16(F.f1000_c080(...lw32(F.f1000_c094(...lw32(sx),...lw(k))),...lw(1000)));
    const dy=s16(F.f1000_c080(...lw32(F.f1000_c094(...lw32(sy),...lw(k))),...lw(1000)));
    si=s16(cx-dx);y=s16(cy-dy);di=s16(dx<<1);h=s16(dy<<1);
    if(mode===0x49){
     f2524_18ba(x0,y0,u16(si-x0),w20);
     f2524_18ba(u16(si+di),y0,u16(x1-si-di),w20);
     f2524_18ba(si,y0,di,u16(y-y0));
     f2524_18ba(si,u16(y+h),di,u16(y1-y-h));
    }else f2524_18ba(si,y,di,h);
   }
   break;
  }
  case 0x1718:f2524_18ba(x,y,w,h);break;                   // 'H' plain copy (3x3 minimum)
  case 0x172c:F.f1ff8_44b4(x,y,w,h,1);break;               // 'G'
  case 0x1748:{                                             // 'M' / 'N' vertical wipe in 3-px columns
   if(!(s16(w-3)>=3))break;
   const lim=s16(w-3);
   let di=x;
   for(let si=3;si<=lim;si++){
    if(mode===0x4e)di=s16(x1-si);
    else if(mode===0x4d)di=si-3;                            // QUIRK: 'M' starts at column 0, not at x
    f2524_18ba(di,y,3,h);
   }
   break;
  }
  case 0x17a6:                                              // 'J'
   if(rb(0x385d)===4){F.f1ff8_2545(0,0,0x140,0xc8);break;}
   blinds();break;
  case 0x1816:{                                             // 'O' / 'P' horizontal wipe; 'K', 'L' repeat row y
   if(!(s16(h-3)>=3))break;
   const lim=s16(h-3);
   let di=y;
   for(let si=3;si<=lim;si++){
    if(mode===0x50)di=s16(y1-si);
    else if(mode===0x4f)di=si-3;                            // QUIRK: 'O' starts at row 0, not at y
    f2524_18ba(x,di,w,3);
    f2524_1896();
   }
   break;
  }
 }
 ww(0x3858,save);                                           // 188a
}
// Long arguments as (lo, hi) words: lw sign-extends a 16-bit value (CWD), lw32 splits a DX:AX result.
const lw=v=>{v=s16(v);return [v&0xffff,v<0?0xffff:0];};
const lw32=v=>[v&0xffff,v>>>16&0xffff];
// 2524:1896 transitionDelay: 100 calls of copyRect(0,0,0,0), which copy nothing (a CPU-speed delay).
export function f2524_1896(){for(let si=0x64;si;si--)f2524_18ba(0,0,0,0);}
// 2524:18ba copyRect(x,y,w,h): blit only when w >= 3 and h >= 3 (signed).
export function f2524_18ba(x,y,w,h){if(s16(w)>=3&&s16(h)>=3)F.f1ff8_2545(x,y,w,h);}
// 2524:18e0 initTrackTriple: [5c9e]=-100, [5ca0]=0, [5ca2]=0.
export function f2524_18e0(){ww(0x5c9e,0xff9c);ww(0x5ca0,0);ww(0x5ca2,0);}
// 2524:18f4 raceInit: grid order, per-car state, track objects, colour records, difficulty adjustments.
export function f2524_18f4(){
 let b4=0;
 for(let i=0;i<10;i++)ww(0x96c6-2*i,0);                     // STD; REP STOSW: 96b4..96c7
 for(let si=9;si>=0;si--){
  if(rw(0x89c8)!==0)ww(0x8a7c+2*si,si);
  else ww(0x8a7c+u16(rsb(si+0x8eda)<<1),9-si);
 }
 if(rw(0x89c8)!==0)f2524_1e30();
 const common=k=>{                                          // 19c2
  const s6=k*6;
  ww(s6+0xa942,0);ww(s6+0xa940,0);ww(s6+0xa93e,0);ww(s6+0x8990,0);ww(s6+0x898c,0);ww(s6+0x898e,0);
  wb(k+0x8e9c,0);wb(k+0x98e0,0);
  const s2=k*2;
  ww(s2+0x9b90,0);ww(s2+0x8926,0);ww(s2+0x96c8,0);ww(s2+0x8a34,0);ww(s2+0x8a1e,0);ww(s2+0x5c6e,0);
  wb(k+0x8a54,1);
  b4=rw(s2+0x8a7c);
  if(b4===9)b4=0;else b4=u16(((b4%3)<<5)-0x20);             // DIV by 3 (unsigned)
  ww(s2+0xa97a,b4);ww(s2+0x9ad6,b4);ww(s2+0x5c84,b4);
  const q=Math.floor(rw(s2+0x8a7c)/3),a=s16(q*5);
  ww(s2+0x96f2,a);
  wd(k*4+0xa678,a);                                         // CWD
  ww(0x895a,rw(0x8a7c)>5?1:0);
  wb(0x9bc8,1);
  ww(s2+0x96a0,0xa00);ww(s2+0x9b0e,0x64);
  F.f1000_156c(k);
 };
 for(let k=9;k>=0;k--){
  f2524_1e8a(k);
  if(k===0){common(k);continue;}
  const si=k*2;
  if(rw(0x89c8)===0){                                       // 1950
   ww(si+0x1c5c,rw(si+0x1c5c)+(Math.abs(s16(rw(0xd24)-2))<<3));
   ww(si+0x9b6c,rw(si+0x1c48)+rw(0xd24));
   if(rw(si+0x9aa6)!==0){
    const di=k*4+0xa22a;
    if(rw(di+2)!==0||rw(di)>0x1f4){ww(si+0x9aa6,0);ww(di+2,0);ww(di,0);}
    else{ww(si+0x9aa6,rsw(si+0x1c5c)>>1);ww(k*4+0xa22c,0);ww(k*4+0xa22a,0);}
   }
  }else{
   ww(si+0x9aa6,0);
   ww(si+0x1c5c,rw(si+0x1c70)+imul16(0x19,rw(0xd28)));
   ww(si+0x9b6c,rw(si+0x1c48));
  }
  common(k);
 }
 // QUIRK: STD; REP STOSW from DS:8a7b clears bytes 8a5f..8a7c, which includes the low byte of the grid
 // word [8a7c] (the intent is the per-object alive bytes 8a54[0x0b..0x27]).
 for(let i=0;i<15;i++)ww(0x8a7b-2*i,0);
 if(s16(rw(0x5c00)+0x14)>0x14){
  let p22=0xaa46,p24=0xaa46;
  for(let k=0x14;;){
   wb(k+0x8a54,1);
   const j=k-0x14;
   const t=rw(0x9dfe+2*j),si=u16(t*6);
   const a16=rw(si+0x5ca2),a1a=rw(si+0x5ca8),a6=rw(si+0x5ca0),a10=rw(si+0x5ca6),a2=rw(si+0x5c9e),aa=rw(si+0x5ca4);
   let b1c,b1e;
   if(rsw(p22)>0){b1c=u16((aa-a2)<<3);b1e=u16((a6-a10)<<3);}
   else{b1c=u16((a2-aa)<<3);b1e=u16((a10-a6)<<3);}
   ww(p24,F.f1000_c148(rw(p24)));
   const bc=u16(b1e+a2),b12=u16(b1c+a6),b14=u16(b1e+aa),b18=u16(b1c+a10);
   const di=j*6;
   ww(di+0xa9a4,F.f2c46_3220(0x1e,u16(a1a-a16)));
   ww(di+0xa9a8,F.f2c46_3220(u16(b14-bc),u16(b18-b12))-0x4000);
   ww(di+0x8f9e,bc);ww(di+0x8fa0,b12);ww(di+0x8fa2,a16);
   p22+=2;p24+=2;k++;
   if(k>=s16(rw(0x5c00)+0x14))break;
  }
 }
 ww(0xa66e,0);ww(0xa8be,9);ww(0x8e70,0);
 if(rw(0x1fa6)!==0){wb(0x9bc8,5);ww(0x9a82,1);}else{wb(0x9bc8,1);ww(0x9a82,0);}
 wb(0x384d,0);wb(0x384e,0);
 if(rw(0x896c)===0){
  const ax=u16(rw(0x9808)<<1),b28=rw(ax+0x1cdc),b26=rw(ax+0x1cf0);
  for(let i=0;i<0x64;i++){ww(0x9252+8*i,b26);ww(0x9258+8*i,b28);}
 }
 ww(0x8988,rw(0x8986)-1);
 if(rw(0xd24)===0){ww(0x9250,0);ww(0x924e,0);}
 ww(0x8a4c,0);ww(0xa462,0);ww(0x924c,0);ww(0xa672,0xffff);ww(0x9bca,0);ww(0x1fac,0);
 ww(0x961e,rw(0x1fce)*3);
 const addCash=n=>{for(let i=0;i<9;i++){const o=0xa22e+4*i;wd(o,rd(o)+n);}};
 switch(rw(0xd28)){
  case 0:ww(0x1c5c,rw(0x1c5c)+0x1e);ww(0x961e,rw(0x961e)+0x21);b4=0;break;
  case 1:ww(0x961e,rw(0x961e)+0x1e);addCash(1000);b4=0xc8;break;
  case 2:ww(0x1c5c,rw(0x1c5c)-0xf);ww(0x961e,rw(0x961e)+0x1c);addCash(3000);b4=0x1f4;break;
  case 3:ww(0x1c5c,rw(0x1c5c)-0x1e);ww(0x961e,rw(0x961e)+0x1a);addCash(5000);b4=0x3e8;break;
  // other values keep b4 from the last grid computation (the k = 0 car)
 }
 const si=Math.abs(s16(rw(0xd24)-2));
 ww(0x8f0a,imul16(0x32,si)+b4);
 ww(0x8954,imul16(0x1e,si)+b4);
}
// 2524:1de8 initRowTables: aa20[i] = 0x22+10i, 9abe[i] = 0x29+10i, i = 0..8.
export function f2524_1de8(){for(let i=0;i<9;i++){ww(0xaa20+2*i,0x22+10*i);ww(0x9abe+2*i,0x29+10*i);}}
// 2524:1e30 shuffleGrid: 50 swaps of 8a7c[rand()%10] and 8a7c[rand()%10] (unsigned DIV).
export function f2524_1e30(){
 for(let n=0x32;n;n--){
  const a=u16(F.f1000_c144())%10,b=u16(F.f1000_c144())%10;
  const di=0x8a7c+2*a,si=0x8a7c+2*b,t=rw(di);
  ww(di,rw(si));ww(si,t);
 }
}
// 2524:1e8a resetProgress(k): [8ec4+2k]=0, a678[k]=0 (dword).
export function f2524_1e8a(k){ww(u16(k<<1)+0x8ec4,0);const bx=u16(k<<2);ww(bx+0xa678,0);ww(bx+0xa67a,0);}
// 2524:1eaa trackTitle: [a8a8] = city name of race [d24]; DS:a8d8 = file base + DS:0bcc; returns
// half the name's pixel width (8 px glyphs, signed division by 2).
export function f2524_1eaa(){
 const si=u16(rw(u16(rw(0xd24)<<1)+0x18bc)<<1);
 ww(0xa8a8,rw(si+0x1ca0));
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3852));
 ww(0x1f28,1);
 F.f1000_c2ce(0xa8d8,rw(si+0x1cb4));
 F.f1000_c298(0xa8d8,0xbcc);
 return u16(Math.trunc(s16(F.f1000_c058(rw(0xa8a8))<<3)/2));
}
// 2524:1f04 drawGasLabels: three 6x6-font labels in colour 0.
export function f2524_1f04(){
 wb(0x3840,0);
 F.f1ff8_3692(rw(0x8e98));
 F.f1ff8_23ba(0xbed,0xec,0x24);
 F.f1ff8_23ba(0xbf3,0x104,0x5b);
 F.f1ff8_23ba(0xbf5,0xe6,0x93);
 ww(0x1f28,1);
 F.f1ff8_3692(rw(0x8eb4));
}
// 2524:1f64 setupShowcaseCamera(champ): camera and object pose for the rotating car/champion view.
export function f2524_1f64(champ){
 ww(0x9b8e,0xa0);ww(0x9bb8,0x41);
 for(const o of [0x898e,0x8990,0xa93e,0xa940,0xa942,0x8992,0x8994,0xa944])ww(o,0);
 if(u16(champ)!==0){ww(0x898c,0xdac);ww(0x8996,0x8000);ww(0xa946,0x4b0);}
 else{ww(0x898c,0xfe00);ww(0x8996,0x4000);ww(0xa946,0x55);}
 ww(0xa948,0xffed);
 for(let i=0;i<6;i+=2)ww(0x98f4+i,rw(0xa93e+i));
 F.f2c46_06a0(0x898c,0x9622);
 F.f2c46_0a63(0x9622);
 ww(0x9a9e,-rw(0xa93e));ww(0x9aa0,-rw(0xa940));ww(0x9aa2,-rw(0xa942));
 const loc=salloc(6);
 try{F.f2c46_0fa5(0x9a9e,0x9622,loc);}finally{sfree(6);}
 ww(0x59fa,0);
}
// 2524:203a applyPalette(i): CGA/Tandy only ([896c]): setPalette(a252[i]).
export function f2524_203a(i){if(rw(0x896c)!==0)F.f1ff8_3c64(rw(u16(i<<1)+0xa252));}
// 2524:2058 drawChampFrame(first): first=1 draws frames 4 and 0 of [9bc2], copies the page and dissolves it
// in; otherwise steps the 4-frame animation [59fe]. Position by [9a3e] (player or rival champion).
export function f2524_2058(first){
 let ax,dx;
 if(rw(0x9a3e)===0){ax=0x2f;dx=0xb0;}else{ax=0x82;dx=0xc3;}
 if(u16(first)===1){
  ww(0x3845,0x140);ww(0x59fe,0);
  ww(0x3858,rw(0x3852));
  F.f1ff8_2541(rw(rw(0x9bc2)+8),dx,u16(ax-0x11));
  F.f1ff8_2541(rw(rw(0x9bc2)),0x24,ax);
  ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3850));
  F.f1ff8_2545(0,0,0x140,0xc8);
  ww(0x3858,rw(0x3854));
  F.f1ff8_44b4(0,0,0x140,0xc8,1);
  return;
 }
 ww(0x59fe,rw(0x59fe)+1);
 if(rsw(0x59fe)>3)ww(0x59fe,0);
 ww(0x3858,rw(0x3852));
 F.f1ff8_2541(rw(u16(rw(0x59fe)<<1)+rw(0x9bc2)),0x24,ax);
}
// 2524:2140 showcaseZoomStep: approach animation on [a946]/[8996]; at the end copy the page, [59fa]=1.
export function f2524_2140(){
 const v=rsw(0xa946);
 if(v>0xb4){ww(0x59fa,0);ww(0xa946,rw(0xa946)-0xf);return;}
 if(v>0xa5){ww(0xa946,rw(0xa946)-8);ww(0x8996,rw(0x8996)+0x170);return;}
 if(v>0x78){ww(0x8996,rw(0x8996)+0x210);ww(0xa946,rw(0xa946)-4);return;}
 if(v>0x67){ww(0x8996,rw(0x8996)+0x260);ww(0xa946,rw(0xa946)-2);return;}
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3850));
 F.f1ff8_2545(0,0,0x140,0xc8);
 ww(0x59fa,1);
}
// 2524:21d2 buildQuizAnswers(d): 8eda[0]=d, 8eda[1..4] = distinct (rand&15)+10, 100 swaps of
// 8eda[rand&3] and 8eda[(rand+1)&3], then [1fb6] = 1-based position of d (last match; unchanged if none).
export function f2524_21d2(d){
 wb(0x8eda,d);
 for(let si=1;si<=4;){
  const v=(F.f1000_c144()&0xf)+0xa&0xff;
  let dup=false;
  for(let di=1;di<si;di++)if(rb(di+0x8eda)===v){dup=true;break;}
  if(dup)continue;
  wb(si+0x8eda,v);si++;
 }
 for(let n=0x64;n;n--){
  const di=F.f1000_c144()&3;
  const si=u16(F.f1000_c144()+1)&3;
  const t=rb(di+0x8eda);
  wb(di+0x8eda,rb(si+0x8eda));
  wb(si+0x8eda,t);
 }
 let cx=rw(0x1fb6);
 for(let si=0;si<=4;si++)if(u16(rsb(si+0x8eda))===u16(d))cx=si+1;
 ww(0x1fb6,cx);
}
// 2524:2280 drawQuizQuestion: three (or two plus a category line) text lines by quiz category [aa6e],
// drawn twice: colour 0 at x=0x19, then colour 0xc at x=0x1a (shadow).
export function f2524_2280(){
 wb(0x3840,0);
 const cat=rb(0xaa6e);
 for(let i=0;i<=1;i++){
  const x=0x19+i;
  if(cat===0){F.f1ff8_23ba(0xc5c,x,0x38);F.f1ff8_23ba(0xc6c,x,0x40);F.f1ff8_23ba(0xc79,x,0x48);}
  else if(cat===3){F.f1ff8_23ba(0xc7f,x,0x38);F.f1ff8_23ba(0xc8d,x,0x40);F.f1ff8_23ba(0xc99,x,0x48);}
  else{F.f1ff8_23ba(0xca0,x,0x38);F.f1ff8_23ba(0xcad,x,0x40);F.f1ff8_23ba(rb(0xaa6e)===1?0xcbf:0xcc5,x,0x48);}
  wb(0x3840,0xc);
 }
}
// 2524:2396 markSoundOption: '*' in front of the current option string (DS:2816[0..3]), ' ' elsewhere.
// Option: music+effects 0, effects only 1, music only 2, none 3.
export function f2524_2396(){
 let k;
 if(rw(0x1fb2)!==0)k=rw(0x1fb0)!==0?0:2;else k=rw(0x1fb0)!==0?1:3;
 for(let cx=0;cx<4;cx++)wb(rw(0x2816+2*cx),cx===k?0x2a:0x20);
}
// 2524:23fe setSoundOption(k): stores the inverse of option k, then toggles both flags back
// (03dc effects, 039c music). Net: 0 both on, 1 effects only, 2 music only, 3 none.
export function f2524_23fe(k){
 switch(u16(k)){
  case 0:ww(0x1fb2,0);ww(0x1fb0,0);break;
  case 1:ww(0x1fb2,1);ww(0x1fb0,0);break;
  case 2:ww(0x1fb2,0);ww(0x1fb0,1);break;
  case 3:ww(0x1fb2,1);ww(0x1fb0,1);break;
 }
 f2524_03dc();
 f2524_039c();
}
// 2524:2452 drawPartsPanel: part labels and the six current part-level names in the 4x5 font.
export function f2524_2452(){
 ww(0xa8a6,1);
 F.f1ff8_3692(rw(0x8e72));
 for(const [s,y] of [[0xde4,0xd],[0xdec,0x21],[0xdf3,0x35],[0xdfb,0x49],[0xe03,0x5d],[0xe11,0x71]])F.f1ff8_23ba(s,3,y);
 for(const [g,t,y] of [[0x1fc8,0x1b6c,0x15],[0x1fca,0x1b72,0x51],[0x1fcc,0x1b78,0x65],[0x1fce,0x1b7e,0x29],[0x1fd0,0x1b84,0x79],[0x1fd2,0x1b8a,0x3d]])
  F.f1ff8_23ba(rw(u16(rw(g)<<1)+t),8,y);
 ww(0xa8a6,0);
 F.f1ff8_3692(rw(0x8eb4));
}
// 2524:258c initLoadout: car-model weapon/part loadout; in autoplay also the "DEMO" overlay texts.
export function f2524_258c(){
 const car=rw(0x9b0c);
 if(car===0){
  ww(0x8e5c,0x12c);ww(0x9a86,0);ww(0x9238,2);ww(0xa8c4,1);ww(0x5c04,0);
  ww(0x1fe0,1);ww(0x1fe4,1);ww(0x1fc8,1);ww(0x1fcc,1);
 }else if(car===1){
  ww(0x8e5c,0x64);ww(0x9a86,3);ww(0x9238,0);ww(0xa8c4,1);ww(0x5c04,1);
  ww(0x1fd6,1);ww(0x1fd0,1);ww(0x1fd2,1);
 }else if(car===2){
  ww(0x8e5c,0x64);ww(0x9a86,1);ww(0x9238,3);ww(0xa8c4,3);ww(0x5c04,3);
  ww(0x1fd8,1);ww(0x1fd2,2);
 }
 if(rw(0x1fa6)===0){ww(0x98fa,0x5a);return;}
 ww(0x1fd0,2);ww(0x9a86,0xe);
 ww(0x3858,rw(0x3850));
 F.f1ff8_3692(rw(0x8eb4));
 wb(0x3840,0xf);
 F.f1ff8_23ba(0xe38,4,4);
 F.f1ff8_23ba(0xe43,0xf4,4);
 F.f1ff8_3692(rw(0x8e72));
 F.f1ff8_23ba(0xe4d,0x54,4);
 ww(0x98fa,0x91);
}
// 2524:26c0 recalcStats: engine, brakes, transmission, armour.
export function f2524_26c0(){f2524_26d2();f2524_26e4();f2524_2710();f2524_2744();}
// 2524:26d2 recalcEngine: [1c48] = [9b6c] = 30*[1fc8] + 90.
export function f2524_26d2(){const v=imul16(0x1e,rw(0x1fc8))+0x5a;ww(0x1c48,v);ww(0x9b6c,v);}
// 2524:26e4 recalcBrakes: [1c34] = ([1fca]+3)*(1000-[aa9e])/1000.
// QUIRK: CWD after IMUL keeps only the low 16 bits of the product before the IDIV.
export function f2524_26e4(){
 if(rw(0xaa9e)===0x3e8){ww(0x1c34,rw(0x1fca)+3);return;}
 const p=s16(imul16(rw(0x1fca)+3,0x3e8-rw(0xaa9e)));
 ww(0x1c34,Math.trunc(p/0x3e8));
}
// 2524:2710 recalcTransmission: [1c20] = ([1fcc]+2)*(100-[8eb6]/10)/100 (same CWD truncation).
export function f2524_2710(){
 if(rw(0x8eb6)===0x3e8){ww(0x1c20,rw(0x1fcc)+2);return;}
 const q=s16(0x64-Math.trunc(rsw(0x8eb6)/10));
 const p=s16(imul16(q,rw(0x1fcc)+2));
 ww(0x1c20,Math.trunc(p/0x64));
}
// 2524:2744 recalcArmour: [9aa6]=0, [1c5c] = 200*[1fd2] + 200.
export function f2524_2744(){ww(0x9aa6,0);ww(0x1c5c,imul16(0xc8,rw(0x1fd2))+0xc8);}
// 2524:2758 drawBioText(k): text block for driver bio pages (three variants by k).
export function f2524_2758(k){
 wb(0x3840,0);
 const L=(s,x,y)=>F.f1ff8_23ba(s,x,y);
 if(u16(k)===0){
  for(const [s,y] of [[0xe5d,0x3c],[0xe6b,0x46],[0xe78,0x50],[0xe85,0x5a],[0xe96,0x64],[0xea6,0x78],[0xeb3,0x82],[0xec0,0x96],[0xecd,0xa0]])L(s,0xa,y);
 }else if(u16(k)===1){
  L(0xed4,0xa,0x3c);L(0xee4,0xa,0x46);L(0xef0,0x52,0x50);
  for(const [s,y] of [[0xef4,0x5a],[0xefc,0x6e],[0xf0b,0x78],[0xf19,0x82],[0xf25,0x8c],[0xf33,0x96]])L(s,0xa,y);
 }else{
  for(const [s,y] of [[0xf39,0x3c],[0xf4a,0x46],[0xf58,0x50],[0xf69,0x5a],[0xf75,0x6e],[0xf80,0x78],[0xf86,0x82],[0xf90,0x8c],[0xf9c,0x96],[0xfaa,0xa0]])L(s,0xa,y);
 }
}
// 2524:2998 drawTrackText(k): k in 0..1 (signed) one block, otherwise another.
export function f2524_2998(k){
 wb(0x3840,0);
 const L=(s,x,y)=>F.f1ff8_23ba(s,x,y);
 if(s16(k)>=0&&s16(k)<=1){
  for(const [s,y] of [[0xfc4,0x50],[0xfd3,0x5a],[0xfe1,0x64],[0xfeb,0x6e],[0xff9,0x78],[0x1008,0x82],[0x1016,0x8c]])L(s,0xa,y);
 }else{
  L(0x101d,0xa,0x3c);L(0x1029,0x42,0x46);
  for(const [s,y] of [[0x1031,0x50],[0x1041,0x5a],[0x104d,0x64],[0x105e,0x6e],[0x106b,0x78],[0x1079,0x82],[0x1087,0x8c],[0x1095,0x96]])L(s,0xa,y);
 }
}
// 2524:2b00 drawResultText(k): k in 0..1 (signed) one block, otherwise another (colour unchanged).
export function f2524_2b00(k){
 const L=(s,x,y)=>F.f1ff8_23ba(s,x,y);
 if(s16(k)>=0&&s16(k)<=1){
  for(const [s,y] of [[0x109e,0x46],[0x10aa,0x50],[0x10ba,0x5a],[0x10ca,0x64],[0x10d6,0x6e]])L(s,0xa,y);
 }else{
  for(const [s,y] of [[0x10e5,0x50],[0x10ef,0x5a],[0x10fe,0x64],[0x1109,0x6e]])L(s,0xa,y);
 }
}
// 2524:2bbe setTextColourMode(f): [a8a6] = f ? 0 : ([896c] ? 8 : 1).
export function f2524_2bbe(f){
 if(u16(f)!==0){ww(0xa8a6,0);return;}
 ww(0xa8a6,rw(0x896c)!==0?8:1);
}
// 2524:2be8 buildGamePath(name): DS:99ec = [8f0c] + "\" + name.
export function f2524_2be8(name){
 wb(0x99ec,0);
 F.f1000_c2ce(0x99ec,0x8f0c);
 F.f1000_c298(0x99ec,0x115a);
 F.f1000_c298(0x99ec,name);
}
// 2524:2c22 saveUnderBox: with page flag 0x800, allocate and save the area under the current box.
export function f2524_2c22(){
 if(!(rw(0x98d6)&0x800))return;
 const n=F.f1ff8_254d(u16(rw(0x8a52)+0xa),u16(rb(0xa8a4)+0xb));
 const p=F.f1ff8_3a88(...lw(n),1)>>>0;
 ww(0x9af0,poff(p));ww(0x9af2,pseg(p));
 if(p===0)return;
 F.f1ff8_2549(rw(0x9af0),pseg(p),u16(rw(0x8a96)-5),u16(rb(0x8db0)-5),u16(rw(0x8a52)+0xa),u16(rb(0xa8a4)+0xb));
}
// 2524:2c9a fillPanel(x,y,w,h): CGA/Tandy ([896c]) draws alternating-colour lines, otherwise fills in colour 3.
export function f2524_2c9a(x,y,w,h){
 if(rw(0x896c)!==0){
  const y0=s16(y);
  if(s16(y0+h)<y0)return;
  const di=s16(y0+h),xe=u16(x+w);
  for(let si=y0;si<=di;si++){wb(0x384e,si&1?1:2);F.f1ff8_2454(x,u16(si),xe,u16(si));}
  return;
 }
 wb(0x384d,3);wb(0x384e,3);
 F.f1ff8_3810(x,y,w,h);
}
// File picker state: [5a04] -> picker record. +8+2i item i selected (i=0..9), +0x1c..+0x24 the five
// buttons (up, down, OK, cancel, drive), +0x26.. previous states (+0x3a.. buttons), +0x44/+0x46 OK and
// cancel labels, +0x4a file pattern. [9620] name list, [5a02] count, [1172] scroll, [1174] selection.
// 2524:2d1c pickerClearButtons: buttons 0; the OK button stays lit while a double click is pending ([96f0]).
export function f2524_2d1c(){
 const bx=rw(0x5a04);
 for(let i=0;i<5;i++)ww(bx+0x1c+2*i,0);
 if(rw(0x96f0)!==0)ww(bx+0x22,1);
}
// 2524:2d48 pickerInvalidateButtons: previous button states = 0x63 (forces a repaint).
export function f2524_2d48(){const bx=rw(0x5a04);for(let i=0;i<5;i++)ww(bx+0x3a+2*i,0x63);}
// 2524:2d6a pickerClearItems: item states +0x08..+0x1a = 0 (STD from +0x1a).
export function f2524_2d6a(){const bx=rw(0x5a04);for(let i=0;i<10;i++)ww(bx+0x1a-2*i,0);}
// 2524:2d8e pickerInvalidateItems: previous item states +0x26..+0x38 = 0x63.
export function f2524_2d8e(){const bx=rw(0x5a04);for(let i=0;i<10;i++)ww(bx+0x38-2*i,0x63);}
// 2524:2db2 pickerBuildList: directories ("*.*" with attribute exactly 0x10, suffixed " (DIR)"), then the
// files matching the pattern. Entries are 20-byte heap blocks. Returns 0, or -1 when the heap is full.
export function f2524_2db2(){
 ww(0x5a02,0);ww(0x1172,0);
 ww(0x9620,F.f1000_c272(0x1b8));
 if(rw(0x9620)===0)return 0xffff;
 const add=()=>{                                            // malloc(0x14) into slot [5a02], copy 12 name bytes
  const p=u16(F.f1000_c272(0x14));
  ww(u16(rw(0x9620)+u16(rw(0x5a02)<<1)),p);
  if(p===0)return false;
  let si=f2524_3abd();
  for(let cx=0;cx<0xc;cx++)wb(p+cx,rb(si++));
  wb(p+0xc,0);
  return true;
 };
 const slot=()=>rw(u16(rw(0x9620)+u16(rw(0x5a02)<<1)));
 if(u16(f2524_3a7b(0x118c,0x10))===0&&f2524_3ab7()===0x10){
  if(!add())return 0xffff;
  f2524_2fc0(slot());ww(0x5a02,rw(0x5a02)+1);
 }
 while(u16(f2524_3a99(0x1190,0x10))===0){
  if(f2524_3ab7()!==0x10)continue;
  if(!add())return 0xffff;
  f2524_2fc0(slot());ww(0x5a02,rw(0x5a02)+1);
 }
 if(u16(f2524_3a7b(rw(rw(0x5a04)+0x4a),0))===0){
  if(!add())return 0xffff;
  ww(0x5a02,rw(0x5a02)+1);
 }
 while(u16(f2524_3a99(rw(rw(0x5a04)+0x4a),0))===0){
  if(!add())return 0xffff;
  ww(0x5a02,rw(0x5a02)+1);
 }
 return 0;
}
// 2524:2fc0 padDirName(p): pad the name with spaces to 9 columns (a 10-char name is cut at column 9),
// then append the string at [116e] (" (DIR)") and one extra NUL.
export function f2524_2fc0(p){
 let cx=0,si=u16(p);
 for(;;){si=u16(si+1);if(rb(si-1)===0)break;const ax=cx;cx++;if(ax>=9)break;}
 si=u16(si-1);
 for(;;){const ax=cx;cx++;if(!(ax<9))break;wb(si,0x20);si=u16(si+1);}
 let s=rw(0x116e),di=si,c;
 do{c=rb(s);s=u16(s+1);wb(di,c);di=u16(di+1);}while(c!==0);
 wb(di,0);
}
// 2524:3020 pickerNextDrive: advance the drive letter at [1170] (wrapping after the last drive) until a
// drive can be selected and getcwd into DS:9b24 reports it.
export function f2524_3020(){
 const bx=rw(0x1170);
 wb(bx,rb(0x9b24));
 const last=(f2524_3b86()&0xff)+0x41&0xff;
 do{
  if(last===rb(bx))wb(bx,0x41);else wb(bx,rb(bx)+1);
  const si=s16(rsb(bx)-0x41);
  if(u16(f2524_3b41(u16(si)))!==0)F.f1000_c0e2(0x9b24,0x3b);
 }while(rb(bx)!==rb(0x9b24));
}
// 2524:308a pickerDrawName: a directory entry sets event 0x19 and returns 0; otherwise draws the name
// field DS:a8d8 with its cursor and returns 1.
export function f2524_308a(){
 if(u16(F.f1000_c10c(rw(0x116e),0xa8e1))===0){ww(0x9924,0x19);return 0;}
 ww(0x963c,rw(0x963c)+1);
 f2524_3782();
 F.f1000_c0f4(0x55,0x89,0x9a,0xf);
 F.f1ff8_3692(rw(0x8eb4));
 F.f1000_c0c0(0xa8d8,0x5f,0x8d);
 F.f1ff8_3692(rw(0x8e98));
 f2524_379e();
 const x=u16(rw(0x5a06)<<3);
 F.f1ff8_2454(u16(x+0x5f),0x95,u16(x+0x67),0x95);
 return 1;
}
// 2524:3134 pickerEditName(max): edit DS:a8d8 with scancode [9658] / ASCII [8dbe]; cursor [5a06],
// insert mode [1176]. '.' and ' ' are refused.
export function f2524_3134(max){
 const p=0xa8d8;
 let len=s16(F.f1000_c058(p));
 const sc=rw(0x9658);
 let redraw=true;
 const pos=()=>rsw(0x5a06);
 if(sc===0)redraw=false;
 else switch(sc){
  case 0x4b:if(pos()>0)ww(0x5a06,pos()-1);break;
  case 0x0e:
   if(pos()>0){ww(0x5a06,pos()-1);const si=u16(p+pos());F.f1000_4f8c(si,u16(si+1));}
   else redraw=false;
   break;
  case 0x47:ww(0x5a06,0);break;
  case 0x4d:if(len>pos())ww(0x5a06,pos()+1);break;
  case 0x4f:ww(0x5a06,len);break;
  case 0x52:ww(0x1176,rw(0x1176)===0?1:0);break;
  case 0x53:if(len>pos()){const si=u16(p+pos());F.f1000_4f8c(si,u16(si+1));}break;
  default:{
   const a=rsw(0x8dbe);
   if(a===0x2e||a===0x20||a<0x20||!(s16(max)>pos())){redraw=false;break;}
   if(rw(0x1176)!==0&&len<s16(max)){const si=u16(p+pos());F.f1000_4f8c(u16(si+1),si);}
   if(rw(0x1176)!==0||len===pos())len++;
   const si=pos();ww(0x5a06,si+1);
   wb(p+si,rb(0x8dbe));
   wb(p+len,0);
  }
 }
 if(redraw)ww(0x963c,rw(0x963c)+1);
 if(rw(0x963c)!==0)f2524_308a();
}
// 2524:328e pickerEvent: one poll of the file picker (pointer [a668]/[a6a0], button [9aee]); sets the
// picker event [9924] (0x15 OK, 0x17 cancel, 0x19 directory, 0x16/0x18/0x1a pressed buttons).
export function f2524_328e(){
 const ev=rw(0x9924);
 if(ev!==0x16&&ev!==0x18&&ev!==0x1a)ww(0x9924,u16(f2524_3a18(0x2b,0xd6,0xffff,0xca))!==0?0xb:0);
 f2524_3134(8);
 const bx=()=>rw(0x5a04);
 if(rw(0x9aee)!==0){
  ww(0x5a08,1);
  f2524_2d1c();
  if(f2524_3a18(0xd6,0x19,0x28,0x2e)){
   ww(bx()+0x1c,1);
   if(rw(0x1172)===0)return;
   ww(0x1172,rw(0x1172)-1);f2524_3546();return;
  }
  if(f2524_3a18(0xd6,0x19,0x58,0x2f)){
   ww(bx()+0x1e,1);
   if(!(s16(rw(0x5a02)-0xa)>rsw(0x1172)))return;
   ww(0x1172,rw(0x1172)+1);f2524_3546();return;
  }
  if(f2524_3a18(0x55,0x3c,0x9f,0x15)){ww(bx()+0x22,1);ww(0x9924,0x16);return;}
  if(f2524_3a18(0xb2,0x3c,0x9f,0x15)){ww(bx()+0x24,1);ww(0x9924,0x18);return;}
  if(f2524_3a18(0x5a,0x10,0x19,0xd)){ww(bx()+0x20,1);ww(0x9924,0x1a);return;}
  if(f2524_3a18(0x5a,0x73,0x2d,0x4f)){
   const v=s16(Math.trunc(s16(rw(0xa6a0)-0x2d)/8));    // |d|>>3 with the sign restored
   if(!(s16(rw(0x5a02)-rw(0x1172))>v))return;
   ww(0x1174,v);
   f2524_2d6a();
   ww(0x963c,rw(0x963c)+1);
   ww(bx()+u16(v<<1)+8,1);
   ww(0x5c1a,rw(0x5c1a)+1);
   f2524_356a();
   if(v!==rsw(0x8f9a)){
    ww(0x96f0,0);
    if(u16(f2524_308a())!==0){
     ww(0x8baa,0);ww(0x8ba8,0);
     if(rsd(0x8a90)>=0&&v===rsw(0x8e90)){ww(0x96f0,rw(0x96f0)+1);ww(bx()+0x22,1);} // -(long) <= 0
     else{ww(0x8a92,0);ww(0x8a90,0);ww(0x8e90,0x63);}
    }
   }
   ww(0x8f9a,v);
   f2524_37f4();
   return;
  }
  ww(0x9924,0);ww(0x96f0,0);
  f2524_3554();
  return;
 }
 if(rw(0x96f0)===1)ww(0x96f0,2);
 ww(0x8f9a,0xffff);
 ww(0x8e90,rw(0x1174));
 if(rw(0x5a08)!==0){f2524_308a();ww(0x5a08,0);}
 const e=rw(0x9924);
 if(e===0x16||e===0x18){ww(0x9924,e-1);f2524_3730();return;}
 if(e===0x19){f2524_35b0();return;}
 if(e===0x1a){f2524_3020();f2524_35b0();return;}
 f2524_2d1c();
 f2524_3554();
}
// 2524:3546 pickerScrolled
export function f2524_3546(){f2524_2d6a();f2524_2d8e();f2524_37f4();}
// 2524:3554 pickerRefreshSelection: after a selection change ([5c1a]) clear the items and repaint.
export function f2524_3554(){if(rw(0x5c1a)!==0){f2524_2d6a();f2524_37f4();ww(0x5c1a,0);}}
// 2524:356a pickerCopySelection: clear DS:a8d9..a8ec, copy entry [1174]+[1172] to DS:a8d8.
export function f2524_356a(){
 for(let i=0;i<10;i++)ww(0xa8eb-2*i,0);
 let si=rw(u16(u16(u16(rw(0x1174)+rw(0x1172))<<1)+rw(0x9620))),di=0xa8d8,c;
 do{c=rb(si);si=u16(si+1);wb(di,c);di=u16(di+1);}while(c!==0);
}
// 2524:35b0 pickerEnterDir: trim the padding of DS:a8d8, chdir, clear the name, rebuild (1000:4dc0).
export function f2524_35b0(){
 for(let si=9;si>=0;si--)if(rb(si+0xa8d8)===0x20)wb(si+0xa8d8,0);
 F.f1000_c0d4(0xa8d8);
 for(let i=0;i<5;i++)ww(0xa8e1-2*i,0);
 ww(0x8f9a,0xffff);
 f2524_36de();
 F.f1000_4dc0();
}
// 2524:3606 pickerAnyItemChanged: 1 if an item state differs from its previous state (items 9..0).
export function f2524_3606(){for(let si=9;si>=0;si--)if(f2524_3636(si))return 1;return 0;}
// 2524:3636 pickerStateChanged(i): [r+8+2i] != [r+0x26+2i]
export function f2524_3636(i){const si=u16(u16(i<<1)+rw(0x5a04));return rw(si+8)!==rw(si+0x26)?1:0;}
// 2524:3658 pickerRepaintButtons: for each changed button, set colours and call its drawer through the
// far-pointer table DS:1178 (2524:38fa, 392a, 39ea, 395a, 39a2). Returns [963c].
export function f2524_3658(){
 for(let si=0xa;si<=0xe;si++){
  const k=si-0xa;
  if(!f2524_3636(si))continue;
  if(rw(u16(0x14+2*k+rw(0x5a04))+8)===1)f2524_37bc();else f2524_3782();
  callFar(rd(0x1178+4*k));                                  // CALLF [BX]
  ww(0x963c,rw(0x963c)+1);
  const di=u16(0x14+2*k+rw(0x5a04));
  ww(di+0x26,rw(di+8));
 }
 if(rw(0x96f0)===2){f2524_3730();ww(0x9924,0x15);}
 return rw(0x963c);
}
// 2524:36de pickerFreeList
export function f2524_36de(){
 for(let di=0,si=0;s16(rw(0x5a02))>0&&di<s16(rw(0x5a02));di++,si+=2)F.f1000_c280(rw(rw(0x9620)+si));
 F.f1000_c280(rw(0x9620));
 F.f1000_c272(0xffff);
}
// 2524:3730 pickerClose: restore page [3852] from [3850]... (dst [3850], src [3852] then [3854]),
// free the list and the picker record.
export function f2524_3730(){
 ww(0x3856,rw(0x3850));ww(0x3858,rw(0x3852));
 F.f1ff8_2545(0,0,0x140,0xc8);
 ww(0x3858,rw(0x3854));
 F.f1ff8_2545(0,0,0x140,0xc8);
 ww(0x3858,rw(0x3852));
 f2524_36de();
 F.f1000_c280(rw(0x5a04));
}
// 2524:3782 / 379e / 37bc / 37da pickerColours: colour sets from the picker record.
export function f2524_3782(){const bx=rw(0x5a04);wb(0x3841,rb(bx));wb(0x384d,rb(bx));wb(0x3840,rb(bx+4));wb(0x384e,rb(bx+4));ww(0xa8a6,0);}
export function f2524_379e(){const bx=rw(0x5a04);wb(0x3841,rb(bx+2));wb(0x384d,rb(bx+2));wb(0x3840,rb(bx+6));wb(0x384e,rb(bx+6));ww(0xa8a6,1);}
export function f2524_37bc(){const bx=rw(0x5a04);wb(0x3841,rb(bx+2));wb(0x384d,rb(bx+2));wb(0x384e,rb(bx+2));wb(0x3840,rb(bx+6));ww(0xa8a6,1);}
export function f2524_37da(){f2524_3782();const bx=rw(0x5a04);wb(0x384e,rb(bx));wb(0x3840,rb(bx+4));ww(0xa8a6,0);}
// 2524:37f4 pickerDrawList: when an item changed, redraw the list box and the 10 visible names.
export function f2524_37f4(){
 f2524_3782();
 if(!f2524_3606())return;
 F.f1000_c03e(0x5a,0x2d,0x73,0x54,2);
 ww(0xa8a6,1);
 F.f1000_c0f4(0x5a,0x2e,0x73,0x53);
 wb(0x384d,0);wb(0x384e,0);
 F.f1ff8_3810(0x5b,0x2e,0x71,0x52);
 for(let si=0,di=0x31;si<0xa;si++,di+=8){
  if(rw(u16(2*si+rw(0x5a04))+8)===1)f2524_37bc();else f2524_37da();
  if(s16(si+rw(0x1172))<rsw(0x5a02)){
   F.f1ff8_3810(0x5b,di-2,0x71,9);
   F.f1ff8_23ba(rw(u16(u16(u16(si+rw(0x1172))<<1)+rw(0x9620))),0x5f,di);
  }
  const a=u16(2*si+rw(0x5a04));
  ww(a+0x26,rw(a+8));
 }
 ww(0x963c,rw(0x963c)+1);
}
// 2524:38fa / 392a / 39ea / 395a / 39a2 picker button drawers (called through DS:1178).
export function f2524_38fa(){F.f1000_c0f4(0xd6,0x28,0x19,0x2e);F.f1ff8_2541(rw(rw(0x9bbe)+0x1c),0xd9,0x3a);}
export function f2524_392a(){F.f1000_c0f4(0xd6,0x58,0x19,0x2f);F.f1ff8_2541(rw(rw(0x9bbe)+0x1e),0xd9,0x64);}
export function f2524_395a(){F.f1000_c0f4(0x55,0x9f,0x3c,0x15);F.f1ff8_3692(rw(0x8eb4));F.f1000_c0c0(rw(rw(0x5a04)+0x44),0x63,0xa6);F.f1ff8_3692(rw(0x8e98));}
export function f2524_39a2(){F.f1000_c0f4(0xb1,0x9f,0x3c,0x15);F.f1ff8_3692(rw(0x8eb4));F.f1000_c0c0(rw(rw(0x5a04)+0x46),0xb6,0xa6);F.f1ff8_3692(rw(0x8e98));}
export function f2524_39ea(){F.f1000_c0f4(0x5a,0x19,0x10,0xd);F.f1000_c0c0(0x1194,0x5f,0x1d);}
// 2524:3a18 pointerIn(x,w,y,h): [a668] in x..x+w (inclusive), [a6a0] in y+1..y+h (signed).
export function f2524_3a18(x,w,y,h){
 const mx=rsw(0xa668),my=rsw(0xa6a0);
 if(s16(x)>mx||s16(x+w)<mx||s16(y)>=my||s16(y+h)<my)return 0;
 return 1;
}
// 2524:3a4c copyFindResult: from the DTA: attribute -> [11c4], 13 name bytes -> DS:1198.
export function f2524_3a4c(){
 const r={ax:0x2f00,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:0};int21(r);
 wb(0x11c4,frb(r.es,r.bx+0x15));
 for(let i=0;i<0xd;i++)wb(0x1198+i,frb(r.es,r.bx+0x1e+i));
}
// 2524:3a7b findFirst(pattern, attr): INT 21h AH=4Eh; returns AL (0 = found; DOS sets AX=0 on success,
// otherwise AL would still hold the low byte of the pattern pointer), then copies the DTA result.
export function f2524_3a7b(pat,attr){
 const r={ax:0x4e00|u16(pat)&0xff,bx:0,cx:u16(attr),dx:u16(pat),si:0,di:0,ds:DGROUP,es:0};int21(r);
 const al=r.ax&0xff;f2524_3a4c();return al;
}
// 2524:3a99 findNext(pattern, attr): INT 21h AH=4Fh (DX/CX unused by DOS); returns AL.
export function f2524_3a99(pat,attr){
 const r={ax:0x4f00|u16(pat)&0xff,bx:0,cx:u16(attr),dx:u16(pat),si:0,di:0,ds:DGROUP,es:0};int21(r);
 const al=r.ax&0xff;f2524_3a4c();return al;
}
// 2524:3ab7 findAttr / 2524:3abd findName
export function f2524_3ab7(){return rb(0x11c4);}
export function f2524_3abd(){return 0x1198;}
// 2524:3ac1 motorBit(n): (1<<n) & word 0000:043F.
export function f2524_3ac1(n){return (1<<(n&0x1f))&frw(0,0x43f)&0xffff;}
// 2524:3ada installCritErr: save INT 24h into CS:3ad6, INT 24h = 2524:3b06, [11c6]=1.
export function f2524_3ada(){
 wb(0x11c6,1);
 const r={ax:0x3524,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:0};int21(r);
 fww(CS,0x3ad6,r.bx);fww(CS,0x3ad8,r.es);
 int21({ax:0x2524,bx:0,cx:0,dx:0x3b06,si:0,di:0,ds:CS,es:0});
}
// 2524:3b06 critErrHandler (INT 24h, register object r): disk errors (AL bit 7 clear) set CS:3b05 and
// return AL=0 (ignore); others chain to the saved vector. Not reached in the port (no INT 24h source).
export function f2524_3b06(r={ax:0}){
 if(r.ax&0x80){callFar(fp(frw(CS,0x3ad8),frw(CS,0x3ad6)));return r;}
 fwb(CS,0x3b05,1);r.ax&=0xff00;return r;
}
// 2524:3b18 takeCritErr: returns and clears CS:3b05.
export function f2524_3b18(){const v=frb(CS,0x3b05);fwb(CS,0x3b05,0);return v;}
// 2524:3b24 restoreCritErr
export function f2524_3b24(){
 wb(0x11c6,0);
 int21({ax:0x2524,bx:0,cx:0,dx:frw(CS,0x3ad6),si:0,di:0,ds:frw(CS,0x3ad8),es:0});
}
// 2524:3b41 selectDrive(d): with the critical-error handler installed, probe the drive (AH=36h); if
// valid select it (AH=0Eh) and return the drive count, else 0. Drives 0/1 also set 0000:0504.
export function f2524_3b41(d){
 const saved=rb(0x11c6);
 if(saved===0)f2524_3ada();
 let dl=u16(d)&0xff;
 if(s8(dl)<=1)fwb(0,0x504,dl);
 const r={ax:0x3600,bx:0,cx:0,dx:u16(d)&0xff00|(dl+1&0xff),si:0,di:0,ds:DGROUP,es:0};int21(r);
 let ax=u16(r.ax+1);
 if(ax!==0){const s={ax:0x0e00,bx:0,cx:0,dx:u16(d),si:0,di:0,ds:DGROUP,es:0};int21(s);ax=s.ax&0xff;}
 if(saved===0)f2524_3b24();
 return ax;
}
// 2524:3b86 driveCount: INT 21h AH=0Eh with DL=FFh; AL = number of drives.
export function f2524_3b86(){const r={ax:0x0e00,bx:0,cx:0,dx:0xff,si:0,di:0,ds:DGROUP,es:0};int21(r);return r.ax&0xff;}
// 2524:3b96 forceRctExtension: cut DS:a8d8 at its last '.', append ".RCT".
export function f2524_3b96(){
 const p=u16(F.f1000_c2f6(0xa8d8,0x2e));
 if(p!==0)wb(p,0);
 F.f1000_c298(0xa8d8,0x11da);
}
// 2524:3bcc ditherRect(x,y,w,h): checkerboard of colour-7 pixels inside the rectangle's border.
export function f2524_3bcc(x,y,w,h){
 const x1=s16(x+w-1),y1=s16(y+h-1);
 for(let row=s16(y+1);row<y1;row++){
  for(let si=s16((row&1)+x+1);si<x1;si+=2)F.f1ff8_3d2b(u16(si),u16(row),7);
 }
}
// 2524:3c2c setPointer(x, y, noMouseSet): clamp to 0..[1fc2] x 0..[1fc4]; move the mouse unless noMouseSet;
// with a mouse, read it back (the mouse wins); [99bc]=1 when the position changed.
export function* f2524_3c2c(x,y,noMouseSet){
 ww(0x5a10,x);ww(0x5a12,y);
 if(rsw(0x5a10)<0)ww(0x5a10,0);else if(rsw(0x5a10)>rsw(0x1fc2))ww(0x5a10,rw(0x1fc2));
 if(rsw(0x5a12)<0)ww(0x5a12,0);else if(rsw(0x5a12)>rsw(0x1fc4))ww(0x5a12,rw(0x1fc4));
 if(u16(noMouseSet)===0&&rw(0xaa9a)!==0)F.f1ff8_404b(rw(0x5a10),rw(0x5a12));
 if(rw(0xaa9a)!==0)yield* F.f1ff8_4025(0x5a10,0x5a12);
 if(rw(0x5a16)!==rw(0x5a10)||rw(0x5a18)!==rw(0x5a12))ww(0x99bc,1);
 ww(0x5a16,rw(0x5a10));ww(0x5a18,rw(0x5a12));
}
// 2524:3cd6 drawMinimap: bounds of the [8986] track points (stride 6 at 5c9e/5ca0), city name, start marker,
// marker at point 1d04[city], and one dot per point. Scale: uldiv(((|min| + c) << 6 or 5), range).
export function f2524_3cd6(){
 wb(0x384b,1);
 ww(0x980c,0xc80);ww(0x98da,0xc80);ww(0x8ec2,0xf380);ww(0x8ed8,0xf380);
 const n=rsw(0x8986);
 if(n>0){
  let dx=rsw(0x98da);
  for(let i=0;i<n;i++){
   const px=rsw(0x5c9e+6*i),py=rsw(0x5ca0+6*i);
   if(px>rsw(0x8ec2))ww(0x8ec2,px);
   if(py>rsw(0x8ed8))ww(0x8ed8,py);
   if(px<rsw(0x980c))ww(0x980c,px);
   if(py<dx)dx=py;
  }
  ww(0x98da,dx);
 }
 if(rw(0x896c)!==0){wb(0x384d,0);wb(0x384e,0);F.f1ff8_3810(0x7b,0x9a,0x4b,0x2d);}
 ww(0x8e96,F.f1000_c148(rw(0x980c))+rw(0x8ec2));
 ww(0x8a32,F.f1000_c148(rw(0x98da))+rw(0x8ed8));
 ww(0xa66a,rsw(0x8e96)>=rsw(0x8a32)?rw(0x8e96):rw(0x8a32));
 wb(0x3840,0xa);
 F.f1ff8_3692(rw(0x8e72));
 F.f1ff8_23ba(rw(u16(rw(0x9808)<<1)+0x1ca0),0x7d,0xbf);
 F.f1ff8_3692(rw(0x8e98));
 if(rw(0xa66a)===0)return;
 const sc=(min,c,sh,range)=>{                               // 32-bit (CWD) add, SHL/RCL, unsigned long divide
  const a=lshl32(s16(F.f1000_c148(rw(min)))+s16(c),sh);
  return F.f1000_c080(a&0xffff,a>>>16&0xffff,...lw(rw(range)))&0xffff;
 };
 const pos=i=>{const x=sc(0x980c,rw(0x5c9e+6*i),6,0x8e96),y=sc(0x98da,rw(0x5ca0+6*i),5,0x8a32);return [u16(x+0x7f),u16(0xbe-y)];};
 let [x,y]=pos(0);
 F.f1ff8_2541(rw(rw(0x965a)+0x12),u16(x-4),u16(y+2));
 [x,y]=pos(rw(u16(rw(0x9808)<<1)+0x1d04));
 wb(0x384e,0xc);
 F.f1ff8_2541(rw(rw(0x965a)+0x22),u16(x-3),u16(y-3));
 for(let si=0;si<rsw(0x8986);si++){
  [x,y]=pos(si);
  wb(0x384d,0xf);wb(0x384e,0xf);
  if(rw(0x896c)!==0)F.f1ff8_3810(u16(x-1),u16(y-1),3,3);
  else F.f1ff8_3d2b(x,y,0xf);
 }
}
const lshl32=(v,n)=>(v<<n)>>>0;
// 2524:406e drawArmourBar: bar length 40*[9aa6]/[1c5c] (low 16 bits of the product, CWD) at (0x16,0xd).
export function f2524_406e(){
 const v=idiv16(s16(imul16(0x28,rw(0x9aa6))),rw(0x1c5c));
 if(v===rsw(0x5c98))return;
 if(rsw(0x5c98)>=0)ww(0x89ca,rw(0x896c)!==0?3:0xc);
 ww(0x3858,rw(0x3852));
 const c=rw(0x896c)!==0?0:0xc;wb(0x384e,c);wb(0x384d,c);
 F.f1ff8_3810(0x16,0xd,u16(v),6);
 const rest=u16(0x28-v);
 wb(0x384e,0xa);wb(0x384d,0xa);
 const si=u16(v+0x16);
 F.f1ff8_3810(si,0xd,rest,6);
 wb(0x384e,0xe);
 F.f1ff8_2454(si,0xd,si,0x12);
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
 F.f1ff8_2545(0x16,0xd,0x28,6);
 ww(0x5c98,v);
 ww(0x3858,rw(0x3852));
}
// 2524:4152 drawCockpit: cockpit overlay frames of [965a] for car model [9b0c] (skipped parts when [1fa4]),
// then the frame at (0x68,0x20) chosen by the model.
export function f2524_4152(){
 wb(0x384b,0);
 const h=()=>rw(0x965a),B=(o,x,y)=>F.f1ff8_2541(rw(h()+o),x,y);
 let f;
 switch(rw(0x9b0c)){
  case 0:
   if(rw(0x1fa4)===0){B(0,0,0x20);B(4,0x128,0x20);B(6,0,0x4c);B(8,0x128,0x4c);}
   f=1;break;
  case 1:
   if(rw(0x1fa4)===0){B(0x1a,0,0x5f);B(0x1c,0x97,0x5a);}
   f=1;break;
  case 2:
   if(rw(0x1fa4)===0){B(0x14,0x10,0x5b);B(0x16,0x100,0x5b);}
   f=0xc;break;
  default:f=undefined; // UNKNOWN: [bp-2] is uninitialised for other models (never happens: 0..2)
 }
 B(u16((f??0)<<1),0x68,0x20);
 wb(0x384b,1);
}
// 2524:426c drawStartLight(s): s != -1 plays effect 10; s != 0 draws frame 7 at (0xe8,0xe); s < 1 frame 8 at
// (0xdd,0xe); then copies (0xdd,0xe,0x14,7) to the front page.
export function f2524_426c(s){
 s=s16(s);
 wb(0x384b,0);
 ww(0x3858,rw(0x3852));
 if(s!==-1)f2524_041a(0xa);
 if(s!==0)F.f1ff8_2541(rw(rw(0x965a)+0xe),0xe8,0xe);
 if(s<1)F.f1ff8_2541(rw(rw(0x965a)+0x10),0xdd,0xe);
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
 F.f1ff8_2545(0xdd,0xe,0x14,7);
 wb(0x384b,rb(0x384b)+1);
}
// 2524:42f0 drawCountdownBar: length = frame counter / 4; colour red/12/yellow/green ([a462]=1 at green).
export function f2524_42f0(){
 let v=u16((rd(0x924e)>>>2));
 if(v===rw(0x2038))return;
 wb(0x384b,0);
 const sv=s16(v);
 if(sv<0xd)wb(0x384e,4);else if(sv<0x17)wb(0x384e,0xc);else if(sv<0x1d)wb(0x384e,0xe);
 else{wb(0x384e,0xa);ww(0xa462,1);}
 ww(0x3858,rw(0x3852));
 ww(0x2038,v);
 if(v!==0)v=u16(v-1);
 const si=u16(v+0xd1);
 F.f1ff8_2454(0xd1,5,si,5);
 F.f1ff8_2454(0xd1,7,si,7);
 F.f1ff8_2454(0xd1,3,si,3);
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
 F.f1ff8_2545(0xd1,3,0x1d,5);
 wb(0x384b,rb(0x384b)+1);
}
// 2524:43cc drawPitSign: frames 16/15 of [965a] at (0x11b,0xd) by [1fb4], copied to the front page.
export function f2524_43cc(){
 wb(0x384b,0);
 ww(0x3858,rw(0x3852));
 if(rw(0x1fb4)!==0){
  F.f1ff8_2541(rw(rw(0x965a)+0x20),0x11b,0xd);
  ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
  F.f1ff8_2545(0x11b,0xd,0x10,5);
  ww(0x3858,rw(0x3852));
  F.f1ff8_2541(rw(rw(0x965a)+0x1e),0x11b,0xd);
 }else{
  F.f1ff8_2541(rw(rw(0x965a)+0x1e),0x11b,0xd);
  ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
  F.f1ff8_2545(0x11b,0xd,0x10,5);
 }
 wb(0x384b,rb(0x384b)+1);
}
// 2524:4482 drawWeaponIcon: frame 5+[9a82] at (0x53,0x17), copied to the front page.
export function f2524_4482(){
 wb(0x384b,0);
 ww(0x3858,rw(0x3852));
 F.f1ff8_2541(rw(u16(rw(0x965a)+u16(rw(0x9a82)<<1)+0xa)),0x53,0x17);
 ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));
 F.f1ff8_2545(0x53,0x17,0x20,7);
 wb(0x384b,rb(0x384b)+1);
}
// 2524:44d6 addArmourDamage(n): past half armour, recompute the engine and damage it (44fc(0)).
export function f2524_44d6(n){
 ww(0x9aa6,rw(0x9aa6)+n);
 if(rsw(0x1c5c)>>1<rsw(0x9aa6)){f2524_26d2();f2524_44fc(0);}
}
// 2524:44fc damageEngine(k): 9b6c[k] -= 10*[1fd4]+30, minimum 20.
export function f2524_44fc(k){
 const si=u16(u16(k<<1)+0x9b6c);
 ww(si,rw(si)-u16(rw(0x1fd4)*10+0x1e));
 if(rsw(si)<0x14)ww(si,0x14);
}
// 2524:4528 damageTransmission: [8eb6] += 100 (max 1000), recompute engine.
export function f2524_4528(){ww(0x8eb6,rw(0x8eb6)+0x64);if(rsw(0x8eb6)>0x3e8)ww(0x8eb6,0x3e8);f2524_26d2();}
// 2524:4542 damageTires: [a670] += 120. QUIRK: past 1000 it ADDs 1000 instead of clamping (2524:454f).
export function f2524_4542(){ww(0xa670,rw(0xa670)+0x78);if(rsw(0xa670)>0x3e8)ww(0xa670,rw(0xa670)+0x3e8);}
// 2524:4556 damageAirfoil: [8dac] += 110, max 1000.
export function f2524_4556(){ww(0x8dac,rw(0x8dac)+0x6e);if(rsw(0x8dac)>0x3e8)ww(0x8dac,0x3e8);}
// 2524:456a damageBrakes: [aa9e] += 130, max 1000, recompute brakes.
export function f2524_456a(){ww(0xaa9e,rw(0xaa9e)+0x82);if(rsw(0xaa9e)>0x3e8)ww(0xaa9e,0x3e8);f2524_26e4();}
// Button centre of a button record: x + w/2 (signed), y + h/2 (bytes).
function* pointAtButton(b){
 const x=u16(rw(b+4)+Math.trunc(rsw(b+6)/2)),y=u16(rb(b+0xa)+(rb(b+0xb)>>1));
 yield* f2524_3c2c(x,y,0);
}
// 2524:4584 nextButton: next button of the current page after [8964] (wrapping); pointer onto it.
// In the file picker ([1f2a]) cycles the picker hot spots instead (469a).
export function* f2524_4584(){
 if(rw(0x1f2a)!==0){yield* f2524_469a();return;}
 let bx=rw(0x8a48);
 if(rw(bx+2)===0)return;
 let cx=rw(bx+2);const dx=rw(0x8964);
 while(cx!==0&&cx!==dx){bx=cx;cx=rw(bx+2);}
 if(cx===0||cx!==rw(0x8964)||rw(cx+2)===0)bx=rw(0x8a48);else bx=cx;
 ww(0x8964,rw(bx+2));
 if(rw(0x8964)===0)return;
 yield* pointAtButton(rw(0x8964));
}
// 2524:4612 prevButton: the button before [8964] (wrapping to the last one).
export function* f2524_4612(){
 if(rw(0x1f2a)!==0)return;
 let bx=rw(0x8a48);
 if(rw(bx+2)===0)return;
 let cx=rw(bx+2);const dx=rw(0x8964);
 for(;;){if(cx===0)break;if(rw(cx+2)===dx)break;cx=rw(cx+2);}
 if(cx===0){bx=rw(0x8a48);for(;;){cx=rw(bx+2);bx=cx;if(rw(bx+2)===0)break;}}
 ww(0x8964,cx);
 if(cx===0)return;
 yield* pointAtButton(rw(0x8964));
}
// 2524:469a nextPickerSpot: cycle [213e] over 5 picker positions (DS:2140 x, DS:214a y).
export function* f2524_469a(){
 ww(0x213e,rw(0x213e)+1);
 if(rsw(0x213e)>4)ww(0x213e,0);
 const si=u16(rw(0x213e)<<1);
 yield* f2524_3c2c(rw(si+0x2140),rw(si+0x214a),0);
}
// 2524:46c8 paletteEntry(c): EGA/VGA only: low nibble of colour c in the current palette table (41a4).
export function f2524_46c8(c){
 if(rb(0x385d)!==2&&rb(0x385d)!==3)return 0;
 const p=u16(u16(F.f1ff8_3c64(0)<<6)+0x41a4);
 return rw(u16(u16(c<<1)+p))&0xf;
}
// 2524:470a paletteCycleSetup(n, delay, colours): copy n attribute indices to DS:5ad0 and their current
// colours to DS:5ac0; [5ae0]=n, [5abe]=delay, [5ae2]=0. EGA/VGA only.
export function f2524_470a(n,delay,list){
 if(rb(0x385d)!==2&&rb(0x385d)!==3)return;
 ww(0x5ae0,n);ww(0x5abe,delay);
 let cnt=u16(n),src=u16(list),si=0x5ad0,di=0x5ac0;
 if(cnt!==0){
  do{const a=rb(src);wb(si++,a);src=u16(src+1);wb(di++,f2524_46c8(s8(a)));cnt=u16(cnt-1);}while(cnt!==0);
 }
 ww(0x5ae2,0);
}
// 2524:478a paletteCycleStep: every [5abe]+1 calls rotate the colours left by one, wait for retrace and
// program the attribute registers (1ff8:3cf5).
export function* f2524_478a(){
 if(rb(0x385d)!==2&&rb(0x385d)!==3)return;
 if(rw(0x5ae0)===0)return;
 if(rw(0x5ae2)!==0){ww(0x5ae2,rw(0x5ae2)-1);return;}
 ww(0x5ae2,rw(0x5abe));
 const first=rb(0x5ac0);
 const n1=u16(rw(0x5ae0)-1);
 for(let i=0;i<n1;i++)wb(0x5ac0+i,rb(0x5ac1+i));
 wb(0x5ac0+n1,first);
 yield* F.f1000_aeaa();
 for(let i=0,n=rw(0x5ae0);i<n;i++)F.f1ff8_3cf5(u16(rsb(0x5ad0+i)),u16(rsb(0x5ac0+i)));
}
// 2524:4850 showActivision (TTM '*'): "ACTIVISIO" palette and screen, palette cycling for up to 720
// timer ticks or until input ([8eba]=1), then restore the pals.blk palette.
// NOTE: the name is 9 characters; DOS truncates it to ACTIVISI (docs/re/resources.md open questions).
export function* f2524_4850(){
 F.f1000_c156();
 f2524_2be8(0x2ab2);
 const f=F.f1ff8_4a48(0x99ec);
 if(u16(f)===0)return;
 const pal=F.f1ff8_3c64(F.f1ff8_3b7a(f));
 ww(0x3858,rw(0x3852));
 F.f1ff8_2fca(f);
 F.f1ff8_4da4(f);
 f2524_470a(8,0x10,0x2abc);
 ww(0x3858,rw(0x3854));ww(0x3856,rw(0x3852));
 F.f1ff8_2545(0,0,0x140,0xc8);
 F.f1000_a390(0x2d0);
 let di=0xffff;
 for(;;){
  const si=u16(yield* F.f1000_a39c());
  if(si!==di){di=si;yield* f2524_478a();}
  if(u16(yield* f2524_0534())!==0){ww(0x8eba,1);break;}
  if(si===0)break;
 }
 F.f1ff8_3ca6(pal);
 F.f1000_c156();
 F.f1ff8_3c64(rw(0xa252));
}
// 2524:4942 setTickCallback(off, seg, _): -> 1000:c52d(off, seg). The third word (0xd) is ignored.
export function f2524_4942(off,seg){F.f1000_c52d(off,seg);}
// 2524:4956 soundTimerInit(_): timer install, music slots 1/3/5/7 = 1000:c731, device by [2d2a]
// (0 = auto: MT-32, AdLib, Tandy, speaker). Returns soundDeviceType().
export function f2524_4956(){
 F.f1000_c442();
 if(rw(0x2d28)!==0){
  const s=gseg(0x1000);
  for(const n of [1,3,5,7])F.f1000_c4cc(n,0xc731,s);
  let ok;
  const one=d=>{ww(0x2d32,d);ok=F.f1000_cd68(d);};
  switch(rw(0x2d2a)){
   case 1:one(0x34d6);break;
   case 2:one(0x3004);break;
   case 3:one(0x2d8a);break;
   case 4:one(0x2ec8);break;
   default:{
    ok=1;
    let found=false;
    for(const d of [0x2ec8,0x2d8a,0x3004,0x34d6]){ww(0x2d32,d);if(u16(F.f1000_cd68(d))!==0){found=true;break;}}
    if(!found)ww(0x2d32,0);
   }
  }
  if(rw(0x2d32)!==0&&u16(ok)!==0)F.f1000_cd72(rw(0x2d32));
  if(rw(0x2d32)===0x34d6||rw(0x2d32)===0x3004)ww(0x2d34,1);
  wb(0x2d38,1);
 }
 return f2524_4b00();
}
// 2524:4a94 soundShutdown
export function f2524_4a94(){
 F.f32e3_0013();
 F.f1000_c543();
 if(rw(0x2d32)!==0){F.f1000_c715();F.f1000_cdac();}
 for(const n of [1,3,5,7])F.f1000_c4cc(n,0,0);
 F.f1000_c48d();
 F.f1000_c543();
 wb(0x2d38,0);
}
// 2524:4b00 soundDeviceType: 4 MT-32, 3 AdLib, 2 Tandy, 1 speaker, 0 none.
export function f2524_4b00(){
 switch(rw(0x2d32)){case 0x2ec8:return 4;case 0x2d8a:return 3;case 0x3004:return 2;case 0x34d6:return 1;}
 return 0;
}
// 2524:4b34 loadMusic(fpOrName): SND: leaf decoded into a DOS block; returns seg:0 packed, or 0.
// QUIRK: on a short read it frees the block's offset with the near free (c280(0)) and leaks the block.
export function f2524_4b34(name){
 let f,own;
 if(u16(F.f1ff8_4de0(name))===0){f=F.f1ff8_4a48(name);own=1;}else{f=name;own=0;}
 if(u16(f)===0)return 0;
 const fail=()=>{if(own)F.f1ff8_4da4(f);return 0;};
 if((F.f1ff8_4ade(f,0x2d39,0)>>>0)===0xffffffff)return fail();
 const len=F.f1ff8_4d72(f)>>>0;
 const h=F.f1ff8_0d47(0xffff,f,0x2d3e,len&0xffff,len>>>16);
 if(s16(h)<0)return fail();
 const size=F.f1ff8_1310(h)>>>0;
 const p=F.f1ff8_3a88(size&0xffff,size>>>16,0)>>>0;
 if(p===0){F.f1ff8_100d(h);return fail();}
 const got=u16(F.f1ff8_11f0(h,poff(p),pseg(p),size&0xffff));
 F.f1ff8_100d(h);
 if(own)F.f1ff8_4da4(f);
 if(got!==(size&0xffff)||(size>>>16)!==0){
  F.f1ff8_100d(h);
  if(own)F.f1ff8_4da4(f);
  F.f1000_c280(poff(p));
  return 0;
 }
 return p;
}
// 2524:4c8a freeMusic(off, seg)
export function f2524_4c8a(off,seg){F.f1ff8_3ae2(off,seg);}
// 2524:4c9e musicPlay(off, seg): 1000:c60a(off, seg, 1)
export function f2524_4c9e(off,seg){F.f1000_c60a(off,seg,1);}
// 2524:4cb6 / 4cbc / 4cc2 / 4cc8 / 4cce / 4cd4: sequencer wrappers (stop, mute, unmute, pause, resume, status).
export function f2524_4cb6(){F.f1000_c715();}
export function f2524_4cbc(){F.f1000_c6dc();}
export function f2524_4cc2(){F.f1000_c6fa();}
export function f2524_4cc8(){F.f1000_c6a3();}
export function f2524_4cce(){F.f1000_c6c1();}
export function f2524_4cd4(){return F.f1000_c552();}
// 2524:4cda musicPlayIfIdle(off, seg). No callers.
export function f2524_4cda(off,seg){if(u16(F.f1000_c552())===0)F.f1000_c60a(off,seg,1);}
// 2524:4cfa startEffect(n, prio): wake the ISR effect tick and start the effect (if the subsystem is on).
export function f2524_4cfa(n,prio){if(rw(0x2d2c)!==0){ww(0x365f,1);F.f32e3_043f(n,prio);}}

export {f2524_043c as parseCmdline,f2524_0260 as hardwareInit,f2524_0584 as playTitleTtm,f2524_0720 as creditsScroll,
 f2524_0624 as demoScriptStep,f2524_0c66 as ttmRun,f2524_1528 as screenTransition,f2524_18f4 as raceInit,
 f2524_21d2 as buildQuizAnswers,f2524_23fe as setSoundOption,f2524_2be8 as buildGamePath,f2524_3c2c as setPointer,
 f2524_4584 as nextButton,f2524_4612 as prevButton,f2524_4850 as showActivision,f2524_4b34 as loadMusic};

// Function pointers stored in data: the picker button drawers (DS:1178) and the INT 24h handler.
register(0x2524,0x38fa,f2524_38fa);
register(0x2524,0x392a,f2524_392a);
register(0x2524,0x39ea,f2524_39ea);
register(0x2524,0x395a,f2524_395a);
register(0x2524,0x39a2,f2524_39a2);
register(0x2524,0x3b06,f2524_3b06,{name:'critErrHandler'});
provide({f2524_0008,f2524_0054,f2524_007a,f2524_009e,f2524_012e,f2524_01da,f2524_0260,f2524_0382,f2524_039c,f2524_03dc,f2524_03f2,f2524_041a,f2524_043c,f2524_0534,f2524_0584,f2524_0624,f2524_0720,f2524_089c,f2524_08de,f2524_0a7c,f2524_0bb6,f2524_0bd8,f2524_0bee,f2524_0c34,f2524_0c66,f2524_120e,f2524_1292,f2524_12b0,f2524_12e6,f2524_136a,f2524_1392,f2524_13e2,f2524_146c,f2524_14a2,f2524_14d4,f2524_1528,f2524_1896,f2524_18ba,f2524_18e0,f2524_18f4,f2524_1de8,f2524_1e30,f2524_1e8a,f2524_1eaa,f2524_1f04,f2524_1f64,f2524_203a,f2524_2058,f2524_2140,f2524_21d2,f2524_2280,f2524_2396,f2524_23fe,f2524_2452,f2524_258c,f2524_26c0,f2524_26d2,f2524_26e4,f2524_2710,f2524_2744,f2524_2758,f2524_2998,f2524_2b00,f2524_2bbe,f2524_2be8,f2524_2c22,f2524_2c9a,f2524_2d1c,f2524_2d48,f2524_2d6a,f2524_2d8e,f2524_2db2,f2524_2fc0,f2524_3020,f2524_308a,f2524_3134,f2524_328e,f2524_3546,f2524_3554,f2524_356a,f2524_35b0,f2524_3606,f2524_3636,f2524_3658,f2524_36de,f2524_3730,f2524_3782,f2524_379e,f2524_37bc,f2524_37da,f2524_37f4,f2524_38fa,f2524_392a,f2524_395a,f2524_39a2,f2524_39ea,f2524_3a18,f2524_3a4c,f2524_3a7b,f2524_3a99,f2524_3ab7,f2524_3abd,f2524_3ac1,f2524_3ada,f2524_3b06,f2524_3b18,f2524_3b24,f2524_3b41,f2524_3b86,f2524_3b96,f2524_3bcc,f2524_3c2c,f2524_3cd6,f2524_406e,f2524_4152,f2524_426c,f2524_42f0,f2524_43cc,f2524_4482,f2524_44d6,f2524_44fc,f2524_4528,f2524_4542,f2524_4556,f2524_456a,f2524_4584,f2524_4612,f2524_469a,f2524_46c8,f2524_470a,f2524_478a,f2524_4850,f2524_4942,f2524_4956,f2524_4a94,f2524_4b00,f2524_4b34,f2524_4c8a,f2524_4c9e,f2524_4cb6,f2524_4cbc,f2524_4cc2,f2524_4cc8,f2524_4cce,f2524_4cd4,f2524_4cda,f2524_4cfa});
