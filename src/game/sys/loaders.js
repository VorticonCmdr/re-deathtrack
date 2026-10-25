// Segment 1ff8 resource loaders: bitmap groups (0006) and their registry, full-screen pictures (2fca), fonts (356e-37ec)
// and palettes (3b7a-3cce). Static, from the raw-byte disassembly. Loaders take `fpOrName`: an open chunk FILE* is used
// in place (and left open), anything else is opened with chunkOpen and closed at the end.
import {rb,rw,wb,ww,salloc,sfree,DGROUP} from '../../engine/mem.js';
import {u16} from '../../engine/int.js';
import {callFar,unsupported} from '../../engine/host.js';
import {F,provide} from '../link.js';
import {f1ff8_3a88,f1ff8_3ae2} from './farmem.js';
import {f1ff8_4a48,f1ff8_4ade,f1ff8_4d72,f1ff8_4da4,f1ff8_4de0} from './chunk.js';
import {f1ff8_0d47,f1ff8_11f0,f1ff8_1310,f1ff8_100d} from './stream.js';
import {f1ff8_52b1,f1ff8_5282,f1ff8_5286} from './draw.js';

const slot=n=>rd32(0x4924+4*n);
import {rd as rd32} from '../../engine/mem.js';
const isFail=v=>(v>>>0)===0xffffffff;
const lo=v=>v&0xffff, hi=v=>v>>>16;

// 1ff8:0006 loadBitmap(fpOrName): BMP:INF: (u16 N, N widths, N heights) into a near handle h (N+1 pointers, h[N]=0) and
// N 10-byte records; driver slot 13 sizes the converted data; BMP:BIN: is decoded into a DOS block in 0x7fff-byte steps;
// slot 14 converts in place. Returns h or 0.
export function f1ff8_0006(arg){
 const fr=salloc(0x1c),N=fr,extra=fr+2; // [bp-4] count, [bp-0x1a] extra size (address-taken locals)
 try{
  let ok=0,h=0,pix=0,aux=0,strm=0,opened=0,total=0;
  const idx=f1ff8_04c6();
  fail:{
   if(idx&0x8000){
    // QUIRK: the original then tests the "opened" flag [bp-2] before writing it (stale stack). APPROX: taken as 0.
    break fail;
   }
   if(!f1ff8_4de0(arg)){opened=1;arg=f1ff8_4a48(arg);}
   if(isFail(f1ff8_4ade(arg,0x2bce,0)))break fail;               // "BMP:INF:"
   if(u16(F.f1000_c214(N,2,1,arg))!==1)break fail;
   const n=rw(N);
   h=u16(F.f1000_c272(u16(2*n+2)));if(!h)break fail;
   const rec=u16(F.f1000_c272(u16(n*10)));ww(h,rec);if(!rec)break fail;
   if((n<<16>>16)>0){
    for(let i=0;i<(n<<16>>16);i++){
     if(u16(F.f1000_c214(u16(rw(h+2*i)+6),2,1,arg))!==1)break fail;
     ww(h+2*(i+1),u16(rw(h)+10*(i+1)));
    }
    for(let i=0;i<(n<<16>>16);i++)if(u16(F.f1000_c214(u16(rw(h+2*i)+8),2,1,arg))!==1)break fail;
   }
   ww(h+2*n,0);
   total=callFar(slot(13),h,extra)>>>0;
   pix=f1ff8_3a88(lo(total),hi(total),0);if(!pix)break fail;
   if(rw(extra)){const e=rw(extra);aux=f1ff8_3a88(e,e&0x8000?0xffff:0,0);if(!aux)break fail;}
   if(isFail(f1ff8_4ade(arg,0x2bd7,0)))break fail;               // "BMP:BIN:"
   const cl=f1ff8_4d72(arg);
   // QUIRK: the handle variable receives (open failed ? 1 : 0), so stream handle 0 is used; it is the handle
   // streamOpenFile returned whenever no other stream is open.
   strm=(f1ff8_0d47(0,arg,0x2be0,lo(cl),hi(cl))&0x8000)?1:0;
   if(strm)break fail;
   let dOff=lo(pix),dSeg=hi(pix);
   for(;;){
    if(f1ff8_11f0(strm,dOff,dSeg,0x7fff)!==0x7fff)break;
    const o=dOff+0x7fff;dOff=u16(o);if(o>0xffff)dSeg=u16(dSeg+0x1000);
   }
   const sz=f1ff8_1310(strm);
   callFar(slot(14),h,lo(pix),hi(pix),lo(sz),hi(sz),lo(aux),hi(aux),lo(total),hi(total));
   f1ff8_100d(strm);
   ok=1;
   if(rb(0x385f))unsupported('1ff8:0006 BMP:VGA: chunk');
   f1ff8_052a(h,n,idx);
  }
  if(aux)f1ff8_3ae2(lo(aux),hi(aux));
  if(!ok){
   if(pix)f1ff8_3ae2(lo(pix),hi(pix));
   if(strm)f1ff8_100d(strm);
   f1ff8_044c(h);
   h=0;
  }
  if(opened)f1ff8_4da4(arg);
  return h;
 }finally{sfree(0x1c);}
}
// 1ff8:044c bitmapFreeHeader(h): free(h[0]) if non-zero, then free(h) if non-zero.
// QUIRK: with h = 0 it reads h[0] from DS:0000.
export function f1ff8_044c(h){const r=rw(h);if(r)F.f1000_c280(r);if(h)F.f1000_c280(h);}
// 1ff8:0476 freeBitmap(h): if registered: unregister, DosFree(frame 0's +2 offset, +0 segment), free the header.
export function f1ff8_0476(h){
 if(!f1ff8_0590(h))return;
 f1ff8_04e8(h);const r=rw(h);f1ff8_3ae2(rw(r+2),rw(r));f1ff8_044c(h);
}
// 1ff8:04c6 bitmapSlotFree(): highest i (39..0) with DS:5af4[i] == 0, or -1.
export function f1ff8_04c6(){for(let i=39;i>=0;i--)if(!rw(0x5af4+2*i))return i;return 0xffff;}
// 1ff8:04e8 bitmapUnreg(h): clears the registry entry holding h.
export function f1ff8_04e8(h){
 if(!h)return;for(let i=39;i>=0;i--)if(rw(0x5b44+2*i)===u16(h)){ww(0x5b44+2*i,0);ww(0x5af4+2*i,0);return 0;}
 return u16(h);
}
// 1ff8:052a bitmapReg(h, count, idx): DS:5af4[idx] = count, DS:5b44[idx] = h (when h != 0).
export function f1ff8_052a(h,count,idx){if(!h)return;ww(0x5af4+2*idx,count);ww(0x5b44+2*idx,h);}
// 1ff8:054a bitmapCount(h): the frame count registered with h, or 0. No callers (static).
export function f1ff8_054a(h){if(!h)return 0;for(let i=39;i>=0;i--)if(rw(0x5b44+2*i)===u16(h))return rw(0x5af4+2*i);return 0;}
// 1ff8:0590 bitmapIsReg(h): 1 if h is in the registry.
export function f1ff8_0590(h){if(!h)return 0;for(let i=39;i>=0;i--)if(rw(0x5b44+2*i)===u16(h))return 1;return 0;}

// 1ff8:2fca loadScreen(fpOrName): SCR:BIN: decoded in bands through a near buffer (0xc80 bytes, halved until malloc
// succeeds) and drawn with slot 17 (stub 5282) at x=0, w=320. Returns 1 or 0.
export function f1ff8_2fca(arg){
 f1ff8_52b1();
 let res=0,opened=0;
 if(!f1ff8_4de0(arg)){opened=1;arg=f1ff8_4a48(arg);}
 body:{
  if(isFail(f1ff8_4ade(arg,0x49d6,0)))break body;                // "SCR:BIN:"
  const cl=f1ff8_4d72(arg);
  let s=f1ff8_0d47(0,arg,0x49df,lo(cl),hi(cl));
  if(s&0x8000)break body;
  let size=0xc80,buf;
  for(;;){buf=u16(F.f1000_c272(size));if(buf)break;size>>>=1;if(!size)break;}
  if(buf){
   const rows=Math.floor(size/0xa0);
   if(!rows)unsupported('1ff8:2fca band of 0 rows (endless loop in the original)');
   for(let y=0;(y<<16>>16)<0xc8;y=u16(y+rows)){f1ff8_11f0(s,buf,DGROUP,size);f1ff8_5282(buf,DGROUP,0,y,0x140,rows);}
   if(rb(0x385f)){unsupported('1ff8:2fca SCR:VGA: chunk');void f1ff8_5286;}
   F.f1000_c280(buf);
   res=1;
  }
  f1ff8_100d(s);
 }
 if(opened)f1ff8_4da4(arg);
 return res;
}

// 1ff8:356e loadFont(fpOrName): first free font slot 1..19, default extension ".fnt", chunk named by DS:4b2e ("FNT:"),
// 4 header bytes (w, h, first, count) into the slot tables, then slot 12 reads the glyphs. Returns the slot or 0.
export function f1ff8_356e(arg){
 let i=1;for(;rw(0x38c4+2*i)&&i<0x14;i++);
 if(i>=0x14)return 0;
 const buf=salloc(0x50);
 try{
  let opened=0;
  if(!f1ff8_4de0(arg)){
   opened=1;F.f1000_c2ce(buf,arg);
   if(!u16(F.f1000_c2f6(buf,0x2e)))F.f1000_c298(buf,0x4b29);
   arg=f1ff8_4a48(buf);
  }
  if(!isFail(f1ff8_4ade(arg,rw(0x4b2e),0))&&u16(F.f1000_c214(buf,1,4,arg))===4){
   wb(0x3874+i,rb(buf));wb(0x3888+i,rb(buf+1));wb(0x389c+i,rb(buf+2));wb(0x38b0+i,rb(buf+3));
   i=u16(callFar(slot(12),arg,i,buf));
  }else i=0;
  if(opened)f1ff8_4da4(arg);
  return i;
 }finally{sfree(0x50);}
}
// 1ff8:3692 selectFont(n): n = 0 returns the slot whose segment equals the current one (QUIRK: 20 when none matches,
// 0 when no font is current); a valid n is copied into slot 0 and returned; otherwise 0.
export function f1ff8_3692(n){
 if(!n){
  const cur=rw(0x38c4);if(!cur)return 0;
  let i=1;for(;i<0x14;i++)if(rw(0x38c4+2*i)===cur)break;
  return i;
 }
 if(!f1ff8_37ec(n))return 0;
 wb(0x3874,rb(0x3874+n));wb(0x3888,rb(0x3888+n));wb(0x389c,rb(0x389c+n));wb(0x38b0,rb(0x38b0+n));
 ww(0x38c4,rw(0x38c4+2*n));
 return n;
}
// 1ff8:3722 freeFont(n): clears slot 0 when n is current, DosFree(0, seg), clears the slot.
export function f1ff8_3722(n){
 if(!f1ff8_37ec(n))return;
 if(rw(0x38c4+2*n)===rw(0x38c4)){wb(0x38b0,0);wb(0x389c,0);wb(0x3888,0);wb(0x3874,0);ww(0x38c4,0);}
 f1ff8_3ae2(0,rw(0x38c4+2*n));ww(0x38c4+2*n,0);
}
// 1ff8:3784 fontWidth(n) / 1ff8:37b8 fontHeight(n): n = 0 or a valid slot returns its byte, else 0. No callers (static).
export function f1ff8_3784(n){return (f1ff8_37ec(n)||!n)?rb(0x3874+n):0;}
export function f1ff8_37b8(n){return (f1ff8_37ec(n)||!n)?rb(0x3888+n):0;}
// 1ff8:37ec fontValid(n) (near): 0 < n < 20 (signed) and DS:38c4[n] != 0.
export function f1ff8_37ec(n){n=n<<16>>16;return n>0&&n<0x14&&rw(0x38c4+2*n)?1:0;}

// 1ff8:3b7a loadPalette(fpOrName): first free palette slot 1..9, default extension ".pal", chunk DS:4b86[[385d]]
// ("PAL:EGA:" for adapter 2), then slot 19 reads it. DS:4186[result] = result.
// QUIRK: every failure stores 0 into DS:4186 (the current-palette byte).
export function f1ff8_3b7a(arg){
 let i=1;for(;rb(0x4186+i)&&i<0xa;i++);
 if(i>=0xa){wb(0x4186,0);return 0;}
 const buf=salloc(0x50);
 try{
  let opened=0;
  if(!f1ff8_4de0(arg)){
   opened=1;F.f1000_c2ce(buf,arg);
   if(!u16(F.f1000_c2f6(buf,0x2e)))F.f1000_c298(buf,0x4b81);
   arg=f1ff8_4a48(buf);
  }
  const tag=rw(0x4b86+2*(rb(0x385d)<<24>>24));
  if(!isFail(f1ff8_4ade(arg,tag,0)))i=u16(callFar(slot(19),arg,i));else i=0;
  if(opened)f1ff8_4da4(arg);
  wb(0x4186+i,i);
  return i;
 }finally{sfree(0x50);}
}
// 1ff8:3c64 setPalette(n): n = 0 returns (s8)DS:4186; a valid n is activated with slot 20 and becomes current; else 0.
export function f1ff8_3c64(n){
 if(!n)return u16(rb(0x4186)<<24>>24);
 if(!f1ff8_3cce(n))return 0;
 callFar(slot(20),n);wb(0x4186,n);return n;
}
// 1ff8:3ca6 freePalette(n): clears slot n, and the current byte when it equals n.
export function f1ff8_3ca6(n){
 if(!f1ff8_3cce(n))return;
 if((n<<16>>16)===(rb(0x4186)<<24>>24))wb(0x4186,0);
 wb(0x4186+n,0);
}
// 1ff8:3cce paletteValid(n) (near): 0 < n < 10 (signed) and DS:4186[n] != 0.
export function f1ff8_3cce(n){n=n<<16>>16;return n>0&&n<0xa&&rb(0x4186+n)?1:0;}

export {f1ff8_0006 as loadBitmap,f1ff8_0476 as freeBitmap,f1ff8_2fca as loadScreen,f1ff8_356e as loadFont,
 f1ff8_3692 as selectFont,f1ff8_3b7a as loadPalette,f1ff8_3c64 as setPalette};
provide({f1ff8_0006,f1ff8_044c,f1ff8_0476,f1ff8_04c6,f1ff8_04e8,f1ff8_052a,f1ff8_054a,f1ff8_0590,f1ff8_2fca,f1ff8_356e,
 f1ff8_3692,f1ff8_3722,f1ff8_3784,f1ff8_37b8,f1ff8_37ec,f1ff8_3b7a,f1ff8_3c64,f1ff8_3ca6,f1ff8_3cce});
