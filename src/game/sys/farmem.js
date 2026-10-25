// Segment 1ff8 far-memory helpers and DOS memory/huge I/O wrappers (static, from the raw-byte disassembly).
// Far pointers are passed as (off, seg) word pairs in C order, as the originals push them.
import {frb,fwb} from '../../engine/mem.js';
import {u16} from '../../engine/int.js';
import {int21} from '../bios.js';
import {provide} from '../link.js';

// 1ff8:46b6 farNormalize (near, register args): in AX = off, DX = seg; out AX = off & 15, DX = seg + (off >> 4).
// Returns {ax,dx}.
export function f1ff8_46b6(ax,dx){return {ax:ax&0xf,dx:u16(dx+(u16(ax)>>4))};}
// 1ff8:48db farNormalizePtr(off, seg): far wrapper of 46b6; returns the normalised pointer packed (DX<<16|AX).
export function f1ff8_48db(off,seg){const r=f1ff8_46b6(off,seg);return (r.dx<<16|r.ax)>>>0;}
// 1ff8:481b farMemcpy(dstOff, dstSeg, srcOff, srcSeg, n): normalises both pointers, copies n (16-bit) bytes forward.
// The original moves words after an alignment byte; for the non-overlapping uses in the game that equals a byte copy.
export function f1ff8_481b(dOff,dSeg,sOff,sSeg,n){
 n=u16(n);if(!n)return;
 const s=f1ff8_46b6(sOff,sSeg),d=f1ff8_46b6(dOff,dSeg);
 for(let i=0;i<n;i++)fwb(d.dx,d.ax+i,frb(s.dx,s.ax+i));
}
// 1ff8:4855 farMemset(dstOff, dstSeg, b, nLo, nHi): fills a 32-bit count in pieces of at most 0x7d00 bytes,
// renormalising the destination before each piece.
export function f1ff8_4855(dOff,dSeg,b,nLo,nHi){
 let di=u16(dOff),es=u16(dSeg);nLo=u16(nLo);nHi=u16(nHi);b&=0xff;
 for(;;){
  let cx=0x7d00;
  if(!nHi){if(!nLo)return;
   // QUIRK: signed JG, so a low word >= 0x8000 with high word 0 is filled in one piece.
   if(!((nLo<<16>>16)>0x7d00))cx=nLo;}
  const bx=cx;
  const p=f1ff8_46b6(di,es);di=p.ax;es=p.dx;
  for(let i=0;i<cx;i++)fwb(es,di+i,b);
  di=u16(di+cx);
  const lo=nLo-bx;nLo=u16(lo);nHi=u16(nHi-(lo<0?1:0));
 }
}
// 1ff8:3a88 DosAlloc(lo, hi): bytes -> paragraphs (bits 4-19, rounded up, 16-bit), INT 21h AH=48h.
// Returns a packed far pointer seg:0, or 0. (0xffff,0xffff) returns the largest free block in bytes (BX << 4, 32-bit).
// Called as CALLF 0x2000:3a08 in the Ghidra listing (normalised form of 1ff8:3a88).
export function f1ff8_3a88(lo,hi){
 lo=u16(lo);hi=u16(hi);
 if(hi===lo&&hi===0xffff){const r={ax:0x4800,bx:0xffff};int21(r);return (r.bx<<4)>>>0;}
 // QUIRK: the paragraph count is 16-bit; 0xffff paragraphs plus rounding wraps to 0.
 let bx=u16((hi<<12)|(lo>>>4));if(lo&0xf)bx=u16(bx+1);
 const r={ax:0x4800|(hi>>>4&0xff),bx};int21(r);
 if(r.cf)return 0;
 return (r.ax<<16)>>>0;
}
// 1ff8:3ae2 DosFree(off, seg): INT 21h AH=49h with ES = seg; the offset is ignored. No return value (AX = DOS result).
export function f1ff8_3ae2(off,seg){const r={ax:0x4900,es:u16(seg)};int21(r);return r.ax;}
// 1ff8:39c2 hugeRead(off, seg, cntLo, cntHi, fd): INT 21h AH=3Fh loop up to each segment end; the segment advances by
// 0x1000 on offset carry. Stops on CF or a 0-byte read. Returns the long count read.
export function f1ff8_39c2(off,seg,lo,hi,fd){
 off=u16(off);seg=u16(seg);let cnt=(u16(hi)*0x10000+u16(lo));const orig=cnt;
 for(;;){
  let cx=u16(-off);if(!cx)cx=0xffff;
  if(cnt<0x10000){if(!cnt)break;if(cx>cnt)cx=cnt;}
  const r={ax:0x3f00,bx:u16(fd),cx,dx:off,ds:seg};int21(r);
  if(r.cf||!r.ax)break;
  cnt-=r.ax;const o=off+r.ax;off=u16(o);if(o>0xffff)seg=u16(seg+0x1000);
 }
 return (orig-cnt)>>>0;
}
// 1ff8:3a26 hugeWrite(off, seg, cntLo, cntHi, fd): the same loop with AH=40h; stops on CF or a short write. No callers (static).
export function f1ff8_3a26(off,seg,lo,hi,fd){
 off=u16(off);seg=u16(seg);let cnt=(u16(hi)*0x10000+u16(lo));const orig=cnt;
 for(;;){
  let cx=u16(-off);if(!cx)cx=0xffff;
  if(cnt<0x10000){if(!cnt)break;if(cx>cnt)cx=cnt;}
  const r={ax:0x4000,bx:u16(fd),cx,dx:off,ds:seg};int21(r);
  if(r.cf||r.ax<cx)break;
  cnt-=r.ax;const o=off+r.ax;off=u16(o);if(o>0xffff)seg=u16(seg+0x1000);
 }
 return (orig-cnt)>>>0;
}
export {f1ff8_3a88 as dosAlloc,f1ff8_3ae2 as dosFree,f1ff8_481b as farMemcpy,f1ff8_4855 as farMemset};
provide({f1ff8_46b6,f1ff8_48db,f1ff8_481b,f1ff8_4855,f1ff8_3a88,f1ff8_3ae2,f1ff8_39c2,f1ff8_3a26});
