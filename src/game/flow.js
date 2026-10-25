// 1000:0000-6dbb game flow: main, fatal exit, race loop driver, dialog pages, dispatcher, shops, standings,
// results, copy-protection quiz, race entry, .MAP loading, menu loops and pointer handling, saves and HI_SCORE.
// Translated from the disassembly of DTRACK.EXE (Ghidra addresses). Analysis: docs/re/gameflow.md, race.md,
// input-timer-sound.md. Calls outside this range go through the late-bound table F (src/game/link.js).
import {rb,rsb,rw,rsw,rd,rsd,wb,ww,wd,frb,frsb,frw,frsw,frd,frsd,fwb,fww,fwd,fp,pseg,poff,padd,salloc,sfree,getStack,strAt,gseg,gaddr,DGROUP} from '../engine/mem.js';
import {s8,u8,s16,u16,s32,u32,idiv16,imod16,idiv32_16,imod32_16,div16,mod16,div32_16,mod32_16,imul16,mul16,lmul,ldiv,lmod,uldiv,ulmod,lshl,lsar,lshr,sar16,shr16,shl16} from '../engine/int.js';
import {idle,register,callFar,callFarG,unsupported} from '../engine/host.js';
import * as ega from '../engine/ega.js';
import {int10,int21,int33,vstatus,outp,inp} from './bios.js';
import {F,provide} from './link.js';
import {frameCost,probe} from './pacing.js';
// Near code pointer in segment 1000 -> packed far address for the host registry.
const near=off=>gaddr(0x1000,off&0xffff);
// Cross-module calling convention (as in seg2524.js/timer.js/sfx.js): one JS argument per 16-bit word the
// original pushes, in C order. A far pointer argument is (off, seg) and a long argument (lo, hi). Returned
// far pointers and DX:AX longs are one packed 32-bit number. lw() splits a 32-bit value into (lo, hi).
const lw=v=>[v&0xffff,v>>>16&0xffff];

// ===== A =====

// ======================================================================
// Part A: 1000:0010-1207 (main, page-selector helpers, fatal exit, race loop, page builder)
// ======================================================================

// 1000:0010 main(argc, argv): init, attract, start page, event loop (gameflow.md §1). argv is a near pointer to near string pointers.
export function* f1000_0010(argc,argv){
 if(!F.f1000_e740(0xa902,0x3b))f1000_0344(0x42); // getcwd into DS:a902; "Unable to find path to the game source"
 // Cut argv[0] at the last '\' before its '.' (no bound check, as in the original).
 let cx=F.f1000_c2f6(rw(argv),0x2e)&0xffff;
 while(rb(cx)!==0x5c)cx=u16(cx-1);
 if(cx)wb(cx,0);
 F.f1000_c2ce(0x8f0c,rw(argv));           // strcpy(game dir, argv[0])
 F.f1000_e70b(0x8f0c);                    // chdir
 F.f2524_043c(argc,argv);                 // command line, adapter detection -> [0x95d6]
 wb(0x3842,1);
 if(rw(0x95d6)===0)f1000_0344(0x76);      // "Hardware not compatible."
 else if(rw(0x95d6)===1)unsupported('1000:00a7 CGA mode 6 (1000:a536)');
 f1000_045a();
 F.f1000_a403();                          // RNG index reset
 F.f2524_0260();                          // input/system init
 ww(0x1fba,0);
 f1000_38e4(0x9c);                        // "SLY.BMP" disk-2 probe
 if(rw(0x9bc2)!==0){f1000_390a();ww(0x9b84,0);}
 else ww(0x9b84,1);
 ww(0x1fba,1);
 F.f2524_2be8(0xa4);                      // "PALS.BLK" -> DS:99ec path
 const h=F.f1ff8_4a48(0x99ec)&0xffff;
 if(h){
  const snd=F.f32e3_009a(h)&0xffff;ww(0x8f9c,snd);
  F.f32e3_05ba(snd);
  for(let si=0xa252,di=2;di;si+=2,di--)ww(si,F.f1ff8_3b7a(h));
  F.f1ff8_3c64(rw(0xa252));
  const pb=F.f1ff8_0006(h)&0xffff;ww(0x9bf6,pb);
  if(!pb)f1000_0344(0xad);                // "Unable to load pointer bitmap"
  F.f1ff8_4da4(h);
 }
 F.f2524_2be8(0xd8);                      // "danger.mus"
 const mus=F.f2524_4b34(0x99ec)>>>0;
 ww(0x8f06,poff(mus));ww(0x8f08,pseg(mus));
 if(!(rw(0x8f06)|rw(0x8f08)))f1000_0344(0xe3); // "Unable to load sounds."
 F.f2524_009e();                          // fonts.blk
 if(rw(0x1fa8)===0){
  // APPROX: far pointer arguments (pushed seg:off) are passed packed, as fp(seg,off).
  F.f2524_03f2(rw(0x8f06),rw(0x8f08));
  for(;;){
   let r=yield* F.f2524_0584();            // TITLE.TTM
   if(r!==0||rw(0x8eba)!==0)break;
   r=yield* F.f2524_0720();                // credits scroller
   if(r!==0){f1000_02ea();break;}
  }
  F.f2524_4cb6();                         // stop music
 }
 yield* f1000_03f6();                     // POSTWAR.SCR backdrop
 F.f2524_012e();                          // bitmaps.blk
 F.f2524_0008();                          // sprite anchors
 f1000_070a();                            // build the 56 dialog pages
 F.f1ff8_3692(rw(0x8e98));                // 6x6 font
 F.f2524_18e0();
 F.f2524_2be8(0x107);                     // "SHAPE"
 F.f1000_a53c(0x99ec);
 F.f2524_01da();                          // trax.mus
 F.f2524_03f2(rw(0x8f06),rw(0x8f08));
 if(rw(0x1fa8)!==0){
  if(rw(0x9b84)!==0){ww(0x9b22,0xb);yield* f1000_6d76(0xd,0);}
  else{ww(0x1fa6,rw(0x1fa6)+1);yield* f1000_2eb8();}
 }else{ww(0x1fba,1);yield* f1000_1bea();}
 F.f2524_1de8();
 yield* f1000_67e8();                     // event loop, never returns
}
export {f1000_0010 as main};

// 1000:026a..02c4 blit page selectors: set [0x3856] (destination) and [0x3858] (source) from the video pages 3850/3852/3854.
export function f1000_026a(){ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3854));}
// 1000:0278 page selector: dst=3854, src=3852
export function f1000_0278(){ww(0x3858,rw(0x3852));ww(0x3856,rw(0x3854));}
// 1000:0286 page selector: dst=src=3852
export function f1000_0286(){ww(0x3858,rw(0x3852));ww(0x3856,rw(0x3852));}
// 1000:0290 page selector: dst=3852, src=3850
export function f1000_0290(){ww(0x3856,rw(0x3852));ww(0x3858,rw(0x3850));}
// 1000:029e page selector: src=3850, dst=3852
export function f1000_029e(){ww(0x3858,rw(0x3850));ww(0x3856,rw(0x3852));}
// 1000:02ac page selector: dst=src=3850
export function f1000_02ac(){ww(0x3856,rw(0x3850));ww(0x3858,rw(0x3850));}
// 1000:02b6 page selector: dst=3850, src=3854
export function f1000_02b6(){ww(0x3856,rw(0x3850));ww(0x3858,rw(0x3854));}
// 1000:02c4 page selector: dst=3850, src=3852
export function f1000_02c4(){ww(0x3856,rw(0x3850));ww(0x3858,rw(0x3852));}
// 1000:02d2 copy page 3852 to 3850 (full screen), then select 3852/3852.
export function f1000_02d2(){f1000_02c4();f1000_0304();f1000_0286();}
// 1000:02dc restore screen: 3852->3850, 3854->3852, select 3852/3852.
export function f1000_02dc(){f1000_02d2();f1000_026a();f1000_0304();f1000_0286();}
// 1000:02ea reset clip rect to 0..319 x 0..199 and [0x384f]=0xf.
export function f1000_02ea(){ww(0x3843,0);ww(0x3847,0);ww(0x3849,0xc7);ww(0x3845,0x13f);wb(0x384f,0xf);}
// 1000:0304 full-screen blit 320x200 from [0x3858] to [0x3856] (1ff8:2545).
export function f1000_0304(){F.f1ff8_2545(0,0,0x140,0xc8);}
// 1000:031a clear the screen: reset clip, fill colours 0, clear page 3854 and copy it through.
export function f1000_031a(){
 f1000_02ea();wb(0x384d,0);wb(0x384e,0);
 f1000_0278();F.f1ff8_3810(0,0,0x140,0xc8);
 f1000_026a();f1000_0304();
}

// 1000:0344 fatalExit(msg): restore cwd and hardware, print msg and credits, exit(1). Also the normal quit and the protection penalty.
export function f1000_0344(msg){
 F.f1000_e70b(0xa902);                    // chdir back to the startup directory
 F.f2524_3b24();F.f1ff8_21cd();F.f1ff8_21e2();
 f1000_038a(msg);
 f1000_038a(0x10d);                       // "Deathtrack USA."
 f1000_038a(0x11d);                       // "(C) Dynamix, Inc. 1989"
 F.f1000_d512(1);                         // exit(1)
}
export {f1000_0344 as fatalExit};

// 1000:038a printLine(str): copy to a local buffer, append DS:0134 ("~\n$"), turn the first '~' into CR, print with INT 21h AH=9.
export function f1000_038a(str){
 const buf=salloc(0x50);
 try{
  F.f1000_c2ce(buf,str);
  // Inline strcat(buf, DS:0134) (REPNE SCASB / REP MOVSW / MOVSB).
  let n=0;while(rb(0x134+n))n++;n++;
  let d=buf;while(rb(d))d=u16(d+1);
  for(let i=0;i<n;i++)wb(d+i,rb(0x134+i));
  const p=F.f1000_c2f6(buf,0x7e)&0xffff;
  if(p)wb(p,0xd);
  f1000_046c(buf);
 }finally{sfree(0x50);}
}

// 1000:03f6 drawMenuBackdrop: POSTWAR.SCR into page 3850, transition to the screen, pointer to (0x9a,0xb4), shape 1.
export function* f1000_03f6(){
 f1000_0290();
 F.f2524_2be8(0x1e0);                     // "POSTWAR.SCR"
 F.f1ff8_2fca(0x99ec);
 f1000_02c4();f1000_0304();f1000_026a();
 F.f2524_1528(0,0,0x140,0xc8,0x50);
 yield* F.f2524_3c2c(0x9a,0xb4,0);
 f1000_69ca();
}
export {f1000_03f6 as drawMenuBackdrop};

// 1000:044a far: fatalExit("Exit(1)"). Called far from the keyboard ISR (1ff8:4394).
export function f1000_044a(){f1000_0344(0x1ec);}

// 1000:045a if [0x385d] (adapter) != 3 call 1000:c00e (purpose unknown, gameflow.md §1 step 6).
export function f1000_045a(){if(rb(0x385d)!==3)F.f1000_c00e();}

// 1000:0466 returns the far pointer 29f6:0000 (DX:AX).
export function f1000_0466(){return fp(gseg(0x29f6),0);}

// 1000:046c dosPrint(str): INT 21h AH=09h with DS:DX=str ('$'-terminated).
export function f1000_046c(str){const r={ax:0x0900,bx:0,cx:0,dx:str&0xffff,si:0,di:0,ds:DGROUP,es:DGROUP};int21(r);}

// 1000:047c raceLoop: per-race setup, then one iteration per frame until [0x924c] (exit code) is set or the wreck countdown ends (race.md).
export function* f1000_047c(){probe('047c');
 ww(0x8956,1);ww(0x9252,1);ww(0x5c9a,1);ww(0x9656,1);ww(0xa8ec,1);
 let laps=s16(F.f1000_def2(rw(0xb4e)));   // atoi(laps string)
 if(laps>1)laps=s16(F.f1000_def2(rw(0xb4e)));else laps=1;
 ww(0x8eb8,laps);
 if(laps>0x63)laps=0x63;
 ww(0x8eb8,laps);
 F.f2c46_004e();
 ww(0x59f6,0xffff);
 F.f2524_18f4();
 f1000_1692();
 if(rw(0x8f02)|rw(0x8f04))F.f2524_03f2(rw(0x8f02),rw(0x8f04));
 // The loop body is f1000_04ed so a checkpoint replay can enter at the loop head (no JS locals cross iterations).
 // Stack frame as in the original (near CALL + PUSH BP + SUB SP,6) so [BP-2..BP-6] land in emulated stack memory.
 salloc(4);raceFrame.bp=getStack();salloc(6);
 try{for(;;){const r=yield* f1000_04ed();if(r!==undefined)return r;}}finally{sfree(10);}
}
// BP of 047c's frame; a checkpoint replay sets it from the captured registers.
export const raceFrame={bp:0};

// 1000:04ed raceFrame: one iteration of the race loop body (04ed-06cb). Returns undefined to continue, or 0 after the
// exit-side calls of the 05fd/0632 exits (the original 047c returns void; 0 is the port's 'loop ended' marker).
// Generator although not in blocking.json (it is the split-out body of 047c).
export function* f1000_04ed(){
 yield* frameCost();probe('04ed');
 ww(0x59f4,rw(0x8926));
 f1000_06dc();
 yield* F.f1000_6dbc();
 wb(0x384b,1);
 F.f1000_9542();
 yield* F.f1000_7982();
 F.f1000_8b94();
 F.f1000_b234();
 F.f1000_863c(1);
 F.f1000_b17e();
 ww(0x8db2,rw(0x8db2)+1);
 F.f2f73_02a4();
 F.f1000_996c();
 F.f1000_a570();
 if(rw(0x1f82)!==0)F.f1000_9bcc();
 F.f1000_b6dc();
 F.f1000_863c(0);
 F.f1000_ba72();
 F.f1000_bc30();
 f1000_02ea();
 F.f2524_4152();
 F.f1000_afc4();
 if(rw(0xa462)!==0)F.f1000_8c10();
 if((rb(0x924e)&3)===0){
  F.f1000_77c8();
  // 1000:0561 protection penalty (gameflow.md §5). [0x1fb8] is never set in this build, so this stays inert.
  if(rw(0x1fb8)!==0){
   if(rw(0x9250)!==0||rw(0x924e)>0x74)f1000_0344(0x620); // "Incorrect answer for protection."
  }
 }
 // 32-bit frame counter [0x924e]:[0x9250] (ADD/ADC).
 const lo=rw(0x924e)+1;ww(0x924e,lo);ww(0x9250,rw(0x9250)+(lo>>16));
 if(rw(0x924e)===0xa&&rw(0x9250)===0)F.f2524_426c(0);
 else if(rw(0x924e)===0x14&&rw(0x9250)===0){ww(0x895a,0);F.f2524_426c(1);}
 F.f1ff8_2555(0);
 F.f1ff8_2559(0,0,0x140,0x64);
 if(rw(0xa672)===0){
  F.f2524_03f2(rw(0x8f06),rw(0x8f08));
  F.f1ff8_3cf1(0);
  return 0;
 }
 if(rsw(0xa672)>0)ww(0xa672,rw(0xa672)-1);
 if(rw(0x924c)!==0){
  F.f1ff8_3cf1(0);
  F.f2524_03f2(rw(0x8f06),rw(0x8f08));
  F.f1000_85f0();
  return 0;
 }
 if((rw(0x8f02)|rw(0x8f04))&&F.f2524_4cd4()===0)F.f2524_03f2(rw(0x8f02),rw(0x8f04));
 const pos=rsw(0x96f2),lo2=rsw(0x1d04+rw(0x9808)*2),hi2=s16(lo2+0x3c);
 // 065b-066e store these in [BP-2], [BP-4], [BP-6]; mirrored so the stack matches the original.
 const bp=raceFrame.bp;if(bp){ww(bp-2,pos);ww(bp-4,lo2);ww(bp-6,hi2);}
 if(pos>lo2&&pos<hi2){
  ww(0x1fb4,1);
  if(rw(0x59f4)!==0&&rw(0x8926)===0&&rsw(0xa97a)>0x37&&rb(0x8a54)===1){
   F.f2524_03f2(rw(0x8f06),rw(0x8f08));
   yield* f1000_23e2();                  // pit menu
   yield* f1000_68dc();                  // modal loop
  }
 }else ww(0x1fb4,0);
 if(rw(0x59f6)!==rw(0x1fb4)){
  F.f2524_43cc();
  ww(0x59f6,rw(0x1fb4));
 }
}
export {f1000_047c as raceLoop};

// 1000:06dc per-frame: [0x9aec]=DS:1cc8[city]; if [0x89ca] changed from [0x59f8], set the border colour (1ff8:3cf1), else clear [0x89ca].
export function f1000_06dc(){
 ww(0x9aec,rw(0x1cc8+u16(rw(0x9808)<<1)));
 const v=rw(0x89ca);
 if(rw(0x59f8)!==v){ww(0x59f8,v);F.f1ff8_3cf1(v);return;}
 ww(0x89ca,0);
}

// 1000:0708 empty function (RET).
export function f1000_0708(){}

// 1000:070a buildPages: create all 56 dialog pages (gameflow.md §2). Generated mechanically from the disassembly.
export function f1000_070a(){
 f1000_3a16();
 f1000_3a1e(0x1);
 f1000_3b46(0x2712,0);
 f1000_3b46(0x65f,0);
 f1000_3b46(0x673,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0x1);
 f1000_3b46(0x2712,0);
 f1000_3b46(0x674,0);
 f1000_3b46(0xa8d8,0);
 f1000_3b46(0x67e,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0x1);
 f1000_3b46(0x2712,0);
 f1000_3b46(0x68b,0);
 f1000_3b46(0xa8d8,0);
 f1000_3b46(0x69d,0);
 f1000_3b46(0x2746,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0x1);
 f1000_3b46(0x2712,0);
 f1000_3b46(0x6b5,0);
 f1000_3b46(0xa8d8,0);
 f1000_3b46(0x6c2,0);
 f1000_3b46(0x2746,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3bb6(0x6da);
 f1000_3bb6(0x6f1);
 f1000_3bb6(0x6fd);
 f1000_3bb6(0x70d);
 f1000_3bb6(0x717);
 f1000_3bb6(0x727);
 f1000_3bb6(0x737);
 f1000_3bb6(0x73e);
 f1000_3bb6(0x746);
 f1000_3a1e(0x1);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3bb6(0x74f);
 f1000_3bb6(0x75a);
 f1000_3bb6(0x768);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_11f2();
 for(let si=0x1ca0,di=0xa;di;si+=2,di--){
  f1000_3bb6(rw(si));
 }
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_11f2();
 for(let si=0x2816,di=0x4;di;si+=2,di--){
  f1000_3bb6(rw(si));
 }
 f1000_3a1e(0);
 f1000_3b46(0x77e,0);
 f1000_3bb6(0x77f);
 f1000_3bb6(0x784);
 f1000_3a1e(0);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0x27d0,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0);
 f1000_3b46(0x7a4,0);
 f1000_3b46(0x7a5,0);
 f1000_3bb6(0x7bb);
 f1000_3a1e(0);
 f1000_3b46(0x7c4,0);
 f1000_3b46(0x7c5,0);
 f1000_11f2();
 f1000_3b46(rw(0xb4e),0x1);
 f1000_11f2();
 f1000_3b46(0x7e3,0);
 f1000_3b46(0x7f6,0);
 for(let si=0x280e,di=0x4;di;si+=2,di--){
  f1000_3bb6(rw(si));
 }
 f1000_3a1e(0);
 f1000_11f2();
 for(let si=0x17a4,di=0x9;di;si+=2,di--){
  f1000_3bb6(rw(si));
 }
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3bb6(0x2754);
 f1000_3bb6(0x7f7);
 f1000_3a1e(0);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_11f2();
 for(let si=0x1ca0,di=0xa;di;si+=2,di--){
  f1000_3bb6(rw(si));
 }
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0x800,0);
 for(let si=0xf;si;si--){
  f1000_3b46(0x27e8,0);
 }
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 for(let si=0xf;si;si--){
  f1000_3b46(0x812,0);
 }
 f1000_3b46(0x813,0);
 f1000_3b46(0x81e,0);
 f1000_3b46(0x1792,0x1);
 f1000_3b46(0x81f,0);
 f1000_3bb6(0x820);
 wb(0x1792,0x0);
 f1000_3a1e(0x1);
 f1000_3b46(0x841,0);
 f1000_3b46(0x842,0);
 f1000_3bb6(0x2722);
 f1000_3bb6(0x2726);
 f1000_3a1e(0);
 f1000_3b46(0x279e,0);
 for(let si=0xf;si;si--){
  f1000_3b46(0x27e8,0);
 }
 f1000_3bb6(0x2768);
 f1000_3bb6(0x2760);
 f1000_3bb6(0x27aa);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3b46(0x27aa,0);
 for(let si=0xc;si;si--){
  f1000_3b46(0x857,0);
 }
 f1000_3bb6(0x87c);
 f1000_3bb6(0x87f);
 f1000_3bb6(0x2768);
 f1000_3bb6(0x2760);
 f1000_3bb6(0x279e);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3a1e(0);
 f1000_3bb6(0x2730);
 f1000_3a1e(0);
 f1000_3bb6(0x2772);
 f1000_3a1e(0);
 f1000_3bb6(0x882);
 f1000_3a1e(0);
 f1000_3bb6(0x2772);
 f1000_3a1e(0);
 f1000_3b46(0x27e8,0);
 f1000_3bb6(0x279e);
 f1000_3bb6(0x27aa);
 f1000_3a1e(0);
 f1000_3b46(0x8a3,0);
 f1000_3b46(0x8a4,0);
 f1000_3b46(0x8c2,0);
 f1000_3bb6(0x2730);
 f1000_3a1e(0);
 f1000_3b46(0x8d9,0);
 f1000_3b46(0x8da,0);
 f1000_3bb6(0x8f8);
 f1000_3a1e(0x1);
 f1000_11f2();
 f1000_3b46(0x2712,0);
 f1000_3b46(0x900,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0x1);
 f1000_11f2();
 f1000_3b46(0x2712,0);
 f1000_3b46(0x911,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0x1);
 f1000_11f2();
 f1000_3b46(0x2712,0);
 f1000_3b46(0x929,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0x1);
 f1000_11f2();
 f1000_3b46(0x2712,0);
 f1000_3b46(0x943,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0x1);
 f1000_11f2();
 f1000_3b46(0x2712,0);
 f1000_3b46(0x954,0);
 f1000_3b46(0x969,0);
 f1000_3b46(0xa8d8,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0x1);
 f1000_3b46(0x979,0);
 f1000_3b46(0x97a,0);
 f1000_3bb6(0x2726);
 f1000_3bb6(0x2722);
 f1000_3a1e(0);
 f1000_3a1e(0);
 f1000_3b46(0x999,0);
 for(let si=0x12;si;si--){
  f1000_3b46(0x27e8,0);
 }
 f1000_3bb6(0x9a7);
 f1000_3a1e(0);
 f1000_3b46(0x9ad,0);
 f1000_3b46(0x9ae,0);
 f1000_3b46(0x9cf,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0);
 f1000_3b46(0x9df,0);
 f1000_3b46(0x9e0,0);
 f1000_3b46(0x9fa,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0);
 f1000_3b46(0xa07,0);
 f1000_3b46(0xa08,0);
 f1000_3b46(0xa26,0);
 f1000_3b46(0xa3e,0);
 f1000_3bb6(0x2794);
 f1000_3a1e(0);
 f1000_3b46(0xa5a,0);
 f1000_3b46(0xa5b,0);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_3bb6(0xa72);
 f1000_3a1e(0);
 f1000_3b46(0xa7a,0);
 f1000_3b46(0xa7b,0);
 f1000_3b46(0xa98,0);
 f1000_3bb6(0x2736);
 f1000_3a1e(0);
 f1000_3b46(0xaa8,0);
 f1000_3b46(0xaa9,0);
 f1000_3b46(0xabd,0);
 f1000_3bb6(0x2736);
 f1000_3a1e(0);
 f1000_3bb6(0x2754);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0x27b8,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0x1);
 f1000_3b46(0xacb,0);
 f1000_3b46(0xacc,0);
 f1000_3bb6(0x2722);
 f1000_3bb6(0x2726);
 f1000_3a1e(0);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0xae2,0);
 f1000_3b46(0xaf4,0);
 f1000_3b46(0xb0c,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0xb1f,0);
 f1000_3b46(0xb31,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0x27b8,0);
 f1000_3bb6(0x271e);
 f1000_3a1e(0);
 f1000_11f2();
 f1000_3b46(0x27b8,0);
 f1000_3bb6(0x271e);
}
export {f1000_070a as buildPages};

// 1000:11c2 addBlankLines(n): n lines of 36 spaces (DS:27e8).
export function f1000_11c2(n){
 n=s16(n);
 if(n<=0)return;
 for(let si=n;si;si=u16(si-1))f1000_3b46(0x27e8,0);
}

// 1000:11f2 two empty lines (null string pointers).
export function f1000_11f2(){f1000_3b46(0,0);f1000_3b46(0,0);}

// ===== B =====

// ---------------------------------------------------------------------------------------------
// Fragment B: 1000:1208-2765 (.MAP loader, cockpit setup, hub/stats/quiz pages, standings, pit stop)
// Cross-module argument convention: far pointers are passed as one packed fp() value, longs as one
// 32-bit value, in C order.
// ---------------------------------------------------------------------------------------------

// 1000:1208 loadSkylineMap: read the .MAP strips (N, widths, heights, 160-byte rows) and convert them
// for the adapter; the EGA path copies them into video RAM at A734:0000 and fills the strip table DS:9bce.
export function f1000_1208(name){
 let rowBytes=0x28;                              // [bp-0xa]
 const file=F.f1000_c1a2(name,0xb50);            // fopen-style open (mode string DS:0b50), retries if [0x1fba]
 // UNKNOWN: on open failure the original jumps to the cleanup and closes the uninitialised stream local
 // [bp-0x22] and fclose(0); the stack garbage is not reproducible, 0 is passed.
 if(!file){F.f1ff8_100d(0);F.f1000_c264(file);return;}
 let h;                                          // [bp-0x22] stream handle
 {
  const len=s16(F.f1000_e3d0(rsb(file+7)));      // length of the open file (FILE._file at +7); CWD -> long
  h=F.f1ff8_0d47(0,file,0xb53,...lw(len));
  if(u16(h)===0xffff){F.f1ff8_100d(h);F.f1000_c264(file);return;}
 }
 const pn=salloc(2);
 let n;
 try{
  F.f1ff8_11f0(h,pn,DGROUP,2);
  n=rsw(pn);
 }finally{sfree(2);}
 const nb=u16(n<<1);
 F.f1ff8_11f0(h,0x9642,DGROUP,nb);
 // QUIRK: the heights are read over the widths at the same address DS:9642 (race.md 1208).
 F.f1ff8_11f0(h,0x9642,DGROUP,nb);
 let total=0;                                    // [bp-8]:[bp-6], signed long
 if(n>0)for(let i=0;i<n;i++)total=total+s16(imul16(0xa0,rw(0x9642+2*i)))|0; // IMUL then CWD: low word sign-extended
 let chunk=0xfa0;                                // [bp-0x1e]:[bp-0x1c]
 let dst;                                        // [bp-4]:[bp-2] as a 32-bit value (offset low, segment high)
 let start;                                      // value used for the strip table
 const adapter=rw(0x95d6);
 if(adapter===3){
  unsupported('1000:12cf .MAP load for adapter 3');
  F.f1ff8_100d(h);F.f1000_c264(file);return;
 }else if(adapter===2){
  dst=(0xa734<<16)>>>0;
  let buf;
  for(;;){
   buf=F.f1ff8_3a88(...lw(chunk),0)>>>0;
   ww(0x9bce,buf&0xffff);ww(0x9bd0,buf>>>16);
   if(buf)break;
   chunk=chunk>>1;                               // SAR/RCR: signed 32-bit halve
  }
  buf=(rw(0x9bce)|rw(0x9bd0)<<16)>>>0;
  while(total!==0){
   if(total<chunk)chunk=total;                   // signed long compare
   F.f1ff8_11f0(h,...lw(buf),u16(chunk));
   const q=chunk>>2;                             // signed 32-bit shift by 2
   F.f1000_ad8e(...lw(buf),...lw(dst),...lw(q));
   dst=dst+q>>>0;                                // ADD/ADC on the 32-bit far pointer value (carry into the segment)
   total=total-chunk|0;
  }
  F.f1ff8_3ae2(rw(0x9bce),rw(0x9bd0));
  start=(0xa734<<16)>>>0;
  F.f1000_ae8e(2);
 }else{
  unsupported('1000:140c .MAP load for CGA/Tandy');
  F.f1ff8_100d(h);F.f1000_c264(file);return;
 }
 // 1000:1515: strip pointers, each strip advances by height*rowBytes.
 if(n>0){
  let p=start;
  for(let i=0;i<n;i++){
   wd(0x9bce+4*i,p);
   p=p+s16(imul16(rw(0x9642+2*i),rowBytes))>>>0; // IMUL then CWD
  }
 }
 F.f1ff8_100d(h);
 F.f1000_c264(file);
}
export {f1000_1208 as loadSkylineMap};

// 1000:156c aiBuyAmmo(k): far function; while driver k (k!=0) has cash, buy terminators, mines, missiles
// and gun rounds round-robin, each purchase clamping the cash at zero.
export function f1000_156c(k){
 if(k===0)return;
 const cash=0xa22a+4*k&0xffff;
 const k2=2*k;
 const buy=(cnt,add,price)=>{
  if(rd(cash)===0)return;
  ww(cnt,rw(cnt)+add);
  let v=rsd(cash)-price|0;
  if(v<0)v=0;                                    // OR DX,DX / JG / JGE: negative -> 0
  wd(cash,v);
 };
 do{
  buy(0x9238+k2&0xffff,1,0x12c);
  buy(0x5c04+k2&0xffff,1,0xc8);
  buy(0x9a86+k2&0xffff,1,0x12c);
  buy(0x8e5c+k2&0xffff,0x64,0xc8);
 }while(rd(cash)!==0);
}
export {f1000_156c as aiBuyAmmo};

// 1000:1692 cockpitSetup: load DASH<n>.SCR and draw the race HUD (minimap, gauges, lap total).
export function f1000_1692(){
 f1000_0278();
 f1000_02ea();
 const name=salloc(0x14),num=salloc(0xa);
 try{
  F.f1000_c2ce(name,0xb56);                      // "DASH"
  F.f1000_def6(rsw(0x9b0c),num,0xa);              // itoa
  F.f1000_c298(name,num);
  F.f1000_c298(name,0xb5b);                      // ".SCR"
  F.f2524_2be8(name);
 }finally{sfree(0xa);sfree(0x14);}
 F.f1ff8_2fca(0x99ec);
 F.f2524_3cd6();
 F.f2524_4152();
 F.f1000_afc4();
 F.f2524_43cc();
 F.f1000_914a();
 ww(0x5c98,0xffff);
 ww(0x9908,0xffff);
 F.f2524_406e();
 F.f1000_89d6();
 F.f1000_8a48();
 wb(0x3842,0);
 wb(0x3841,0);
 wb(0x3840,2);
 F.f1ff8_3692(rw(0x8e72));
 F.f1000_7f3c(rw(0x8eb8));
 F.f1ff8_23ba(0x98fe,0x112,0xac);
 F.f2524_4482();
 wb(0x3842,1);
 F.f1ff8_3692(rw(0x8e98));
 f1000_026a();
 f1000_0304();
 f1000_0278();
}
export {f1000_1692 as cockpitSetup};

// 1000:1780 openPage(n): restore the screen, pointer shape 1, select page n, reset page selectors.
export function f1000_1780(n){
 f1000_02dc();
 f1000_69ca();
 f1000_3ab8(n);
 f1000_0286();
}
export {f1000_1780 as openPage};

// 1000:1798 drawRaceHub: page 0x0c with the race title, cash and location picture.
export function* f1000_1798(){
 const title=salloc(0x1a);
 try{
  const locW=F.f2524_1eaa();                     // [bp-2]
  F.f1000_c2ce(title,rw(0xd40+2*rw(0xd24)));     // "RACE: 1ST" ... by [0xd24]
  F.f1000_c298(title,0xb60);
  const half=Math.trunc(s16(F.f1000_c058(title)<<3)/2); // CWD/SUB/SAR: signed /2
  f1000_38e4(0xa8d8);
  f1000_1780(0xc);
  f1000_3bb6(rw(0xd24)===1?0xb67:0xb71);         // GO RACIN' / KEEP RACIN'
  f1000_3bb6(0xb7d);
  f1000_3bb6(0xb8d);
  f1000_3bb6(0xb9a);
  f1000_11c2(0x10);
  yield* f1000_3c0a(1,0x80);
  f1000_4778();
  f1000_3930(0,0x12,0x12);
  f1000_4808(0x12,0x12,0x6d,0x70,2);
  f1000_4808(0x96,0x12,0x94,0x37,1);
  f1000_4808(0x96,0x5d,0x94,0x25,1);
  f1000_4d06(0xbaf,0xa5,0x21);
  f1000_4d06(0xbbf,0xb1,0x68);
  ww(0xa8a6,1);
  f1000_4d06(title,s16(0xe1-half),0x2b);
  f1000_4d06(rw(0xa8a8),s16(0xe1-locW),0x35);
  f1000_3760(rd(0xa22a),0xe1,0x72,2);
  f1000_69d8();
 }finally{sfree(0x1a);}
}
export {f1000_1798 as drawRaceHub};

// 1000:1916 trackInfo(city): page 0x12 with 12 description lines and the city picture.
export function* f1000_1916(city){
 f1000_1780(0x12);
 f1000_11c2(0x12);
 yield* f1000_3c0a(2,0x80);
 f1000_4778();
 f1000_21d6(0x11,0x22,0xa0,0x70,2);
 F.f1ff8_3692(rw(0x8e98));
 const base=u16(city*12);
 let y=0x2c;
 for(let i=0;i<0xc;i++){
  wb(0x3840,0xc);
  f1000_6692(F.f1000_a2de(u16(base+i),3),0x17,y);
  y=y+8&0xffff;
 }
 F.f1ff8_3692(rw(0x8eb4));
 for(let i=3;i;i--){
  F.f1000_a3ca();                                // QUIRK: rand result tested but unused (gameflow.md "1916 calls rand 3x")
  f1000_4808(0xc1,0x22,0x6d,0x70,2);
 }
 ww(0x1f28,1);
 f1000_6cea();
 F.f1000_c2ce(0xa8d8,rw(0x1cb4+2*city&0xffff));
 F.f1000_c298(0xa8d8,0xbd1);                     // ".BMP"
 f1000_38e4(0xa8d8);
 f1000_3930(0,0xc1,0x22);
 f1000_4808(0xc1,0x22,0x6d,0x70,2);
 F.f2524_1528(0,0,0x140,0x96,0x4a);
 f1000_69d8();
}
export {f1000_1916 as trackInfo};

// 1000:1a66 proBio(k): page 0x11 with the driver's bio lines and portrait.
export function* f1000_1a66(k){
 f1000_1780(0x11);
 f1000_0286();
 f1000_11c2(0x12);
 yield* f1000_3c0a(2,0x80);
 f1000_4778();
 f1000_1b00(0);
 const base=u16(k*11);
 let y=0x30;
 for(let i=0;i<0xb;i++){
  wb(0x3840,i<6?0xc:0xf);
  f1000_6692(F.f1000_a2de(u16(base+i-0xb),0),0x12,y);
  y=y+8&0xffff;
 }
 f1000_1b40(k);
}
export {f1000_1a66 as proBio};

// 1000:1b00 quizFrame(flag): text frame at x 0x10, y = flag ? 0x0e : 0x22 (kept in [0x59fc]); 6x6 font.
export function f1000_1b00(flag){
 ww(0x59fc,flag?0xe:0x22);
 f1000_21d6(0x10,rw(0x59fc),0x78,0x70,2);
 F.f1ff8_3692(rw(0x8e98));
}

// 1000:1b40 drawPortrait(k): frame, <NAME>.BMP of driver k, name label, then a full-screen copy.
export function f1000_1b40(k){
 F.f1ff8_3692(rw(0x8eb4));
 const mode=(F.f1000_a3ca()&1)?0:1;
 f1000_4808(0x99,rw(0x59fc),0x95,0x70,mode);
 ww(0x1f28,1);
 f1000_6cea();
 f1000_33be(k);
 F.f2524_203a(rsb(0x17ca+k&0xffff));
 f1000_38e4(0xa8d8);
 f1000_3930(0,0x94,s16(rw(0x59fc)-1));
 f1000_4808(0x99,rw(0x59fc),0x95,0x70,2);
 F.f1ff8_44b4(0,0,0x140,0xc8,1);
 f1000_69d8();
}

// 1000:1bea drawSignUp: page 0x15 full-screen with TITLE.BMP and WANTSYOU.BMP.
export function* f1000_1bea(){
 f1000_1780(0x15);
 yield* f1000_3c0a(2,0x80);
 f1000_38e4(0xbd6);                              // "TITLE.BMP"
 f1000_3930(0,0xa,0xa);
 f1000_38e4(0xbe0);                              // "WANTSYOU.BMP"
 f1000_3930(0,0x4b,0x32);
 f1000_3930(1,0x5f,0x5a);
 f1000_390a();
 ww(0x1f28,1);
 f1000_69d8();
}
export {f1000_1bea as drawSignUp};

// 1000:1c5e gasPumpPage: page 0x28 with GAS.BMP and the pump gauges.
export function* f1000_1c5e(){
 f1000_1780(0x28);
 yield* f1000_3c0a(2,0xa0);
 f1000_38e4(0xbfc);                              // "GAS.BMP"
 f1000_3930(0,0x1c,0x21);
 f1000_390a();
 f1000_4808(0x1c,0x20,0xaa,0x7b,2);
 f1000_4808(0xe4,0x20,0x3c,0x7b,2);
 ww(0xa8a6,1);
 f1000_4bd4(0x10c,0x23,0x11,0x76);
 F.f2524_1f04();
 f1000_69d8();
}
export {f1000_1c5e as gasPumpPage};

// 1000:1cee showCar: page 0x2d, load driver [0x8db4]'s car model (<NAME>.TBL) and draw the first frame.
export function* f1000_1cee(){
 f1000_1780(0x2d);
 F.f1000_c2ce(0xa8d8,rw(0x17b6+2*rw(0x8db4)&0xffff));
 F.f2524_2be8(0xa8d8);
 F.f2c46_00b4(0x99ec);
 f1000_11c2(0x13);
 yield* f1000_3c0a(2,0xa0);
 f1000_4778();
 f1000_21d6(0x17,0x1e,0x10e,0x78,2);
 F.f2524_1f64(0);
 f1000_1d74(0);
 f1000_69d8();
}
export {f1000_1cee as showCar};

// 1000:1d74 animateCarOrChamp(mode): one frame of the rotating car (mode 0: show-car page, mode 1:
// champion page) and the car name.
export function f1000_1d74(mode){
 f1000_0286();
 if(mode!==0){
  if(rw(0x59fa)===0)F.f2524_2140();
  f1000_02c4();
  F.f1ff8_2545(0x18,0x1f,0x10c,0x85);
  f1000_0286();
  ww(0x3843,0x1c);
  ww(0x3845,0x11f);
  ww(0x3849,0xa4);
 }else{
  wb(0x8997,rb(0x8997)+3);
  wb(0x384d,9);
  wb(0x384e,9);
  F.f1ff8_3810(0x18,0x1f,0x10c,0x76);
  ww(0x3845,0x125);
  ww(0x3843,0x18);
  ww(0x3849,0x94);
 }
 ww(0x1f28,1);
 wb(0x384b,1);
 ww(0x3847,0x1f);
 if(rw(0x59fa)!==0){
  F.f2524_2058(rw(0x59fa));
  if(rw(0x59fa)===1)ww(0x59fa,rw(0x59fa)+1);
 }else{
  F.f1000_aae4(0,0xa944,0x8992);
 }
 f1000_02ea();
 ww(0xa8a6,1);
 f1000_4d06(rw(0x17d4+2*rw(0x8db4)&0xffff),0x40,0x8b);
 f1000_6cea();
}
export {f1000_1d74 as animateCarOrChamp};

// 1000:1e64 drawChampion: page 0x31. Player champion: WIN.BMP, MYCAR<n> model, "YOUR WINNINGS: $";
// rival champion: name and portrait.
export function* f1000_1e64(){
 f1000_1780(0x31);
 f1000_11c2(0x14);
 yield* f1000_3c0a(2,0x80);
 f1000_4778();
 ww(0x1f28,1);
 const s=salloc(0x16),num=salloc(0x16);          // [bp-0x20] and [bp-0x36]
 try{
  if(rw(0x9a3e)===0){
   f1000_21d6(0x1b,0x1b,0x105,0x8b,2);
   F.f2524_2be8(0xc04);                          // "WIN.BMP"
   const bmp=F.f1ff8_0006(0x99ec);
   if(bmp){
    F.f1ff8_2541(rw(bmp),0x1c,0x1c);
    F.f1ff8_0476(bmp);
   }
   F.f1000_c2ce(0xa8d8,0xc0c);                   // "MYCAR"
   F.f1000_c298(0xa8d8,F.f1000_def6(rsw(0x9b0c),s,0xa));
   F.f2524_2be8(0xa8d8);
   F.f2c46_00b4(0x99ec);
   F.f1000_c2ce(s,0xc12);                        // "YOUR WINNINGS: $"
   F.f1000_c298(s,F.f1000_df12(rw(0xa22a),rw(0xa22c),num,0xa));
   const w=u16(F.f1000_c058(s)<<2);
   f1000_4d06(s,s16(0xa0-w),0xa);
   F.f2524_1f64(1);
   f1000_0290();
   f1000_0304();
   f1000_1d74(1);
  }else{
   f1000_21d6(0x16,0x1b,0xa2,0x75,2);
   ww(0xa8a6,0);
   f1000_4d06(rw(0x17a2+2*rw(0x9a3e)&0xffff),0xc3,0x66);
   f1000_33be(rw(0x9a3e));
   F.f2524_2be8(0xa8d8);
   const bmp=F.f1ff8_0006(0x99ec);
   if(bmp){
    F.f1ff8_2541(rw(bmp),0x17,0x1c);
    F.f1ff8_0476(bmp);
   }
   f1000_0290();
   f1000_0304();
   ww(0x59fa,1);
  }
  f1000_69d8();
 }finally{sfree(0x16);sfree(0x16);}
}
export {f1000_1e64 as drawChampion};

// 1000:204c drawStandings: page 0x2e, the 10x10 table of places per race, then [0x9a3e]=8eda[0].
export function* f1000_204c(){
 f1000_1780(0x2e);
 f1000_11c2(0x14);
 yield* f1000_3c0a(2,0x90);
 f1000_4778();
 ww(0xa8a6,1);
 F.f1ff8_3692(rw(0x8e98));
 f1000_4d06(0xc23,0xaa,0x30);
 f1000_4d06(0xc2f,0x77,0x37);
 const buf=salloc(0x14);                         // [bp-0x1a]
 try{
  let y=0x46;                                    // [bp-0x26]
  for(let r=0;r<0xa;r++){
   const k=rsb(0x8eda+r);
   ww(0xa8a6,k?0:6);
   f1000_4d06(rw(0x17a2+2*k&0xffff),0x13,y);
   const row=u16(k*10);
   let x=0x77;
   for(let c=0;c<0xa;c++){
    const p=rsb(0x9926+row+c&0xffff);
    if(p===0)F.f1000_c2ce(buf,0xc4d);            // "-"
    else F.f1000_def6(p,buf,0xa);
    f1000_4d06(buf,x,y);
    x=x+0x12&0xffff;
   }
   y=y+0xa&0xffff;
  }
 }finally{sfree(0x14);}
 ww(0x1f28,1);
 F.f1ff8_3692(rw(0x8eb4));
 f1000_38e4(0xc4f);
 f1000_3930(2,0x2f,0xf);
 f1000_3930(1,0xa5,0xf);
 f1000_69d8();
 ww(0x9a3e,rsb(0x8eda));
}
export {f1000_204c as drawStandings};

// 1000:21ba refreshSoundsPage: if page 10 is current, re-mark the options and redraw it.
export function* f1000_21ba(){
 if(f1000_4770()!==0xa)return;
 F.f2524_2396();
 yield* f1000_6d76(0xa,0);
}
export {f1000_21ba as refreshSoundsPage};

// 1000:21d6 drawPanel(x,y,w,h,mode): [0xa8a6]=1, box 4808 and background 4bd4.
export function f1000_21d6(x,y,w,h,mode){
 ww(0xa8a6,1);
 f1000_4808(x,y,w,h,mode);
 f1000_4bd4(x,y,w,h);
}

// 1000:2208 cmpPoints(a,b): qsort comparator on driver bytes, descending by season points DS:99be.
export function f1000_2208(a,b){
 return s16(rw(0x99be+2*rsb(b)&0xffff)-rw(0x99be+2*rsb(a)&0xffff));
}

// 1000:2230 protectionQuiz: category, random driver, page 0x34 with five answers and the portrait.
export function* f1000_2230(){
 wb(0xaa6e,F.f1000_a3ca()&3);
 // QUIRK: 1000:2245 pushes DX:AX after rand as a long; rand leaves DX untouched, which still holds 0 from
 // the CWD of the constant 9 at 1000:2242, so the signed long mod is effectively unsigned 16-bit (gameflow.md §5).
 const r=F.f1000_a3ca()&0xffff;
 const d=u16(F.f1000_e8dc(r,0,9,0)+1);
 f1000_1780(0x34);
 F.f2524_21d2(d);
 for(let i=0;i<=4;i++){
  const v=rsb(0x8eda+i),c=rb(0xaa6e);
  const tbl=c===0?0x181c:c===1?0x17e8:c===2?0x1884:0x1850;
  f1000_3bb6(rw(tbl+2*v&0xffff));
 }
 f1000_11c2(0xf);
 yield* f1000_3c0a(2,0x80);
 f1000_4778();
 f1000_1b00(1);
 F.f2524_2280();
 f1000_1b40(d);
}
export {f1000_2230 as protectionQuiz};

// 1000:22fe seasonPoints: 99be[k] = sum of (11-place)*100, 8eda[k]=k, qsort descending by points.
export function f1000_22fe(){
 for(let k=0;k<0xa;k++){
  const pts=0x99be+2*k;
  ww(pts,0);
  const row=u16(k*10);
  for(let c=0;c<0xa;c++){
   const p=rsb(0x9926+row+c&0xffff);
   if(p)ww(pts,rw(pts)+imul16(0xb-p,0x64));
  }
  wb(0x8eda+k,k);
 }
 F.f1000_e5a4(0x8eda,0xa,1,0x2208);              // qsort(8eda,10,1,cmpPoints)
}
export {f1000_22fe as seasonPoints};

// 1000:238c shuffleCircuit: 100 swaps of the city order DS:18be with unsigned rand%10 indices.
export function f1000_238c(){
 for(let n=0x64;n;n--){
  const i=mod16(F.f1000_a3ca(),0xa);
  const j=mod16(F.f1000_a3ca(),0xa);
  const t=rw(0x18be+2*i);
  ww(0x18be+2*i,rw(0x18be+2*j));
  ww(0x18be+2*j,t);
 }
}
export {f1000_238c as shuffleCircuit};

// 1000:23e2 pitMenu: page 0x27 with the available pit options (action codes in DS:9b64[]), PITSTOP.BMP.
export function* f1000_23e2(){
 let n=0;                                        // [bp-2]
 f1000_69ca();
 f1000_0278();
 f1000_0304();
 f1000_3ab8(0x27);
 ww(0x1fae,1);
 if(rsw(0x96a0)<0x1000){
  f1000_3bb6(0xccd);                             // REFUEL
  ww(0x9b64,0);
  n++;
 }
 f1000_3bb6(0xcd4);ww(0x9b64+2*n&0xffff,1);n++;  // REARM
 f1000_3bb6(0xcda);ww(0x9b64+2*n&0xffff,2);n++;  // REBUILD
 f1000_3bb6(0xce2);ww(0x9b64+2*n&0xffff,3);n++;  // OUT'A HERE
 f1000_11c2(0x10);
 yield* f1000_3c0a(2,0x81);
 f1000_4778();
 f1000_21d6(0x48,0x1b,0xad,0x62,2);
 f1000_38e4(0xced);                              // "PITSTOP.BMP"
 f1000_3930(0,0x49,0x1c);
 f1000_390a();
 f1000_69d8();
}
export {f1000_23e2 as pitMenu};

// 1000:24c4 pumpFuel: +0xc fuel per poll up to 0x1000 and grow the gauge; when already full, page 0x2c.
export function* f1000_24c4(){
 // level = fuel*300/0x1000 through the MSC long helpers (both callee-pop).
 const lv=F.f1000_e80c(...lw(F.f1000_e8a8(...lw(rsw(0x96a0)),...lw(0x12c))),...lw(0x1000));
 const h=idiv16(s16(mul16(0x72,lv&0xffff)),0x12c); // MUL then CWD drops DX, IDIV 300
 if(rsw(0x96a0)<0x1000){
  ww(0x96a0,rw(0x96a0)+0xc);
  if(rsw(0x96a0)>0x1000)ww(0x96a0,0x1000);
  wb(0x384e,rw(0x896c)?0:0xc);
  const lim=s16(0x95-h);
  if(lim<0x95){
   let y=0x95;
   do{F.f1ff8_2454(0x10f,y,0x119,y);y=s16(y-2);}while(y>lim);
  }
  f1000_0286();
  f1000_6cea();
  return;
 }
 wb(0x384e,0);
 const lim=s16(0x95-h);
 if(lim<0x95){
  let y=0x95;
  do{F.f1ff8_2454(0x110,y,0x118,y);y=s16(y-2);}while(y>lim);
 }
 yield* f1000_6d76(0x2c,0x420);
}
export {f1000_24c4 as pumpFuel};

// 1000:25bc hiScoreInsert: if the player's cash beats an entry, replace the lowest entry with the player
// (name DS:1792) and write HI_SCORE.
export function* f1000_25bc(){
 const cash=rd(0xa22a);
 for(let i=0;i<0xa;i++){
  if(rd(0x1b30+4*i)>=cash)continue;              // unsigned compare
  let min=rd(0x1b54),idx=9;
  for(let j=8;j>=0;j--){
   const v=rd(0x1b30+4*j);
   if(min>v){min=v;idx=j;}                       // unsigned, strict
  }
  wd(0x1b30+4*idx,cash);
  F.f1000_c2ce(rw(0x1b58+2*idx),0x1792);
  yield* f1000_51bc();
  return;
 }
}
export {f1000_25bc as hiScoreInsert};

// 1000:2678 cmpProgress(a,b): qsort comparator for the results, descending by the u32 DS:a678[k];
// returns the sign of the 32-bit difference a678[*b]-a678[*a].
export function f1000_2678(a,b){
 const d=rd(0xa678+4*rsb(b)&0xffff)-rd(0xa678+4*rsb(a)&0xffff)|0;
 if(d===0)return 0;
 return d<0?0xffff:1;
}

// 1000:26d6 cmpHiScore(a,b): qsort comparator for the top scores: 1 when cash[*b] >= cash[*a]
// (unsigned), else -1; never 0.
export function f1000_26d6(a,b){
 const ca=rd(0x1b30+4*rsb(a)&0xffff),cb=rd(0x1b30+4*rsb(b)&0xffff);
 return cb>=ca?1:0xffff;
}

// 1000:2714 redrawShop: reselect the parts (0x17) or weapons (0x18) page and redraw its grid full screen.
export function f1000_2714(){
 f1000_0286();
 if(rw(0x1e6a)===0){
  f1000_3ab8(0x17);
  f1000_5822();
  ww(0x98d6,0x180);
 }else{
  f1000_3ab8(0x18);
  f1000_582e();
  ww(0x98d6,0x380);
 }
 ww(0x8db0,5);
 ww(0x8a96,5);
 ww(0x8a52,0x136);
 ww(0xa8a4,0xbe);
 ww(0x1f28,1);
 f1000_6cea();
}
export {f1000_2714 as redrawShop};

// qsort comparators: their near addresses are passed to the runtime qsort (1000:e5a4) by 22fe, 34b0 and 3406.
register(0x1000,0x2208,f1000_2208);
register(0x1000,0x2678,f1000_2678);
register(0x1000,0x26d6,f1000_26d6);
// 1000:156c is a far function called from 2524:18f4.

// ===== C =====
// ---------------------------------------------------------------------------------------------
// Fragment C: 1000:2766-3a1d (dispatcher, modal dispatcher, new game, race entry/exit, results,
// money formatting, picture loader, season flow, disk-check continuation).
// ---------------------------------------------------------------------------------------------

// Inline MSC strcat expansion (REPNE SCASB / REP MOVSW / REP MOVSB) used by several functions here:
// appends the NUL-terminated string at src to the one at dst, both DS offsets.
function _Cstrcat(dst,src){
 let n=0;while(rb(src+n))n++;n++;          // length including the terminator
 let d=dst;while(rb(d))d=d+1&0xffff;
 for(let i=0;i<n;i++)wb(d+i,rb(src+i));
}

// 1000:2766 menuDispatch: handle activation of button `choice` (1-based) on page `screen`.
// Jump tables are read from the code segment at run time: CS:2c2e (screens 5..0x38) and CS:2848 (page 5).
// The fragments Ghidra split off (285a, 28fd, 2c24, 2c96) are parts of this function and are folded in.
export function* f1000_2766(screen,choice){
 screen&=0xffff;choice&=0xffff;
 const cs=gseg(0x1000);
 let t=u16(screen-5)>0x33?0x2c24:frw(cs,0x2c2e+2*u16(screen-5));
 // Case labels are the jump-table targets in address order, so fall-throughs follow the original layout.
 switch(t){
  case 0x2784:{ // page 5 main menu, second table
   if(u16(choice-1)>8){yield* f1000_6d62(6,0);return;} // 1000:2a09
   const c=frw(cs,0x2848+2*u16(choice-1));
   switch(c){
    case 0x279a:yield* f1000_39a0();return;                    // FULL CIRCUIT RUN
    case 0x27a0:ww(0xd24,0);yield* f1000_6d76(8,0);return;     // RUN A TRACK
    case 0x27b0:                                                // RUN OLD CIRCUIT: file dialog "LOAD"
     f1000_4f28(0,9,0,0xe,0xd7a,0xd73,0xd5c,0xd56,0);
     ww(0x1f2a,1);return;
    case 0x27e2:yield* f1000_2f72();return;                    // THE SHOPS
    case 0x29e2:yield* f1000_6d76(7,0);return;                 // SCOPE THE STATS
    case 0x27e8:{                                               // SET YOUR LIMITS: mark the difficulty with '*'
     const dx=rw(0xd28);let si=0x280e;
     for(let cx=0;cx<4;cx++){wb(rw(si),cx===dx?0x2a:0x20);si+=2;}
     yield* f1000_6d76(0xf,0);return;
    }
    case 0x281c:F.f2524_2396();yield* f1000_6d76(0xa,0);return; // SOUNDS
    case 0x282a:                                                 // RESTART
     if(rw(0x9b84)===0){yield* f1000_1bea();return;}
     yield* f1000_6d76(0x37,0);return;
    case 0x283e:yield* f1000_6d76(0x16,0);return;              // BAIL OUT
    default:throw Error(`1000:2795 unexpected page-5 target ${c.toString(16)}`);
   }
  }
  case 0x285e: // 0x16 exit to DOS?
   if(choice===2){f1000_0344(0xd7f);return;}
   yield* f1000_6d76(5,0);return;
  case 0x2872: // 0x08 track list
   ww(0x89c8,1);
   if(choice===0xb){yield* f1000_6d76(5,0);return;}
   yield* f1000_2f88(u16(choice-1));return;
  case 0x288c: // 0x15 sign-up "GO FOR IT!"
   if(F.f1000_c10c(0x1792,0xd93)===0)ww(0xd26,1);  // "Lukaszuk!" cheat
   if(rb(0x1792)===0)F.f1000_c2ce(0x1792,0xd9d);   // "NEW KID"
   if(rw(0x9b84)!==0){
    ww(0x9b22,rw(0x1fb6)===0xffff?0x34:0xb);
    yield* f1000_6d76(0xd,0);return;
   }
   if(rw(0x1fb6)===0xffff){yield* f1000_2230();return;}
   yield* f1000_2eb8();return;
  case 0x28f2: // 0x34 copy-protection quiz answer
   f1000_47be();
   // QUIRK: the original compared choice with [0x1fb6] and set [0x1fb8]=1 on a wrong answer (1000:28fd).
   // DTRACK.EXE has the JNZ at 1000:28fb patched to JMP (EB 06), so the flag is never set (gameflow.md §5).
   yield* f1000_2eb8();return;
  case 0x290a: // 0x13 scan the tracks
   if(choice===0xb){yield* f1000_6d76(7,0);return;}
   yield* f1000_1916(u16(choice-1));return;
  case 0x2922: // 0x12 track info
   yield* f1000_6d76(0x13,0);return;
  case 0x292c: // 0x07 stats
   if(choice===1){yield* f1000_3406();return;}
   if(choice===2){yield* f1000_6d76(0x10,0);return;}
   if(choice===3){yield* f1000_6d76(0x13,0);return;}
   if(choice===4){yield* f1000_6d76(5,0);return;}
   return;
  case 0x2952: // 0x0a sounds
   F.f2524_23fe(u16(choice-1));
   yield* f1000_6d76(5,0);return;
  case 0x2968:{ // 0x0f limits: laps from the edit field, difficulty from the choice
   // atoi is called a second time when the first result is >1 (literal, 1000:2977).
   let ax=F.f1000_def2(rw(0xb4e))&0xffff;
   ax=s16(ax)>1?F.f1000_def2(rw(0xb4e))&0xffff:1;
   ww(0x8eb8,ax);
   if(s16(ax)>0x63)ax=0x63;
   ww(0x8eb8,ax);
   ww(0xd28,u16(choice-1));
   yield* f1000_6d76(5,0);return;
  }
  case 0x299e: // 0x09 results
   if(rw(0x9a84)===0){yield* f1000_3958();return;}
   yield* f1000_318c();return;
  case 0x29ae: // 0x33 exit circuit?
   if(choice===2){ww(0xd24,0);yield* f1000_2eb8();return;}
   yield* f1000_1798();return;
  case 0x29c4: // 0x21, 0x22 file errors
   ww(0x9b22,5);
   yield* f1000_39ae();
   // QUIRK: no jump after the call; falls into the 0x23 code and runs 39ae again with target 0x0b
   // (gameflow.md §3, case 0x21/0x22).
  // falls through
  case 0x29cd: // 0x23 file mangled
   ww(0x9b22,0xb);
  // falls through
  case 0x29d3: // 0x0d disk 2
   yield* f1000_39ae();return;
  case 0x29da: // 0x24, 0x25, 0x2b
   ww(0x9b22,0xc);yield* f1000_39ae();return;
  case 0x29e2: // 0x14 top scores
   yield* f1000_6d76(7,0);return;
  case 0x29ec: // 0x0c race hub
   f1000_47be();
   if(choice===1){
    if(rsw(0x9aa6)>=rsw(0x1c5c)||rsw(0xa670)>0x3e7){yield* f1000_6d76(0x2b,0);return;}
    ww(0xd24,rw(0xd24)+1);
    yield* f1000_3396();return;
   }
   if(choice===2){yield* f1000_57ac();return;}
   if(choice===3){f1000_4f28(0,9,0,0xe,0xdc4,0xdbd,0xdab,0xda5,0);ww(0x1f2a,2);return;}
   if(choice===4){yield* f1000_6d76(0x33,0);return;}
   yield* f1000_6d62(6,0);return;
  case 0x2a76: // 0x17 parts shop
   yield* f1000_65ea(choice,0);return;
  case 0x2a82: // 0x18 weapons shop
   yield* f1000_6626(choice,0);return;
  case 0x2a8e: // 0x1a description
   yield* f1000_57b6();return;
  case 0x2a94: // 0x1f, 0x20, 0x2a, 0x2f, 0x30 shop popups
   f1000_2714();return;
  case 0x2a9a: // 0x0b car dealer
   if(choice===1){
    ww(0x9b0c,rw(0x9b0c)+1);
    if(rsw(0x9b0c)>2)ww(0x9b0c,0);
    yield* f1000_2eb8();return;
   }
   if(choice===2){F.f2524_26c0();yield* f1000_6d76(5,0);return;}
   return;
  case 0x2ace: // 0x1e shop choice
   if(choice===1){yield* f1000_57ac();return;}
   yield* f1000_57a2();return;
  case 0x2ae0: // 0x10 pros
   if(choice===0xa){yield* f1000_6d76(7,0);return;}
   ww(0x8db4,choice);
   yield* f1000_1a66(choice);return;
  case 0x2af6:{ // 0x32, 0x37, 0x38 insert disk 1: probe DYNAMIX.BMP with retries off
   ww(0x1fba,0);ww(0x9a7e,0);
   F.f2524_2be8(0xdc9);
   const ax=F.f1ff8_0006(0x99ec)&0xffff;
   ww(0x9a7e,ax);ww(0x1fba,1);
   if(ax===0){yield* f1000_6d76(screen,4);return;}
   F.f1ff8_0476(rw(0x9a7e));
   if(screen===0x37){yield* f1000_1bea();return;}
   if(screen===0x32){yield* f1000_1e64();return;}
   yield* f1000_03f6();
   ww(0x9b22,0xb);yield* f1000_39ae();return;
  }
  case 0x2b60: // 0x11 pro bio
   if(choice===1){yield* f1000_6d76(0x10,0);return;}
   yield* f1000_1cee();return;
  case 0x2b74: // 0x2d show car: free the 3D model
   F.f2c46_005e();F.f2c46_00fa();
   ww(0x2a70,0);ww(0x2a6e,0);
   yield* f1000_6d76(0x10,0);return;
  case 0x2b88: // 0x1b mafioso offer
   yield* f1000_2fb0();return;
  case 0x2b8e: // 0x1c, 0x1d mafioso result
   yield* f1000_3958();return;
  case 0x2b94: // 0x2e standings "MORE..."
   f1000_38e4(0xdd5);
   if(rw(0x9a3e)!==0||rw(0x9b84)===0){yield* f1000_1e64();return;}
   yield* f1000_6d76(0x32,4);return;
  case 0x2bb6: // 0x31 champion
   if(rw(0x9a3e)===0){
    F.f2c46_005e();F.f2c46_00fa();
    ww(0x2a70,0);ww(0x2a6e,0);
    yield* f1000_6d76(0x35,0);return;
   }
   if(rw(0x9b84)!==0){yield* f1000_6d76(0x38,0);return;}
   f1000_69ca();yield* f1000_03f6();yield* f1000_2eb8();return;
  case 0x2bfa: // 0x35 YOU'RE THE CHAMP
   f1000_69ca();yield* f1000_03f6();
   if(rw(0x9b84)!==0){ww(0x9b22,0x63);yield* f1000_6d76(0xd,0);}
   else yield* f1000_397c();
   f1000_69d8();return;
  case 0x2c24: // screens outside 5..0x38 and 6, 0xe, 0x19, 0x26-0x29, 0x2c, 0x36: back to the main menu
   ww(0x9b22,5);yield* f1000_39ae();return;
  default:throw Error(`1000:277f unexpected dispatch target ${t.toString(16)}`);
 }
}

// 1000:2c9c modalDispatch: in-race modal page handler; returns 1 to leave the modal loop 68dc.
// Jump table CS:2d78 covers screens 0x0e..0x36.
export function* f1000_2c9c(screen,choice){
 screen&=0xffff;choice&=0xffff;
 const t=u16(screen-0xe)>0x28?0x2dca:frw(gseg(0x1000),0x2d78+2*u16(screen-0xe));
 switch(t){
  case 0x2cb8: // 0x26 exit race?
   if(f1000_4774()===1)ww(0x924c,0xffff);
   ww(0x9b8c,0xffff);F.f2524_43cc();return 1;
  case 0x2cd8: // 0x36 out of gas
   F.f2524_1e8a(0);ww(0x924c,1);return 1;
  case 0x2cec:{ // 0x27 pit menu
   f1000_47be();
   const ax=rw(0x9b62+2*choice);
   if(ax===0){yield* f1000_1c5e();return 0;}
   if(ax===1){yield* f1000_57a2();return 0;}
   if(ax===2){yield* f1000_57ac();return 0;}
   f1000_1692();
   F.f2524_426c(0xffff);
   f1000_0708();
   F.f2524_03f2(rw(0x8f02),rw(0x8f04)); // far pointer to trax.mus, packed
  }
  // falls through into the 0x0e code (1000:2d28)
  case 0x2d28: // 0x0e paused
   F.f2524_43cc();ww(0x9b8c,0xffff);return 1;
  case 0x2d4a: // 0x28, 0x2c
   yield* f1000_23e2();return 0;
  case 0x2d50: // 0x17
   yield* f1000_65ea(choice,1);return 0;
  case 0x2d60: // 0x18
   yield* f1000_6626(choice,1);return 0;
  case 0x2d6c: // 0x1a
   yield* f1000_57b6();return 0;
  case 0x2d72: // 0x1f, 0x20, 0x29, 0x2a, 0x2f, 0x30
   f1000_2714();return 0;
  case 0x2dca:return 0;
  default:throw Error(`1000:2cb3 unexpected modal target ${t.toString(16)}`);
 }
}

// 1000:2dd0 drawCarPicture: CAR<n>.SCR of the current car model, then its name.
export function f1000_2dd0(){
 f1000_69ca();f1000_0278();
 F.f1000_c2ce(0xa8d8,rw(0x18b8+(rw(0x9b0c)<<1)));
 _Cstrcat(0xa8d8,0xddf); // ".SCR"
 F.f2524_2be8(0xa8d8);
 F.f1ff8_2fca(0x99ec);
 f1000_045a();f1000_0286();
 F.f2524_203a(rsb(0xd2a+rw(0x9b0c)));
}

// 1000:2e4a drawCarName: HELLCAT / CRUSHER / PITBULL label and text colour.
export function f1000_2e4a(){
 const ax=rw(0x9b0c);
 if(ax===0){
  f1000_4d06(0xe1a,0x73,0x9b);
  wb(0x3840,0xc);
  if(rw(0x896c)!==0)wb(0x3840,0xe);
 }else if(ax===1){
  f1000_4d06(0xe24,0x73,0x9b);
  wb(0x3840,0xe);
 }else if(ax===2){
  f1000_4d06(0xe2e,0x73,0x9b);
  wb(0x3840,5);
 }
 F.f2524_2452();
 f1000_69d8();
}

// 1000:2eb8 newGame: reset loadout, damage and cash, then show the car dealer page 0x0b.
export function* f1000_2eb8(){
 f1000_2dd0();
 for(let i=0;i<6;i++)ww(0x1fd2-2*i,0);  // STD REP STOSW: part levels 1fc8..1fd2
 for(let i=0;i<9;i++)ww(0x1fe4-2*i,0);  // weapon models 1fd4..1fe4
 F.f2524_258c();
 ww(0xa24e,0x2710);ww(0xa250,0);       // cash[9] = 10000
 for(let i=0;i<0x12;i++)ww(0xa24c-2*i,rw(0xa250-2*i)); // backward overlapping MOVSW fills cash[0..8]
 if(rw(0xd26)!==0){ww(0xa22a,0x4b40);ww(0xa22c,0x4c);} // cheat: 5,000,000
 ww(0x8dac,0);ww(0xa670,0);ww(0x8eb6,0);ww(0xaa9e,0);
 F.f2524_26c0();
 yield* f1000_6d76(0xb,0x22);
 ww(0x8964,0);
 yield* F.f2524_4584();
 yield* F.f2524_4584();
 f1000_2e4a();
}

// 1000:2f72 shopChoice: car picture and page 0x1e (parts or weapons).
export function* f1000_2f72(){
 f1000_2dd0();
 yield* f1000_6d76(0x1e,0x22);
 f1000_2e4a();
}

// 1000:2f88 enterRace(city): circuit races may get the mafioso offer first.
export function* f1000_2f88(city){
 ww(0x9a84,0);ww(0x9808,city);
 if(rw(0xd24)!==0){yield* f1000_2ff4();return;}
 yield* f1000_2fb0();
}

// 1000:2fb0 runRaceAndResults: race, randomise rival progress after a quit, results page.
export function* f1000_2fb0(){
 yield* f1000_32b8();
 if(rsw(0x924c)<0){
  F.f2524_1e8a(0);
  let si=0xa67c;
  for(let di=9;di;di--){
   const ax=F.f1000_a3ca()&0x0fff; // AND AH,0Fh
   ww(si,ax);ww(si+2,0);si+=4;
  }
 }
 yield* f1000_34b0();
}

// 1000:2ff4 mafiosoOffer: circuit race entry; when the race word is odd (or in autoplay) show page 0x1b.
export function* f1000_2ff4(){
 ww(0x901a,0);
 if(!(rb(0x9636)&1)&&rw(0x1fa6)===0){ww(0x9a84,0);yield* f1000_2fb0();return;}
 let dx;
 if(rw(0x1fa6)!==0)dx=mod16(rw(0x9636),9)+1;
 else dx=mod16(rw(0x9636),10);
 ww(0x9a84,dx);
 if(dx===0){yield* f1000_2fb0();return;}
 f1000_1780(0x1b);
 f1000_38e4(0xe50); // MAFIOZO1.BMP
 ww(0x1f28,1);
 yield* f1000_3c0a(0x1b,0x80);
 const v=mod16(rw(0x9636),3);
 wb(0x3840,0);ww(0xa8a6,0);
 ww(0x8a4a,imul16(F.f1000_a3ca()&3,0x3e8)+0x7d0);
 F.f2524_2758(v);
 const name=()=>rw(0x17a2+(rw(0x9a84)<<1));
 if(v===0){
  f1000_4d06(name(),0xa,0x6e);
  f1000_3760(rsw(0x8a4a),0xa,0x8c,1);
 }else if(v===1){
  f1000_3760(rsw(0x8a4a),0xa,0x50,1);
  f1000_4d06(name(),0xa,0x64);
 }else{
  f1000_4d06(name(),0xa,0x64);
  f1000_3760(rsw(0x8a4a),0x42,0x78,1);
 }
 f1000_3930(0,0x97,0x2b);
 f1000_4808(0x97,0x2b,0x97,0x8d,2);
 F.f2524_1528(0,0,0x140,0xc8,0x4a);
 f1000_390a();
 f1000_69d8();
}

// 1000:318c mafiosoResult: page 0x1d (contract fulfilled, bounty paid) or 0x1c.
export function* f1000_318c(){
 if(rw(0x9a84)===0)return;
 f1000_38e4(0xfb5); // MAFIOZO2.BMP
 ww(0x1f28,1);
 if(rw(0x901a)!==0){
  wd(0xa22a,u32(rd(0xa22a)+rsw(0x8a4a)));
  f1000_1780(0x1d);
  yield* f1000_3c0a(0x1d,0x80);
  const v=mod16(rw(0x9636),3);
  wb(0x3840,0);
  if(v<0||v>1){
   f1000_3760(rsw(0x8a4a),0xa,0x46,1);
   f1000_4d06(0xfc2,0xa,0x6e);
  }else{
   f1000_3760(rsw(0x8a4a),0x52,0x64,1);
  }
  F.f2524_2998();
 }else{
  f1000_1780(0x1c);
  yield* f1000_3c0a(0x1c,0x80);
  wb(0x3840,0);
  F.f2524_2b00();
 }
 f1000_3930(s16(1-rw(0x901a)),0x97,0x2b);
 f1000_4808(0x97,0x2b,0x97,0x8d,2);
 F.f2524_1528(0,0,0x140,0xc8,0x4a);
 f1000_390a();
 f1000_69d8();
}

// 1000:32b8 loadAndRunRace: <city>.MAP and <city>.TRK, then the race loop 047c.
export function* f1000_32b8(){probe('32b8');
 ww(0x9250,0);ww(0x924e,0);
 F.f1000_c2ce(0xa8d8,rw(0x1cb4+(rw(0x9808)<<1)));
 _Cstrcat(0xa8d8,0x1112); // ".MAP"
 F.f2524_2be8(0xa8d8);
 F.f2524_4cb6();
 f1000_1208(0x99ec);
 f1000_0278();
 const p=F.f1000_c2f6(0x99ec,0x2e)&0xffff; // strrchr(path,'.')
 if(p)wb(p,0);
 _Cstrcat(0x99ec,0x1117); // ".TRK"
 f1000_69ca();
 const r=yield* f1000_4fae(0x99ec);
 // QUIRK: on a TRK load failure (-1) the race is skipped and 2fb0 still shows results (gameflow.md §6).
 if(u16(r+1)!==0){
  f1000_69d8();
  yield* f1000_047c();
  f1000_031a();
  F.f1ff8_3c64(rw(0xa252));
 }
}

// 1000:3396 runCircuitRace: next city of the circuit order.
export function* f1000_3396(){
 ww(0x89c8,rw(0xd24)===2?1:0);
 yield* f1000_2f88(rw(0x18ba+(rw(0xd24)<<1)));
}

// 1000:33be driverBmpName(k): DS:a8d8 = file base of driver k + ".BMP".
export function f1000_33be(k){
 F.f1000_c2ce(0xa8d8,rw(0x17b6+(k<<1)));
 _Cstrcat(0xa8d8,0x111c);
}

// 1000:3406 drawTopScores: page 0x14 with the HI_SCORE names and cash.
export function* f1000_3406(){
 f1000_5136();
 f1000_1780(0x14);
 yield* f1000_3c0a(2,0x80);
 for(let si=0;si<10;si++)wb(0x8eda+si,si);
 F.f1000_e5a4(0x8eda,10,1,0x26d6); // qsort with comparator 1000:26d6
 let di=0x32;
 for(let si=0;si<10;si++){
  const k=rsb(0x8eda+si);
  ww(0xa8a6,1);
  f1000_4d06(rw(0x1b58+2*k),0x30,di);
  f1000_3760(rd(0x1b30+4*k),0x110,di,3);
  di+=0xa;
 }
 ww(0x1f28,1);
 f1000_69d8();
}

// 1000:34b0 raceResults: sort by progress, record places, pay prizes, draw page 9.
export function* f1000_34b0(){
 f1000_1780(9);
 for(let si=0,di=0xa678;si<10;si++,di+=4){
  wb(0x8eda+si,si);
  if(rsb(0x8a54+si)<=0){
   F.f1000_e9a0(di,0xa); // *(u32*)di >>= 10 (AH=0 from SI; RET 4)
   wb(0x8a54+si,0);
  }
 }
 F.f1000_e5a4(0x8eda,10,1,0x2678); // qsort with comparator 1000:2678
 f1000_0286();
 f1000_11c2(0x14);
 yield* f1000_3c0a(2,0x90);
 f1000_4778();
 F.f1ff8_3692(rw(0x8e98));
 ww(0xa8a6,1);
 f1000_4d06(0x1121,0x8a,0x37); // "PLACE"
 ww(0xa8a6,0);
 f1000_4d06(0x1127,0xc0,0x37); // "KILLS    WINNINGS"
 F.f1ff8_3692(rw(0x8eb4));
 const buf=salloc(10); // [bp-0x10] itoa buffer
 try{
  for(let i=0;i<10;i++){
   const k=rsb(0x8eda+i);
   F.f2524_2bbe(k);
   const y=s16(i*10+0x46);
   f1000_4d06(rw(0x17a2+2*k),0xf,y);
   F.f2524_2bbe(k);
   const r=s16(rw(0xd24)-2);
   // QUIRK: with d24==0 (single race) r=-2, so these writes land at 96b0 and 9924+... (gameflow.md §6).
   // The kills stored are always [0x5c6e] (driver 0), literal.
   ww(0x96b4+2*r,rw(0x5c6e));
   if(rb(0x8a54+k)===0){
    wb(0x9926+r+k*10,0);
    f1000_4d06(0x1139,0x8e,y); // "OUT"
   }else{
    f1000_4d06(rw(0xd42+2*i),0x8e,y);
    wb(0x9926+r+k*10,i+1);
   }
   // Rivals are paid by place even when OUT; the player only when not wrecked.
   if(rb(0x8a54+k)!==0||k!==0){
    const o=0xa22a+4*k;
    wd(o,u32(rd(o)+rsw(0xd2e+2*i)));
   }
   F.f2524_2bbe(k);
   f1000_4d06(F.f1000_def6(rw(0x5c6e+2*k),buf,10),0xcc,y);
   const si=rsw(0xd2e+2*i);
   if(si!==0&&rw(0xd24)!==0&&rb(0x8a54+k)!==0){
    let x=0xf2;
    if(si<0x2710)x+=4;
    f1000_3760(rsw(0xd2e+2*i),x,y,1);
   }else{
    f1000_4d06(0x113d,0xf2,y); // "  ---  "
   }
  }
 }finally{sfree(10);}
 ww(0x1f28,1);
 f1000_38e4(0x1145); // RESULTS.BMP
 f1000_3930(0,0xc,0xa);
 f1000_3930(1,0xc8,0xa);
 f1000_69d8();
}

// 1000:3760 drawMoney(value,x,y,align): "$" + thousands-separated u32, aligned 0 (6692), 1 left,
// 2 centred, 3 right.
export function f1000_3760(value,x,y,align){
 const b14=salloc(0x14),b30=salloc(0x14);
 try{
  F.f1000_c2ce(b14,0x1151); // "$"
  const q=F.f1000_e9c0(...lw(value),...lw(1000))>>>0;  // unsigned long divide
  F.f1000_df12(...lw(q),b30,10);                // ultoa
  if(q){F.f1000_c298(b14,b30);F.f1000_c298(b14,0x1153);} // ","
  const r=F.f1000_ea22(...lw(value),...lw(1000))>>>0;  // unsigned long remainder
  F.f1000_df12(...lw(r),b30,10);
  if(q){
   if(F.f1000_c058(b30)===1)_Cstrcat(b14,0x1155);      // "00"
   else if(F.f1000_c058(b30)===2)_Cstrcat(b14,0x1158); // "0"
  }
  _Cstrcat(b14,b30);
  align&=0xffff;
  if(align===0){f1000_6692(b14,x,y);return;}
  let off=0; // UNKNOWN: [bp-0x32] is uninitialised for align values other than 0..3.
  if(align===1)off=0;
  else if(align===2){const v=s16(F.f1000_c058(b14)<<3);off=Math.trunc(v/2);}
  else if(align===3)off=s16(F.f1000_c058(b14)<<3);
  f1000_4d06(b14,s16(x-off),y);
 }finally{sfree(0x14);sfree(0x14);}
}

// 1000:38e4 loadPicture(name): replace [0x9bc2] with the bitmap set from file `name` (0 if missing).
export function f1000_38e4(name){
 F.f2524_2be8(name);
 f1000_390a();
 ww(0x9bc2,F.f1ff8_0006(0x99ec));
 f1000_045a();
}

// 1000:390a freePicture: free [0x9bc2] and compact the heap.
export function f1000_390a(){
 if(rw(0x9bc2)!==0)F.f1ff8_0476(rw(0x9bc2));
 ww(0x9bc2,0);
 F.f1000_c272(0xffff);
}

// 1000:3930 drawPicture(i,x,y): frame i of [0x9bc2] if loaded.
export function f1000_3930(i,x,y){
 if(rw(0x9bc2)===0)return;
 F.f1ff8_2541(rw(rw(0x9bc2)+(i<<1)),x,y);
}

// 1000:3958 afterRace: single race -> new game; circuit not over -> hub; circuit over -> standings.
export function* f1000_3958(){
 if(rw(0xd24)===0){yield* f1000_2eb8();return;}
 if(rw(0xd24)!==0xb){yield* f1000_1798();return;}
 ww(0xd24,0);
 f1000_22fe();
 yield* f1000_204c();
}

// 1000:397c afterChampion: player champion -> hi-score, harder circuit; else new game.
export function* f1000_397c(){
 if(rw(0x9a3e)!==0){yield* f1000_2eb8();return;}
 yield* f1000_25bc();
 ww(0xd28,rw(0xd28)+1);
 if(rw(0xd28)===4)ww(0xd28,3);
 yield* f1000_39a0();
}

// 1000:39a0 newCircuit: shuffle the city order and show the hub.
export function* f1000_39a0(){
 ww(0xd24,1);
 f1000_238c();
 yield* f1000_1798();
}

// 1000:39ae continueAfterDiskCheck: probe disk 2 via HI_SCORE, then continue to [0x9b22].
export function* f1000_39ae(){
 ww(0x1fba,0);
 if(f1000_5136()===0){
  ww(0x1fba,1);
  yield* f1000_6d76(0xd,0);return; // INSERT DISK #2
 }
 ww(0x1fba,1);
 switch(rw(0x9b22)){
  case 5:yield* f1000_6d76(5,0);return;
  case 0xb:
   if(rw(0x1fa8)!==0)ww(0x1fa6,rw(0x1fa6)+1);
   yield* f1000_2eb8();return;
  case 0xc:yield* f1000_1798();return;
  case 0x34:yield* f1000_2230();return;
  case 0x63:yield* f1000_397c();return;
 }
}

// 1000:3a16 clearPages: empty the page list.
export function f1000_3a16(){ww(0x9bcc,0);}

export {f1000_2766 as menuDispatch,f1000_2c9c as modalDispatch,f1000_2eb8 as newGame,f1000_34b0 as raceResults,
 f1000_39ae as continueAfterDiskCheck,f1000_39a0 as newCircuit,f1000_33be as driverBmpName,f1000_2dd0 as drawCarPicture,
 f1000_2e4a as drawCarName};

// qsort comparators passed by near address (1000:3406, 1000:34b0); translated in fragment B.

// ===== D =====
// ---- Fragment D: dialog framework 1000:3a1e-4fad (gameflow.md §2) ----
// Page record (13 bytes): +0 line list, +2 button list (the record acts as a list node), +4 x (w), +6 width (w),
// +8 b=99, +9 b, +0xa y (b), +0xb height (b), +0xc style (b).
// Line record (14 bytes): +0 str, +2 next, +4 x, +6 width, +8 focused (b), +9 prev focus (b), +0xa y (b),
// +0xb height (b), +0xc capacity (b, strlen at creation), +0xd editable (b).
// Button record (12 bytes): +0 str, +2 next, +4 x, +6 width, +8 hover (b), +9 prev hover (b), +0xa y (b), +0xb height (b).

// 1000:3a1e newPage: append a page node and a fresh page record with the given style
export function f1000_3a1e(style){
 let idx=1,node;
 if(rw(0x9bcc)===0){node=F.f1000_de60(4);ww(0x9bcc,node);}
 else{
  let cx=rw(0x9bcc);
  while(rw(cx+2)!==0){cx=rw(cx+2);idx++;}
  node=F.f1000_de60(4);ww(cx+2,node);
 }
 // QUIRK: idx counts the existing nodes, so every page after the first stores the index of the previous
 // last page in [0x9018]/[0x8db8] (static, 1000:3a40-3a77: DX is not incremented for the new node).
 ww(0x9018,idx);ww(0x8db8,idx);
 const rec=F.f1000_de60(0xd);
 ww(node,rec);ww(node+2,0);
 ww(0x8a48,rec);
 wb(rec+0xc,style);ww(rec,0);ww(rec+2,0);wb(rec+9,0);wb(rec+8,0x63);ww(rec+4,0);wb(rec+0xa,0);
}

// 1000:3ab8 selectPage: make page n (1-based) current, focus its first editable line; 0, or -1 past the end
export function f1000_3ab8(n){
 ww(0x9018,n);
 let cx=rw(0x9bcc),dx=s16(n);
 while(dx>1){dx--;if(rw(cx+2)===0)return -1;cx=rw(cx+2);}
 const rec=rw(cx);ww(0x8a48,rec);
 if(rec===0)return -1;
 ww(0x8984,rb(rec+0xc));
 let l=rw(rec);
 while(l!==0&&rb(l+0xd)===0)l=rw(l+2);
 if(l!==0){wb(l+8,1);ww(0x5a00,0);ww(0xa66c,0xe);ww(0x115c,rw(0x115c)+1);}
 return 0;
}

// 1000:3b46 addLine: append a line (string, editable flag) to the current page
export function f1000_3b46(str,editable){
 const rec=rw(0x8a48);let p;
 if(rw(rec)===0){p=F.f1000_de60(0xe);ww(rw(0x8a48),p);}
 else{let cx=rw(rec);while(rw(cx+2)!==0)cx=rw(cx+2);p=F.f1000_de60(0xe);ww(cx+2,p);}
 ww(p+2,0);ww(p,str);wb(p+0xd,editable);
 wb(p+0xc,F.f1000_c058(str));
}

// 1000:3bb6 addButton: append a button to the current page
export function f1000_3bb6(str){
 let bx=rw(0x8a48),p;
 if(rw(bx+2)===0){p=F.f1000_de60(0xc);bx=rw(0x8a48);}
 else{let cx=rw(bx+2);while(rw(cx+2)!==0)cx=rw(cx+2);p=F.f1000_de60(0xc);bx=cx;}
 ww(bx+2,p);ww(p+2,0);ww(p,str);
}

// 1000:3c0a layoutAndDrawPage: lay out the current page (box size/position, lines, buttons) and draw it
export function* f1000_3c0a(frame,flags){
 let nLines=0,nButtons=0,maxLine=0,maxButton=0;
 ww(0x98d6,flags);ww(0xa8a6,0);
 if(rb(0x98d6)&1){f1000_031a();f1000_0286();}
 else if(!(rb(0x98d6)&0x20))f1000_02d2();
 ww(0x5c02,frame);
 F.f1ff8_3692(rw(0x8eb4));
 ww(0x5c82,8);ww(0x8eae,8);
 // Widest line: (strlen+2)*glyph, or capacity*glyph for editable lines.
 for(let si=rw(rw(0x8a48));si!==0;si=rw(si+2)){
  nLines++;
  const w=rb(si+0xd)===0?s16(imul16(F.f1000_c058(rw(si))+2,rw(0x8eae))):u16(mul16(rb(si+0xc),rw(0x8eae)));
  if(!(s16(maxLine)>=s16(w)))maxLine=w;
 }
 // Buttons: width (strlen+2)*glyph, height line+4.
 for(let si=rw(rw(0x8a48)+2);si!==0;si=rw(si+2)){
  nButtons++;
  ww(si+6,imul16(F.f1000_c058(rw(si))+2,rw(0x8eae)));
  wb(si+0xb,rb(0x5c82)+4);
  const w=rsw(si+6);if(w>=s16(maxButton))maxButton=w;
 }
 let bx=rw(0x8a48);
 let ax=s16(maxButton+0x1e);if(!(ax>=s16(maxLine)))ax=maxLine;
 ax=u16(ax+4);ww(bx+6,ax);ww(0x8a52,ax);
 const lh=rsw(0x5c82);
 let cx=s16(imul16(nLines+2,lh)+imul16(nButtons,lh+2)+idiv16(lh,2));
 if(!(rb(0x98d6)&2))cx=s16(cx+0x14);
 if(cx>0xbe)cx=0xbe;
 bx=rw(0x8a48);wb(bx+0xb,cx);wb(0xa8a4,cx);
 // Buttons span the box width minus two glyphs.
 for(let b=rw(bx+2);b!==0;b=rw(b+2))ww(b+6,rw(0x8a52)-(rw(0x8eae)<<1));
 bx=rw(0x8a48);
 ax=idiv16(s16(0x140-rw(bx+6)),2);ww(bx+4,ax);ww(0x8a96,ax);
 // QUIRK: vertical centring in byte arithmetic (gameflow.md §2: wraps at 256).
 const y=u8(0xc8-rb(bx+0xb))>>1;wb(bx+0xa,y);wb(0x8db0,y);
 if(rb(0x98d6)&0x80){ww(bx+4,5);ww(0x8a96,5);wb(bx+0xa,5);wb(0x8db0,5);ww(bx+6,0x136);ww(0x8a52,0x136);wb(bx+0xb,0xbe);wb(0xa8a4,0xbe);}
 else if(rb(0x98d6)&2){wb(bx+0xa,0x92);wb(0x8db0,0x92);}
 // Lines: centred, one every line height starting one line below the box top.
 let di=0;
 for(let si=rw(rw(0x8a48));si!==0;si=rw(si+2)){
  di++;
  const w=rb(si+0xd)===0?imul16(F.f1000_c058(rw(si)),rw(0x8eae)):mul16(rb(si+0xc),rw(0x8eae));
  ww(si+6,w);wb(si+0xb,rb(0x5c82));
  ww(si+4,idiv16(s16(rw(rw(0x8a48)+6)-rw(si+6)),2)+rw(0x8a96));
  wb(si+0xa,mul16(di&0xff,rw(0x5c82))+rb(0x8db0));
 }
 nLines=di;
 // Buttons: relative positions below the lines (made absolute after the box is drawn).
 if(rw(rw(0x8a48)+2)!==0){
  const step=rw(0x5c82)+3;let yb=u8(imul16(nLines,rw(0x5c82)));const gx=rw(0x8eae);
  for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2)){yb=u8(yb+step);wb(b+0xa,yb);ww(b+4,gx);}
 }
 F.f2524_2c22();
 f1000_4808(rw(0x8a96),rb(0x8db0),rw(0x8a52),rb(0xa8a4),1);
 for(let si=rw(rw(0x8a48));si!==0;si=rw(si+2)){
  if(rb(si+0xd)!==0){
   const save=rw(0xa8a6);ww(0xa8a6,1);
   f1000_4bd4(rw(si+4)-2&0xffff,rb(si+0xa)-2&0xffff,rw(si+6)+4&0xffff,rb(si+0xb)+3);
   ww(0xa8a6,save);
  }
  if(rb(0x98d6)&0x10)f1000_4d06(rw(si),0xb8,rb(si+0xa));
  else f1000_4d06(rw(si),rw(si+4),rb(si+0xa));
 }
 for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2)){
  ww(b+4,rw(b+4)+rw(0x8a96));wb(b+0xa,rb(b+0xa)+rb(0x8db0));wb(b+8,0x63);
  f1000_45ea(b);
 }
 ww(0xa464,0);
 yield* F.f2524_4584();
}

// 1000:3f92 hitTest(x,y,pressed,&redraw,ascii,scan): per-poll page/file-dialog input; returns the event code
export function* f1000_3f92(x,y,pressed,redrawPtr,ascii,scan){
 ww(0xa668,x);ww(0xa6a0,y);ww(0x9aee,pressed);ww(0x9bc6,0);ww(0x8dbe,ascii);ww(0x9658,scan);
 if(rw(0x1f2a)!==0){
  F.f2524_328e();
  ww(redrawPtr,F.f2524_3658());
  return rw(0x9924);
 }
 yield* f1000_3fe4();
 ww(redrawPtr,f1000_44fc());
 return rw(0xa66c);
}

// 1000:3fe4 hitTestPage: event code for the pointer, shop grid selection and B/D keys, button/field hits
export function* f1000_3fe4(){
 let bias=0;
 ww(0xa66c,f1000_42ce(rw(0x8a96)-0x14&0xffff,rw(0x8a52)+0x19&0xffff,rb(0x8db0)-0x19&0xffff,rb(0xa8a4)+0x1f)?0xb:0);
 if(rw(0x98d6)&0x300){
  if(F.f1000_df1c(rw(0x8dbe))===0x42){
   if(rw(0x98d6)&0x200){yield* f1000_632e();return;}
   yield* f1000_5c7c();return;
  }
  if(F.f1000_df1c(rw(0x8dbe))===0x44){yield* f1000_6090();return;}
 }
 if(rw(0x9aee)===0){
  // Release: clear hover; a press that was over a button becomes an activation.
  for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2))wb(b+8,0);
  if(rw(0xaa9c)!==0){ww(0xa464,rw(0xaa9c));ww(0xa66c,0xd);}
  ww(0xaa9c,0);
  return;
 }
 ww(0xaa9c,0);
 if(rw(0x5c02)!==0)bias=1;
 if(rw(0x98d6)&0x300){
  let cols,cw;
  if(rw(0x98d6)&0x200){cols=3;cw=0x64;}else{cols=6;cw=0x32;}
  for(let c=0,base=0,xacc=0;c<cols;c++,base+=3,xacc+=0x12c){
   const x0=s16(idiv16(xacc,cols)+0xa);
   for(let di=0,y0=0x28;di<3;di++,y0+=0x23){
    if(!f1000_42ce(x0,cw,y0,0x23))continue;
    if(cols===6){
     const idx=s16(base+di);if(idx===rsw(0x115e))continue;
     const old=rsw(0x115e);ww(0x115e,idx);
     f1000_5a88(idiv16(old,3),imod16(old,3));
     f1000_5a88(c,di);
    }else{
     const idx=imod16(s16(3*s16(c+rw(0x1e6c))+di),0x1b);
     if(idx===rsw(0x1160))continue;
     let old=rsw(0x1160);ww(0x1160,idx);
     if(rsw(0x1e6c)>6&&old<6)old=s16(old+0x1b);
     f1000_5df6(idiv16(s16(-s16(3*rw(0x1e6c)-old)),3),imod16(old,3));
     f1000_5df6(c,di);
    }
    F.f1ff8_3692(rw(0x8eb4));
    ww(0x9bc6,rw(0x9bc6)+1);
   }
  }
 }
 let di=0;
 for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2)){
  di++;
  if(f1000_42ce(rw(b+4),rw(b+6),rb(b+0xa),rb(b+0xb)-bias&0xffff)){wb(b+8,1);ww(0xa66c,0xc);ww(0xaa9c,di);}
  else wb(b+8,0);
 }
 for(let l=rw(rw(0x8a48));l!==0;l=rw(l+2)){
  if(rb(l+0xd)===0){wb(l+8,0);continue;}
  // An editable line that is missed keeps its focus (static, 1000:4275 skips the clear).
  if(f1000_42ce(rw(l+4),rw(l+6),rb(l+0xa),rb(l+0xb))){wb(l+8,1);ww(0x5a00,0);ww(0xa66c,0xe);ww(0x115c,rw(0x115c)+1);}
 }
}

// 1000:42ce pointInRect(x,w,y,h): pointer [0xa668],[0xa6a0] inside; x inclusive at both ends, y exclusive at the top
export function f1000_42ce(x,w,y,h){
 const px=rsw(0xa668),py=rsw(0xa6a0);
 if(s16(x)>px)return 0;
 if(s16(x+w)<px)return 0;
 if(s16(y)>=py)return 0;
 if(s16(y+h)<py)return 0;
 return 1;
}

// 1000:4302 drawField: redraw an editable line with its cursor
export function f1000_4302(line){
 ww(0xa8a6,1);
 const y=rb(line+0xa);
 f1000_4bd4(rw(line+4)-2&0xffff,y-2&0xffff,rw(line+6)+4&0xffff,rb(line+0xb)+3);
 if(rb(line+0xc)!==rw(0x5a00)){
  const off=imul16(rw(0x5a00),rw(0x8eae))&0xffff;
  ww(0xa8a6,0);
  const di=rw(line+4)+off&0xffff,t=rw(0x5c82)+y-1&0xffff;
  F.f1ff8_2454(di,t,rw(0x8eae)+di-1&0xffff,t);
 }
 ww(0xa8a6,1);wb(0x3842,1);
 f1000_4d06(rw(line),rw(line+4),rb(line+0xa));
}

// 1000:439e editField: apply this poll's key to the focused editable line
export function f1000_439e(line){
 const s=rw(line);
 let len=F.f1000_c058(s);
 const redraw=()=>{ww(0x9bc6,rw(0x9bc6)+1);};
 const sc=rsw(0x9658);
 done:{
  if(sc===0)break done;
  switch(sc){
   case 0x4b:if(rsw(0x5a00)>0)ww(0x5a00,rw(0x5a00)-1);redraw();break done;
   case 0x0e:
    if(!(rsw(0x5a00)>0))break done;
    ww(0x5a00,rw(0x5a00)-1);{const si=s+rw(0x5a00)&0xffff;f1000_4f8c(si,si+1&0xffff);}
    redraw();break done;
   case 0x1c:ww(0x9bc6,rw(0x9bc6)+1);ww(0x8dbe,0);ww(0x9658,0);return;
   case 0x47:ww(0x5a00,0);redraw();break done;
   case 0x4d:if(s16(len)>rsw(0x5a00))ww(0x5a00,rw(0x5a00)+1);redraw();break done;
   case 0x4f:ww(0x5a00,len);redraw();break done;
   case 0x52:ww(0x1162,rw(0x1162)===0?1:0);redraw();break done;
   case 0x53:
    if(s16(len)>rsw(0x5a00)){const si=s+rw(0x5a00)&0xffff;f1000_4f8c(si,si+1&0xffff);}
    redraw();break done;
  }
  if(rsw(0x8dbe)<0x20)break done;
  const cap=rb(line+0xc);
  if(!(rw(0x5a00)<cap))break done;
  if(rw(0x1162)!==0&&u16(len)<cap){const si=s+rw(0x5a00)&0xffff;f1000_4f8c(si+1&0xffff,si);}
  if(rw(0x1162)!==0||u16(len)===rw(0x5a00))len=u16(len+1);
  const cur=rw(0x5a00);ww(0x5a00,cur+1);
  wb(s+cur,rb(0x8dbe));
  wb(s+len,0);
  redraw();
 }
 if(rw(0x9bc6)!==0)f1000_4302(line);
}

// 1000:44fc repaintPage: repaint buttons/fields whose state changed, close the page on activation; returns [0x9bc6]
export function f1000_44fc(){
 if(rw(0xa66c)===0xd){
  if(!(rw(0x98d6)&0x100))f1000_46da();
  ww(0x9bc6,rw(0x9bc6)+1);
  return rw(0x9bc6);
 }
 // Buttons that lost the hover first (normal colour), then those that gained it (highlight).
 for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2)){
  if(rb(b+8)!==rb(b+9)&&rb(b+8)!==1){ww(0xa8a6,0);f1000_45ea(b);wb(b+9,rb(b+8));ww(0x9bc6,rw(0x9bc6)+1);}
 }
 for(let b=rw(rw(0x8a48)+2);b!==0;b=rw(b+2)){
  if(rb(b+8)!==rb(b+9)){ww(0xa8a6,1);f1000_45ea(b);wb(b+9,rb(b+8));ww(0x9bc6,rw(0x9bc6)+1);}
 }
 for(let l=rw(rw(0x8a48));l!==0;l=rw(l+2)){
  if(rb(l+8)===1&&rb(l+0xd)!==0)f1000_439e(l);
  if(rb(l+8)===rb(l+9))continue;
  ww(0xa8a6,rb(l+8)===1?1:0);
  if(rb(l+0xd)!==0){f1000_4302(l);wb(l+9,rb(l+8));ww(0x9bc6,rw(0x9bc6)+1);}
 }
 return rw(0x9bc6);
}

// 1000:45ea drawButton: button background and label; shop buttons and '<'/'>' arrows have fixed places
export function f1000_45ea(btn){
 let tx;
 const str=rw(btn);
 if(str===0x2760){ww(btn+4,0xd);ww(btn+6,0x64);tx=0x24;}           // "BUY IT"
 else if(str===0x2768){                                            // "DESCRIBE"
  ww(btn+4,0xcf);ww(btn+6,0x62);tx=0xde;
  wb(btn+0xa,rw(0x98d6)&0x200?0x99:0x9b);
 }
 else if(rb(str)===0x3c){ww(btn+4,0xa);wb(btn+0xa,0xa);ww(btn+6,0x32);wb(btn+0xb,0xc);tx=0x1c;}
 else if(rb(str)===0x3e){ww(btn+4,0x104);wb(btn+0xa,0xa);ww(btn+6,0x32);wb(btn+0xb,0xc);tx=0x115;}
 else tx=idiv16(s16(rw(0x8a52)-imul16(F.f1000_c058(str),rw(0x8eae))),2)+rw(0x8a96)&0xffff;
 const y=rb(btn+0xa);
 f1000_4bd4(rw(btn+4),y+1,rw(btn+6),rb(btn+0xb)-1&0xffff);
 f1000_4d06(rw(btn),tx,y+3);
}

// 1000:46da closePage: mark the page closed, free the picture, restore the screen per the page flags
export function f1000_46da(){
 ww(0x1f28,0xffff);
 if(!(rb(0x98d6)&4))f1000_390a();
 if(rw(0x98d6)&0x800){
  if((rw(0x9af0)|rw(0x9af2))===0)return;
  // Far pointer [0x9af0] (offset) : [0x9af2] (segment) passed packed.
  F.f1ff8_2551(rw(0x9af0),rw(0x9af2),rw(0x8a96)-5&0xffff,rb(0x8db0)-5&0xffff,rw(0x8a52)+0xa&0xffff,rb(0xa8a4)+0xb);
  F.f1ff8_3ae2(rw(0x9af0),rw(0x9af2));
  ww(0x9af2,0);ww(0x9af0,0);
  return;
 }
 if(rw(0x98d6)&0x400)return;
 if(rb(0x98d6)&0x40){f1000_031a();f1000_0286();return;}
 f1000_02d2();
}

// 1000:4770 currentPage
export function f1000_4770(){return rw(0x9018);}
// 1000:4774 activatedButton
export function f1000_4774(){return rw(0xa464);}

// 1000:4778 freeLines: free all lines of the current page
export function f1000_4778(){
 const bx=rw(0x8a48);
 if(rw(bx)===0)return;
 let si=rw(bx);ww(bx,0);
 do{const di=rw(si+2);if(si!==0)F.f1000_de4e(si);si=di;}while(si!==0);
 // UNKNOWN: malloc(0xffff) result is discarded (heap probe/compaction, gameflow.md catalogue: inferred).
 F.f1000_de60(0xffff);
}

// 1000:47be freeButtons: free all buttons of the current page
export function f1000_47be(){
 const bx=rw(0x8a48);
 if(rw(bx+2)===0)return;
 let si=rw(bx+2);ww(bx+2,0);
 do{const di=rw(si+2);if(si!==0)F.f1000_de4e(si);si=di;}while(si!==0);
 F.f1000_de60(0xffff); // UNKNOWN: as in 4778
}

// 1000:4808 drawBox(x,y,w,h,mode): fill (mode!=2), bevelled frame (mode!=5), random speckles and decorations
export function f1000_4808(x,y,w,h,mode){
 const p=salloc(16);const xs=p,ys=p+8; // locals [bp-0x1a..-0x14] and [bp-0x22..-0x1c]
 try{
  mode=s16(mode);
  if(mode!==2){
   if(rw(0x8984)!==0){wb(0x384d,4);wb(0x384e,4);F.f1ff8_3810(x,y,w,h);}
   else F.f2524_2c9a(x,y,w,h);
  }
  if(mode!==5){
   let c=rw(0x8984)!==0?0x1d:9;wb(0x384d,c);wb(0x384e,c);
   F.f1ff8_3810(x-5&0xffff,y-5&0xffff,5,h+0xa&0xffff);
   c=rw(0x8984)!==0?0xc:0xb;wb(0x384d,c);wb(0x384e,c);
   let si=x+w&0xffff;const di=y-5&0xffff;
   F.f1ff8_3810(si,di,6,h+0xa&0xffff);
   ww(xs,x-5);ww(xs+2,si+5);ww(xs+4,si);ww(xs+6,x);
   ww(ys,di);ww(ys+2,di);ww(ys+4,y);ww(ys+6,y);
   c=rw(0x8984)!==0?0x14:0x1b;wb(0x384d,c);wb(0x384e,c);
   F.f1ff8_256d(4,xs,ys);
   si=y+h&0xffff;
   ww(ys,si+5);ww(ys+2,si+5);ww(ys+4,si);ww(ys+6,si);
   c=rw(0x8984)!==0?0x16:1;wb(0x384d,c);wb(0x384e,c);
   F.f1ff8_256d(4,xs,ys);
  }
  if(rw(0x8984)!==0)return;
  let count=0;
  if(mode!==2){
   // Speckles: w*h/25 pairs of pixels in colours 7 and 9 (long maths __aNlmul/__aNldiv, 1000:e8a8/e80c).
   count=ldiv(lmul(s16(w),s16(h)),25);
   for(let n=count;n>0;n--){
    // Literal: on CGA/Tandy ([0x896c]) the speckles are skipped; the branch only skips drawing.
    if(rw(0x896c)!==0)continue;
    for(const col of [7,9]){
     const px=mod16(F.f1000_a3ca(),w)+x&0xffff;
     let py=mod16(F.f1000_a3ca(),h)+y&0xffff;if(py===u16(y))py=py+1&0xffff;
     F.f1ff8_3d2b(px,py,col);
    }
   }
  }
  // UNKNOWN: with mode 2 the original divides an uninitialised local here; the value is unused (mode!=1).
  count=ldiv(count,0x78); // 1000:e97e (*p /= 120)
  if(mode!==1||rw(0x8984)!==0)return;
  for(let n=count;n>0;n--){
   const px=mod16(F.f1000_a3ca(),w-0xc)+x&0xffff;
   let py=mod16(F.f1000_a3ca(),h-0xc)+y&0xffff;if(py===u16(y))py=py+1&0xffff;
   const k=F.f1000_a3ca()&7;
   F.f1ff8_2541(rw(rw(0x9bbe)+2*k),px,py);
  }
  if((F.f1000_a3ca()&1)&&s16(w)>0x50){
   const px=mod16(F.f1000_a3ca(),w-0x28)+x+0xa&0xffff;
   const k=F.f1000_a3ca()&1;
   F.f1ff8_2541(rw(rw(0x9bbe)+2*k+0x14),px,y-5&0xffff);
  }
  if((F.f1000_a3ca()&1)&&s16(w)>0x50&&s16(h)>0x3c){
   const px=mod16(F.f1000_a3ca(),w-0x5a)+x+0xa&0xffff;
   F.f1ff8_2541(rw(rw(0x9bbe)+0x18),px,y+h-5&0xffff);
  }
  if((F.f1000_a3ca()&1)&&s16(h)>0x50){
   const py=mod16(F.f1000_a3ca(),h-0x28)+y+0xa&0xffff;
   const k=F.f1000_a3ca()&1;
   F.f1ff8_2541(rw(rw(0x9bbe)+2*k+0x10),x-5&0xffff,py);
  }
 }finally{sfree(16);}
}

// 1000:4bd4 drawButtonBg(x,y,w,h): button/field background with a two-colour edge; colour set by [0xa8a6]/[0x8984]
export function f1000_4bd4(x,y,w,h){
 // Literal: the [0x896c] (CGA/Tandy) tests only pick colour values and are kept as in the original.
 if(rsw(0xa8a6)>0){
  if(rw(0x8984)!==0){wb(0x384d,0x16);wb(0x384e,0xc);F.f1ff8_3810(x,y,w,h);wb(0x384e,0);}
  else{
   if(rw(0x896c)!==0){wb(0x384d,0xc);wb(0x384e,0xf);}else{wb(0x384d,9);wb(0x384e,0xb);}
   F.f1ff8_3810(x,y,w,h);
   wb(0x384e,rw(0x896c)!==0?0:1);
  }
 }else{
  wb(0x384d,rw(0xa8a6)!==0?5:rw(0x8984)!==0?4:3);
  if(rw(0x8984)!==0){wb(0x384e,0);F.f1ff8_3810(x,y,w,h);wb(0x384e,0xc);}
  else{
   wb(0x384e,rw(0x896c)!==0?0:1);
   F.f1ff8_3810(x,y,w,h);
   wb(0x384e,rw(0x896c)!==0?0xf:0xb);
  }
 }
 const si=x+w-1&0xffff;
 F.f1ff8_2454(x,y,si,y);
 F.f1ff8_2454(si,y+1&0xffff,si,y+h-1&0xffff);
}

// 1000:4d06 drawShadowText(str,x,y): text with a 1-px outline in the page style
export function f1000_4d06(str,x,y){
 wb(0x3842,1);
 if(rw(0x8984)!==0){
  wb(0x3840,0);F.f1ff8_23ba(str,x,y);
  wb(0x3840,rw(0xa8a6)===1?7:0xf);
  F.f1ff8_23ba(str,x+1&0xffff,y);
  return;
 }
 wb(0x3840,0);F.f1ff8_23ba(str,x-1&0xffff,y);
 wb(0x3840,0xf);F.f1ff8_23ba(str,x+1&0xffff,y);
 // Literal: [0x896c] (CGA/Tandy) only selects colour 0xf instead of 0xe.
 if(rw(0xa8a6)===1)wb(0x3840,0xc);
 else if(rw(0xa8a6)===0)wb(0x3840,rw(0x896c)!==0?0xf:0xe);
 else wb(0x3840,rb(0xa8a6));
 F.f1ff8_23ba(str,x,y);
}

// 1000:4dc0 fileDialogDraw: draw the file dialog from the record [0x5a04] and reset its state (far)
export function f1000_4dc0(){
 F.f2524_2d1c();F.f2524_2d48();F.f2524_3782();
 F.f1000_c03e(0x3f,9,0xc2,0xb6,0);
 F.f1000_c0f4(0x6c,0x19,0x7a,0xd);
 F.f1000_c0f4(0x55,0x89,0x9a,0xf);
 F.f1ff8_3692(rw(0x8eb4));
 F.f1000_c0c0(rw(rw(0x5a04)+0x48),0x4d,0xe);
 F.f1ff8_3692(rw(0x8e98));
 if(rw(rw(0x5a04)+0x4c)!==0){
  const drive=s16(rsb(rw(rw(0x5a04)+0x4c))-0x41);
  F.f2524_3b41(drive);
  F.f1000_c0d4(rw(rw(0x5a04)+0x4c));
  F.f1000_c0e2(0x9b24,0x3b);
  ww(rw(0x5a04)+0x4c,0);
 }else F.f1000_c0e2(0x9b24,0x3b);
 F.f2524_2db2();F.f2524_3546();
 ww(0x9924,0);wb(0xa8d8,0);
 const buf=F.f1000_c272(0x3c);
 F.f1000_c0e2(buf,0x3b);
 let skip=s16(F.f1000_c058(buf)-0x13);if(skip<0)skip=0;
 F.f1000_c0c0(skip+buf&0xffff,0x71,0x1d);
 ww(0x8a92,0);ww(0x8a90,0);ww(0x96f0,0);ww(0x8e90,0);
 F.f1000_c280(buf);
}

// 1000:4f28 openFileDialog(a,b,c,d,okLabel,cancelLabel,title,pattern,dir): allocate the dialog record, draw it (far)
export function f1000_4f28(a1,a2,a3,a4,a5,a6,a7,a8,a9){
 const r=F.f1000_c272(0x4e);ww(0x5a04,r);
 if(r===0)return -1;
 const bx=rw(0x5a04);
 ww(bx,a1);ww(bx+4,a2);ww(bx+2,a3);ww(bx+6,a4);ww(bx+0x48,a7);ww(bx+0x44,a5);ww(bx+0x46,a6);ww(bx+0x4a,a8);ww(bx+0x4c,a9);
 f1000_4dc0();
 ww(0x5a06,0);
 return 0;
}

// 1000:4f8c strShift(dst,src): memmove(dst,src,strlen(src)+1) (far; 1000:e546 is memmove)
export function f1000_4f8c(dst,src){
 F.f1000_e546(dst,src,F.f1000_c058(src)+1&0xffff);
}

// ===== E1 =====
// ---- fragment E1: 1000:4fae-5a87 (track file, HI_SCORE, circuit save/load, shop entry and grid) ----
// Runtime functions used here (meaning inferred from use): daa4 open(name,mode[,perm]) -> handle/-1,
// dc48 read(h,buf,n) -> count/-1, dd26 write(h,buf,n) -> count/-1, da0a close(h); d678 fopen(name,mode),
// d6a0 fread(buf,size,n,fp), d886 fwrite(buf,size,n,fp), d5be fclose(fp), e7fe remove(name);
// e8a8 long multiply, e80c / e9c0 long divide (callee-pops MSC helpers, operands in C order).

// 1000:4fae loadTrack: read <city>.TRK ('T'..':' header, word count, pairs into 9dfe/aa46, triples into 5c9e/5ca0/5ca2).
// Returns 0, or -1 after showing warning page 3 (cannot open), 2 (bad header) or 4 (read error).
export function* f1000_4fae(name){
 let cnt=0; // [bp-0x14]
 const h=F.f1000_daa4(name,0x8000)&0xffff;
 if(h===0xffff){yield* f1000_6d62(3,0);return -1;}
 const p=salloc(10); // [bp-0x12] header (4 bytes), [bp-0xc],[bp-0xa],[bp-8] triple words
 const hdr=p,t0=p+4,t1=p+6,t2=p+8;
 try{
  let page=0;
  fail:{
   if(((F.f1000_dc48(h,hdr,4)+1)&0xffff)===0){page=4;break fail;}
   if(rb(hdr)!==0x54||rb(hdr+3)!==0x3a){page=2;break fail;}
   if(((F.f1000_dc48(h,0x5c00,2)+1)&0xffff)===0){page=4;break fail;}
   cnt=0;
   if(rsw(0x5c00)>0){
    let si=0x9dfe,di=0xaa46;
    do{
     if(((F.f1000_dc48(h,si,2)+1)&0xffff)===0){page=4;break fail;}
     if(((F.f1000_dc48(h,di,2)+1)&0xffff)===0){page=4;break fail;}
     si+=2;di+=2;cnt++;
    }while(cnt<rsw(0x5c00));
   }
   let di=0,a=0x5c9e,b=0x5ca0,c=0x5ca2;
   for(;;){
    // QUIRK: only a zero-byte read ends the list; a -1 read result is taken as data (literal OR AX,AX).
    if((F.f1000_dc48(h,t0,2)&0xffff)===0){cnt=di;break;}
    if((F.f1000_dc48(h,t1,2)&0xffff)===0){cnt=di;page=4;break fail;}
    if((F.f1000_dc48(h,t2,2)&0xffff)===0){cnt=di;page=4;break fail;}
    // All-zero triples after the second one are skipped.
    if(di>1&&rw(t0)===0&&rw(t1)===0&&rw(t2)===0)continue;
    ww(a,rw(t0));ww(b,rw(t1));ww(c,rw(t2));
    a+=6;b+=6;c+=6;di++;
   }
   F.f1000_da0a(h);
   const v=cnt-1;ww(0x9b0a,v);ww(0x8986,v);
   f1000_045a();
   return 0;
  }
  yield* f1000_6d62(page,0);
  F.f1000_da0a(h);
  return -1;
 }finally{sfree(10);}
}

// 1000:5136 readHiScores: load HI_SCORE (10 x {name[15], u32 cash}) into *1b58[i] / 1b30[i]. 1 = read, 0 = missing.
export function f1000_5136(){
 F.f2524_2be8(0x11c8);
 const h=F.f1000_daa4(0x99ec,0x8000)&0xffff;
 if(h===0xffff)return 0;
 let si=0x1b58,di=0x1b30;
 for(let n=10;n;n--){
  // Read results are not checked (static).
  F.f1000_dc48(h,rw(si),0xf);
  F.f1000_dc48(h,di,4);
  si+=2;di+=4;
 }
 F.f1000_da0a(h);
 f1000_045a();
 return 1;
}

// 1000:51bc writeHiScores: write HI_SCORE (mode 0x8301, perm 0x80). Open failure shows page 0x0d "INSERT DISK #2".
export function* f1000_51bc(){
 F.f2524_2be8(0x11d1);
 const h=F.f1000_daa4(0x99ec,0x8301,0x80)&0xffff;
 if(h===0xffff){yield* f1000_6d76(0xd,0);return;}
 let di=0x1b58,cash=0x1b30;
 for(let i=0;i<10;i++){
  if((F.f1000_dd26(h,rw(di),0xf)&0xffff)===0xffff)break;
  if(((F.f1000_dd26(h,cash,4)+1)&0xffff)===0)break;
  di+=2;cash+=4;
 }
 F.f1000_da0a(h);
}

// 1000:525a loadCircuit: open <name>.RCT (name from 2524:3b96 into DS:a8d8), check "R..:" and read it via 5368.
// Returns 0, or -1 after error page 0x21 (cannot open), 0x22 (not a race file) or 0x23 (mangled).
export function* f1000_525a(){
 F.f2524_3b96();
 const fpp=F.f1000_d678(0xa8d8,0x11df)&0xffff;
 const p=salloc(4); // [bp-6] 4-byte header
 try{
  let page;
  if(fpp===0)page=0x21;
  else if((F.f1000_d6a0(p,1,4,fpp)&0xffff)===0)page=0x22;
  else if(rb(p)!==0x52||rb(p+3)!==0x3a)page=0x22; // only bytes 0 and 3 are checked (gameflow.md §4)
  else{
   ww(0x8e94,0xd6a0); // record I/O through fread
   if((f1000_5368(fpp)&0xffff)===0){f1000_045a();return 0;}
   page=0x23;
  }
  yield* f1000_6d62(page,0);
  // QUIRK: fclose is called even when fopen returned NULL (static).
  F.f1000_d5be(fpp);
  return -1;
 }finally{sfree(4);}
}

// 1000:52ec saveCircuit: create <name>.RCT, write the "RAC:" tag (DS:11e5) and the records via 5368.
// Returns 0, or -1 after error page 0x24 (cannot open) or 0x25 (write error).
export function* f1000_52ec(){
 F.f2524_3b96();
 const fpp=F.f1000_d678(0xa8d8,0x11e2)&0xffff;
 let page;
 if(fpp===0)page=0x24;
 else if((F.f1000_d886(0x11e5,1,4,fpp)&0xffff)===0)page=0x25;
 else{
  ww(0x8e94,0xd886); // record I/O through fwrite
  if((f1000_5368(fpp)&0xffff)===0){f1000_045a();return 0;}
  page=0x25;
 }
 yield* f1000_6d62(page,0);
 F.f1000_d5be(fpp);
 return -1;
}

// 1000:5368 circuitRecordIO: read or write (per the function pointer [0x8e94]) the 428-byte circuit body, then fclose.
// Returns 0 on success, 1 on a short transfer or a failed fclose (a failed fclose after writing also removes the file).
export function f1000_5368(fpp){
 const io=(buf,size,n)=>callFar(near(rw(0x8e94)),buf,size,n,fpp)&0xffff;
 let p96dc=0x96dc,p8e5c=0x8e5c,p9b0e=0x9b0e,pa8c4=0xa8c4,p9238=0x9238,p9a86=0x9a86,p5c04=0x5c04,
  pa22a=0xa22a,p1c5c=0x1c5c,p9aa6=0x9aa6,p9b6c=0x9b6c,p1c48=0x1c48;
 for(let k=0;k<10;k++){
  if(!io(p96dc,2,1))return 1;
  if(!io(p8e5c,2,1))return 1;
  if(!io(p9b0e,2,1))return 1;
  if(!io(pa8c4,2,1))return 1;
  if(!io(p9238,2,1))return 1;
  if(!io(p9a86,2,1))return 1;
  if(!io(p5c04,2,1))return 1;
  if(!io(pa22a,4,1))return 1;
  if(!io(p1c5c,2,1))return 1;
  if(!io(p9aa6,2,1))return 1;
  // Bytes 9926[j*10+k], j=0..9 (one byte per driver for race column k).
  for(let j=0,si=k+0x9926;j<10;j++,si+=10)if(!io(si&0xffff,1,1))return 1;
  if(!io(p9b6c,2,1))return 1;
  if(!io(p1c48,2,1))return 1;
  p96dc+=2;p8e5c+=2;p9b0e+=2;pa8c4+=2;p9238+=2;p9a86+=2;p5c04+=2;pa22a+=4;p1c5c+=2;p9aa6+=2;p9b6c+=2;p1c48+=2;
 }
 for(let i=0;i<6;i++)if(!io(0x1fc8+2*i,2,1))return 1;
 for(let i=0;i<9;i++)if(!io(0x1fd4+2*i,2,1))return 1;
 for(const g of [0xd24,0x8eb8,0x9b0c,0x115e,0x1160,0xd28,0xa670,0x8dac,0x8eb6,0xaa9e])if(!io(g,2,1))return 1;
 io(0x1792,1,0xe); // name: result not checked (static)
 if((F.f1000_d5be(fpp)&0xffff)===0){
  // Rebuild the laps string *[0xb4e] from [0x8eb8] as two digits.
  const l=rsw(0x8eb8),bx=rw(0xb4e);
  wb(bx,idiv16(l,10)+0x30);
  wb(bx+1,imod16(l,10)+0x30);
  return 0;
 }
 if(rw(0x8e94)===0xd886)F.f1000_e7fe(0xa8d8);
 return 1;
}

// 1000:574c drawShopCash: cash panel of the player (a22a[0]) under the shop grid.
export function f1000_574c(){
 const y=rw(0x1e6a)===0?0x9e:0x9c;
 ww(0xa8a6,1);
 f1000_4bd4(0x71,y-2,0x5e,0xb);
 // 3760(long cash, x, y, mode): the u32 cash is passed as one 32-bit argument (pushed as two words).
 f1000_3760(rd(0xa22a),0xa0,y,2);
}

// 1000:57a2 openWeaponsShop: [0x1e6a]=1, load WEAPONS.BMP and draw page 0x18.
export function* f1000_57a2(){ww(0x1e6a,1);yield* f1000_5804();}
// 1000:57ac openPartsShop: [0x1e6a]=0, load PARTS.BMP and draw page 0x17.
export function* f1000_57ac(){ww(0x1e6a,0);yield* f1000_5804();}

// 1000:57b6 drawShop: redraw the current shop page (0x17 flags 0x180 / 0x18 flags 0x380) and its grid.
export function* f1000_57b6(){
 f1000_0286();
 ww(0x1f28,1);
 if(rw(0x1e6a)===0){f1000_3ab8(0x17);yield* f1000_3c0a(2,0x180);f1000_5822();}
 else{f1000_3ab8(0x18);yield* f1000_3c0a(2,0x380);f1000_582e();}
 f1000_69d8();
}

// 1000:5804 enterShop: pointer shape 1, load PARTS.BMP (DS:1e6e) or WEAPONS.BMP (DS:1e78), draw the shop.
export function* f1000_5804(){
 f1000_69ca();
 f1000_38e4(rw(0x1e6a)===0?0x1e6e:0x1e78);
 yield* f1000_57b6();
}

// 1000:5822 drawPartsGrid: 6 rows.
export function f1000_5822(){f1000_583a(6);}
// 1000:582e drawWeaponsGrid: 3 rows.
export function f1000_582e(){f1000_583a(3);}

// 1000:583a drawShopGrid(rows): row labels and 3 cells per row (cell painter 5a88 parts / 5df6 weapons), then the cash panel.
export function f1000_583a(rows){
 rows=s16(rows);
 const weapons=rows===3?1:0;  // [bp-2]
 let cell=0x5df6;              // [bp-4]: near pointer to the cell painter
 f1000_0286();
 if(rows>0){
  const h=s16(0x32*weapons+0x32); // [bp-0xe]
  let acc=0,lbl=0x1dce,di=0;      // [bp-0x10], [bp-0x12]
  do{
   F.f1ff8_3692(rw(0x8e98));
   const x=s16(idiv16(acc,rows)+0xa); // [bp-0xc]
   ww(0xa8a6,0);
   f1000_4bd4(x,0x1e,h,0xa);
   wb(0x3840,0);
   if(weapons){
    let t=imod16(s16(di+rw(0x1e6c)),9);
    if(t>8)t-=8;
    const sp=0x1dbc+2*t;
    const n=F.f1000_c058(rw(sp));
    F.f1ff8_23ba(rw(sp),s16(sar16(s16(-s16(n*6-0x64)),1)+x),0x20);
   }else{
    const n=F.f1000_c058(rw(lbl));
    F.f1ff8_23ba(rw(lbl),s16(sar16(s16(-s16(n*6-0x32)),1)+x),0x20);
    cell=0x5a88;
   }
   // Indirect call through the local pointer [bp-4] (targets 1000:5a88 / 1000:5df6, both registered).
   for(let si=0;si<3;si++)callFar(near(cell),di,si);
   acc=s16(acc+0x12c);lbl+=2;di++;
  }while(di<rows);
 }
 F.f1ff8_3692(rw(0x8eb4));
 f1000_574c();
 f1000_6cea();
}

// 1000:598c repairPrice(part, level): [0xa9a2] = repair cost of part type `part` if the player owns that level
// (damage% of 1000 for brakes..airfoil, engine and armour from their max/current values). Returns 1 if nonzero.
export function f1000_598c(part,level){
 ww(0xa9a2,0);
 part=s16(part);
 if(rw(0x1fc8+2*part)!==u16(level))return 0;
 let r;
 const pct=v=>F.f1000_e80c(...lw(F.f1000_e8a8(...lw(rsw(v)),...lw(100))),...lw(1000)); // damage*100/1000
 switch(part){
  case 0:{
   if(rw(0x1c48)===rw(0x9b6c))return 0;
   // QUIRK: IMUL result is truncated by CWD before the long divide (static, 1000:59e2-59e4).
   const num=s16(imul16(s16(rw(0x1c48)-rw(0x9b6c)),100));
   r=F.f1000_e80c(...lw(num),...lw(rsw(0x1c48)));
   break;
  }
  case 1:if(rw(0xaa9e)===0)return 0;r=pct(0xaa9e);break;
  case 2:if(rw(0x8eb6)===0)return 0;r=pct(0x8eb6);break;
  case 3:if(rw(0xa670)===0)return 0;r=pct(0xa670);break;
  case 4:if(rw(0x8dac)===0)return 0;r=pct(0x8dac);break;
  case 5:if(rw(0x9aa6)===0)return 0;r=F.f1000_e9c0(...lw(F.f1000_e8a8(...lw(rsw(0x9aa6)),...lw(100))),...lw(rsw(0x1c5c)));break;
  default:return 0;
 }
 ww(0xa9a2,r);
 return (r&0xffff)?1:0;
}

register(0x1000,0x5a88,f1000_5a88,{name:'f1000_5a88'});
register(0x1000,0x5df6,f1000_5df6,{name:'f1000_5df6'});

// ===== E2 =====
// ---- fragment E2: 1000:5a88-6dbb (shop cells and purchases, description page, menu loops, pointer) ----

// 1000:5a88 drawPartCell: draw one parts-shop grid cell (type, level) with price and picture
export function f1000_5a88(type,level){
 const N=0x2a,bp=salloc(N)+N;
 try{
  wb(0x384b,0);
  const x=s16(idiv16(s16(imul16(0x12c,type)),6)+10); // [bp-0x24]
  let t3=s16(type*3);                                   // [bp-0x2]
  const y=s16(imul16(0x23,level)+0x2a);                // [bp-0x28]
  if(s16(t3+level)===rsw(0x115e)){wb(0x3840,0xe);ww(0xa8a6,1);}
  else{
   wb(0x3840,0xf);ww(0xa8a6,0);
   if(rsw(0x1fc8+u16(type<<1))===s16(level)){ww(0xa8a6,0xffff);wb(0x3840,0xe);}
  }
  f1000_4bd4(x,s16(y-2),0x32,0x23);
  const cx=s16(x+0x19);                                 // [bp-0x2a]
  const buf=bp-0x22,num=bp-0xe;
  F.f1000_c2ce(buf,0x1e84);                             // "$ "
  const idx=u16(s16(t3+level)<<1);
  if(f1000_598c(type,level)){
   // repair price = price * damage / 100 (MSC long helpers)
   const q=F.f1000_e80c(...lw(F.f1000_e8a8(...lw(rsw(0x1dda+idx)),...lw(rsw(0xa9a2)))),...lw(100));
   F.f1000_def6(s16(q),num,10);
  }else F.f1000_def6(rsw(0x1dda+idx),num,10);
  F.f1000_c298(buf,num);
  F.f1000_c298(buf,0x1e87);                             // ".00"
  let px=s16(cx-(s16(F.f1000_c058(buf)<<2)>>1));        // [bp-0x26]
  F.f1ff8_3692(rw(0x8e72));
  F.f1ff8_23ba(buf,px,s16(y+0x1a));
  const si=rw(0x9bc2);
  const bmp=rw(u16(s16(t3+level)<<1)+si);               // [bp-0x4]; read even when no pictures are loaded
  px=s16(cx-(rsw(bmp+6)>>1));
  if(si){
   px=s16(px+1);
   F.f1ff8_2541(bmp,px,y);
   if(rw(0xa9a2)){
    t3=0x12;if(rw(0xa8a6))t3++;
    f1000_3930(t3,s16(x+1),s16(y-1));
   }
  }
  if(rw(0x1fae)&&rsw(0x1fc8+u16(type<<1))!==s16(level))F.f2524_3bcc(x,s16(y-2),0x32,0x23);
  wb(0x384b,1);
 }finally{sfree(N);}
}

// 1000:5c7c buyPart: BUY in the parts shop for the selected part [0x115e]
export function* f1000_5c7c(){
 // Protection penalty site (gameflow.md §5); [0x1fb8] is never set in this build.
 if(rw(0x1fb8))f1000_0344(0x1e8b);
 const type=idiv16(rw(0x115e),3),level=imod16(rw(0x115e),3);
 f1000_598c(type,level);
 ww(0xa9a2,F.f1000_e80c(...lw(F.f1000_e8a8(...lw(rsw(0x1dda+u16(rw(0x115e)<<1))),...lw(rsw(0xa9a2)))),...lw(100)));
 const own=rsw(0x1fc8+u16(type<<1));
 if(rw(0x1fae)&&own!==level){yield* f1000_6d76(0x29,0x424);return;}
 // Cash compares are unsigned 32-bit against the sign-extended price.
 if(!rw(0xa9a2)&&u32(rsw(0x1dda+u16(rw(0x115e)<<1)))>rd(0xa22a)){yield* f1000_6d76(0x1f,0x424);return;}
 if(rw(0xa9a2)&&u32(rsw(0xa9a2))>rd(0xa22a)){yield* f1000_6d76(0x2a,0x424);return;}
 if(own===level&&!rw(0xa9a2)){yield* f1000_6d76(0x20,0x424);return;}
 if(!rw(0xa9a2))ww(0xa9a2,rw(0x1dda+u16(rw(0x115e)<<1)));
 wd(0xa22a,rd(0xa22a)-rsw(0xa9a2));
 ww(0x1fc8+u16(type<<1),level);
 switch(type){
  case 0:F.f2524_26d2();break;
  case 1:ww(0xaa9e,0);F.f2524_26e4();break;
  case 2:ww(0x8eb6,0);F.f2524_2710();break;
  case 3:ww(0xa670,0);break;
  case 4:ww(0x8dac,0);break;
  case 5:F.f2524_2744();break;
 }
 f1000_5822();
}

// 1000:5df6 drawWeaponCell: draw one weapons-shop grid cell (column, model) with price, ammo and picture
export function f1000_5df6(col,level){
 if(s16(col)>2||s16(col)<0)return;
 const N=0x32,bp=salloc(N)+N;
 try{
  wb(0x384b,0);
  let x=s16(idiv16(s16(imul16(0x12c,col)),3)+10);       // [bp-0x2a]
  let y=s16(imul16(0x23,level)+0x2a);                  // [bp-0x30]
  const type=imod16(s16(col+rw(0x1e6c)),9);             // [bp-0x2c]
  const idx=imod16(s16(type*3+level),0x1b);             // [bp-0xa]
  if(idx===rsw(0x1160)){wb(0x3840,0xe);ww(0xa8a6,1);}
  else{
   wb(0x3840,0xf);ww(0xa8a6,0);
   if(rsw(0x1fd4+u16(type<<1))===s16(level)){wb(0x3840,0xe);ww(0xa8a6,0xffff);}
  }
  f1000_4bd4(x,s16(y-2),0x64,0x23);
  const cx=s16(x+0x32);                                 // [bp-0x32]
  let avail=1;                                          // [bp-0x2]
  if(rw(0x1fae)){
   const si=u16(type<<1);
   if(!rw(0x1daa+si)||rsw(0x1fd4+si)!==s16(level))avail=0;
  }
  const buf=bp-0x28,num=bp-0x14;
  if(avail){
   F.f1ff8_3692(rw(0x8e72));
   F.f1000_c2ce(buf,0x1eac);                            // "$ "
   F.f1000_def6(rsw(0x1dfe+u16(idx<<1)),num,10);
   F.f1000_c298(buf,num);
   F.f1000_c298(buf,0x1eaf);                            // ".00"
   const px=s16(cx-u16(F.f1000_c058(buf)<<2)+0x30);
   F.f1ff8_23ba(buf,px,s16(y+0x1a));
   if(rsw(0x1fd4+u16(type<<1))===s16(level)){
    let n;
    switch(type){
     case 0:n=rw(0x96dc);break;
     case 2:n=rw(0x8e5c);break;
     case 3:n=rw(0x5c04);break;
     case 4:n=rw(0x9a86);break;
     case 7:n=rw(0x9238);break;
     default:n=1;
    }
    F.f1000_def6(s16(n),num,10);
    wb(0x3840,0);
    F.f1ff8_23ba(num,s16(cx-0x31),s16(y+0x1a));
   }
  }
  if(rw(0x9bc2)){
   const bmp=rw(u16(idx<<1)+rw(0x9bc2));
   let px=s16(cx-(rsw(bmp+6)>>1));
   px=s16(px+1);
   F.f1ff8_2541(bmp,px,y);
   if(!avail)f1000_3930(0x1b,s16(x+1),s16(y-1));
  }else{
   F.f1ff8_3692(rw(0x8e98));
   x=s16(x+10);y=s16(y+6);
   F.f1ff8_23ba(0x1eb3,x,y);                            // "NO MEMORY FOR"
   F.f1ff8_23ba(0x1ec1,s16(x+3),s16(y+8));              // "  PICTURE!"
  }
  wb(0x384b,1);
 }finally{sfree(N);}
}

// 1000:6090 describeItem: page 0x1a with manufacturer, name, price and the 8-line description of the selection
export function* f1000_6090(){
 f1000_3ab8(0x1a);
 f1000_0286();
 f1000_11c2(0x14);
 yield* f1000_3c0a(2,0x84);
 f1000_4778();
 ww(0xa8a6,1);
 F.f1ff8_3692(rw(0x8e98));
 f1000_4808(0xf,0xf,0x64,0x28,2);
 f1000_4bd4(0xf,0xf,0x65,0x28);
 f1000_4808(0xf,0x46,0x120,0x5f,2);
 f1000_4bd4(0xf,0x46,0x121,0x5f);
 wb(0x3840,0);
 F.f1ff8_23ba(0x1ecc,0x82,0xf);                         // "MANUFACTURER:"
 F.f1ff8_23ba(0x1eda,0x82,0x1e);                        // "PRODUCT NAME:"
 F.f1ff8_23ba(0x1ee8,0x82,0x2d);                        // "PRICE:"
 f1000_4d06(0x1eef,0x14,0x4b);                          // "DESCRIPTION"
 ww(0xa8a6,0);
 let price;
 if(!rw(0x1e6a)){
  for(let si=0,di=0x55;si<8;si++,di+=8){
   wb(0x3840,0xe);
   f1000_6692(F.f1000_a2de(u16((rw(0x115e)<<3)+si),1),0x1a,di);
  }
  const bmp=rw(u16(rw(0x115e)<<1)+rw(0x9bc2));
  f1000_3930(rw(0x115e),s16(-s16((rsw(bmp+6)>>1)-0x41)),0x17);
  wb(0x3840,0xc);
  f1000_6692(rw(0x1bc6+u16(idiv16(rw(0x115e),3)<<1)),0xa8,0x16);
  f1000_6692(rw(0x1b6c+u16(rw(0x115e)<<1)),0xa8,0x25);
  price=rsw(0x1dda+u16(rw(0x115e)<<1));
 }else{
  for(let si=0,di=0x55;si<8;si++,di+=8){
   wb(0x3840,0xe);
   f1000_6692(F.f1000_a2de(u16((rw(0x1160)<<3)+si),2),0x1a,di);
  }
  const bmp=rw(u16(rw(0x1160)<<1)+rw(0x9bc2));
  f1000_3930(rw(0x1160),s16(-s16((rsw(bmp+6)>>1)-0x41)),0x17);
  wb(0x3840,0xc);
  const m=(rw(0x1160)===0xa||rw(0x1160)===0xb)?0:idiv16(rw(0x1160),3);
  f1000_6692(rw(0x1bd2+u16(m<<1)),0xa8,0x16);
  f1000_6692(rw(0x1b90+u16(rw(0x1160)<<1)),0xa8,0x25);
  price=rsw(0x1dfe+u16(rw(0x1160)<<1));
 }
 f1000_3760(price,0xa8,0x34,0);                        // long price (CWD)
 F.f1ff8_3692(rw(0x8eb4));
 f1000_6cea();
}

// 1000:632e buyWeapon: BUY in the weapons shop for the selected weapon [0x1160] (trade-in credited first)
export function* f1000_632e(){
 // Protection penalty site (gameflow.md §5); [0x1fb8] is never set in this build.
 if(rw(0x1fb8))f1000_0344(0x1efb);
 const type=idiv16(rw(0x1160),3),level=imod16(rw(0x1160),3); // [bp-0xc], [bp-0x8]
 let ammo;                                              // [bp-0xa]
 switch(type){
  case 0:ammo=rw(0x96dc);break;
  case 2:ammo=rw(0x8e5c);break;
  case 3:ammo=rw(0x5c04);break;
  case 4:ammo=rw(0x9a86);break;
  case 7:ammo=rw(0x9238);break;
  default:ammo=1;
 }
 ammo=s16(ammo);
 let credit=0;                                          // [bp-0x2]
 const T=u16(type<<1);
 if(rsw(0x1fd4+T)!==level){
  // Trade-in: price of the owned model times the ammo count (rounds/100 for guns), 16-bit product.
  credit=type===2?idiv16(ammo,100):ammo;
  const cur=s16(rw(0x1fd4+T)+type*3);
  credit=s16(imul16(rw(0x1dfe+u16(cur<<1)),credit));
  wd(0xa22a,rd(0xa22a)+credit);
 }
 const off=rsw(0x1e6c);
 if(!(type>=off&&type<=s16(off+2))&&!(type===0&&off>=7)&&!(type===1&&off===8)){
  // QUIRK: the trade-in credit above is kept when the item is not on screen (popup 0x30 returns directly).
  yield* f1000_6d76(0x30,0x424);return;
 }
 let popup=0;
 if(rw(0x1fae)&&(!rw(0x1daa+T)||rsw(0x1fd4+T)!==level))popup=0x29;
 else if(u32(rsw(0x1dfe+u16(rw(0x1160)<<1)))>rd(0xa22a))popup=0x1f;
 else{
  if(!(rsw(0x1e34+u16(rw(0x1160)<<1))>ammo)&&!rw(0xd26)&&rsw(0x1fd4+T)===level){yield* f1000_6d76(0x2f,0x424);return;}
  if(rsw(0x1fd4+T)===imod16(rw(0x1160),3)&&(type===1||type===5||type===6||type===8))popup=0x20;
 }
 if(popup){
  // Shared exit at 1000:6451: show the popup, then take the trade-in credit back.
  yield* f1000_6d76(popup,0x424);
  if(rsw(0x1fd4+T)===level)return;
  wd(0xa22a,rd(0xa22a)-credit);
  return;
 }
 if(rsw(0x1fd4+T)!==level){
  switch(type){
   case 0:ww(0x96dc,0);break;
   case 2:ww(0x8e5c,0);break;
   case 3:ww(0x5c04,0);break;
   case 4:ww(0x9a86,0);break;
   case 7:ww(0x9238,0);break;
  }
 }
 ww(0x1fd4+T,imod16(rw(0x1160),3));
 wd(0xa22a,rd(0xa22a)-rsw(0x1dfe+u16(rw(0x1160)<<1)));
 switch(type){
  case 0:ww(0x96dc,rw(0x96dc)+1);break;
  case 2:ww(0x8e5c,rw(0x8e5c)+0x64);break;
  case 3:ww(0x5c04,rw(0x5c04)+1);break;
  case 4:ww(0x9a86,rw(0x9a86)+1);break;
  case 7:ww(0x9238,rw(0x9238)+1);break;
 }
 f1000_582e();
}

// 1000:65bc leaveShop: shop exit -> pit menu (in race), race hub (circuit) or main menu
export function* f1000_65bc(inPit){
 if(inPit){yield* f1000_23e2();return;}
 f1000_02dc();
 if(rw(0xd24)){yield* f1000_1798();return;}
 yield* f1000_6d76(5,0);
}

// 1000:65ea partsShopChoice: page 0x17 buttons (1 describe, 2 buy, 3 weapons shop, 4 exit)
export function* f1000_65ea(choice,inPit){
 switch(choice){
  case 1:yield* f1000_6090();return;
  case 2:yield* f1000_5c7c();return;
  case 3:f1000_02dc();yield* f1000_57a2();return;
  case 4:yield* f1000_65bc(inPit);return;
 }
}

// 1000:6626 weaponsShopChoice: page 0x18 buttons (1 <<, 2 >>, 3 describe, 4 buy, 5 parts shop, 6 exit)
export function* f1000_6626(choice,inPit){
 switch(choice){
  case 1:ww(0x1e6c,rw(0x1e6c)-1);if(rsw(0x1e6c)<0)ww(0x1e6c,8);f1000_582e();return;
  case 2:ww(0x1e6c,rw(0x1e6c)+1);if(rsw(0x1e6c)>8)ww(0x1e6c,0);f1000_582e();return;
  case 3:yield* f1000_6090();return;
  case 4:yield* f1000_632e();return;
  case 5:f1000_02dc();yield* f1000_57ac();return;
  case 6:yield* f1000_65bc(inPit);return;
 }
}

// 1000:6692 drawTextShadow: text in colour 0 at x, then in the current colour [0x3840] at x+1
export function f1000_6692(str,x,y){
 const c=s8(rb(0x3840));
 wb(0x3840,0);
 F.f1ff8_23ba(str,x,y);
 wb(0x3840,c);
 F.f1ff8_23ba(str,s16(x+1),y);
}

// The scancode/ASCII locals of 66d2 are not written in autoplay; the original passes stale stack words.
// APPROX: these keep the last values read instead of whatever the stack slot held.
let _E2_key=0,_E2_scan=0;

// 1000:66d2 menuKeyHook: per-poll callback ([0x1f20]): RNG tick, keys, autoplay script, hit test
export function* f1000_66d2(){
 F.f1000_a3ca();                                        // the RNG advances every poll
 if(rw(0x1f1e))ww(0x1f1e,rw(0x1f1e)-1);
 if(!rw(0x1fa6)){
  const key=u16(yield* F.f1ff8_4457());
  const up=u8(F.f1000_df1c(key&0x7f));                   // [bp-0x2]
  if(key===0x0f09)yield* F.f2524_4584();                  // Tab: next button
  _E2_scan=key>>8;                                        // [bp-0x6]
  _E2_key=key&0xff;                                       // [bp-0x4] with its high byte cleared
  if(yield* F.f1ff8_44a0(0x1c))ww(0x9aee,1);              // Enter held
  if((yield* F.f1ff8_44a0(0x38))&&up===0x43&&rw(0x1fc0))F.f1ff8_3dd1(); // Alt+C: joystick recalibration (sys module)
  if(f1000_4770()!==0x15&&!rw(0x1f2a)){
   if(yield* F.f1ff8_44a0(0x39))ww(0x9aee,1);             // Space held
   if(up===0x53){F.f2524_03dc();yield* f1000_21ba();}
   if(up===0x54){F.f2524_039c();yield* f1000_21ba();}
  }
 }
 ww(0x1f2e,rw(0x1f2e)+1);
 if(rsw(0x8dae)>0){ww(0x8dae,rw(0x8dae)-1);ww(0x9aee,1);}
 if(rw(0x1f2e)===0xc8){
  ww(0x1f2e,0);
  if(rw(0x1fa6))yield* F.f2524_0624();
 }
 ww(0x9b82,yield* f1000_3f92(rw(0x5a10),rw(0x5a12),rw(0x9aee),0x963c,_E2_key,_E2_scan));
}

// 1000:67e8 eventLoop: main menu loop, never returns
export function* f1000_67e8(){
 ww(0x1f20,0x66d2);
 ww(0x963c,0);
 for(;;){
  ww(0x9b82,0);
  yield* f1000_6a90();
  if(rw(0x963c))f1000_6cea();
  f1000_6998();
  if(rw(0x1f28)){
   if(rw(0x9b82)===0xd){
    const page=f1000_4770(),choice=f1000_4774();
    yield* f1000_2766(page,choice);
    if(rsw(0x1f28)<0)ww(0x1f28,0);
   }else if(f1000_4770()===0x2d)f1000_1d74(0);
   else if(f1000_4770()===0x31)f1000_1d74(1);
   continue;
  }
  if(!rw(0x1f2a))continue;
  let r;
  if(rw(0x1f2a)===1){
   if(rw(0x9b82)===0x17){ww(0x1f2a,0);ww(0x9b22,5);yield* f1000_39ae();}
   if(rw(0x9b82)!==0x15)continue;
   ww(0x1f2a,0);
   r=yield* f1000_525a();
  }else{
   if(rw(0x9b82)===0x17){ww(0x1f2a,0);ww(0x9b22,0xc);yield* f1000_39ae();}
   if(rw(0x9b82)!==0x15)continue;
   ww(0x1f2a,0);
   r=yield* f1000_52ec();
  }
  if(u16(r)===0xffff)continue;
  ww(0x9b22,0xc);
  yield* f1000_39ae();
 }
}

// 1000:68dc modalLoop: in-race menu loop; returns when 2c9c reports the menu closed
export function* f1000_68dc(){
 for(;;){
  ww(0x9b82,0);
  yield* f1000_6a90();
  if(rw(0x963c))f1000_6cea();
  f1000_6998();
  if(rw(0x9b82)===0xd){
   const page=f1000_4770(),choice=f1000_4774();
   if(rw(0x1fae)){
    // Rivals keep driving while the pit menu is open: ten passes over drivers 9..1.
    for(let n=10;n>0;n--)for(let k=9;k>0;k--)yield* F.f1000_7a9c(k);
   }
   if(page===0x1a||(s16(page)>=0x1f&&s16(page)<=0x20))f1000_6cea();
   else{f1000_026a();f1000_0304();f1000_0278();}
   if(yield* f1000_2c9c(page,choice)){ww(0x1fae,0);return;}
   continue;
  }
  if(rw(0x9b82)===0xc)continue;
  if(f1000_4770()===0x28)yield* f1000_24c4();
 }
}

// 1000:6998 updatePointerShape: shape 2 outside the box, shape 0 when entering it
export function f1000_6998(){
 const ev=rw(0x9b82);
 if(rw(0x1f30)===ev)return;
 if(!ev)f1000_69bc();
 else if(!rw(0x1f30))f1000_69d8();
 else return;
 ww(0x1f30,rw(0x9b82));
}

// 1000:69bc pointerShape2
export function f1000_69bc(){f1000_69e6(rw(rw(0x9bf6)+4));}
// 1000:69ca pointerShape1
export function f1000_69ca(){f1000_69e6(rw(rw(0x9bf6)+2));}
// 1000:69d8 pointerShape0
export function f1000_69d8(){f1000_69e6(rw(rw(0x9bf6)));}

// 1000:69e6 setPointerShape: install pointer bitmap, reallocate both background save buffers, redraw
export function f1000_69e6(bmp){
 if(rw(0x8a4e)|rw(0x8a50)){
  F.f1ff8_3ae2(rw(0x8a4e),rw(0x8a50));
  F.f1ff8_3ae2(rw(0xa8c0),rw(0xa8c2));
 }
 ww(0x5a0e,bmp);
 const size=u16(F.f1ff8_254d(rw(bmp+6),u16(rw(bmp+8)+1))); // [bp-0x4], high word [bp-0x2]=0
 let p=F.f1ff8_3a88(size,0,1);
 ww(0x8a4e,p&0xffff);ww(0x8a50,p>>>16);
 if(!((p&0xffff)|(p>>>16)))f1000_0344(0x1f32);          // "No memory for sprite data"
 p=F.f1ff8_3a88(size,0,1);
 ww(0xa8c0,p&0xffff);ww(0xa8c2,p>>>16);
 // QUIRK: the second check tests the first buffer [0x8a4e] again, not [0xa8c0] (static, 1000:6a75).
 if(!(rw(0x8a4e)|rw(0x8a50)))f1000_0344(0x1f5a);
 f1000_6cea();
}

// 1000:6a90 menuFrame: read joystick/keys/mouse, move the pointer, run the poll callback, redraw the pointer
export function* f1000_6a90(){
 F.f2524_0382();
 const bmp=rw(0x5a0e);
 const w=rw(bmp+6);                                     // [bp-0x2]
 let hNew=u16(rw(bmp+8)+1),hOld=hNew;                   // [bp-0xc], [bp-0xa]
 ww(0x9aee,0);
 if(!rw(0x1fa6)){
  // Joystick reads go to the sys module, which reports no joystick in the port.
  if(rb(0x4b9a)&&rw(0x1fc0)){
   ww(0x9aee,yield* F.f1ff8_3fc2(0));
   ww(0x5a14,yield* F.f1ff8_3fc2(1));
  }
  if(!rw(0x1f1e)){
   let dir=0;                                           // [bp-0x8]
   if(rb(0x4b9a)&&rw(0x1fc0))dir=(yield* F.f1ff8_3f62(0))&0xff;
   if(!dir)dir=yield* F.f1ff8_4486(0);
   // Free pointer movement with no page open or on grid pages (flag 0x100); else button selection.
   const free=!rw(0x1f28)||(rw(0x98d6)&0x100);
   if(dir&2){
    if(free)yield* F.f2524_3c2c(rw(0x5a10),u16(rw(0x5a12)+1),0);
    else{yield* F.f2524_4584();ww(0x1f1e,0x3c);}
   }else if(dir&1){
    if(free)yield* F.f2524_3c2c(rw(0x5a10),u16(rw(0x5a12)-1),0);
    else{yield* F.f2524_4612();ww(0x1f1e,0x3c);}
   }
   if(dir&8){if(free)yield* F.f2524_3c2c(u16(rw(0x5a10)+1),rw(0x5a12),0);}
   else if(dir&4){if(free)yield* F.f2524_3c2c(u16(rw(0x5a10)-1),rw(0x5a12),0);}
  }
  yield* F.f2524_3c2c(rw(0x5a10),rw(0x5a12),1);
  if(!rw(0x9aee)&&rw(0xaa9a))ww(0x9aee,yield* F.f1ff8_4068(0));
 }
 // Indirect call through the per-poll callback pointer (always 1000:66d2 here).
 if(rw(0x1f20))yield* callFarG(near(rw(0x1f20)));
 if(s16(hOld+rw(0x1f24))>0xc8)hOld=u16(0xc9-rw(0x1f24));
 if(s16(hNew+rw(0x5a12))>0xc8)hNew=u16(0xc9-rw(0x5a12));
 ww(0x3858,rw(0x3852));ww(0x3856,rw(0x3852));
 F.f1ff8_2549(rw(0x8a4e),rw(0x8a50),rw(0x5a10),rw(0x5a12),w,hNew);
 F.f1ff8_2541(rw(0x5a0e),rw(0x5a10),rw(0x5a12));
 ww(0x3858,rw(0x3854));
 F.f1ff8_2545(rw(0x1f22),rw(0x1f24),w,hOld);
 F.f1ff8_2545(rw(0x5a10),rw(0x5a12),w,hNew);
 ww(0x3858,rw(0x3852));
 F.f1ff8_2551(rw(0x8a4e),rw(0x8a50),rw(0x5a10),rw(0x5a12),w,hNew);
 ww(0x99bc,0);
 ww(0x5a0c,rw(0x9aee));
 ww(0x1f22,rw(0x5a10));
 ww(0x1f24,rw(0x5a12));
}

// 1000:6cea redrawPointer: draw the pointer into page [0x3852], copy it to the screen, restore the page
export function f1000_6cea(){
 ww(0x3858,rw(0x3852));
 let bmp=rw(0x5a0e);
 F.f1ff8_2549(rw(0xa8c0),rw(0xa8c2),rw(0x5a10),rw(0x5a12),rw(bmp+6),rw(bmp+8));
 F.f1ff8_2541(rw(0x5a0e),rw(0x5a10),rw(0x5a12));
 f1000_026a();
 f1000_0304();
 ww(0x3858,rw(0x3852));
 bmp=rw(0x5a0e);
 F.f1ff8_2551(rw(0xa8c0),rw(0xa8c2),rw(0x5a10),rw(0x5a12),rw(bmp+6),rw(bmp+8));
 ww(0x99bc,1);
 ww(0x963c,0);
}

// 1000:6d62 showPage(n,flags) with frame 0
export function* f1000_6d62(n,flags){yield* f1000_6d96(n,0,flags);}
// 1000:6d76 showPage(n,flags) with frame 2, then EGA border colour 0
export function* f1000_6d76(n,flags){yield* f1000_6d96(n,2,flags);F.f1ff8_3cf1(0);}
// 1000:6d96 showPage: select page n, prepare, lay out and draw it, redraw the pointer, mark a page open
export function* f1000_6d96(n,frame,flags){
 f1000_3ab8(n);
 f1000_0286();
 yield* f1000_3c0a(frame,flags);
 f1000_6cea();
 ww(0x1f28,1);
}

export {f1000_67e8 as eventLoop,f1000_68dc as modalLoop,f1000_66d2 as pollCallback,f1000_6a90 as pollInput,f1000_6998 as updatePointerShape,f1000_69e6 as setPointerShape,f1000_6cea as redrawPointer};

register(0x1000,0x66d2,f1000_66d2,{gen:true});
// 1000:583a calls these cell painters through a local near pointer ([bp-4] = 0x5df6 / 0x5a88).

provide({f1000_0010,f1000_026a,f1000_0278,f1000_0286,f1000_0290,f1000_029e,f1000_02ac,f1000_02b6,f1000_02c4,f1000_02d2,f1000_02dc,f1000_02ea,f1000_0304,f1000_031a,f1000_0344,f1000_038a,f1000_03f6,f1000_044a,f1000_045a,f1000_0466,f1000_046c,f1000_047c,f1000_04ed,f1000_06dc,f1000_0708,f1000_070a,f1000_11c2,f1000_11f2,f1000_1208,f1000_156c,f1000_1692,f1000_1780,f1000_1798,f1000_1916,f1000_1a66,f1000_1b00,f1000_1b40,f1000_1bea,f1000_1c5e,f1000_1cee,f1000_1d74,f1000_1e64,f1000_204c,f1000_21ba,f1000_21d6,f1000_2208,f1000_2230,f1000_22fe,f1000_238c,f1000_23e2,f1000_24c4,f1000_25bc,f1000_2678,f1000_26d6,f1000_2714,f1000_2766,f1000_2c9c,f1000_2dd0,f1000_2e4a,f1000_2eb8,f1000_2f72,f1000_2f88,f1000_2fb0,f1000_2ff4,f1000_318c,f1000_32b8,f1000_3396,f1000_33be,f1000_3406,f1000_34b0,f1000_3760,f1000_38e4,f1000_390a,f1000_3930,f1000_3958,f1000_397c,f1000_39a0,f1000_39ae,f1000_3a16,f1000_3a1e,f1000_3ab8,f1000_3b46,f1000_3bb6,f1000_3c0a,f1000_3f92,f1000_3fe4,f1000_42ce,f1000_4302,f1000_439e,f1000_44fc,f1000_45ea,f1000_46da,f1000_4770,f1000_4774,f1000_4778,f1000_47be,f1000_4808,f1000_4bd4,f1000_4d06,f1000_4dc0,f1000_4f28,f1000_4f8c,f1000_4fae,f1000_5136,f1000_51bc,f1000_525a,f1000_52ec,f1000_5368,f1000_574c,f1000_57a2,f1000_57ac,f1000_57b6,f1000_5804,f1000_5822,f1000_582e,f1000_583a,f1000_598c,f1000_5a88,f1000_5c7c,f1000_5df6,f1000_6090,f1000_632e,f1000_65bc,f1000_65ea,f1000_6626,f1000_6692,f1000_66d2,f1000_67e8,f1000_68dc,f1000_6998,f1000_69bc,f1000_69ca,f1000_69d8,f1000_69e6,f1000_6a90,f1000_6cea,f1000_6d62,f1000_6d76,f1000_6d96});
