// Segment 2fd2: the CGA driver (adapter id 1; table DS:4e3c, copied to the active table DS:4924 by 1ff8:21bc).
// Translated instruction by instruction from the raw bytes (the Ghidra listing mis-prints segment moves and jump targets).
// The adapter is driven in BIOS mode 4 (320x200, 4 colours, 2 bits per pixel, leftmost pixel in the high bits); the frame
// buffer B800:0000 holds even scanlines at +0 and odd scanlines at +0x2000, 80 bytes per line. DS:3d3e[y] is the row table.
// Pages (init 2fd2:0252): [3854] displayed = B800, [3852] back page and [3850] third page = 16 KB DOS blocks.
// Colour tables: DS:41a4/41c4 (even/odd rows, 16 words each per palette), 4424/4444, 46a4 (pixel bytes). The dithering
// "CGA:" palettes hold, per colour, a word whose low byte carries two 2-bit pixel patterns (see f2fd2_00be).
// Display: src/engine/cga.js. The game then runs 1000:a536 (INT 10h AX=0006h, observed in the port's own boot with argument GC): the
// same bytes are shown as 640x200 1 bpp (colour select 3Fh: white on black), so 2-bit colour codes 01/10 look like half tones.
// Mode 4 (colour select 30h: black, bright cyan, bright magenta, white) is modelled for the instant between the two mode sets.
//
// Calling convention of the JS functions (same as egadrv.js)
// ----------------------------------------------------------
// Stack-argument slots take one JS parameter per pushed word, in [bp+6], [bp+8], ... order. Register-argument slots take
// the registers as explicit parameters. Segments are segment numbers; B800-BFFF counts as video memory (work.vram, APPROX:
// one unit per byte moved, words count 2; the cost per unit is calibrated by the main session).
//
// slot  addr       JS signature                                    notes
//  0    2fd2:0252  f2fd2_0252() -> al                              cgaInit (BIOS mode 4, pages, row and colour tables)
//  1    2fd2:0318  f2fd2_0318(ax, dx, bp, es)                      cgaDrawGlyph: AX=char, DX=x, BP=y, ES=page segment
//  2    2fd2:05dc  f2fd2_05dc(bx, cx, dx, si, es)                  cgaLine: BX=x1, CX=y1, DX=x2, SI=y2 (x1<=x2), ES=page
//  3    2fd2:0b87  f2fd2_0b87(spr, x, y)                           cgaDrawSprite: spr = near ptr to {seg, dataOff, maskOff, w, h}
//  4    2fd2:1224  f2fd2_1224(x, y, w, h)                          cgaCopyRect [3856] -> [3858]
//  5    2fd2:128f  f2fd2_128f(off, seg, x, y, w, h)                cgaSaveRect [3856] -> buffer
//  6    2fd2:12f2  f2fd2_12f2(w, h) -> u32                         cgaSaveRectSize
//  7    2fd2:1313  f2fd2_1313(off, seg, x, y, w, h)                cgaRestoreRect buffer -> [3858]
//  8,15,16,18,28-34  2fd2:0251  f2fd2_0251()                       RETF (so there is no page flip: slot 8 does nothing)
//  9    2fd2:13cd  f2fd2_13cd(x, y, w, h)                          cgaPresentRect [3852] -> [3854] (words)
// 10    2fd2:1430  f2fd2_1430(ax, bx, cx, dx, di, es)              cgaHSpanSolid: AX=colour word, BX=x, CX=width, DI=row offset; DX unused
// 11    2fd2:1427  f2fd2_1427(ax, bx, cx, dx, di, es)              cgaHSpanDither: toggles DS:386a, odd calls use DX as the colour word
// 12    2fd2:14c5  f2fd2_14c5(fp, i) -> i or 0                     cgaLoadFontData (fread 1000:c214, 1ff8:3a88 alloc): 1 bpp file glyphs -> 2 bpp
// 13    2fd2:167e  f2fd2_167e(list, pExtra) -> u32                 cgaSpriteBytesNeeded
// 14    2fd2:1572  f2fd2_1572(list, off, seg, szLo, szHi, auxOff, auxSeg)   cgaConvertSprites
// 17    2fd2:16c5  f2fd2_16c5(srcOff, srcSeg, x, y, w, h)          cgaBlitPacked (opaque 4 bpp band, dithered to 2 bpp)
// 19    2fd2:0004  f2fd2_0004(fp, p) -> p                          cgaReadPalette (fread 1000:c214)
// 20    2fd2:0071  f2fd2_0071(p)                                   cgaSetPalette: copies palette p over palette 0
// 21    2fd2:1377  f2fd2_1377(x, y) -> colour                      cgaGetPixel from [3858]
// 22    2fd2:138e  f2fd2_138e(x, y, c)                             cgaPutPixel to [3858]
// 23    1ff8:44b4  dissolveRect (shared with the EGA, src/game/egadrv.js; the CGA unit handlers are cgaDissolvePlot below)
// 24    2fd2:1734  f2fd2_1734()                                    RETF
// 25    29f6:0044  egaSetBorder (shared with the EGA table: INT 10h AX=1001h)
// 26    2fd2:1745  f2fd2_1745()                                    RETF
// 27    2fd2:1746  f2fd2_1746(si)                                  cgaFillSpans: SI = near ptr to {y, count, (x1,x2) x count}
// internal: f2fd2_00be convert4bppRow (register ABI), f2fd2_014e convertRows, f2fd2_01e9 buildMask, f2fd2_13a9 pixelAddr,
//           sprite bodies f2fd2_0ce3..f2fd2_11eb (jump table DS:506a, near JMP AX in f2fd2_0b87).
import {B,rb,rw,wb,ww,salloc,sfree,DGROUP} from '../engine/mem.js';
import {s8,s16,u16,div32_16,mod32_16} from '../engine/int.js';
import {work} from '../engine/ega.js';
import {register,unsupported} from '../engine/host.js';
import {int10,int21} from './bios.js';
import {F,provide} from './link.js';

// ---- machine helpers ----
const lin=(s,o)=>((s&0xffff)<<4)+(o&0xffff);
const isVram=l=>l>=0xb8000&&l<0xc0000;
// CPU access at s:o. APPROX: every byte moved in B800-BFFF counts one work.vram unit.
function mrd(s,o){const l=lin(s,o);if(isVram(l))work.vram++;return B[l];}
function mwr(s,o,v){const l=lin(s,o);if(isVram(l))work.vram++;B[l]=v;}
const mrw=(s,o)=>mrd(s,o)|mrd(s,o+1)<<8;
const mww=(s,o,v)=>{mwr(s,o,v);mwr(s,o+1,v>>8);};
const rowOff=y=>rw(u16(u16(y<<1)+0x3d3e)); // MOV reg,[2*y+3d3e]
const swap=v=>(v<<8|v>>8)&0xffff;           // XCHG AH,AL on a word read from memory
const ror16=(v,n)=>(v>>>n|v<<16-n)&0xffff, ror8=(v,n)=>(v>>>n|v<<8-n)&0xff;
const R=o=>Object.assign({ax:0,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:0},o);
// rep movsw within DGROUP (ES=DS): n words from near si to near di.
function cpw(di,si,n){for(;n;n--){ww(di,rw(si));di=u16(di+2);si=u16(si+2);}}
// Next scanline pair advance used by every row loop: XOR DI,2000h; add 50h when the new row is the even one.
const nextRow=di=>{di=(di^0x2000)&0xffff;return di&0x2000?di:u16(di+0x50);};
// 8086 signed compare helpers on 16-bit values (flags of CMP/SUB a,b).
const jl=(a,b)=>s16(a)<s16(b), jle=(a,b)=>s16(a)<=s16(b);
// JNG after INC r (r = result): ZF, or SF != OF where OF is only set for 7FFFh -> 8000h.
const jngInc=r=>r===0||r>0x8000;

// 2fd2:0251 nullSlot: lone RETF (slots 8, 15, 16, 18, 28-34).
export function f2fd2_0251(){}
// 2fd2:1734 slot 24 and 2fd2:1745 slot 26: lone RETF.
export function f2fd2_1734(){}
export function f2fd2_1745(){}

// 2fd2:0004 cgaReadPalette(fp,p): fread(buf,1,0xa2,fp); DS:4190[p] and DS:419a[p] take the first two bytes; the next
// 0x20+0x20+0x10 words go to palette p of the tables 41a4, 4424 and 46a4 (64 bytes per palette). Returns p.
export function f2fd2_0004(fp,p){
 p=u16(p);
 const buf=salloc(0xa2);
 try{
  F.f1000_c214(buf,1,0xa2,fp);
  let si=buf;
  wb(u16(p+0x4190),rb(si));wb(u16(p+0x419a),rb(si+1));si+=2;
  const base=u16(p<<6);
  cpw(u16(base+0x41a4),si,0x20);si+=0x40;
  cpw(u16(base+0x4424),si,0x20);si+=0x40;
  cpw(u16(base+0x46a4),si,0x10);
  return p;
 }finally{sfree(0xa2);}
}
// 2fd2:0071 cgaSetPalette(p): p = 0 does nothing; else palette p is copied over palette 0 (the active tables).
export function f2fd2_0071(p){
 let si=u16(p);if(!si)return;
 si=u16(si<<6);const bx=si;
 cpw(0x41a4,u16(bx+0x41a4),0x20);cpw(0x4424,u16(bx+0x4424),0x20);cpw(0x46a4,u16(bx+0x46a4),0x10);
}

// 2fd2:00be convert4bppRow (register ABI, near-style helper called through CALLF): DS:SI packed 4 bpp source (two pixels
// per byte, high nibble first), ES:DI destination, CX = destination bytes (0 means 65536), DX bit 0 = row parity.
// Each destination byte takes two source bytes; the pixel colour c selects the low byte T of the word DS:41a4[c] and the
// 2-bit value (T >> 2) & 3 or T & 3: checkerboard dither, with the choice swapped between the high and the low nibble and
// between even and odd rows. Returns {si,di} (SI and DI advance; BX and BP are clobbered).
export function f2fd2_00be(ds,si,es,di,cx,dx){
 const odd=dx&1,T=c=>rb(0x41a4+2*c);
 const hi=c=>(odd?T(c)>>2:T(c))&3, lo=c=>(odd?T(c):T(c)>>2)&3;
 cx=u16(cx);
 do{
  const b1=mrd(ds,si),b2=mrd(ds,si+1);si=u16(si+2);
  mwr(es,di,hi(b1>>4)<<6|lo(b1&15)<<4|hi(b2>>4)<<2|lo(b2&15));di=u16(di+1);
  cx=u16(cx-1);
 }while(cx);
 return {si,di};
}
// 2fd2:014e convertRows(dOff,dSeg,sOff,sSeg,w,h,par): converts h rows of w 4 bpp pixels from sSeg:sOff into 2 bpp at
// dSeg:dOff (rows of w/4 bytes, consecutive) with f2fd2_00be; the row parity starts at par (bit 0), flipped when h is odd.
export function f2fd2_014e(dOff,dSeg,sOff,sSeg,w,h,par){
 par=u16(par);h=u16(h);
 if(h&1)par^=1;
 ww(0x4d86,u16(w)>>2);
 let si=sOff&0xf,ds=u16((sOff>>4)+sSeg),di=dOff&0xf,es=u16((dOff>>4)+dSeg);
 par&=1;
 let dx=u16(par+h);
 do{
  const r=f2fd2_00be(ds,si,es,di,rw(0x4d86),dx);
  ds=u16(ds+(r.si>>4));si=r.si&0xf;es=u16(es+(r.di>>4));di=r.di&0xf;
  dx=u16(dx-1);
 }while(dx!==par);
}
// 2fd2:01e9 buildMask(dOff,dSeg,sOff,sSeg,count): reads `count` words (4 packed pixels) from sSeg:sOff and stores one byte per
// word: 2 bits per pixel, 11 for transparent (colour 0) and 00 for opaque. CX = 0 means 65536 words.
export function f2fd2_01e9(dOff,dSeg,sOff,sSeg,count){
 let si=sOff&0xf,ds=u16((sOff>>4)+sSeg),di=dOff&0xf,es=u16((dOff>>4)+dSeg),cx=u16(count);
 do{
  const ax=mrw(ds,si);si=u16(si+2);
  let bl=0;
  if(ax&0xf000)bl|=0x0c;if(ax&0x0f00)bl|=0x03;if(ax&0x00f0)bl|=0xc0;if(ax&0x000f)bl|=0x30;
  mwr(es,di,~bl&0xff);di=u16(di+1);
  cx=u16(cx-1);
 }while(cx);
}

// 2fd2:0252 cgaInit (slot 0): BIOS mode 4, 4 colours ([3861]), pages [3854]=B800 / [3852] / [3850] (two 16 KB DOS blocks,
// cleared), row table DS:3d3e[200], colour tables 41a4/41c4/4424/4444/46a4[c] = (c & 3) * 0x5555. Sets [385d] = 1 on success;
// returns AL = 1, or 0 when an allocation fails.
// UNKNOWN: DX at the allocation checks (OR DX,AX) is a leftover of the caller; it is taken as non-zero (only AX = 0 fails).
// The Tandy branch ([385c] = 1, 3168:18aa and 3168:1820) is not translated.
export function f2fd2_0252(){
 int10({ax:4});
 wb(0x3861,4);
 if(rb(0x385c)===1){unsupported('2fd2:0252 Tandy page set-up (3168:18aa/1820)');wb(0x385d,0);return 0;}
 let r=R({ax:0x4800,bx:0x400});int21(r);
 if(!r.ax){wb(0x385d,0);return 0;}
 ww(0x3852,r.ax);ww(0x3854,0xb800);
 r=R({ax:0x4800,bx:0x400});int21(r);
 if(!r.ax){wb(0x385d,0);return 0;}
 ww(0x3850,r.ax);
 for(const seg of [rw(0x3854),rw(0x3852),rw(0x3850)])for(let i=0;i<0x4000;i++)mwr(seg,i,0);
 let ax=0;
 for(let y=0;y<100;y++){ww(0x3d3e+4*y,ax);ax=u16(ax+0x2000);ww(0x3d3e+4*y+2,ax);ax=u16(ax-0x1fb0);}
 ax=0;
 for(let si=0,cx=0x10;cx;cx--,si+=2){
  for(const t of [0x41a4,0x41c4,0x4424,0x4444,0x46a4])ww(si+t,ax);
  ax+=0x5555;if(ax>0xffff)ax=0;
 }
 wb(0x385d,1);
 return 1;
}

// ---- slot 1: glyph ----
// 2fd2:0318 cgaDrawGlyph(ax,dx,bp,es): AX = character (AL), DX = x, BP = y, ES = page. Current font = slot 0 of the font arrays:
// width [3874], height [3888], first char [389c], count [38b0], data segment [38c4]; the glyph bytes are 2 bpp (f2fd2_14c5), 4 pixels
// per byte, a set pixel is 11. Colours: [3868] foreground and [3869] background pixel bytes; [3842] != 0 is transparent.
// Preserves DX, SI, BP, DS. The glyph rows have ceil(w/4) bytes; widths and x not multiples of 4 take the shifting paths.
// QUIRK: glyph offset = idx * ((h * bytesPerRow) & 0xff) (8-bit MUL BL on the low byte of the product).
export function f2fd2_0318(ax,dx,bp,es){
 const di0=u16(ax);dx=u16(dx);bp=u16(bp);
 const fg=()=>rb(0x3868),bg=()=>rb(0x3869);
 const fontSeg=()=>rw(0x38c4);
 // glyph index: AL - [389c] (signed JL), then compare with [38b0] (signed JL)
 const first=rb(0x389c),count=rb(0x38b0);
 if(!(dx&3)&&!(rb(0x3874)&3)){
  // aligned: x multiple of 4 and width multiple of 4
  const bpr=rb(0x3874)>>2;let cl=bpr,ch=rb(0x3888);
  const prod=ch*bpr;                                // MUL BL: AX = AL * BL
  const al=(di0-first)&0xff;
  if(s8(di0&0xff)<s8(first)||!(s8(al)<s8(count)))return;
  let si=al*(prod&0xff);
  let di=u16(rowOff(bp)+(dx>>2));
  const w=bpr,ds=fontSeg(),f=fg(),b=bg();
  if(!rb(0x3842)){
   do{
    cl=w;
    do{const g=mrd(ds,si);si=u16(si+1);mwr(es,di,g&f|(g^0xff)&b);di=u16(di+1);cl=cl-1&0xff;}while(cl);
    di=nextRow(u16(di-w));
    ch=ch-1&0xff;
   }while(ch);
  }else{
   do{
    cl=w;
    do{const g=mrd(ds,si);si=u16(si+1);const k=(g^0xff)&0xff;mwr(es,di,mrd(es,di)&k);mwr(es,di,mrd(es,di)|g&f);di=u16(di+1);cl=cl-1&0xff;}while(cl);
    di=nextRow(u16(di-w));
    ch=ch-1&0xff;
   }while(ch);
  }
  return;
 }
 // unaligned (03d9)
 let cl=(dx&3)<<1;
 let bpD=u16(rowOff(bp)+(dx>>2));                   // BP = row start + x/4
 const wd=rb(0x3874);
 let bpr=wd>>2;if(wd&3)bpr++;                       // DX = ceil(w/4) (DH = 0)
 wb(0x504c,rb(0x5048+(wd&3)));                      // edge mask: pixels of the last byte beyond the width
 let ch=rb(0x3888);
 const prod=ch*(bpr&0xff);                          // MUL BL
 const al=(di0-first)&0xff;
 if(s8(di0&0xff)<s8(first)||!(s8(al)<s8(count)))return;
 let si=al*(prod&0xff);
 let di=bpD;
 const ds=fontSeg(),f=fg(),b=bg(),edge=rb(0x504c);
 const colour=g=>g&f|(g^0xff)&b;
 const sh=(hiB,loB)=>((hiB<<8|loB)>>cl)&0xff;     // SHR AX,CL with AH = hiB, AL = loB, taking AL
 if(cl===0){
  // 053c: x multiple of 4, width not
  const dxr=bpr;
  if(!rb(0x3842)){
   do{
    let dl=dxr;
    for(dl--;dl;dl--){const g=mrd(ds,si);si=u16(si+1);mwr(es,di,colour(g));di=u16(di+1);}
    {const g=mrd(ds,si);si=u16(si+1);const c=colour(g)&(edge^0xff);mwr(es,di,mrd(es,di)&edge|c);di=u16(di+1);}
    di=nextRow(u16(di-dxr));
    ch=ch-1&0xff;
   }while(ch);
  }else{
   do{
    let dl=dxr;
    do{const g=mrd(ds,si);si=u16(si+1);const d=mrd(es,di)&((g^0xff)&0xff);mwr(es,di,d|g&f);di=u16(di+1);dl=dl-1&0xff;}while(dl);
    di=nextRow(u16(di-dxr));
    ch=ch-1&0xff;
   }while(ch);
  }
  return;
 }
 const dxs=bpr+1;                                   // INC DX: one more destination byte
 if(!rb(0x3842)){
  // 043c: opaque, shifted
  do{
   let bh=0xff,bl=0,dl=dxs-1&0xff;
   for(dl--;dl;dl--){                               // first bpr-1 bytes
    let dh=mrd(es,di);
    const keep=sh(bh,0);bh=0;dh&=keep;
    const c=colour(mrd(ds,si));si=u16(si+1);
    const v=sh(bl,c);bl=c;
    mwr(es,di,v|dh);di=u16(di+1);
   }
   // 0476: last glyph byte and the spill byte
   let dh=mrd(es,di);
   let keep=sh(bh,edge);bh=edge;dh&=keep;
   let c=colour(mrd(ds,si));si=u16(si+1);
   c&=bh^0xff;
   let v=sh(bl,c);bl=c;
   mwr(es,di,v|dh);di=u16(di+1);
   dh=mrd(es,di);
   keep=sh(bh,0xff);dh&=keep;
   v=sh(bl,0);
   mwr(es,di,v|dh);
   di=nextRow(u16(di-(dxs-1&0xff)));
   ch=ch-1&0xff;
  }while(ch);
 }else{
  // 04d8: transparent, shifted
  do{
   let bl=0,dl=dxs&0xff;
   for(dl--;dl;dl--){
    let dh=mrd(es,di);
    const g=mrd(ds,si);si=u16(si+1);
    const keep=(((((bl^0xff)<<8)|(g^0xff))>>cl)&0xff);
    dh&=keep;
    const v=sh(bl,g)&f;bl=g;
    mwr(es,di,v|dh);di=u16(di+1);
   }
   let dh=mrd(es,di);
   const keep=((((bl^0xff)<<8|0xff)>>cl)&0xff);
   dh&=keep;
   const v=sh(bl,0)&f;
   mwr(es,di,v|dh);di=u16(di+1);
   di=nextRow(u16(di-dxs));
   ch=ch-1&0xff;
  }while(ch);
 }
}

// ---- slot 2: line ----
// 2fd2:05dc cgaLine(bx,cx,dx,si,es): unclipped line from (x1,y1) to (x2,y2), x1 <= x2 (the caller swaps). Colour = word DS:41a4[[384e]]
// (both row parities use the even-row table). The pixel mask word M = DS:504e[(x1&3)*2] ANDs out the pixel and the colour C is that
// word without M; both rotate right by 2 bits per x step. Horizontal and the x-major staircase work on 16-bit windows (two
// screen bytes, big-endian), vertical, diagonal and y-major on bytes. Same 4-connected staircase as the EGA line (graphics.md).
// QUIRK: the diagonal case ends one row short of (x2,y2) with an extra pixel below; widths and counts are 16-bit.
// UNKNOWN: DS:5056, 5060, 5058, 505a, 505c, 505e are scratch variables; they are written as in the original.
export function f2fd2_05dc(bx,cx,dx,si,es){
 bx=u16(bx);cx=u16(cx);dx=u16(dx);si=u16(si);
 const x1=bx,y1=cx,x2=dx,y2=si;
 let C=rw(u16(((rb(0x384e))<<1)+0x41a4));ww(0x5060,C);
 let M=rw(u16(((bx&3)<<1)+0x504e));ww(0x5056,M);
 C=rw(0x5060)&(M^0xffff);ww(0x5060,C);
 let di=u16(rowOff(cx)+(bx>>2));
 if(x1===x2){
  if(y1===y2){mwr(es,di,mrd(es,di)&(M>>8)|C>>8);return;}
  // 06a3 vertical
  let n=u16(y1-y2);
  if(!jl(y1,y2)){n=u16(-n);di=u16(rowOff(y2)+(x1>>2));}
  n=u16(-n);
  let bp=di&0x2000?0xe050:0x2000;
  const bh=M>>8,dh=C>>8;
  let al;
  for(;;){al=mrd(es,di)&bh|dh;mwr(es,di,al);n=u16(n-1);if(n&0x8000)break;di=u16(di+bp);bp^=0xc050;}
  mwr(es,di,al);
  return;
 }
 if(y1===y2){
  // 063a horizontal
  let n=u16(x2-x1);
  let ax=swap(mrw(es,di))&M|C;
  for(;;){
   C=ror16(C,2);const cf=M>>1&1;M=ror16(M,2);
   if(cf){ax=ax&M|C;n=u16(n-1);if(!n)break;}
   else{mww(es,di,swap(ax));di=u16(di+2);ax=swap(mrw(es,di))&M|C;n=u16(n-1);if(!n)break;}
  }
  mww(es,di,swap(ax));
  return;
 }
 // 072a general
 let dxx=u16(x2-x1);let dy=u16(y2-y1);
 let down=true;
 if(!(s16(y2)>s16(y1))){dy=u16(-dy);down=false;}   // SUB SI,CX; JG 0735 else NEG SI; JMP 095f
 let bp;
 if(down)bp=di&0x2000?0xe050:0x2000;else bp=di&0x2000?0x2000:0xe050;
 const step=()=>{di=down?u16(di+bp):u16(di-bp);};
 let cxx=dy;
 if(cxx===dxx){
  // 074f / 0979 diagonal
  cxx=dxx;
  let bh=M>>8,dh=C>>8;
  let al=mrd(es,di)&bh|dh;
  for(;;){
   dh=ror8(dh,1);dh=ror8(dh,1);const cf=bh>>1&1;bh=ror8(bh,1);bh=ror8(bh,1);
   if(!cf){
    mwr(es,di,al);di=u16(di+1);al=mrd(es,di)&bh|dh;cxx=u16(cxx-1);if(!cxx)break;
    mwr(es,di,al);step();bp^=0xc050;al=mrd(es,di)&bh|dh;
   }else{
    al=al&bh|dh;cxx=u16(cxx-1);if(!cxx)break;
    mwr(es,di,al);step();bp^=0xc050;al=mrd(es,di)&bh|dh;
   }
  }
  mwr(es,di,al);step();al=mrd(es,di)&bh|dh;mwr(es,di,al);
  return;
 }
 if(cxx<dxx){
  // 07d8 / 0a02 x-major: runs of q+1 or q pixels, then one step in y
  let sI=dxx,cnt=u16(cxx+1);
  const q=div32_16(dxx,cnt);                         // CWD; DIV CX with DX:AX = sign-extended dx
  const rem=mod32_16(dxx,cnt);
  ww(0x5058,q);
  const f=div32_16(rem*65536,cnt);ww(0x505a,f);
  let bxW=rw(0x5056),dxW=rw(0x5060);
  ww(0x505e,0);
  let run=u16(rw(0x5058)+1);
  let ax=swap(mrw(es,di))&bxW|dxW;
  for(;;){
   // 0808
   ww(0x505c,sI);
   const t=u16(sI-run);
   if(s16(sI)>=s16(run))sI=t;else{run=rw(0x505c);sI=0;}
   // 0816 pixel loop
   let done=false;
   for(;;){
    dxW=ror16(dxW,2);const cf=bxW>>1&1;bxW=ror16(bxW,2);
    if(cf){ax=ax&bxW|dxW;run=u16(run-1);if(!run)break;}
    else{mww(es,di,swap(ax));di=u16(di+2);ax=swap(mrw(es,di))&bxW|dxW;run=u16(run-1);if(!run)break;}
   }
   // 085c
   if(sI===0){mww(es,di,swap(ax));return;}
   mww(es,di,swap(ax));step();bp^=0xc050;
   ax=swap(mrw(es,di))&bxW|dxW;
   const acc=rw(0x505e)+rw(0x505a);ww(0x505e,acc);
   run=rw(0x5058);if(acc>0xffff)run=u16(run+1);
  }
 }
 {
  // 08ab / 0ad5 y-major: runs of q+1 or q rows, then one step in x
  // XCHG CX,DX: CX = dx, DX = dy
  let sI=cxx;const cnt=u16(dxx+1);
  const q=div32_16(cxx,cnt),rem=mod32_16(cxx,cnt);
  ww(0x5058,q);
  const f=div32_16(rem*65536,cnt);ww(0x505a,f);
  let acc=0,run=u16(rw(0x5058)+1);
  let bh=rw(0x5056)>>8,bl=rw(0x5060)>>8;
  let al=mrd(es,di)&bh|bl;
  for(;;){
   // 08d7
   ww(0x505c,sI);
   if(s16(sI)>=s16(run))sI=u16(sI-run);else{run=rw(0x505c);sI=0;}
   for(;;){
    mwr(es,di,al);step();bp^=0xc050;al=mrd(es,di)&bh|bl;run=u16(run-1);if(!run)break;
   }
   // 0920
   if(sI===0){mwr(es,di,al);return;}
   bl=ror8(bl,1);bl=ror8(bl,1);const cf=bh>>1&1;bh=ror8(bh,1);bh=ror8(bh,1);
   if(cf){al=al&bh|bl;}
   else{mwr(es,di,al);di=u16(di+1);al=mrd(es,di)&bh|bl;}
   run=rw(0x5058);acc+=rw(0x505a);if(acc>0xffff){acc&=0xffff;run=u16(run+1);}
  }
 }
}

// ---- slot 3: masked sprite ----
// 2fd2:0b87 cgaDrawSprite(spr,x,y): spr = near ptr to {seg, dataOff, maskOff, w, h} (written by f2fd2_1572); the data is 2 bpp,
// the mask has 11 for transparent pixels, both w/4 bytes per row. Destination ES = [3858]. Optional clip ([384b] != 0) to the
// rectangle [3843],[3845],[3847],[3849] (x byte-granular, y exact). Scratch: DS:5062 right bound, 5064 shift s = x&3,
// 5066 clip flags (bit 0 left clipped, bit 1 right clipped), 5068 source bytes to skip per row. The body is selected through the
// table DS:506a[flags*4 + s] (f2fd2_11eb for s = 0, f2fd2_0ce3.. for s = 1..3).
// QUIRK: when the sprite is clipped on both sides, 8-bit AL arithmetic is used for the per-row skip (AH keeps w/4's high byte).
export function f2fd2_0b87(spr,x,y){
 spr=u16(spr);x=u16(x);y=u16(y);
 const Lseg=rw(spr),Loff=rw(spr+2),Lmask=rw(spr+4),Lw=rw(spr+6),Lh=rw(spr+8);
 const es=rw(0x3858);
 let di,dh,cx,si,bp;
 if(!rb(0x384b)){
  di=u16(rowOff(y)+(x>>2));
  ww(0x5064,x&3);
  cx=Lh;dh=(Lw>>2)&0xff;
  ww(0x5068,0);ww(0x5066,0);
  si=Loff;bp=Lmask;
 }else{
  let dx=Lw>>2,bx=y,ax;cx=Lh;si=0;
  ax=rw(0x3847);
  if(jl(bx,ax)){                                    // top
   ax=u16(ax-bx);
   if(jle(cx,ax))return;                            // SUB CX,AX; JNG
   cx=u16(cx-ax);
   si=(ax&0xff)*(dx&0xff);                          // MUL DL
   bx=rw(0x3847);
  }
  ax=u16(bx+cx-1);
  if(ax>rw(0x3849)){                                // bottom (unsigned)
   cx=u16(rw(0x3849)-bx+1);
   if(jngInc(cx))return;                            // INC CX; JNG
  }
  di=rowOff(bx);
  dx=u16(dx<<2);
  ax=x;bx=ax;ax=rw(0x3843);
  if(jl(bx,ax)){                                    // left
   ax=u16(ax-bx);
   if(jle(dx,ax))return;                            // SUB DX,AX; JNG
   dx=u16(dx-ax);
   bx=ax;ax=dx&3;ww(0x5064,ax);
   ax=u16(ax+bx)>>2;si=u16(si+ax);
   bx=rw(0x3843);
   ww(0x5066,1);
  }else{
   ww(0x5064,bx&3);ww(0x5066,0);
  }
  ax=u16(rw(0x3845)-1)|3;ww(0x5062,ax);
  di=u16(di+(bx>>2));
  ax=u16(bx+dx-1);
  if(ax>rw(0x5062)){                                // right (unsigned)
   dx=u16(rw(0x5062)-bx+1);
   if(jngInc(dx))return;                            // INC DX; JNG
   ww(0x5066,u16(rw(0x5066)+2));
  }
  dx>>=2;dh=dx&0xff;
  ax=Lw>>2;ax=ax&0xff00|(ax-dh)&0xff;
  if(rw(0x5066)===3)ax=ax&0xff00|(ax-1)&0xff;      // DEC AL
  ww(0x5068,ax);
  ax=si;si=u16(si+Loff);ax=u16(ax+Lmask);bp=ax;
 }
 const target=rw(u16(0x506a+(rw(0x5066)<<3)+(rw(0x5064)<<1)));
 const body=spriteBodies[target];
 if(!body)return unsupported(`2fd2:0ce1 sprite jump to 2fd2:${target.toString(16)}`);
 body(es,Lseg,si,bp,di,cx&0xff,dh);
}
// Sprite body core. Per row: dh bytes (plus a spill byte when s != 0) of  dest = (dest & mask') | data'  where the mask and data
// rows are shifted right by 2*s bits across byte boundaries (previous byte in the high half). F bit 0: the previous bytes are the
// real ones left of the clip (DS:BP-1, DS:SI-1) instead of 0xff / 0; bit 1: the next bytes are the real ones (DS:BP, DS:SI)
// instead of 0xff / 0 for the spill byte. F = 0 handlers do not add the row skip DS:5068 (it is 0 there).
function spriteRows(es,ds,si,bp,di,cl,dh,s,F){
 const b=2*s;
 do{
  const row=di;
  if(s===0){
   let ch=dh;
   do{const m=mrd(ds,bp);bp=u16(bp+1);mwr(es,di,mrd(es,di)&m);const d=mrd(ds,si);si=u16(si+1);mwr(es,di,mrd(es,di)|d);di=u16(di+1);ch=ch-1&0xff;}while(ch);
  }else{
   let bh=0xff,bl=0;
   if(F&1){bh=mrd(ds,bp-1);bl=mrd(ds,si-1);}
   let ch=dh;
   for(;;){
    ch=ch-1&0xff;if(ch&0x80)break;                  // DEC CH; JL (signed)
    let dl=mrd(es,di);
    let al=mrd(ds,bp);bp=u16(bp+1);
    let ah=bh;bh=al;
    dl&=((ah<<8|al)>>b)&0xff;
    al=mrd(ds,si);si=u16(si+1);
    ah=bl;bl=al;
    dl|=((ah<<8|al)>>b)&0xff;
    mwr(es,di,dl);di=u16(di+1);
   }
   let dl=mrd(es,di);
   let al=F&2?mrd(ds,bp):0xff;
   dl&=((bh<<8|al)>>b)&0xff;
   al=F&2?mrd(ds,si):0;
   dl|=((bl<<8|al)>>b)&0xff;
   mwr(es,di,dl);
  }
  di=row;
  cl=cl-1&0xff;
  if(!cl)return;
  if(s===0||F){const k=rw(0x5068);si=u16(si+k);bp=u16(bp+k);}
  di=nextRow(di);
 }while(true);
}
const body=(s,F)=>(es,ds,si,bp,di,cl,dh)=>spriteRows(es,ds,si,bp,di,cl,dh,s,F);
export const f2fd2_11eb=body(0,0),f2fd2_0ce3=body(1,0),f2fd2_0d40=body(2,0),f2fd2_0dad=body(3,0);
export const f2fd2_0e0a=body(1,1),f2fd2_0e73=body(2,1),f2fd2_0eec=body(3,1);
export const f2fd2_0f55=body(1,2),f2fd2_0fbc=body(2,2),f2fd2_1033=body(3,2);
export const f2fd2_109a=body(1,3),f2fd2_1105=body(2,3),f2fd2_1180=body(3,3);
const spriteBodies={0x11eb:f2fd2_11eb,0x0ce3:f2fd2_0ce3,0x0d40:f2fd2_0d40,0x0dad:f2fd2_0dad,0x0e0a:f2fd2_0e0a,0x0e73:f2fd2_0e73,0x0eec:f2fd2_0eec,
 0x0f55:f2fd2_0f55,0x0fbc:f2fd2_0fbc,0x1033:f2fd2_1033,0x109a:f2fd2_109a,0x1105:f2fd2_1105,0x1180:f2fd2_1180};

// ---- rectangle copies ----
// 2fd2:1224 cgaCopyRect(x,y,w,h) (slot 4; falls through into 2fd2:1250): bytes (x>>2) .. ((x+w+3)>>2)-1 of rows y..y+h-1, [3856] -> [3858].
// An odd byte count copies the extra byte with MOVSB. h = 0 copies 65536 rows. No clipping.
export function f2fd2_1224(x,y,w,h){
 x=u16(x);y=u16(y);w=u16(w);h=u16(h);
 let bx=u16(u16(w+x)+3)&0xfffc,ax=x&0xfffc;
 bx=u16(bx-ax)>>2;ax>>=2;
 return f2fd2_1250(y,bx,ax,h);
}
// 2fd2:1250 (internal; BP = y, BX = byte count, AX/SI = first byte column, DX = rows): the row loop of slot 4.
export function f2fd2_1250(y,bx,ax,dx){
 let bp=u16(u16(y<<1)+0x3d3e);
 const es=rw(0x3858),ds=rw(0x3856);
 const odd=bx&1;bx>>=1;
 do{
  let di=u16(rw(bp)+ax),si=di;
  for(let cx=bx;cx;cx--){mww(es,di,mrw(ds,si));di=u16(di+2);si=u16(si+2);}
  if(odd){mwr(es,di,mrd(ds,si));}
  bp=u16(bp+2);dx=u16(dx-1);
 }while(dx);
}
// 2fd2:128f cgaSaveRect(off,seg,x,y,w,h) (slot 5): rows y.. of [3856], bytes (x>>2) .. ((x+w)>>2) (one more than needed when x+w is a
// multiple of 4), rounded up to words, appended to the buffer seg:off (rows of 2*words bytes).
export function f2fd2_128f(off,seg,x,y,w,h){
 let di=off&0xf,es=u16((off>>4)+seg);
 let si=u16(x),ax=si;si>>=2;
 let bx=u16(u16(w+ax)>>2);bx=u16(bx-si+1);
 const odd=bx&1;bx>>=1;if(odd)bx++;
 let dx=u16(h),bp=u16(u16(y<<1)+0x3d3e);
 const ds=rw(0x3856);ax=si;
 do{
  let s=u16(rw(bp)+ax);
  for(let cx=bx;cx;cx--){mww(es,di,mrw(ds,s));di=u16(di+2);s=u16(s+2);}
  bp=u16(bp+2);dx=u16(dx-1);
 }while(dx);
}
// 2fd2:12f2 cgaSaveRectSize(w,h) (slot 6): h * (even-rounded (w>>2) + 1 + (w&3 ? 1 : 0)), DX:AX.
export function f2fd2_12f2(w,h){
 w=u16(w);let bx=(w>>2)+1;if(w&3)bx++;if(bx&1)bx++;
 return (u16(h)*bx)>>>0;
}
// 2fd2:1313 cgaRestoreRect(off,seg,x,y,w,h) (slot 7): the inverse of f2fd2_128f, into [3858].
export function f2fd2_1313(off,seg,x,y,w,h){
 let si=off&0xf,ds=u16((off>>4)+seg);
 let di=u16(x),ax=di;di>>=2;
 let bx=u16(u16(w+ax)>>2);bx=u16(bx-di+1);
 const odd=bx&1;bx>>=1;if(odd)bx++;
 let dx=u16(h),bp=u16(u16(y<<1)+0x3d3e);
 const es=rw(0x3858);ax=di;
 do{
  let d=u16(rw(bp)+ax);
  for(let cx=bx;cx;cx--){mww(es,d,mrw(ds,si));d=u16(d+2);si=u16(si+2);}
  bp=u16(bp+2);dx=u16(dx-1);
 }while(dx);
}
// 2fd2:13cd cgaPresentRect(x,y,w,h) (slot 9): copies whole words of the rows y.. from the back page [3852] to the displayed page
// [3854]: byte columns (x>>2) .. ((x+w)>>2) (one more unless that is 80), rounded up to an even count. No clipping.
export function f2fd2_13cd(x,y,w,h){
 let si=u16(x),ax=si;si>>=2;
 let bx=u16(u16(w+ax)>>2);bx=u16(bx-si);
 if(bx!==0x50)bx=u16(bx+1);
 const odd=bx&1;bx>>=1;if(odd)bx++;
 let dx=u16(h),bp=u16(u16(y<<1)+0x3d3e);
 const es=rw(0x3854),ds=rw(0x3852);ax=si;
 do{
  let di=u16(rw(bp)+ax),s=di;
  for(let cx=bx;cx;cx--){mww(es,di,mrw(ds,s));di=u16(di+2);s=u16(s+2);}
  bp=u16(bp+2);dx=u16(dx-1);
 }while(dx);
}

// ---- pixels ----
// 2fd2:13a9 pixelAddr (near; AX = y, BX = x): BX = byte offset of the pixel in the page [3858] (0x2000 * (y&1) + 80 * (y>>1) + (x>>2) for
// y < 256), AH = 3, CL = 2 * (3 - (x&3)) the shift of the pixel in its byte, ES = [3858]. Returns {bx, cl, ah, es}.
export function f2fd2_13a9(ax,bx){
 ax=u16(ax);bx=u16(bx);
 let cl=bx&0xff;
 ax=swap(ax)>>1;                                    // XCHG AH,AL; SHR AX,1
 bx=bx&0xff|((bx>>8)+(ax&0xff)&0xff)<<8;            // ADD BH,AL
 ax&=0xff00;                                        // XOR AL,AL
 bx=u16(bx+ax);
 ax>>=2;bx=u16(bx+ax);
 bx>>=2;
 return {bx,cl:(((cl&3)^3)<<1)&0xff,ah:3,es:rw(0x3858)};
}
// 2fd2:1377 cgaGetPixel(x,y) (slot 21): the 2-bit pixel from the page [3858].
export function f2fd2_1377(x,y){
 const r=f2fd2_13a9(y,x);
 return (mrd(r.es,r.bx)>>r.cl)&r.ah;
}
// 2fd2:138e cgaPutPixel(x,y,c) (slot 22): replaces the pixel with the low bits of c shifted into place (16-bit SHL AX,CL).
// QUIRK: a colour above 3 spills into neighbouring pixels of the byte (and into AH, which becomes the keep mask).
export function f2fd2_138e(x,y,c){
 const r=f2fd2_13a9(y,x);
 const ax=((r.ah<<8|c&0xff)<<r.cl)&0xffff;
 const keep=~(ax>>8)&0xff;
 mwr(r.es,r.bx,mrd(r.es,r.bx)&keep);
 mwr(r.es,r.bx,mrd(r.es,r.bx)|ax&0xff);
}

// ---- slots 10, 11: horizontal span ----
// 2fd2:1427 cgaHSpanDither(ax,bx,cx,dx,di,es) (slot 11): toggles DS:386a; when the new value is non-zero AX = DX (the second
// dither word), then the solid span below.
export function f2fd2_1427(ax,bx,cx,dx,di,es){
 const v=rw(0x386a)^1;ww(0x386a,v);
 if(v)ax=dx;
 return f2fd2_1430(ax,bx,cx,dx,di,es);
}
// 2fd2:1430 cgaHSpanSolid(ax,bx,cx,dx,di,es) (slot 10): pixels x .. x+cx-1 of the row at ES:DI in the colour word AX (low byte
// for the first byte, the word for whole words, alternate bytes continue the pattern); cx <= 0 draws nothing.
// Tables DS:508a (pixels kept left of the start: 00 c0 f0 fc) and DS:508e (pixels from index i on: ff 3f 0f 03).
export function f2fd2_1430(ax,bx,cx,dx,di,es){
 ax=u16(ax);bx=u16(bx);cx=u16(cx);di=u16(di);
 if(s16(cx)<=0)return;
 dx=ax;                                              // colour word
 di=u16(di+(bx>>2));bx&=3;
 ax=dx;dx=u16(bx+cx);
 if(s16(dx)<4){
  let ah=rb(0x508a+bx)|rb(0x508e+dx);
  const al=mrd(es,di)&ah;ah^=0xff;
  mwr(es,di,al|(ax&0xff)&ah);
  return;
 }
 dx=u16(4-bx);cx=u16(cx-dx);dx=ax;
 {
  const al=mrd(es,di)&rb(0x508a+bx);
  mwr(es,di,al|(dx&0xff)&rb(0x508e+bx));di=u16(di+1);
 }
 dx=cx;cx&=0xfff8;
 if(cx){for(cx>>=3;cx;cx--){mww(es,di,ax);di=u16(di+2);}}
 cx=dx&4;
 if(cx){mwr(es,di,ax&0xff);di=u16(di+1);}
 cx=dx&3;
 if(cx){
  const ah=rb(0x508e+cx);
  mwr(es,di,mrd(es,di)&ah|(ax&0xff)&rb(0x508a+cx));
 }
}

// ---- slot 12: font data ----
// 2fd2:14c5 cgaLoadFontData(fp,i) (slot 12): font slot i has width [3874+i], height [3888+i], count [38b0+i]. Allocates
// (ceil(w/4) * h) * count bytes through 1ff8:3a88 (stored in [38c4+2i] and [5095]) and reads the 1 bpp file glyphs (each row
// ceil(w/8) bytes, fread byte by byte into DS:5092) as 2 bpp: a set bit becomes 11 in the pixel's slot of its output byte, every row
// starts a fresh output byte. Returns i, or 0 when the allocation fails.
// QUIRK: the byte count uses two 8-bit MULs (the second takes the low byte of the first product); DS:5093 holds that count and is
// later overwritten with CL (UNKNOWN: CH is a leftover of the caller, stored as 0 here; the value is dead).
export function f2fd2_14c5(fp,i){
 const si=u16(i);
 let dl=rb(si+0x3874)>>2;if(rb(si+0x3874)&3)dl=dl+1&0xff;
 let ax=rb(si+0x3888)*dl;
 ax=(ax&0xff)*rb(si+0x38b0);
 ww(0x5093,ax);
 const p=F.f1ff8_3a88(ax,0)>>>0;
 const seg=p>>>16;
 if(!seg&&!(p&0xffff))return 0;
 ww(u16((si<<1)+0x38c4),seg);ww(0x5095,seg);
 let di=0,bp=rw(0x5093);
 outer:for(;;){
  F.f1000_c214(0x5092,1,1,fp);
  let dlp=0xc0,dh=0x80,ah=rb(0x5092),al=0,cl=rb(si+0x3874);
  for(;;){
   if(dh&ah)al|=dlp;
   cl=cl-1&0xff;
   if(!cl){mwr(rw(0x5095),di,al);di=u16(di+1);bp=u16(bp-1);if(bp)continue outer;break outer;}
   const c=dlp>>1&1;dlp=ror8(dlp,2);
   if(c){mwr(rw(0x5095),di,al);di=u16(di+1);bp=u16(bp-1);if(!bp)break outer;al=0;}
   const c2=dh&1;dh=ror8(dh,1);
   // QUIRK: the mid-row fread clobbers AL with its return value (1 item read), which stays in the output byte under construction
   if(c2){ww(0x5093,cl);al=F.f1000_c214(0x5092,1,1,fp)&0xff;dlp=0xc0;dh=0x80;ah=rb(0x5092);}
  }
 }
 return si;
}

// ---- slots 13, 14: sprite groups ----
// 2fd2:167e cgaSpriteBytesNeeded(list,pExtra) (slot 13): list = near ptr to a zero-terminated word list of sprite headers (w at +6,
// h at +8). Returns DX:AX = sum of (w>>1) * h over the sprites (16-bit adds with carry into DX; the high word of each MUL is dropped)
// and stores the largest single product (signed word compare) at DS:pExtra.
export function f2fd2_167e(list,pExtra){
 let di=u16(list),bx=0,cx=0,max=0;
 for(;;){
  const si=rw(di);if(!si)break;
  const ax=((rw(si+6)>>1)*rw(si+8))&0xffff;
  if(s16(ax)>s16(max))max=ax;
  bx+=ax;if(bx>0xffff){bx&=0xffff;cx++;}
  di=u16(di+2);
 }
 ww(u16(pExtra),max);
 return (cx<<16|bx)>>>0;
}
// 2fd2:1572 cgaConvertSprites(list,off,seg,szLo,szHi,auxOff,auxSeg) (slot 14): for each sprite header (near ptrs in `list`, zero
// terminated): stores seg/off at +0/+2, copies (w/2)*h packed 4 bpp bytes to the aux buffer, converts them in place to 2 bpp data
// of half the size (f2fd2_014e, parity 0), stores the mask offset (data off + half) at +4 and builds the mask behind the data
// (f2fd2_01e9). The destination pointer advances by 2*half (huge-pointer style: carry into the segment), then is normalised.
export function f2fd2_1572(list,off,seg,szLo,szHi,auxOff,auxSeg){
 list=u16(list);off=u16(off);seg=u16(seg);
 const adv=n=>{const o=off+n;off=u16(o);if(o>0xffff)seg=u16(seg+0x1000);};
 for(;;){
  const si=rw(list);list=u16(list+2);
  if(!si)break;
  ww(si,seg);ww(si+2,off);
  const cnt=(s16(rw(si+6))>>1)*s16(rw(si+8))&0xffff;
  for(let i=0;i<cnt;i++){const sl=(seg<<4)+off+i;mwr(auxSeg,u16(auxOff+i),mrd(u16(sl>>4),sl&0xf));}
  let half=cnt>>1;
  ww(si+4,u16(off+half));
  f2fd2_014e(off,seg,auxOff,auxSeg,rw(si+6),rw(si+8),0);
  adv(half);
  f2fd2_01e9(off,seg,auxOff,auxSeg,half);
  adv(half);
  seg=u16(seg+(off>>4));off&=0xf;
 }
}

// ---- slot 17: packed blit ----
// 2fd2:16c5 cgaBlitPacked(srcOff,srcSeg,x,y,w,h) (slot 17): h rows of w 4 bpp pixels (w/2 source bytes each, consecutive from
// srcSeg:srcOff) are dithered to 2 bpp by f2fd2_00be into the page [3858] at byte column x>>2; the row parity comes from y.
// h = 0 draws 65536 rows. Only whole destination bytes (x, w multiples of 4) are meaningful.
export function f2fd2_16c5(srcOff,srcSeg,x,y,w,h){
 const w4=u16(w)>>2,x4=u16(x)>>2;
 let si=srcOff&0xf;const ds=u16((srcOff>>4)+srcSeg);
 y=u16(y);h=u16(h);
 do{
  const es=rw(0x3858);
  const di=u16(rowOff(y)+x4);
  const r=f2fd2_00be(ds,si,es,di,w4,y);si=r.si;
  y=u16(y+1);h=u16(h-1);
 }while(h);
}

// ---- slot 27: span list ----
// 2fd2:1746 cgaFillSpans(si) (slot 27): SI = near ptr to {y, count, (x1,x2) x count}; span i fills pixels x1..x2 of row y+i on [3858]
// (spans with x2 < x1 are skipped). The colour words are DS:41a4[[384d]] (stored in [3864]) and DS:4424[[384d]] (stored in
// [3866]); when they differ the rows alternate: even rows take [3864], odd rows [3866] (2fd2:1810), else every row takes
// [3864]. Left/right edge masks DS:509c (00 c0 f0 fc) / 50a0 (ff 3f 0f 03). DS:50a4 is the remaining span count.
export function f2fd2_1746(si){
 si=u16(si);
 const es=rw(0x3858);
 const nx=()=>{const v=rw(si);si=u16(si+2);return v;};
 let bp=u16(nx()<<1);
 ww(0x50a4,nx());
 const bx0=rb(0x384d)<<1;
 const w0=rw(u16(bx0+0x41a4));ww(0x3864,w0);
 const w1=rw(u16(bx0+0x4424));
 const dither=w1!==w0;
 if(dither)ww(0x3866,w1);
 for(;;){
  const x1=nx(),x2=nx();
  const colour=dither&&(bp>>1&1)?w1:w0;
  if(s16(x2)>=s16(x1)){
   let cx=u16(u16(x2-x1)+1),di=u16(rw(u16(bp+0x3d3e))+(x1>>2)); // BP = 2*y indexes the row table directly
   let bx=x1&3,dx=u16(bx+cx);
   const ax=colour;
   if(s16(dx)<4){
    let ah=rb(0x509c+bx)|rb(0x50a0+dx);
    const al=mrd(es,di)&ah;ah^=0xff;
    mwr(es,di,al|(ax&0xff)&ah);
   }else{
    dx=u16(4-bx);cx=u16(cx-dx);
    {const ah=rb(0x509c+bx);mwr(es,di,mrd(es,di)&ah|(ax&0xff)&(ah^0xff));di=u16(di+1);}
    dx=cx;
    for(cx>>=3;cx;cx--){mww(es,di,ax);di=u16(di+2);}
    cx=dx&4;
    if(cx){mwr(es,di,ax&0xff);di=u16(di+1);}
    dx&=3;
    if(dx){const ah=rb(0x50a0+dx);mwr(es,di,mrd(es,di)&ah|(ax&0xff)&(ah^0xff));}
   }
  }
  const left=rw(0x50a4);ww(0x50a4,u16(left-1));
  if(jle(left,1))return;                             // SUB [50a4],1; JNG
  bp=u16(bp+2);
 }
}

// ---- dissolve, CGA unit handlers (1ff8:44b4 slot 23, adapter 1) ----
// 1ff8:457d..45af selects, for a unit of 2^shift pixels: the handler DS:4d5c[shift] (4652 pixel, 4654 pixel pair, 464b byte, 4642 word),
// the in-unit index mask 3 >> shift and the pixel mask table DS:4d7b + 4*shift (c0 30 0c 03 | f0 0f | ... ). The handler copies the unit
// (bit-masked for sub-byte units) from the source page [3856] to the displayed page [3854] at the same offset.
// cgaDissolveSetup(shift) -> {umask, base, handler}; cgaDissolvePlot(h, a, y, ...) is one unit at row `r`, unit column `a`.
export function cgaDissolveSetup(shift){
 return {umask:3>>shift,base:u16(0x4d7b+(shift<<2)),handler:rw(u16(0x4d5c+(shift<<1)))};
}
// BL/BH are the LFSR state bytes, xs = x >> shift, y = rectangle top; handler/umask/base from cgaDissolveSetup.
export function cgaDissolvePlot(BL,BH,y,xs,s){
 const r=y&0xff00|(y+BH)&0xff;                      // MOV AX,y; ADD AL,BH (8-bit)
 let si=rw(u16((r<<1)+0x3d3e));
 let a=u16(BL+xs);
 const bp=u16((a&s.umask)+s.base);
 const es=rw(0x3854),ds=rw(0x3856);
 switch(s.handler){
  case 0x4652:case 0x4654:{
   a>>=s.handler===0x4652?2:1;
   si=u16(si+a);
   const m=rb(bp);
   const g=mrd(ds,si);
   mwr(es,si,g&m|mrd(es,si)&(m^0xff));
   return;
  }
  case 0x464b:si=u16(si+a);mwr(es,si,mrd(ds,si));return;
  case 0x4642:a=u16(a<<1);si=u16(si+a);mww(es,si,mrw(ds,si));return;
  default:return unsupported(`1ff8:4607 dissolve handler 1ff8:${s.handler.toString(16)}`);
 }
}

// ---- far-pointer slots (DS:4e3c table entries copied into DS:4924) ----
register(0x2fd2,0x0252,f2fd2_0252);
register(0x2fd2,0x0318,f2fd2_0318);
register(0x2fd2,0x05dc,f2fd2_05dc);
register(0x2fd2,0x0b87,f2fd2_0b87);
register(0x2fd2,0x1224,f2fd2_1224);
register(0x2fd2,0x128f,f2fd2_128f);
register(0x2fd2,0x12f2,f2fd2_12f2);
register(0x2fd2,0x1313,f2fd2_1313);
register(0x2fd2,0x0251,f2fd2_0251);
register(0x2fd2,0x13cd,f2fd2_13cd);
register(0x2fd2,0x1430,f2fd2_1430);
register(0x2fd2,0x1427,f2fd2_1427);
register(0x2fd2,0x14c5,f2fd2_14c5);
register(0x2fd2,0x167e,f2fd2_167e);
register(0x2fd2,0x1572,f2fd2_1572);
register(0x2fd2,0x16c5,f2fd2_16c5);
register(0x2fd2,0x0004,f2fd2_0004);
register(0x2fd2,0x0071,f2fd2_0071);
register(0x2fd2,0x1377,f2fd2_1377);
register(0x2fd2,0x138e,f2fd2_138e);
register(0x2fd2,0x1734,f2fd2_1734);
register(0x2fd2,0x1745,f2fd2_1745);
register(0x2fd2,0x1746,f2fd2_1746);

provide({f2fd2_0004,f2fd2_0071,f2fd2_00be,f2fd2_014e,f2fd2_01e9,f2fd2_0251,f2fd2_0252,f2fd2_0318,f2fd2_05dc,f2fd2_0b87,
 f2fd2_0ce3,f2fd2_0d40,f2fd2_0dad,f2fd2_0e0a,f2fd2_0e73,f2fd2_0eec,f2fd2_0f55,f2fd2_0fbc,f2fd2_1033,f2fd2_109a,f2fd2_1105,f2fd2_1180,
 f2fd2_11eb,f2fd2_1224,f2fd2_1250,f2fd2_128f,f2fd2_12f2,f2fd2_1313,f2fd2_1377,f2fd2_138e,f2fd2_13a9,f2fd2_13cd,f2fd2_1427,
 f2fd2_1430,f2fd2_14c5,f2fd2_1572,f2fd2_167e,f2fd2_16c5,f2fd2_1734,f2fd2_1745,f2fd2_1746});
export {f2fd2_0252 as cgaInit,f2fd2_0318 as cgaDrawGlyph,f2fd2_05dc as cgaLine,f2fd2_0b87 as cgaDrawSprite,f2fd2_1224 as cgaCopyRect,
 f2fd2_128f as cgaSaveRect,f2fd2_12f2 as cgaSaveRectSize,f2fd2_1313 as cgaRestoreRect,f2fd2_13cd as cgaPresentRect,
 f2fd2_1430 as cgaHSpanSolid,f2fd2_1427 as cgaHSpanDither,f2fd2_14c5 as cgaLoadFontData,f2fd2_167e as cgaSpriteBytesNeeded,
 f2fd2_1572 as cgaConvertSprites,f2fd2_16c5 as cgaBlitPacked,f2fd2_0004 as cgaReadPalette,f2fd2_0071 as cgaSetPalette,
 f2fd2_1377 as cgaGetPixel,f2fd2_138e as cgaPutPixel,f2fd2_1746 as cgaFillSpans};
