// Segment 29f6: the EGA driver (table DS:4d9c, copied to the active table DS:4924 by 1ff8:21bc) plus the
// dissolve routine 1ff8:44b4 (slot 23 entry). Translated instruction by instruction onto src/engine/ega.js.
// Analysis: docs/re/graphics.md (EGA slots), docs/re/resources.md (bitmap records).
//
// Calling convention of the JS functions
// --------------------------------------
// Stack-argument slots take one JS parameter per pushed word, in [bp+6], [bp+8], ... order (C order).
// Register-argument slots take the registers as explicit parameters (listed below). Segments are segment
// numbers (0xa000, 0xa200, 0xa400, 0xa600 or a DOS block); video segments map to ega offsets
// (seg-0xa000)*16 + off, anything else is conventional memory. 32-bit DX:AX results come back as u32.
//
// slot  addr       JS signature                                    notes
//  0    29f6:13b5  f29f6_13b5(cx=0)                                egaInit; CX (left 0 by 1ff8:21bc) indexes the colour tables
//  1    29f6:16ec  f29f6_16ec(ax, dx, bp, es)                      egaDrawGlyph: AX=char, DX=x, BP=y, ES=page segment
//  2    29f6:19b1  f29f6_19b1(bx, cx, dx, si, es)                  egaLine: BX=x1, CX=y1, DX=x2, SI=y2 (x1<=x2 unsigned), ES=page
//  3    29f6:00a7  f29f6_00a7(spr, x, y)                           egaDrawSprite: spr = near ptr to {seg,planeOff,maskOff,w,h}
//  4    29f6:1be8  f29f6_1be8(x, y, w, h)                          egaCopyRect [3856] -> [3858] (latch copy)
//  5    29f6:1c4c  f29f6_1c4c(off, seg, x, y, w, h)                egaSaveRect [3856] -> buffer
//  6    29f6:1cda  f29f6_1cda(w, h) -> u32                         egaSaveRectSize
//  7    29f6:1d05  f29f6_1d05(off, seg, x, y, w, h)                egaRestoreRect buffer -> [3858]
//  8    29f6:1d9c  f29f6_1d9c(wait)                                egaFlip; wait != 0 is unsupported (only caller passes 0)
//  9,15,16,18,28-34  29f6:13b4  f29f6_13b4()                       RETF
// 10    29f6:1ece  f29f6_1ece(ax, bx, cx, dx, di, es)              egaHSpanSolid: AL=colour, BX=x, CX=width, DI=row offset; DX unused
// 11    29f6:1ddc  f29f6_1ddc(ax, bx, cx, dx, di, es)              egaHSpanDither: AX/DX dither words, BX=x, CX=width, DI=row offset
//                                                                  (10 and 11 share one signature: callers go through the far ptr DS:3870)
// 12    29f6:21ad  f29f6_21ad(fp, i, buf) -> i or 0                egaLoadFontData (fread 1000:c214, INT 21h 48h)
// 13    29f6:1f4c  f29f6_1f4c(list, pExtra) -> u32                 egaSpriteBytesNeeded
// 14    29f6:1f8d  f29f6_1f8d(list, off, seg, lenLo, lenHi)        egaConvertSprites via A600 scratch
// 17    29f6:23d8  f29f6_23d8(srcOff, srcSeg, x, y, w, h)          egaBlitPacked (opaque 4 bpp band)
// 19    29f6:225b  f29f6_225b(fp, p) -> p                          egaReadPalette (fread 1000:c214)
// 20    29f6:22c9  f29f6_22c9(p)                                   egaSetPalette (INT 10h AX=1000h)
// 21    29f6:2344  f29f6_2344(x, y) -> colour                      egaGetPixel from [3858]
// 22    29f6:238d  f29f6_238d(x, y, c)                             egaPutPixel to [3858]
// 23    1ff8:44b4  f1ff8_44b4(x, y, w, h, unit)                    dissolveRect [3856] -> [3854] (called directly, not via the table)
// 24    29f6:0002  f29f6_0002(a, b)                                egaSetHRetrace: retrace wait is unsupported (no caller found)
// 25    29f6:0044  f29f6_0044(c)                                   egaSetBorder (INT 10h AX=1001h)
// 26    29f6:0066  f29f6_0066(r, c)                                egaSetPaletteReg (direct ATC write)
// 27    29f6:141a  f29f6_141a(si)                                  egaFillSpans: SI = near ptr to {y, count, (x1,x2) x count}
// internal: f29f6_2034 packedToPlanar(srcOff,srcSeg,dstOff,dstSeg,groups), f29f6_2137 vramPlanesToMem(srcOff,srcSeg,dstOff,dstSeg,n),
//           f29f6_216a vramMaskToMem(srcOff,srcSeg,dstOff,dstSeg,n), f29f6_2327 pixelAddr(ax=y, bx=x) -> {ax,bx,cl},
//           sprite bodies f29f6_022c (shift 0) and f29f6_039e..f29f6_117c (shifts 1..7), reached through DS:2c1b.
import {B,rb,rw,wb,ww,salloc,sfree,frw,DGROUP} from '../engine/mem.js';
import {s8,s16,u16,mul16,DivideError} from '../engine/int.js';
import * as ega from '../engine/ega.js';
import {register,unsupported} from '../engine/host.js';
import {int10,int21,inp} from './bios.js';
import {F,provide} from './link.js';
import {cgaDissolveSetup,cgaDissolvePlot} from './cgadrv.js';

// ---- machine helpers ----
const lin=(s,o)=>((s&0xffff)<<4)+(o&0xffff);
// CPU byte read/write at s:o; A000-AFFF goes to the EGA (reads load the latches).
function mrd(s,o){const l=lin(s,o);return l>=0xa0000&&l<0xb0000?ega.rd(l-0xa0000):B[l];}
function mwr(s,o,v){const l=lin(s,o);if(l>=0xa0000&&l<0xb0000)ega.wr(l-0xa0000,v&0xff);else B[l]=v&0xff;}
// OUT DX,AX: index from AL, data from AH (ega.outw).
function outw(port,ax){ega.outw(port,ax&0xffff);}
function outb(port,al){ega.out(port,al&0xff);}
const gc8=m=>outw(0x3ce,(m&0xff)<<8|8);
const R=o=>Object.assign({ax:0,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:0},o);
const rowOff=y=>rw(u16(u16(y<<1)+0x3d3e)); // MOV reg,[2*y+3d3e]

// 29f6:0002 egaSetHRetrace(a,b): CRTC 05h = 15h-a, 06h = 6-b after the end of a vertical retrace.
export function f29f6_0002(a,b){
 const cl=(0x15-a)&0xff,ch=(6-b)&0xff;
 const port=frw(0x40,0x63);
 // The original busy-waits on IN CRTC+6 bit 3 (set, then clear) with interrupts off. It is not in
 // blocking.json and no caller was found (graphics.md), so the wait is not modelled.
 unsupported('29f6:0002 egaSetHRetrace retrace wait');
 outw(port,cl<<8|0x05);outw(port,ch<<8|0x06);
}

// 29f6:0044 egaSetBorder(c): overscan colour through INT 10h AX=1001h.
export function f29f6_0044(c){
 const bl=c&0xff;let bh=bl&0x0f;
 if(rb(0x385d)===2&&bh>=8)bh=bh+8&0xff;
 int10(R({ax:0x1001,bx:bh<<8|bl}));
}

// 29f6:0066 egaSetPaletteReg(r,c): direct attribute-controller write (c >= 8 becomes c+8).
export function f29f6_0066(r,c){
 let si=u16(c);if(si>=8)si=u16(si+8);
 const di=u16(r);
 const crtc=frw(0x40,0x63),st=crtc&0xff00|(crtc+6)&0xff;
 inp(st);                       // resets the ATC flip-flop
 const atc=st&0xff00|0xc0;
 outb(atc,di);outb(atc,si);     // index with bit 5 clear (display off), then the colour
 inp(st);
 outb(atc,0x20);                // re-enable the display
}

// ---- slot 3: masked sprite ----
// 29f6:00a7 egaDrawSprite(spr,x,y): setup, optional byte-granular clip, dispatch on x&7 through DS:2c1b.
export function f29f6_00a7(spr,x,y){
 spr=u16(spr);x=u16(x);y=u16(y);
 // REP MOVSW of the 5-word record to [bp-0a]..[bp-2]
 const rseg=rw(spr),rplane=rw(spr+2),rmask=rw(spr+4),w=rw(spr+6),h=rw(spr+8);
 const es=rw(0x3858);
 let di,si,dh,dl,cx,ax,dx,bx;
 if(rb(0x384b)===0){
  di=u16(rowOff(y)+(x>>>3));
  ww(0x2c12,x&7);
  cx=h;ax=w>>>3;dh=ax&0xff;dl=cx&0xff;
  ww(0x2c19,(ax&0xff)*(cx&0xff));                   // MUL CL (8-bit)
  ww(0x2c15,0);wb(0x2c14,0);
  ww(0x2c17,(0x28-dh)&0xff);
  si=rplane;
  return dispatchSprite(es,rseg,si,rmask,di,dl,dh);
 }
 // 29f6:011d clip path
 cx=h;ax=w>>>3;dx=ax;
 ww(0x2c19,(ax&0xff)*(cx&0xff));
 bx=y;si=0;ax=rw(0x3847);
 if(s16(bx)<s16(ax)){                                // top (signed)
  ax=u16(ax-bx);
  if(s16(cx)<=s16(ax))return;                        // SUB CX,AX; JNG
  cx=u16(cx-ax);
  si=(ax&0xff)*(dx&0xff);                            // MUL DL (8-bit)
  bx=rw(0x3847);
 }
 ax=u16(bx+cx);
 if(ax>rw(0x3849)){                                  // bottom (unsigned)
  const t=u16(rw(0x3849)-bx);
  if(s16(t)+1<=0)return;                             // INC CX; JNG
  cx=u16(t+1);
 }
 di=rowOff(bx);
 dx=u16(dx<<3);
 bx=x;ax=rw(0x3843)&0xfff8;
 if(s16(bx)<s16(ax)){                                // left, byte granular (signed)
  ax=u16(ax-bx);
  if(s16(dx)<=s16(ax))return;                        // SUB DX,AX; JNG
  dx=u16(dx-ax);
  bx=ax;ax=dx&7;ww(0x2c12,ax);
  ax=u16(ax+bx);si=u16(si+(ax>>>3));
  bx=rw(0x3843)&0xfff8;
  wb(0x2c14,1);
 }else{
  ax=bx&7;ww(0x2c12,ax);wb(0x2c14,0);                // MOV [2c14],AH (0)
 }
 di=u16(di+(bx>>>3));
 ax=u16(rw(0x3845)+1)&0xfff8;ww(0x2c10,ax);
 ax=u16(bx+dx);
 if(!(ax<rw(0x2c10))){                               // right (unsigned)
  const r=rw(0x2c10);
  if(s16(r)<=s16(bx))return;                         // SUB DX,BX; JNG
  dx=u16(r-bx);
  wb(0x2c14,rb(0x2c14)|2);
 }
 dx>>>=3;dh=dx&0xff;
 if(rb(0x2c14)===3&&(x&7)!==0)dh=dh-1&0xff;
 dl=cx&0xff;
 ax=w>>>3;ax=ax&0xff00|(ax-dh)&0xff;ww(0x2c15,ax);
 ww(0x2c17,(0x28-dh)&0xff);
 const bp=u16(si+rmask);si=u16(si+rplane);
 return dispatchSprite(es,rseg,si,bp,di,dl,dh);
}
// 29f6:021d JMP [SS:2c1b + 2*[2c12]]
function dispatchSprite(es,ds,si,bp,di,dl,dh){
 const target=rw(0x2c1b+(rw(0x2c12)<<1&0xffff));
 const body=spriteBodies[target];
 if(!body)return unsupported(`29f6:022a sprite jump to 29f6:${target.toString(16)}`);
 return body(es,ds,si,bp,di,dl,dh);   // every body ends at the epilogue 29f6:13ab
}
// Sprite body register state on entry: ES=page, DS=sprite segment, SI=plane data, BP=mask data,
// DI=screen offset, DL=rows, DH=byte columns. Flags F = [2c14] (1 left-clipped, 2 right-clipped).
// 29f6:022c spriteShift0: byte-aligned body.
export function f29f6_022c(es,ds,si,bp,di,dl,dh){
 let cl=dl,ch;const bh=dh,di0=di;
 // phase 1: clear opaque pixels (write mode 2, colour 0, GC8 = ~mask)
 for(;;){
  ch=bh;
  do{
   const m=mrd(ds,bp);bp=u16(bp+1);
   gc8(m^0xff);mrd(es,di);mwr(es,di,0);di=u16(di+1);
   ch=ch-1&0xff;
  }while(ch);
  cl=cl-1&0xff;if(!cl)break;
  bp=u16(bp+rw(0x2c15));di=u16(di+rw(0x2c17));
 }
 outw(0x3ce,0x0005);outw(0x3ce,0xff08);
 di=di0;
 // phase 2: OR the plane data in, write mode 0, one plane at a time
 for(let p=0;p<4;p++){
  const en=rb(0x384f)&1<<p;
  if(en){
   outw(0x3c4,en<<8|2);outw(0x3ce,p<<8|4);
   const si0=si,d0=di;
   cl=dl;
   for(;;){
    ch=dh;
    do{const v=mrd(ds,si);si=u16(si+1);mwr(es,di,mrd(es,di)|v);di=u16(di+1);ch=ch-1&0xff;}while(ch);
    cl=cl-1&0xff;if(!cl)break;
    si=u16(si+rw(0x2c15));di=u16(di+rw(0x2c17));
   }
   if(p===3)break;           // plane 3 does not restore SI/DI and goes straight to the exit
   si=si0;di=d0;
  }
  if(p===3)break;
  si=u16(si+rw(0x2c19));
 }
 outw(0x3c4,0x0f02);outw(0x3ce,0x0205);
}
// Shifts 1-4 compute SHR AX,s and take AL; shifts 5-7 compute SHL AX,(8-s) and take AH. The seven bodies
// are otherwise instruction-identical (checked by diffing the listings), so they share this translation.
function shifted(s,hi,lo){
 const v=(hi&0xff)<<8|lo&0xff;
 return s<=4?(v>>>s)&0xff:((v<<(8-s))&0xffff)>>>8;
}
function spriteShifted(s,es,ds,si,bp,di,dl,dh){
 let cl=dl,ch,bl,al,ah;const bh=dh,di0=di;
 // phase 1
 for(;;){
  ch=bh;bl=0xff;
  if(rb(0x2c14)&1)bl=mrd(ds,u16(bp-1));
  for(;;){
   const old=ch;ch=ch-1&0xff;if(s8(old)-1<0)break;    // DEC CH; JL
   al=mrd(ds,bp);bp=u16(bp+1);ah=bl;bl=al;
   gc8(shifted(s,ah,al)^0xff);mrd(es,di);mwr(es,di,0);di=u16(di+1);
  }
  ah=bl;bl=0xff;
  if(rb(0x2c14)&2)bl=mrd(ds,bp);
  al=bl;
  gc8(shifted(s,ah,al)^0xff);mrd(es,di);mwr(es,di,0);
  cl=cl-1&0xff;if(!cl)break;
  bp=u16(bp+rw(0x2c15));di=u16(di+rw(0x2c17));
 }
 outw(0x3ce,0x0005);outw(0x3ce,0xff08);
 di=di0;
 const f=rb(0x2c14);
 // phase 2
 for(let p=0;p<4;p++){
  const en=rb(0x384f)&1<<p;
  if(en){
   outw(0x3c4,en<<8|2);outw(0x3ce,p<<8|4);
   const si0=si,d0=di;
   cl=dl;
   for(;;){
    ch=dh;bl=0;
    if(f&1)bl=mrd(ds,u16(si-1));
    for(;;){
     const old=ch;ch=ch-1&0xff;if(s8(old)-1<0)break;
     al=mrd(ds,si);si=u16(si+1);ah=bl;bl=al;
     mwr(es,di,mrd(es,di)|shifted(s,ah,al));di=u16(di+1);
    }
    ah=bl;al=0;
    if(f&2)al=mrd(ds,si);
    mwr(es,di,mrd(es,di)|shifted(s,ah,al));
    cl=cl-1&0xff;if(!cl)break;
    si=u16(si+rw(0x2c15));di=u16(di+rw(0x2c17));
   }
   if(p===3)break;
   si=si0;di=d0;
  }
  if(p===3)break;
  si=u16(si+rw(0x2c19));
 }
 outw(0x3c4,0x0f02);outw(0x3ce,0x0205);
}
// 29f6:039e .. 29f6:117c spriteShift1..7
export function f29f6_039e(...a){return spriteShifted(1,...a);}
export function f29f6_05d1(...a){return spriteShifted(2,...a);}
export function f29f6_0818(...a){return spriteShifted(3,...a);}
export function f29f6_0a73(...a){return spriteShifted(4,...a);}
export function f29f6_0ce2(...a){return spriteShifted(5,...a);}
export function f29f6_0f39(...a){return spriteShifted(6,...a);}
export function f29f6_117c(...a){return spriteShifted(7,...a);}
const spriteBodies={0x022c:f29f6_022c,0x039e:f29f6_039e,0x05d1:f29f6_05d1,0x0818:f29f6_0818,0x0a73:f29f6_0a73,0x0ce2:f29f6_0ce2,0x0f39:f29f6_0f39,0x117c:f29f6_117c};

// 29f6:13b4: lone RETF (slots 9, 15, 16, 18, 28-34).
export function f29f6_13b4(){}

// 29f6:13b5 egaInit(cx): mode 0Dh, page segments, colour tables, row table, SEQ2=F, GC5=2.
export function f29f6_13b5(cx=0){
 wb(0x3861,0x10);
 ww(0x3854,0xa000);ww(0x3852,0xa200);ww(0x3850,0xa400);
 int10(R({ax:0x000d,cx}));
 let ax=0,si=u16(cx);
 for(let n=0x10;n;n--){
  ww(si+0x41a4,ax);ww(si+0x41c4,ax);ww(si+0x4424,ax);ww(si+0x4444,ax);ww(si+0x46a4,ax);
  ax=u16(ax+0x101);si=u16(si+2);
 }
 for(let n=0xc8,di=0x3d3e,v=0;n;n--){ww(di,v);di=u16(di+2);v=u16(v+0x28);}
 outw(0x3c4,0x0f02);outw(0x3ce,0x0205);
}

// ---- slot 27: span list fill ----
// 29f6:141a egaFillSpans(si): rows y..y+count-1, colour [384d]; solid or 2x2 dither.
export function f29f6_141a(si){
 si=u16(si);
 outw(0x3ce,0x0205);outw(0x3ce,0xff08);
 const es=rw(0x3858);
 let bp=u16(rw(si)<<1);si=u16(si+2);
 ww(0x4e3a,rw(si));si=u16(si+2);
 const bx=rb(0x384d)<<1;
 const a=rw(bx+0x41a4);ww(0x3864,a);
 const b=rw(bx+0x4424);
 if(b!==a)return f29f6_14e8(b,si,bp,es);
 for(;;){
  let x1=rw(si),x2=rw(si+2);si=u16(si+4);
  if(s16(x2)>=s16(x1)){                              // SUB AX,BX; JNL
   let cx=u16(u16(x2-x1)+1);
   let di=rw(u16(bp+0x3d3e));
   const al=rw(0x3864)&0xff;
   di=u16(di+(x1>>>3));let bxx=x1&7;
   const dx=u16(bxx+cx);
   if(s16(dx)<8){                                    // 29f6:14c0 single byte
    const m=rb(0x4e28+bxx)&rb(0x4e30+(dx&0xff));
    gc8(m);mrd(es,di);mwr(es,di,al);
   }else{
    cx=u16(cx-(8-bxx));
    gc8(rb(0x4e28+bxx));mrd(es,di);mwr(es,di,al);di=u16(di+1);
    const bh=cx&0xff;
    cx>>>=3;
    if(cx){outb(0x3cf,0xff);for(;cx;cx--){mwr(es,di,al);di=u16(di+1);}}
    bxx=bh&7;
    if(bxx){outb(0x3cf,rb(0x4e30+bxx));mrd(es,di);mwr(es,di,al);}
   }
  }
  const n=rw(0x4e3a);ww(0x4e3a,u16(n-1));
  if(s16(n)-1<=0)return;                             // SUB [4e3a],1; JNG
  bp=u16(bp+2);
 }
}
// One dithered row of slot 27 (29f6:14f7 even-row block, 29f6:15f0 odd-row block; identical code).
function ditherRow(word,si,bp,es){
 const x1=rw(si),x2=rw(si+2);
 if(!(s16(x2)>=s16(x1)))return;
 let cx=u16(u16(x2-x1)+1);
 let di=rw(u16(bp+0x3d3e));
 wb(0x4e38,word>>8);wb(0x4e39,word&0xff);
 di=u16(di+(x1>>>3));let bx=x1&7;
 const dx=u16(bx+cx);
 if(s16(dx)<8){
  const m=rb(0x4e28+bx)&rb(0x4e30+(dx&0xff));
  gc8(m&0xaa);mrd(es,di);mwr(es,di,rb(0x4e38));
  gc8(m&0x55);mrd(es,di);mwr(es,di,rb(0x4e39));
  return;
 }
 cx=u16(cx-(8-bx));
 const ah=rb(0x4e28+bx),di0=di;
 // pass 1: even pixels (mask AA), latch loaded once from the left byte
 let c=rb(0x4e38);
 gc8(ah&0xaa);mrd(es,di);mwr(es,di,c);di=u16(di+1);
 let n=cx>>>3;
 if(n){outw(0x3ce,0xaa08);for(;n;n--){mwr(es,di,c);di=u16(di+1);}}
 bx=cx&7;
 if(bx){gc8(rb(0x4e30+bx)&0xaa);mrd(es,di);mwr(es,di,c);}
 // pass 2: odd pixels (mask 55), latch reloaded from the first middle byte
 di=di0;c=rb(0x4e39);
 gc8(ah&0x55);mrd(es,di);mwr(es,di,c);di=u16(di+1);
 n=cx>>>3;
 if(n){outw(0x3ce,0x5508);mrd(es,di);for(;n;n--){mwr(es,di,c);di=u16(di+1);}}
 bx=cx&7;
 if(bx){gc8(rb(0x4e30+bx)&0x55);mrd(es,di);mwr(es,di,c);}
}
// 29f6:14e8 fillSpansDither (AX = 4424 word on entry): even rows use [3864], odd rows [3866].
export function f29f6_14e8(ax,si,bp,es){
 ww(0x3866,ax);
 let odd=(bp>>>1)&1;
 for(;;){
  ditherRow(rw(odd?0x3866:0x3864),si,bp,es);si=u16(si+4);
  const n=rw(0x4e3a);ww(0x4e3a,u16(n-1));
  if(s16(n)-1<=0)return;
  bp=u16(bp+2);odd^=1;
 }
}

// ---- slot 1: glyph ----
// 29f6:16ec egaDrawGlyph(ax=char, dx=x, bp=y, es=page) with the current font (slot 0 of the font arrays).
export function f29f6_16ec(ax,dx,bp,es){
 ax=u16(ax);dx=u16(dx);bp=u16(bp);
 const chr=ax&0xff,fs=rw(0x38c4),fg=rb(0x3868),bg=rb(0x3869),transparent=rb(0x3842);
 let si,di,ch,cl;
 if((dx&7)===0&&(rb(0x3874)&7)===0){
  // aligned path
  const bpr=rb(0x3874)>>>3;cl=bpr;ch=rb(0x3888);
  const bx=ch*bpr;                                   // MUL BL: 16-bit h*bpr
  if(s8(chr)<s8(rb(0x389c)))return;                  // SUB AL,[389c]; JL
  const idx=chr-rb(0x389c)&0xff;
  if(!(idx<rb(0x38b0)))return;                       // CMP AL,[38b0]; JC
  si=idx*(bx&0xff);                                  // MUL BL: low byte of h*bpr only
  di=u16(rowOff(bp)+(dx>>>3));
  const n=bpr&0xff;
  do{
   let c=n;
   do{
    const g=mrd(fs,si);si=u16(si+1);
    if(transparent){gc8(g);mrd(es,di);mwr(es,di,fg);}
    else{gc8(g);mrd(es,di);mwr(es,di,fg);gc8(g^0xff);mrd(es,di);mwr(es,di,bg);}
    di=u16(di+1);c=c-1&0xff;
   }while(c);
   di=u16(di-n+0x28);ch=ch-1&0xff;
  }while(ch);
  return;
 }
 // 29f6:17b3 unaligned path
 cl=dx&7;
 bp=u16(rowOff(bp)+(dx>>>3));
 const w=rb(0x3874);
 let bpr=w>>>3;if(w&7)bpr++;
 const edge=rb(0x5010+(w&7));wb(0x5018,edge);
 ch=rb(0x3888);
 const bx=ch*(bpr&0xff);
 if(s8(chr)<s8(rb(0x389c)))return;
 const idx=chr-rb(0x389c)&0xff;
 if(!(s8(idx)<s8(rb(0x38b0))))return;               // CMP AL,[38b0]; JL (signed here)
 si=idx*(bx&0xff);
 di=bp;
 if(cl!==0){
  const nb=bpr+1;                                    // screen bytes per row
  if(transparent){
   // 29f6:18cd
   do{
    let bl=0,bh=nb&0xff;
    for(;;){
     bh=bh-1&0xff;if(!bh)break;
     const g=mrd(fs,si);si=u16(si+1);
     gc8(shifted4(cl,bl,g));bl=g;mrd(es,di);mwr(es,di,fg);di=u16(di+1);
    }
    gc8(shifted4(cl,bl,0));mrd(es,di);mwr(es,di,fg);di=u16(di+1);
    di=u16(di-nb+0x28);ch=ch-1&0xff;
   }while(ch);
   return;
  }
  // 29f6:1818 opaque: DL = bpr after DEC DL
  const n=nb-1&0xff;
  for(;;){
   let bl=0,bh=0,d=n;
   for(;;){
    d=d-1&0xff;if(!d)break;
    const g=mrd(fs,si);si=u16(si+1);
    gc8(shifted4(cl,bl,g));bl=g;mrd(es,di);mwr(es,di,fg);
    const ng=g^0xff;gc8(shifted4(cl,bh,ng));bh=ng;mrd(es,di);mwr(es,di,bg);di=u16(di+1);
   }
   // last glyph byte: background limited by the right-edge mask [5018]
   const g=mrd(fs,si);si=u16(si+1);
   gc8(shifted4(cl,bl,g));bl=g;mrd(es,di);mwr(es,di,fg);
   const ng=(g^0xff)&rb(0x5018);gc8(shifted4(cl,bh,ng));bh=ng;mrd(es,di);mwr(es,di,bg);di=u16(di+1);
   // spill byte
   gc8(shifted4(cl,bl,0));mrd(es,di);mwr(es,di,fg);
   gc8(shifted4(cl,bh,0));mrd(es,di);mwr(es,di,bg);
   di=u16(di-n+0x28);
   ch=ch-1&0xff;if(!ch)return;
  }
 }
 // 29f6:1916 x byte-aligned, width not a multiple of 8
 const n=bpr&0xff;
 if(!transparent){
  do{
   let b=n;
   for(;;){
    b=b-1&0xff;if(!b)break;
    const g=mrd(fs,si);si=u16(si+1);
    gc8(g);mrd(es,di);mwr(es,di,fg);gc8(g^0xff);mrd(es,di);mwr(es,di,bg);di=u16(di+1);
   }
   const g=mrd(fs,si);si=u16(si+1);
   gc8(g);mrd(es,di);mwr(es,di,fg);
   gc8((g^0xff)&rb(0x5018));mrd(es,di);mwr(es,di,bg);di=u16(di+1);
   di=u16(di-n+0x28);ch=ch-1&0xff;
  }while(ch);
  return;
 }
 // 29f6:197d
 do{
  let b=n;
  do{const g=mrd(fs,si);si=u16(si+1);gc8(g);mrd(es,di);mwr(es,di,fg);di=u16(di+1);b=b-1&0xff;}while(b);
  di=u16(di-n+0x28);ch=ch-1&0xff;
 }while(ch);
}
// SHR AX,CL with AH=hi, AL=lo, result AL.
const shifted4=(cl,hi,lo)=>(((hi&0xff)<<8|lo&0xff)>>>cl)&0xff;

// ---- slot 2: line ----
// 29f6:19b1 egaLine(bx=x1, cx=y1, dx=x2, si=y2, es=page): unclipped, x1 <= x2, colour low byte of 41a4[[384e]].
export function f29f6_19b1(bx,cx,dx,si,es){
 bx=u16(bx);cx=u16(cx);dx=u16(dx);si=u16(si);
 const col=rw(0x41a4+(rb(0x384e)<<1));ww(0x3862,col);
 let ah=rb(0x501a+(bx&7));wb(0x5022,ah);
 let di=u16(rowOff(cx)+(bx>>>3));
 const c=col&0xff;
 const plot=()=>{mrd(es,di);gc8(ah);mwr(es,di,c);};  // latch read, GC8 = bit, write colour
 const replot=()=>{mrd(es,di);mwr(es,di,c);};         // same bit mask as before (no OUT)
 const ror=()=>{const cf=ah&1;ah=(ah>>>1|ah<<7)&0xff;return cf;};
 if(bx===dx){
  if(cx===si){plot();return;}                       // single pixel
  // 29f6:1a3f vertical
  let bp=0x28,d=u16(si-cx);
  if(!(s16(si)>s16(cx))){d=u16(-d);bp=-0x28;}         // SUB SI,CX; JG
  let n=d;gc8(ah);
  do{replot();di=u16(di+bp);n=u16(n-1);}while(!(n&0x8000)); // DEC CX; JS
  return;
 }
 if(cx===si){
  // 29f6:1a07 horizontal
  let n=u16(dx-bx);
  plot();
  do{if(ror())di=u16(di+1);plot();n=u16(n-1);}while(n);
  return;
 }
 // 29f6:1a6c
 let bp=0x28;
 const ddx=u16(dx-bx);
 let dy=u16(si-cx);
 if(!(s16(si)>s16(cx))){dy=u16(-dy);bp=-0x28;}
 if(dy===ddx){
  // 29f6:1a89 diagonal staircase
  let n=ddx;
  plot();
  for(;;){
   if(!ror()){
    plot();di=u16(di+bp);replot();
    n=u16(n-1);if(!n)return;
   }else{
    di=u16(di+1);plot();
    n=u16(n-1);if(!n)return;   // QUIRK: a final step that crosses a byte skips its y step (graphics.md, 29f6:1ab7)
    di=u16(di+bp);replot();
   }
  }
 }
 if(dy<ddx){
  // 29f6:1acf x-major
  let rem=ddx;const dv=dy+1;
  const q=Math.floor(ddx/dv),r=ddx%dv,f=Math.floor(r*0x10000/dv);
  ww(0x5023,q);ww(0x5025,f);ww(0x5029,0);
  let n=u16(q+1);
  plot();
  for(;;){
   ww(0x5027,rem);
   if(s16(rem)<s16(n)){n=rem;rem=0;}else rem=u16(rem-n);  // SUB SI,CX; JNL
   do{if(ror())di=u16(di+1);plot();n=u16(n-1);}while(n);
   if(rem===0)return;
   di=u16(di+bp);replot();
   const acc=rw(0x5029)+f;ww(0x5029,acc);
   n=acc>0xffff?u16(q+1):q;
  }
 }
 // 29f6:1b52 y-major
 let rem=dy;const dv=ddx+1;
 const q=Math.floor(dy/dv),r=dy%dv,f=Math.floor(r*0x10000/dv);
 ww(0x5023,q);ww(0x5025,f);ww(0x5029,0);
 let n=u16(q+1);
 plot();
 for(;;){
  ww(0x5027,rem);
  if(s16(rem)<s16(n)){n=rem;rem=0;}else rem=u16(rem-n);
  do{di=u16(di+bp);plot();n=u16(n-1);}while(n);
  if(rem===0)return;
  if(ror())di=u16(di+1);
  plot();
  const acc=rw(0x5029)+f;ww(0x5029,acc);
  n=acc>0xffff?u16(q+1):q;
 }
}

// ---- slots 4-8 ----
// 29f6:1be8 egaCopyRect(x,y,w,h): write mode 1 latch copy [3856] -> [3858], byte columns, h=0 means 65536 rows.
export function f29f6_1be8(x,y,w,h){
 x=u16(x);y=u16(y);w=u16(w);h=u16(h);
 outw(0x3ce,0x0105);
 let ax=x;
 let bx=u16(u16(w+ax)+7)&0xfff8;
 ax&=0xfff8;bx=u16(bx-ax)>>>3;ax>>>=3;
 let dx=h,di=u16(rowOff(y)+ax);
 const es=rw(0x3858),ds=rw(0x3856);
 do{
  const bp=di;let si=di;
  for(let cx=bx;cx;cx--){mwr(es,di,mrd(ds,si));si=u16(si+1);di=u16(di+1);}
  di=u16(bp+0x28);dx=u16(dx-1);
 }while(dx);
 outw(0x3ce,0x0205);
}
// Shared byte-count computation of slots 5 and 7: words per row.
function rectWords(x,w){
 const cx=x>>>3;let bx=u16(w+x)>>>3;bx=u16(bx-cx+1);
 const odd=bx&1;bx>>>=1;if(odd)bx++;
 return {cx,bx};
}
// 29f6:1c4c egaSaveRect(off,seg,x,y,w,h): [3856] planes 3,2,1,0 -> buffer, rows of 2*words bytes.
export function f29f6_1c4c(off,seg,x,y,w,h){
 off=u16(off);seg=u16(seg);x=u16(x);y=u16(y);w=u16(w);h=u16(h);
 outw(0x3ce,0x0005);outw(0x3ce,0xff08);outw(0x3ce,0x0000);
 let di=off&0xf;const es=u16((off>>>4)+seg);
 const {cx,bx}=rectWords(x,w);
 let dx=h,si=u16(rowOff(y)+cx);
 const ds=rw(0x3856);
 let ax=0x0304;
 for(;;){
  outw(0x3ce,ax);
  const si0=si,dx0=dx;
  do{
   const bp=si;
   for(let n=bx;n;n--){mwr(es,di,mrd(ds,si));mwr(es,u16(di+1),mrd(ds,u16(si+1)));si=u16(si+2);di=u16(di+2);}
   si=u16(bp+0x28);dx=u16(dx-1);
  }while(dx);
  si=si0;dx=dx0;
  const ah=ax>>8;ax=((ah-1)&0xff)<<8|ax&0xff;
  if(s8(ah)-1<0)break;                               // DEC AH; JNL
 }
 outw(0x3ce,0x0205);
}
// 29f6:1cda egaSaveRectSize(w,h) -> DX:AX = h*b*4, b = even upper bound of the bytes per row.
export function f29f6_1cda(w,h){
 w=u16(w);h=u16(h);
 let bx=(w>>>3)+1;if(w&7)bx++;if(bx&1)bx++;
 return (mul16(h,bx)<<2)>>>0;
}
// 29f6:1d05 egaRestoreRect(off,seg,x,y,w,h): buffer -> [3858], SEQ2 = 8,4,2,1.
export function f29f6_1d05(off,seg,x,y,w,h){
 off=u16(off);seg=u16(seg);x=u16(x);y=u16(y);w=u16(w);h=u16(h);
 outw(0x3ce,0x0005);outw(0x3ce,0xff08);outw(0x3ce,0x0000);
 let si=off&0xf;const ds=u16((off>>>4)+seg);
 const {cx,bx}=rectWords(x,w);
 let dx=h,di=u16(rowOff(y)+cx);
 const es=rw(0x3858);
 let ah=8;
 for(;;){
  outw(0x3c4,ah<<8|2);
  const di0=di,dx0=dx;
  do{
   const bp=di;
   for(let n=bx;n;n--){mwr(es,di,mrd(ds,si));mwr(es,u16(di+1),mrd(ds,u16(si+1)));si=u16(si+2);di=u16(di+2);}
   di=u16(bp+0x28);dx=u16(dx-1);
  }while(dx);
  di=di0;dx=dx0;
  const cf=ah&1;ah>>>=1;if(cf)break;                // SHR AH,1; JNC
 }
 outw(0x3ce,0x0205);outw(0x3c4,0x0f02);
}
// 29f6:1d9c egaFlip(wait): swap [3852]/[3854], CRTC 0Ch = new displayed segment >> 4 (low byte).
export function f29f6_1d9c(wait){
 const ax=rw(0x3852),cx=ax;
 const old=rw(0x3854);ww(0x3854,ax);ww(0x3852,old);
 const port=frw(0x40,0x63);
 outw(port,((cx>>>4)&0xff)<<8|0x0c);
 // The only caller (1000:05bf) passes 0. A non-zero argument would spin on 3DAh bit 3 (clear, then set),
 // which needs a generator; slot 8 is not in blocking.json.
 if(u16(wait))unsupported('29f6:1d9c egaFlip retrace wait (wait != 0)');
}

// ---- slots 10 / 11: horizontal spans (register arguments) ----
// 29f6:1ddc egaHSpanDither(ax,bx=x,cx=width,dx,di=row offset,es): AH -> even x, AL -> odd x.
export function f29f6_1ddc(ax,bx,cx,dx,di,es){
 ax=u16(ax);bx=u16(bx);cx=u16(cx);dx=u16(dx);di=u16(di);
 const ph=rw(0x386a)^1;ww(0x386a,ph);
 if(ph!==0)ax=dx;
 if(!(s16(cx)>0))return;
 wb(0x503c,ax>>8);wb(0x503d,ax&0xff);
 di=u16(di+(bx>>>3));bx&=7;
 const d=u16(bx+cx);
 if(s16(d)<8){
  const m=rb(0x502c+bx)&rb(0x5034+(d&0xff));
  gc8(m&0xaa);mrd(es,di);mwr(es,di,rb(0x503c));
  gc8(m&0x55);mrd(es,di);mwr(es,di,rb(0x503d));
  return;
 }
 cx=u16(cx-(8-bx));
 const ah=rb(0x502c+bx),di0=di;
 let c=rb(0x503c);
 gc8(ah&0xaa);mrd(es,di);mwr(es,di,c);di=u16(di+1);
 let n=cx&0xfff8;
 if(n){n>>>=3;outw(0x3ce,0xaa08);for(;n;n--){mwr(es,di,c);di=u16(di+1);}}
 let r=cx&7;
 if(r){gc8(rb(0x5034+r)&0xaa);mrd(es,di);mwr(es,di,c);}
 di=di0;c=rb(0x503d);
 gc8(ah&0x55);mrd(es,di);mwr(es,di,c);di=u16(di+1);
 n=cx&0xfff8;
 if(n){n>>>=3;outw(0x3ce,0x5508);mrd(es,di);for(;n;n--){mwr(es,di,c);di=u16(di+1);}}
 r=cx&7;
 if(r){gc8(rb(0x5034+r)&0x55);mrd(es,di);mwr(es,di,c);}
}
// 29f6:1ece egaHSpanSolid(ax,bx=x,cx=width,dx,di=row offset,es): colour AL.
export function f29f6_1ece(ax,bx,cx,dx,di,es){
 ax=u16(ax);bx=u16(bx);cx=u16(cx);di=u16(di);
 if(!(s16(cx)>0))return;
 const al=ax&0xff;
 di=u16(di+(bx>>>3));bx&=7;
 const d=u16(bx+cx);
 if(s16(d)<8){
  gc8(rb(0x502c+bx)&rb(0x5034+(d&0xff)));mrd(es,di);mwr(es,di,al);
  return;
 }
 cx=u16(cx-(8-bx));
 gc8(rb(0x502c+bx));mrd(es,di);mwr(es,di,al);di=u16(di+1);
 let n=cx&0xfff8;
 if(n){n>>>=3;outw(0x3ce,0xff08);for(;n;n--){mwr(es,di,al);di=u16(di+1);}}
 const r=cx&7;
 if(r){gc8(rb(0x5034+r));mrd(es,di);mwr(es,di,al);}
}

// ---- slots 13 / 14: sprite conversion ----
// 29f6:1f4c egaSpriteBytesNeeded(list,pExtra) -> sum + sum/4, sum = sum of low words of (w>>1)*h.
export function f29f6_1f4c(list,pExtra){
 let di=u16(list),sum=0;
 for(;;){
  const si=rw(di);if(!si)break;
  // QUIRK: MUL DX leaves DX:AX but only AX is added (ADD BX,AX; ADC CX,0)
  sum=sum+(mul16(rw(si+6)>>>1,rw(si+8))&0xffff)>>>0;
  di=u16(di+2);
 }
 ww(u16(pExtra),0);
 return sum+(sum>>>2)>>>0;
}
// 29f6:1f8d egaConvertSprites(list,off,seg,lenLo,lenHi): packed data -> A600 planes -> per-sprite planes + mask.
export function f29f6_1f8d(list,off,seg,lenLo,lenHi){
 list=u16(list);off=u16(off);seg=u16(seg);
 const len=(u16(lenHi)<<16|u16(lenLo))>>>0;
 f29f6_2034(off,seg,0,0xa600,(len>>>2)&0xffff);
 let di=0,bx=list;
 for(;;){
  const si=rw(bx);if(!si)break;
  const n=(mul16(rw(si+6)>>>1,rw(si+8))&0xffff)>>>2;
  const planeOff=off;
  ww(si,seg);ww(si+2,planeOff);
  off=u16(u16(n<<2)+planeOff);ww(si+4,off);
  f29f6_2137(di,0xa600,planeOff,seg,n);
  f29f6_216a(di,0xa600,off,seg,n);
  di=u16(di+n);
  const ax=u16(n+off);
  seg=u16(seg+(ax>>>4));off=ax&0xf;
  bx=u16(bx+2);
 }
}
// Shift ladder used by 2034 and slot 17: byte bits 7..0 go to CH,CL,BH,BL,CH,CL,BH,BL (planes 3,2,1,0).
function ladder(p,b){
 for(let k=0;k<2;k++)for(let q=3;q>=0;q--){p[q]=(p[q]<<1|b>>7&1)&0xff;b=b<<1&0xff;}
}
// 29f6:2034 packedToPlanar(srcOff,srcSeg,dstOff,dstSeg,groups): 4 packed bytes -> 1 byte per plane (write mode 0).
export function f29f6_2034(srcOff,srcSeg,dstOff,dstSeg,groups){
 outw(0x3ce,0x0205);outw(0x3ce,0xff08);outw(0x3ce,0x0005);
 let di=u16(dstOff),si=u16(srcOff),ds=u16(srcSeg),bp=u16(groups);
 const es=u16(dstSeg),p=[0,0,0,0];  // p[0]=BL, p[1]=BH, p[2]=CL, p[3]=CH
 outw(0x3c4,0x0102);
 do{
  ladder(p,mrd(ds,si));ladder(p,mrd(ds,u16(si+1)));si=u16(si+2);
  const lo=mrd(ds,si),hi=mrd(ds,u16(si+1));
  const carry=si+2>0xffff;si=u16(si+2);
  ladder(p,lo);ladder(p,hi);
  if(carry)ds=u16(ds+0x1000);                         // segment advances when the second word wraps SI
  outb(0x3c5,1);mwr(es,di,p[0]);outb(0x3c5,2);mwr(es,di,p[1]);
  outb(0x3c5,4);mwr(es,di,p[2]);outb(0x3c5,8);mwr(es,di,p[3]);
  di=u16(di+1);bp=u16(bp-1);
 }while(bp);
 outw(0x3ce,0x0205);outw(0x3c4,0x0f02);
}
// 29f6:2137 vramPlanesToMem(srcOff,srcSeg,dstOff,dstSeg,n): planes 0..3 (GC4), n bytes each, appended.
export function f29f6_2137(srcOff,srcSeg,dstOff,dstSeg,n){
 let di=u16(dstOff);const es=u16(dstSeg),si0=u16(srcOff),ds=u16(srcSeg),bx=u16(n);
 let ax=0x0004;
 for(let bp=4;bp;bp--){
  outw(0x3ce,ax);
  let si=si0;
  for(let cx=bx;cx;cx--){mwr(es,di,mrd(ds,si));si=u16(si+1);di=u16(di+1);}
  ax=u16(ax+0x100);
 }
}
// 29f6:216a vramMaskToMem(srcOff,srcSeg,dstOff,dstSeg,n): ~(p0|p1|p2|p3) per byte, 1 = transparent.
export function f29f6_216a(srcOff,srcSeg,dstOff,dstSeg,n){
 let di=u16(dstOff),si=u16(srcOff),bp=u16(n);const es=u16(dstSeg),ds=u16(srcSeg);
 outw(0x3ce,0x0004);
 do{
  outb(0x3cf,0);let ah=mrd(ds,si);
  outb(0x3cf,1);ah|=mrd(ds,si);
  outb(0x3cf,2);ah|=mrd(ds,si);
  outb(0x3cf,3);ah|=mrd(ds,si);
  mwr(es,di,~ah&0xff);di=u16(di+1);si=u16(si+1);bp=u16(bp-1);
 }while(bp);
}

// ---- slots 12, 19, 20 ----
// 29f6:21ad egaLoadFontData(fp,i,buf): DOS block for font i, filled with fread in 80-byte pieces.
export function f29f6_21ad(fp,i,buf){
 const si=u16(i);buf=u16(buf);
 const w=rb(si+0x3874);
 let dl=w>>>3;if(w&7)dl=dl+1&0xff;
 let ax=rb(si+0x3888)*dl;                           // MUL DL (8-bit operands)
 ax=(ax&0xff)*rb(si+0x38b0);                        // MUL DL on the low byte of the first product
 ww(0x5040,ax);
 let dx=ax>>>4;if(ax&0xf)dx++;
 const r=R({ax:0x4800|ax&0xff,bx:dx});int21(r);
 if(r.cf)return 0;
 const seg=r.ax&0xffff;
 ww(u16((si<<1)+0x38c4),seg);ww(0x503e,seg);
 let di=0;
 ax=rw(0x5040);
 const q=Math.floor(ax/0x50);if(q>0xff)throw new DivideError('Divide overflow'); // DIV BL
 ww(0x5040,(ax%0x50)<<8|q);
 // QUIRK: the block counter is a byte decremented before the test, so q = 0 reads 256 blocks (graphics.md)
 for(;;){
  F.f1000_c214(buf,0x50,1,fp);
  const es=rw(0x503e);
  for(let k=0;k<0x50;k++){mwr(es,di,rb(buf+k));di=u16(di+1);}
  const c=rb(0x5040)-1&0xff;wb(0x5040,c);if(!c)break;
 }
 const rem=rb(0x5041);
 F.f1000_c214(buf,rem,1,fp);
 const es=rw(0x503e);
 for(let k=0;k<rem;k++){mwr(es,di,rb(buf+k));di=u16(di+1);}
 return si;
}
// 29f6:225b egaReadPalette(fp,p): 128-byte PAL chunk -> 41a4[p] and 4424[p] (high nibble of byte 1, low nibble of byte 0).
export function f29f6_225b(fp,p){
 p=u16(p);
 const buf=salloc(0x80);
 try{
  F.f1000_c214(buf,1,0x80,fp);
  let si=buf;const base=u16(p<<6);
  for(const tab of [0x41a4,0x4424]){
   let di=u16(base+tab);
   for(let n=0x20;n;n--){const v=rw(si);si=u16(si+2);ww(di,(v>>>12)<<8|v&0x0f);di=u16(di+2);}
  }
  return p;
 }finally{sfree(0x80);}
}
// 29f6:22c9 egaSetPalette(p): activate palette p (entries 16-31 copied, 0-15 programmed via INT 10h 1000h).
export function f29f6_22c9(p){
 p=u16(p);
 if(!p)return;
 let si=u16(p<<6);
 for(let cx=0;cx<0x10;cx++){
  const di=cx<<1;
  ww(di+0x41a4,cx);ww(di+0x4424,cx);ww(di+0x46a4,cx);
  ww(di+0x41c4,rw(si+0x41c4));ww(di+0x4444,rw(si+0x4444));
  let al=rw(si+0x41a4)&0x0f;if(al>=8)al+=8;
  int10(R({ax:0x1000,bx:al<<8|cx}));
  si=u16(si+2);
 }
}

// ---- slots 21 / 22 ----
// 29f6:2327 pixelAddr (near, registers): AX=y, BX=x -> BX = y*40 + x/8, CL = 7-(x&7), AH = 1.
export function f29f6_2327(ax,bx){
 const cl=(bx&7)^7;
 const prod=mul16(ax,0x28)&0xffff;
 return {bx:u16((u16(bx)>>>3)+prod),cl,ax:0x100|prod&0xff};
}
// 29f6:2344 egaGetPixel(x,y) -> colour 0..15 from [3858].
export function f29f6_2344(x,y){
 const es=rw(0x3858);
 const a=f29f6_2327(u16(y),u16(x));
 const ch=1<<a.cl&0xff,si=a.bx;
 let bx=0,ax=0x0304;
 for(;;){
  outw(0x3ce,ax);
  let bh=mrd(es,si)&ch;bh=-bh&0xff;
  bx=bh<<8|bx&0xff;bx=(bx<<1|bx>>>15)&0xffff;        // ROL BX,1
  const ah=ax>>8;ax=((ah-1)&0xff)<<8|ax&0xff;
  if(s8(ah)-1<0)break;
 }
 const al=bx&0xff;
 outw(0x3c4,0x0f02);outw(0x3ce,0x0205);
 return al;
}
// 29f6:238d egaPutPixel(x,y,c): raw colour c to [3858] in write mode 2.
export function f29f6_238d(x,y,c){
 const es=rw(0x3858);
 const a=f29f6_2327(u16(y),u16(x));
 gc8(1<<a.cl);outw(0x3ce,0x0205);outw(0x3ce,0x0003);
 mrd(es,a.bx);mwr(es,a.bx,c&0xff);
 outw(0x3ce,0xff08);outw(0x3ce,0x0005);outw(0x3ce,0x0003);outw(0x3c4,0x0f02);outw(0x3ce,0x0205);
}

// ---- slot 17 ----
// 29f6:23d8 egaBlitPacked(srcOff,srcSeg,x,y,w,h): opaque packed 4 bpp -> [3858], x truncated to a byte.
export function f29f6_23d8(srcOff,srcSeg,x,y,w,h){
 srcOff=u16(srcOff);srcSeg=u16(srcSeg);x=u16(x);y=u16(y);w=u16(w);h=u16(h);
 outw(0x3ce,0x0005);outw(0x3ce,0xff08);
 outb(0x3c4,2);
 let di=u16(rowOff(y)+(x>>>3));
 const es=rw(0x3858);
 ww(0x5046,h);
 let si=srcOff&0xf;const ds=u16((srcOff>>>4)+srcSeg);
 const bpr=w>>>3;ww(0x5042,bpr);
 let bp=bpr;ww(0x5044,u16(-u16(bpr-0x28)));
 const p=[0,0,0,0];
 for(;;){
  for(let k=0;k<4;k++){ladder(p,mrd(ds,si));si=u16(si+1);}   // two LODSW, no segment wrap handling
  outb(0x3c5,1);mwr(es,di,p[0]);outb(0x3c5,2);mwr(es,di,p[1]);
  outb(0x3c5,4);mwr(es,di,p[2]);outb(0x3c5,8);mwr(es,di,p[3]);di=u16(di+1);
  const ob=bp;bp=u16(bp-1);
  if(s16(ob)-1>0)continue;                          // DEC BP; JNG (w>>3 = 0 still draws one group)
  const oh=rw(0x5046);
  if(s16(oh)-1<=0)break;                            // DEC AX; JNG
  ww(0x5046,u16(oh-1));
  bp=rw(0x5042);di=u16(di+rw(0x5044));
 }
 outb(0x3c5,0x0f);outw(0x3ce,0x0205);outw(0x3ce,0x0003);
}

// ---- slot 23 ----
// 1ff8:44b4 dissolveRect(x,y,w,h,unit): LFSR-ordered copy [3856] -> displayed page [3854].
// The original patches its own immediates (CS:45cf/45e4 cols, 45dd h, 45d7 taps, 45e8 y, 45fb x>>shift,
// 4601 unit index mask, 4605 mask table base, 4608 JMP rel8 to the unit handler) on every call, and patches
// cols/h to 0 at 4612/4617 for the final (0,0) unit. All patch sites are rewritten before use on each call,
// so they are translated as the local parameters below.
export function f1ff8_44b4(x,y,w,h,unit){
 x=u16(x);y=u16(y);w=u16(w);h=u16(h);unit=u16(unit);
 let ax=unit,cx=0xffff;
 do{cx=u16(cx+1);ax>>>=1;}while(ax);
 let cl=cx&0xff;
 if(cl===0)cl=cl+(w>>>8)&0xff;                      // ADD CL,AH: unit 1 with w >= 256
 const shift=cl;
 // SHR AX,CL: DOSBox (386+) masks the count to 5 bits.
 const shr=(v,n)=>{n&=31;return n>=16?0:v>>>n;};
 let colsP=shr(w,shift)&0xff;                       // patched at 45cf and 45e4
 const hb=h&0xff;
 if(hb){
  let hP=hb;                                        // patched at 45dd
  let bx=0;for(let al=hb;al;al>>>=1)bx+=2;
  const T=rw(bx+0x4d42);                            // patched at 45d7
  let S=hb<<8|colsP;
  const xs=shr(x,shift);                            // patched at 45fb
  const id=rb(0x385d);
  if(id===4||rw(0x4d8c)!==0){
   // 1ff8:451f plain copy onto the displayed page through copyRect (1ff8:2545)
   if(id!==2)unsupported('1ff8:451f dissolve copy path for non-EGA adapter');
   const save=rw(0x3858);ww(0x3858,rw(0x3854));
   F.f1ff8_2545(x,y,w,h);
   ww(0x3858,save);
  }else if(id===2){
   outw(0x3ce,0x0005);
   if(shift===3)outw(0x3ce,0x0105);
   outw(0x3ce,0x0000);outw(0x3ce,0x0001);
   outb(0x3c4,2);
   const umask=shr(7,shift);                         // patched at 4601
   const base=u16(umask+0x4d6c);                     // patched at 4605
   const handler=rw(u16((shift<<1)+0x4d54));         // JMP target patched at 4608
   const es=rw(0x3854),ds=rw(0x3856);
   const plot=(BL,BH)=>{
    const r=y&0xff00|(y+BH)&0xff;                     // MOV AX,y; ADD AL,BH (8-bit)
    let si=rw(u16((r<<1)+0x3d3e));
    let a=u16(BL+xs);
    const bp=u16((a&umask)+base);
    if(handler===0x464b){                            // 8-pixel unit: latch copy (write mode 1)
     si=u16(si+a);mwr(es,si,mrd(ds,si));
     return;
    }
    if(handler===0x466b)a>>>=3;else if(handler===0x466d)a>>>=2;else if(handler===0x466f)a>>>=1;
    else return unsupported(`1ff8:4607 dissolve handler 1ff8:${handler.toString(16)}`);
    si=u16(si+a);
    gc8(rb(bp));outw(0x3ce,0x0004);
    let c0=mrd(ds,si);outb(0x3cf,1);let c1=mrd(ds,si);
    outb(0x3cf,2);const c2=mrd(ds,si);outb(0x3cf,3);const c3=mrd(ds,si);
    mrd(es,si);                                      // latch load from the destination
    outb(0x3c5,8);mwr(es,si,c3);outb(0x3c5,4);mwr(es,si,c2);
    outb(0x3c5,2);mwr(es,si,c1);outb(0x3c5,1);mwr(es,si,c0);
   };
   let guard=0;
   for(;;){
    if(++guard>0x30000)throw Error('1ff8:44b4 dissolve LFSR did not cycle');
    const lsb=S&1;S>>>=1;if(lsb)S^=T;S&=0xffff;     // SHR BX,1; SBB AX,AX; AND AX,T; XOR BX,AX
    const BH=S>>>8,BL=S&0xff;
    if(BH>hP)continue;
    if(BH===hP){
     if(BL!==colsP)continue;
     // 1ff8:4609: the LFSR never yields state 0, so unit (0,0) is drawn once at the end
     S=0;
     if(colsP===0)break;
     colsP=0;hP=0;
     plot(0,0);
     continue;
    }
    if(BL>=colsP)continue;
    plot(BL,BH);
   }
  }else if(id===1){
   // 1ff8:457d CGA: handler DS:4d5c[shift], index mask 3>>shift, pixel mask table DS:4d7b+4*shift (cgadrv.js)
   const cs=cgaDissolveSetup(shift);
   let guard=0;
   for(;;){
    if(++guard>0x30000)throw Error('1ff8:44b4 dissolve LFSR did not cycle');
    const lsb=S&1;S>>>=1;if(lsb)S^=T;S&=0xffff;
    const BH=S>>>8,BL=S&0xff;
    if(BH>hP)continue;
    if(BH===hP){
     if(BL!==colsP)continue;
     S=0;
     if(colsP===0)break;
     colsP=0;hP=0;
     cgaDissolvePlot(0,0,y,xs,cs);
     continue;
    }
    if(BL>=colsP)continue;
    cgaDissolvePlot(BL,BH,y,xs,cs);
   }
  }
  else unsupported('1ff8:459f dissolve non-EGA path');
 }
 // 1ff8:461e
 if(rb(0x385d)===2){outb(0x3c5,0x0f);outw(0x3ce,0x0205);}
}

// Far-pointer slots (DS:4d9c table entries copied into DS:4924).
register(0x29f6,0x13b5,f29f6_13b5);
register(0x29f6,0x16ec,f29f6_16ec);
register(0x29f6,0x19b1,f29f6_19b1);
register(0x29f6,0x00a7,f29f6_00a7);
register(0x29f6,0x1be8,f29f6_1be8);
register(0x29f6,0x1c4c,f29f6_1c4c);
register(0x29f6,0x1cda,f29f6_1cda);
register(0x29f6,0x1d05,f29f6_1d05);
register(0x29f6,0x1d9c,f29f6_1d9c);
register(0x29f6,0x13b4,f29f6_13b4);
register(0x29f6,0x1ece,f29f6_1ece);
register(0x29f6,0x1ddc,f29f6_1ddc);
register(0x29f6,0x21ad,f29f6_21ad);
register(0x29f6,0x1f4c,f29f6_1f4c);
register(0x29f6,0x1f8d,f29f6_1f8d);
register(0x29f6,0x23d8,f29f6_23d8);
register(0x29f6,0x225b,f29f6_225b);
register(0x29f6,0x22c9,f29f6_22c9);
register(0x29f6,0x2344,f29f6_2344);
register(0x29f6,0x238d,f29f6_238d);
register(0x1ff8,0x44b4,f1ff8_44b4);
register(0x29f6,0x0002,f29f6_0002);
register(0x29f6,0x0044,f29f6_0044);
register(0x29f6,0x0066,f29f6_0066);
register(0x29f6,0x141a,f29f6_141a);

provide({f29f6_0002,f29f6_0044,f29f6_0066,f29f6_00a7,f29f6_022c,f29f6_039e,f29f6_05d1,f29f6_0818,f29f6_0a73,f29f6_0ce2,
 f29f6_0f39,f29f6_117c,f29f6_13b4,f29f6_13b5,f29f6_141a,f29f6_14e8,f29f6_16ec,f29f6_19b1,f29f6_1be8,f29f6_1c4c,f29f6_1cda,
 f29f6_1d05,f29f6_1d9c,f29f6_1ddc,f29f6_1ece,f29f6_1f4c,f29f6_1f8d,f29f6_2034,f29f6_2137,f29f6_216a,f29f6_21ad,f29f6_225b,
 f29f6_22c9,f29f6_2327,f29f6_2344,f29f6_238d,f29f6_23d8,f1ff8_44b4});
export {f29f6_13b5 as egaInit,f29f6_16ec as egaDrawGlyph,f29f6_19b1 as egaLine,f29f6_00a7 as egaDrawSprite,f29f6_1be8 as egaCopyRect,
 f29f6_1c4c as egaSaveRect,f29f6_1cda as egaSaveRectSize,f29f6_1d05 as egaRestoreRect,f29f6_1d9c as egaFlip,f29f6_1ece as egaHSpanSolid,
 f29f6_1ddc as egaHSpanDither,f29f6_21ad as egaLoadFontData,f29f6_1f4c as egaSpriteBytesNeeded,f29f6_1f8d as egaConvertSprites,
 f29f6_23d8 as egaBlitPacked,f29f6_225b as egaReadPalette,f29f6_22c9 as egaSetPalette,f29f6_2344 as egaGetPixel,f29f6_238d as egaPutPixel,
 f1ff8_44b4 as dissolveRect,f29f6_0044 as egaSetBorder,f29f6_0066 as egaSetPaletteReg,f29f6_141a as egaFillSpans};
