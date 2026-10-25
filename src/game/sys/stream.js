// Segment 1ff8 stream codec (1ff8:05d2-20fe): handle-based reader for the Dynamix compression envelope
// (u8 method, u32 decoded size, data; method 0 raw, 1 RLE, 2 LZW). Translated from the raw-byte disassembly.
// Runtime calls go through the MSC far thunks: c1d6 fseek, c206 ftell, c214 fread, c22c fwrite, c244 fputc,
// c264 fclose, c280 free, c308 calloc, c31a fgetc. Longs are passed as (lo, hi) and returned packed (DX<<16|AX).
// The write side (encoders 066d/1f14/1a12, 19ba/1c40/1df8/1ed4, streamWrite 123f, write mode of 0d47/100d),
// the memory-source open 0edf with its RLE decoder 18c6, and seek/rewind 1346-14f9 have no game caller: not translated.
import {ioWork} from '../../engine/dos.js';
import {rb,rw,rd,wb,ww,wd,frb,fwb,frw,fww,gaddr} from '../../engine/mem.js';
import {u16} from '../../engine/int.js';
import {callFar,register,unsupported} from '../../engine/host.js';
import {F,provide} from '../link.js';
import {f1ff8_46b6,f1ff8_481b,f1ff8_4855,f1ff8_3a88,f1ff8_3ae2} from './farmem.js';

const G={cur:0x8e9a,tab:0x980e,workOff:0x8ebc,workSeg:0x8ebe,ring:0xaa98,flags:0x99eb,method:0xaa1c,fp:0x9b08,
 mode:0x9aa4,memOff:0x99b8,memSeg:0x99ba,dstOff:0x9638,dstSeg:0x963a,want:0x9bc4,encCount:0x896e,
 methods:0x37c8,presetOff:0x37c4,presetSeg:0x37c6,
 lzwWidth:0xa25e,lzwMax:0x895c,lzwNext:0xa028,lzwReset:0x95d8,lzwBit:0x9ad4,lzwLimit:0x9a3c,lzwGroup:0x37f2,lzwMask:0x37fe,
 lzwOld:0x98d8,lzwFirst:0x8db6,lzwIn:0x8958,lzwStart:0x9aba,lzwPending:0x98ea,lzwSp:0x3807};
const cur=()=>rw(G.cur);
const fgetc=fp=>u16(F.f1000_c31a(fp));
// Adds n to the far pointer stored at DS:o/o+2 the way the codec does: offset add, segment += 0x1000 on carry.
function hugeAdd(o,n){const v=rw(o)+n;ww(o,v);if(v>0xffff)ww(o+2,rw(o+2)+0x1000);}
const add32=(o,n)=>wd(o,rd(o)+n);

// 1ff8:0a5f streamSelect(h): loads stream h into the codec globals. Returns 0 if the handle is not open, else 1.
// No bounds check on h (h = -1 reads DS:980c).
export function f1ff8_0a5f(h){
 const s=rw(G.tab+2*h);ww(G.cur,s);if(!s)return 0;
 ww(G.workOff,rw(s+2));ww(G.workSeg,rw(s+4));ww(G.ring,rw(s));
 const f=rb(s+0x20);wb(G.flags,f);wb(G.method,f&0x1f);
 if(f&0x20){ww(G.fp,rw(s+6));wb(G.mode,0x20);}
 else{
  wb(G.mode,0);
  // Memory source: far pointer +6 advanced by the input position (+0x0a, 32-bit), then normalised.
  const lin=rw(s+6)+(rd(s+0xa)>>>0),off=lin&0xffff,seg=u16((Math.floor(lin/0x10000)<<12)+rw(s+8));
  const p=f1ff8_46b6(off,seg);ww(G.memOff,p.ax);ww(G.memSeg,p.dx);
 }
 return 1;
}
// 1ff8:0b05 modeHasR(mode): 1 if the near string contains 'r'.
export function f1ff8_0b05(m){for(;;){const c=rb(m);if(!c)return 0;m=u16(m+1);if(c===0x72)return 1;}}
// 1ff8:0b3c freeNear(p): free(p) when p != 0.
export function f1ff8_0b3c(p){if(p)F.f1000_c280(p);}
// 1ff8:0b5f streamFree(h): frees the ring, the far work block (unless the preset block is in use) and the struct.
// Returns -1 (AX = 0xffff) in both cases.
export function f1ff8_0b5f(h){
 const s=rw(G.tab+2*h);ww(G.cur,s);if(!s)return 0xffff;
 f1ff8_0b3c(rw(s));
 if(rd(s+2)&&!(rw(G.presetOff)|rw(G.presetSeg)))f1ff8_3ae2(rw(s+2),rw(s+4));
 f1ff8_0b3c(rw(G.cur));
 ww(G.tab+2*h,0);
 return 0xffff;
}
// 1ff8:0bd6 streamAlloc(): first free handle of 100, struct calloc(1,0x21) into it and DS:8e9a. Returns the handle or -1.
// (The caller pushes the mode string; it is unused.)
export function f1ff8_0bd6(){
 let i=0;for(;i<100;i++)if(!rw(G.tab+2*i))break;
 if(i===100)return 0xffff;
 const s=u16(F.f1000_c308(1,0x21));ww(G.cur,s);if(!s)return 0xffff;
 ww(G.tab+2*i,s);return i;
}
// 1ff8:0c50 streamSetMethod(m, mode): ring calloc and far work block per the method table entry DS:37c8+14m
// (+0 read ring size, +2 read far size, +4 write far size). Sets +0x20 = m. Returns -1 on failure, else not -1.
export function f1ff8_0c50(m,mode){
 if((m<<16>>16)>2)return 0xffff;
 const e=G.methods+m*14;let rbuf=0x80,far;
 if(f1ff8_0b05(mode)){rbuf=rw(e);far=rw(e+2);}else far=rw(e+4);
 const s=cur(),ring=u16(F.f1000_c308(1,rbuf));ww(s,ring);if(!ring)return 0xffff;
 if(far){
  if(rw(G.presetOff)|rw(G.presetSeg)){ww(s+2,rw(G.presetOff));ww(s+4,rw(G.presetSeg));ww(G.workOff,rw(G.presetOff));ww(G.workSeg,rw(G.presetSeg));}
  else{
   const p=f1ff8_3a88(far,0);wd(s+2,p);wd(G.workOff,p);
   if(!p)return 0xffff;
  }
 }
 wb(cur()+0x20,m);
 return m&0xff; // UNKNOWN: AH holds a leftover; callers only test for -1.
}
// 1ff8:0d47 streamOpenFile(m, fp, mode, lenLo, lenHi): read mode ("r" in mode): the method is read with fgetc, the
// decoded size with fread(+0x12,1,4); limit = len (which includes the 5 header bytes); decoder init; flags |= 0x60.
// Returns the handle or -1. Write mode is not translated (no game caller passes a mode without 'r').
export function f1ff8_0d47(m,fp,mode,lenLo,lenHi){
 const h=f1ff8_0bd6(mode);
 if(h===0xffff)return 0xffff;
 let s=cur();ww(s+6,fp);
 wd(s+0x1c,F.f1000_c206(fp));
 wd(s+0xa,5);
 if(!f1ff8_0b05(mode)){unsupported('1ff8:0d47 stream open for writing');return 0xffff;}
 const b=fgetc(fp)&0xff;
 wb(cur()+0x20,b);
 if(f1ff8_0c50(b,mode)===0xffff){
  F.f1000_c1d6(fp,0xffff,0xffff,1); // QUIRK: steps back over the method byte only on this path.
  return f1ff8_0b5f(h);
 }
 s=cur();ww(s+0xe,lenLo);ww(s+0x10,lenHi);
 F.f1000_c214(u16(cur()+0x12),1,4,fp);
 const dinit=rw(b*14+0x37d4);
 if(dinit)callFar(gaddr(0x1ff8,dinit));
 wb(cur()+0x20,rb(cur()+0x20)|0x40);
 wb(cur()+0x20,rb(cur()+0x20)|0x20);
 return h;
}
// 1ff8:100d streamClose(h): write mode would flush and patch the size (not translated); always frees the stream.
// Returns DS:896e (0 for read streams), or -1 for a bad handle.
export function f1ff8_100d(h){
 if(!f1ff8_0a5f(h))return 0xffff;
 ww(G.encCount,0);
 if(!(rb(G.flags)&0x40))unsupported('1ff8:100d close of a write stream');
 f1ff8_0b5f(h);
 return rw(G.encCount);
}
// 1ff8:10fa ringDrain (near): copies min(head-tail, wanted) bytes of the 128-byte ring at stream +0 to the destination.
// A full drain resets head and tail to 0.
export function f1ff8_10fa(){
 const s=cur(),tail=rb(s+0x1b);let n=u16(rb(s+0x1a)-tail);
 if(rw(G.want)<n){n=rw(G.want);wb(s+0x1b,tail+n);}
 else{wb(s+0x1a,0);wb(s+0x1b,0);}
 if(!n)return;
 if(rb(G.mode)&0x40)f1ff8_481b(rw(G.dstOff),rw(G.dstSeg),u16(rw(G.ring)+tail),DSEG(),n);
 ww(G.want,rw(G.want)-n);hugeAdd(G.dstOff,n);
}
// 1ff8:1191 streamFill(h, n) (near): drain the ring, run the decoder from the method table if more is wanted, drain again.
// Adds the delivered count to +0x16 and returns it.
export function f1ff8_1191(h,n){
 ww(G.want,n);f1ff8_10fa();
 if(rw(G.want)){
  callFar(gaddr(0x1ff8,rw(rb(G.method)*14+0x37ce)));
  if(rw(G.want))f1ff8_10fa();
 }
 n=u16(n-rw(G.want));add32(cur()+0x16,n);
 ioWork.decoded+=n; // work-cost model input (src/game/pacing.js)
 return n;
}
// 1ff8:11f0 streamRead(h, dstOff, dstSeg, n): decodes up to n bytes to the far destination. Returns the count, or -1.
export function f1ff8_11f0(h,off,seg,n){
 if(!f1ff8_0a5f(h))return 0xffff;
 const p=f1ff8_46b6(off,seg);ww(G.dstOff,p.ax);ww(G.dstSeg,p.dx);
 wb(G.mode,rb(G.mode)|0x40);
 return f1ff8_1191(h,u16(n));
}
// 1ff8:1310 streamSize(h): the header's decoded size as a long, or -1L.
export function f1ff8_1310(h){if(!f1ff8_0a5f(h))return 0xffffffff;return rd(cur()+0x12);}

// ---- input and output primitives ----
// 1ff8:0739 srcGetc (near): next input byte, or 0xffff when the position reaches the limit (or fgetc fails).
export function f1ff8_0739(){
 const s=cur();
 if(rd(s+0xa)===rd(s+0xe))return 0xffff;
 add32(s+0xa,1);
 if(rb(G.flags)&0x20)return fgetc(rw(G.fp));
 const b=frb(rw(G.memSeg),rw(G.memOff));hugeAdd(G.memOff,1);return b;
}
// 1ff8:07ad srcRead(buf, n) (near): up to n bytes (bounded by the limit) into the near buffer. The position advances by the
// requested count before the read. Returns the count actually read.
export function f1ff8_07ad(buf,n){
 const s=cur(),rem=(rd(s+0xe)-rd(s+0xa))>>>0;
 if(!rem)return 0;
 let c=(rem>0xffff||n<rem)?n:rem;
 add32(s+0xa,c);
 if(rb(G.flags)&0x20)return u16(F.f1000_c214(buf,1,c,rw(G.fp)));
 f1ff8_481b(buf,DSEG(),rw(G.memOff),rw(G.memSeg),c);hugeAdd(G.memOff,c);return c;
}
// 1ff8:06b8 copyFromFile(dstOff, dstSeg, n) (near): fread in 50-byte pieces through DS:5b94 to a far destination.
export function f1ff8_06b8(off,seg,n){
 let got=1;
 while(n&&(got<<16>>16)>0){
  got=u16(F.f1000_c214(0x5b94,1,n<0x32?n:0x32,rw(G.fp)));
  n=u16(n-got);
  f1ff8_481b(off,seg,0x5b94,DSEG(),got);
  const o=off+got;off=u16(o);if(o>0xffff)seg=u16(seg+0x1000);
 }
}
// 1ff8:0870 outCopy(n) (near), with its tail 08e3: n literal bytes from the file. If they fit, copied (or skipped with
// fseek in seek mode) and 1 is returned. Otherwise all n go to ring[0..n), head += n, and 0 stops the decoder.
export function f1ff8_0870(n){
 const s=cur();add32(s+0xa,n);
 if(rw(G.want)>=n){
  if(rb(G.mode)&0x40)f1ff8_06b8(rw(G.dstOff),rw(G.dstSeg),n);
  else F.f1000_c1d6(rw(G.fp),n,0,1);
  ww(G.want,rw(G.want)-n);hugeAdd(G.dstOff,n);
  return 1;
 }
 wb(s+0x1a,rb(s+0x1a)+n);
 f1ff8_06b8(rw(G.ring),DSEG(),n);
 return 0;
}
// 1ff8:0904 outFill(b, n) (near), with its tail 0962: n copies of b. Overflow goes to the ring at head.
export function f1ff8_0904(b,n){
 if(n<=rw(G.want)){
  if(rb(G.mode)&0x40)f1ff8_4855(rw(G.dstOff),rw(G.dstSeg),b,n,n&0x8000?0xffff:0);
  ww(G.want,rw(G.want)-n);hugeAdd(G.dstOff,n); // n < 0x8000 here (RLE counts are 7-bit)
  return 1;
 }
 const s=cur();
 f1ff8_4855(u16(rb(s+0x1a)+rw(G.ring)),DSEG(),b,n,n&0x8000?0xffff:0);
 wb(s+0x1a,rb(s+0x1a)+n);
 return 0;
}
// 1ff8:0998 outByte(b) (near), with its tail 09da: one byte to the destination, or to ring[head++] (word increment of
// +0x1a) when nothing more is wanted, returning 0.
export function f1ff8_0998(b){
 if(rw(G.want)>=1){
  if(rb(G.mode)&0x40)fwb(rw(G.dstSeg),rw(G.dstOff),b);
  hugeAdd(G.dstOff,1);ww(G.want,rw(G.want)-1);
  return 1;
 }
 const s=cur(),hd=rb(s+0x1a);ww(s+0x1a,rw(s+0x1a)+1);wb(u16(hd+rw(G.ring)),b);
 return 0;
}

// ---- decoders (near, entered through the method table at DS:37c8) ----
// 1ff8:05d2 decodeRaw: copies input bytes until the input ends or the output overflows.
export function f1ff8_05d2(){let r=1;while(r){const c=f1ff8_0739();if(c===0xffff)break;r=f1ff8_0998(c);}}
// 1ff8:0605 decodeRle: control byte c; bit 7 clear: copy c literals; set: repeat the next byte (c & 0x7f) times.
export function f1ff8_0605(){
 if(!(rb(G.mode)&0x20)){unsupported('1ff8:18c6 RLE decode from a memory source');return;}
 let r=1;
 while(r){
  const c=f1ff8_0739();if(c===0xffff)break;
  if(c&0x80){const n=c&0x7f;const b=f1ff8_0739();r=f1ff8_0904(b&0xff,n);}
  else r=f1ff8_0870(c&0x7f);
 }
}
// 1ff8:17ff lzwGetCode (near, hand-written; uses SI/BX/CX/DX, returns AX): reads codes LSB-first from a group of
// `width` bytes at DS:37f2. A new group is read when the width grows (next > max), after a reset, or when the bit
// position reaches the group's limit (bytes*8 - (width-1)); the unread bits of the old group are discarded.
// Returns the code, or 0xffff when a group read returns 0 bytes.
export function f1ff8_17ff(){
 let fresh=false;
 if((rw(G.lzwNext)<<16>>16)>(rw(G.lzwMax)<<16>>16)){
  const cl=rw(G.lzwWidth)+1;ww(G.lzwWidth,cl);
  ww(G.lzwMax,(cl&0xff)===12?0x1000:u16((1<<(cl&31))-1));
  if(rw(G.lzwReset))resetWidth();
  fresh=true;
 }else if(rw(G.lzwReset)){resetWidth();fresh=true;}
 else if(!((rw(G.lzwBit)<<16>>16)<(rw(G.lzwLimit)<<16>>16)))fresh=true;
 if(fresh){
  const si=rw(G.lzwWidth),n=f1ff8_07ad(G.lzwGroup,si);
  if(!((n<<16>>16)>0)){ww(G.lzwLimit,n);return 0xffff;}
  ww(G.lzwBit,0);ww(G.lzwLimit,u16(n*8-(si-1)));
 }
 // 1818: extract `width` bits at the current bit position.
 const pos=rw(G.lzwBit);let bl=rw(G.lzwWidth)&0xff;
 ww(G.lzwBit,pos+bl);
 let si=G.lzwGroup+(pos>>>3),ch=pos&7;
 let dx=rb(si++)>>ch;ch=8-ch;bl=(bl-ch)<<24>>24;
 if(bl>=8){dx|=rb(si++)<<ch;ch+=8;bl-=8;}
 return u16(((rb(G.lzwMask+bl)&rb(si))<<ch)|dx);
}
function resetWidth(){ww(G.lzwWidth,9);ww(G.lzwMax,0x1ff);ww(G.lzwReset,0);}
// 1ff8:15fc decodeLzw (hand-written), including the first-code entry 15e0. Dictionary in the far work block:
// prefix words at seg:2*code, suffix bytes at seg:0x2720+code, string stack at (seg+0x372):0 (built in reverse).
// When the destination fills in the middle of a string, the next byte goes to the ring, the stack pointer is kept
// at DS:3807 and DS:98ea flags the pending string for the next call. The dictionary uses the work block's segment
// with offset 0 (the original loads DS = [8ebe]); the reset clear uses [8ebe]:[8ebc].
export function f1ff8_15fc(){
 const dseg=rw(G.workSeg),sseg=u16(dseg+0x372);
 let si,di;
 // Emits the stacked string from SI downwards; returns false when the destination filled (state saved).
 const emit=(skipFirstSub)=>{
  let cx=u16(rw(G.want)+1),dst=rw(G.dstOff);const dseg2=rw(G.dstSeg),deliver=rb(G.mode)&0x40;
  let first=skipFirstSub;
  for(;;){
   if(!first){si=u16(si-2);if(si&0x8000)break;}
   first=false;
   const al=frb(sseg,si);si=u16(si+1);
   cx=u16(cx-1);
   if(!cx){
    ww(G.dstOff,dst);ww(G.lzwSp,si);
    const s=cur(),hd=rb(s+0x1a);ww(s+0x1a,rw(s+0x1a)+1);wb(u16(hd+rw(G.ring)),al);
    ww(G.want,0);wb(G.lzwPending,1);
    return false;
   }
   if(deliver)fwb(dseg2,dst,al);
   dst=u16(dst+1);
  }
  ww(G.want,u16(cx-1));ww(G.dstOff,dst);
  return true;
 };
 // 17cb: add the dictionary entry (old code, first char) while next < 0x1000, then old = incoming code.
 const addEntry=()=>{
  const nx=rw(G.lzwNext);
  if((nx<<16>>16)<0x1000){
   fww(dseg,nx*2,rw(G.lzwOld));ww(G.lzwNext,nx+1);fwb(dseg,0x2720+nx,rb(G.lzwFirst));
  }
  ww(G.lzwOld,rw(G.lzwIn));
 };
 if(rb(G.lzwPending)){
  si=rw(G.lzwSp);wb(G.lzwPending,0);
  if(!emit(false))return;
  addEntry();
 }else if(rb(G.lzwStart)){
  // 15e0: first code of the stream: output it, no dictionary entry.
  wb(G.lzwStart,0);
  const c=f1ff8_17ff();ww(G.lzwOld,c);ww(G.lzwFirst,c);
  f1ff8_0998(c&0xff);
 }
 for(;;){
  let c=f1ff8_17ff();
  if(c&0x8000)return;
  if(c===0x100){
   // QUIRK: reset fills the 256 prefix words with the work offset (0), sets the reset flag to offset+1 and
   // next = 0x100 (XCHG AL,AH), so the next code adds a dead entry 0x100.
   const off=rw(G.workOff);for(let i=0;i<0x100;i++)fww(dseg,off+2*i,off);
   const ax=u16(off+1);ww(G.lzwReset,ax);ww(G.lzwNext,((ax&0xff)<<8)|(ax>>8));
   c=f1ff8_17ff();
   if(c&0x8000)return;
  }
  di=0;si=c;ww(G.lzwIn,c);
  if(!((c<<16>>16)<(rw(G.lzwNext)<<16>>16))){fwb(sseg,di++,rb(G.lzwFirst));si=rw(G.lzwOld);}
  while((si<<16>>16)>=0x100){fwb(sseg,di++,frb(dseg,u16(0x2720+si)));si=frw(dseg,u16(si*2));}
  const al=frb(dseg,u16(0x2720+si));fwb(sseg,di++,al);ww(G.lzwFirst,al);
  si=u16(di-1);
  if(!emit(true))return;
  addEntry();
 }
}
// 1ff8:204a lzwDecodeInit (near): clears 0x3aa1 bytes of the work block, width 9, max 0x1ff, prefix[0..255] = 0,
// suffix[c] = c, next 0x101, first-code flag set, stack pointer DS:9b60 = block + 0x3720.
export function f1ff8_204a(){
 const off=rw(G.workOff),seg=rw(G.workSeg);
 f1ff8_4855(off,seg,0,0x3aa1,0);
 ww(G.lzwWidth,9);ww(G.lzwMax,0x1ff);
 const at=a=>{const l=a+off;return {s:u16((Math.floor(l/0x10000)<<12)+seg),o:l&0xffff};};
 for(let c=0xff;c>=0;c--){let p=at(c*2);fww(p.s,p.o,0);p=at(0x2720+c);fwb(p.s,p.o,c);}
 ww(G.lzwNext,0x101);ww(G.lzwReset,0);wb(G.lzwStart,1);wb(G.lzwPending,0);ww(G.lzwBit,0);ww(G.lzwLimit,0);
 const p=at(0x3720);ww(0x9b60,p.o);ww(0x9b62,p.s);
}
// DGROUP segment value for near buffers handed to far helpers (PUSH DS).
import {DGROUP} from '../../engine/mem.js';
const DSEG=()=>DGROUP;

export {f1ff8_0d47 as streamOpenFile,f1ff8_11f0 as streamRead,f1ff8_1310 as streamSize,f1ff8_100d as streamClose};
provide({f1ff8_0a5f,f1ff8_0b05,f1ff8_0b3c,f1ff8_0b5f,f1ff8_0bd6,f1ff8_0c50,f1ff8_0d47,f1ff8_100d,f1ff8_10fa,f1ff8_1191,
 f1ff8_11f0,f1ff8_1310,f1ff8_0739,f1ff8_07ad,f1ff8_06b8,f1ff8_0870,f1ff8_0904,f1ff8_0998,f1ff8_05d2,f1ff8_0605,f1ff8_17ff,
 f1ff8_15fc,f1ff8_204a});
// Near entry points stored in the method table DS:37c8 (decode, decoder init).
register(0x1ff8,0x05d2,f1ff8_05d2);
register(0x1ff8,0x0605,f1ff8_0605);
register(0x1ff8,0x15fc,f1ff8_15fc);
register(0x1ff8,0x204a,f1ff8_204a);
