// Segment 1ff8 chunk-file library (1ff8:48ea-4de0): 4 slots of 0x44 bytes at DS:8a98 keyed by the FILE* (near),
// tag path +2, end[level] u32 at +0x1c (container flag bit 31 kept), depth +0x38, match counter +0x3a,
// position +0x3c (data offset of the current chunk), payload length +0x40. Snapshot at DS:8dd8.
// Runtime thunks: c1a2 fopen with retry, c1d6 fseek(fp,lo,hi,whence), c206 ftell (packed), c214 fread, c256 rewind, c264 fclose.
import {rb,rw,rd,wb,ww,wd} from '../../engine/mem.js';
import {u16} from '../../engine/int.js';
import {F,provide} from '../link.js';

const SLOTS=0x8a98,SNAP=0x8dd8;
const copy44=(d,s)=>{for(let i=0;i<0x22;i++)ww(d+2*i,rw(s+2*i));};
const fseek=(fp,pos,wh)=>F.f1000_c1d6(fp,pos&0xffff,pos>>>16,wh);
const ftell=fp=>F.f1000_c206(fp)>>>0;

// 1ff8:48ea chunkSlotFind(fp) (near): address of the slot (index 3 down to 0) whose FILE* equals fp, or 0.
// fp = 0 finds a free slot.
export function f1ff8_48ea(fp){for(let i=3;i>=0;i--){if(rw(SLOTS+0x44*i)===u16(fp))return SLOTS+0x44*i;}return 0;}
// 1ff8:491e chunkSlotReset(slot) (near): zeroes the slot except FILE* and end[0], then rewind(fp).
export function f1ff8_491e(s){
 const fp=rw(s),e0=rd(s+0x1c);
 for(let i=0;i<0x44;i++)wb(s+i,0);
 wd(s+0x1c,e0);ww(s,fp);F.f1000_c256(fp);
}
// 1ff8:4970 tagPathEq(a, b, n) (near): 1 when both strings end together or n characters matched; 0 at a mismatch.
export function f1ff8_4970(a,b,n){
 for(;;){
  if(!rb(a)&&!rb(b))return 1;
  if(!n)return 1;n=u16(n-1);
  const x=rb(a),y=rb(b);a=u16(a+1);b=u16(b+1);
  if(x!==y)return 0;
 }
}
// 1ff8:49a6 chunkSave(buf, fp): copies the slot of fp into buf; returns buf or 0. No callers (static).
export function f1ff8_49a6(buf,fp){
 if(!fp||!buf)return 0;const s=f1ff8_48ea(fp);if(!s)return 0;copy44(buf,s);return buf;
}
// 1ff8:49ec chunkLoad(buf): copies buf into the slot keyed by buf[0] and seeks to its position; returns 1 or 0. No callers.
export function f1ff8_49ec(buf){
 if(!buf||!rw(buf))return 0;const s=f1ff8_48ea(rw(buf));if(!s)return 0;
 copy44(s,buf);fseek(rw(s),rd(s+0x3c),0);return 1;
}
// 1ff8:4a48 chunkOpen(name): fopen(name,"rb") into a free slot, end[0] = file length | 0x80000000, reset.
// Returns the FILE* or 0.
export function f1ff8_4a48(name){
 const s=f1ff8_48ea(0);if(!s)return 0;
 const fp=u16(F.f1000_c1a2(name,0x4d82));ww(s,fp);if(!fp)return 0;
 fseek(fp,0,2);
 wd(s+0x1c,(ftell(fp)|0x80000000)>>>0);
 f1ff8_491e(s);
 return rw(s);
}
// 1ff8:4aae chunkRestore(slot) (near): restores the snapshot, seeks to its position, returns -1L.
export function f1ff8_4aae(s){copy44(s,SNAP);fseek(rw(s),rd(s+0x3c),0);return 0xffffffff;}
// 1ff8:4ade chunkSeek(fp, path, n): moves to the n-th chunk whose full tag path equals `path` (n = 0: the current chunk
// if still unread, else the next; n = -1: the current one again). Returns the data offset (packed long) or -1L.
export function f1ff8_4ade(fp,path,n){
 n=n<<16>>16;
 if(!fp)return 0xffffffff;
 const s=f1ff8_48ea(fp);if(!s)return 0xffffffff;
 let len=0;while(rb(path+len))len++;
 if(!len||(len&3))return 0xffffffff;
 copy44(SNAP,s);
 let store; // [bp-6]: counter stored on success
 const counter=()=>rsw16(rw(s+0x3a));
 const ret=()=>rd(s+0x3c);
 if(f1ff8_4970(path,u16(s+2),0x19)){
  if(n===0&&ftell(rw(s))===rd(s+0x3c))return ret();
  if(n===-1){fseek(rw(s),rd(s+0x3c),0);return ret();}
  if(counter()){
   if(n){
    store=n;
    if(counter()<n)n-=counter();
    else if(counter()<=n){fseek(rw(s),rd(s+0x3c),0);return ret();}
    else f1ff8_491e(s);
   }else{n=1;store=u16(rw(s+0x3a)+1);}
  }else{store=n;if(n)f1ff8_491e(s);else n=1;}
 }else{
  if(n>0){f1ff8_491e(s);store=n;}
  else{n=1;store=0;}
 }
 const end=d=>rd(s+0x1c+d), depth=()=>rsw16(rw(s+0x38));
 // 4bfc: step past the current chunk (descend into a container, skip a leaf).
 if(!(end(depth())&0x80000000))wd(s+0x3c,rd(s+0x3c)+rd(s+0x40));
 fseek(rw(s),rd(s+0x3c),0);
 for(;;){
  // 4d5b
  const was=n;n=(n-1)<<16>>16;
  if(!was){ww(s+0x3a,store);return ret();}
  // 4c34: pop finished levels, then enter or skip.
  for(;;){
   if(((end(depth())&0x7fffffff)>>>0)===rd(s+0x3c)){
    if(depth()===0)return f1ff8_4aae(s);
    ww(s+0x38,rw(s+0x38)-4);continue;
   }
   if(!(end(depth())&0x80000000)){wd(s+0x3c,rd(s+0x3c)+rd(s+0x40));fseek(rw(s),rd(s+0x3c),0);continue;}
   if(u16(F.f1000_c214(u16(s+2+depth()),1,4,rw(s)))!==4)return f1ff8_4aae(s);
   ww(s+0x38,rw(s+0x38)+4);
   if(depth()>=0x18)return f1ff8_4aae(s);
   wb(s+2+depth(),0);
   wd(s+0x3c,rd(s+0x3c)+8);
   if(u16(F.f1000_c214(u16(s+0x40),4,1,rw(s)))!==1)return f1ff8_4aae(s);
   wd(s+0x1c+depth(),rd(s+0x3c)+rd(s+0x40));
   ww(s+0x42,rw(s+0x42)&0x7fff);
   if(!rd(s+0x40))return f1ff8_4aae(s);
   // The payload length must be strictly less than the file length.
   if(!(((rd(s+0x1c)&0x7fffffff)>>>0)>rd(s+0x40)))return f1ff8_4aae(s);
   if(depth()===len&&f1ff8_4970(u16(s+2),path,len))break;
  }
 }
}
const rsw16=v=>v<<16>>16;
// 1ff8:4d72 chunkLen(fp): the current chunk's payload length (packed long) or -1L.
export function f1ff8_4d72(fp){if(!fp)return 0xffffffff;const s=f1ff8_48ea(fp);if(!s)return 0xffffffff;return rd(s+0x40);}
// 1ff8:4da4 chunkClose(fp): frees the slot and fclose(fp). Returns 1, or 0 if fp is not open.
export function f1ff8_4da4(fp){if(!fp)return 0;const s=f1ff8_48ea(fp);if(!s)return 0;ww(s,0);F.f1000_c264(fp);return 1;}
// 1ff8:4de0 chunkIsOpen(x): 1 if a slot holds x. QUIRK: x = 0 matches any free slot and returns 1.
export function f1ff8_4de0(x){return f1ff8_48ea(x)?1:0;}
export {f1ff8_4a48 as chunkOpen,f1ff8_4ade as chunkSeek,f1ff8_4d72 as chunkLen,f1ff8_4da4 as chunkClose,f1ff8_4de0 as chunkIsOpen};
provide({f1ff8_48ea,f1ff8_491e,f1ff8_4970,f1ff8_49a6,f1ff8_49ec,f1ff8_4a48,f1ff8_4aae,f1ff8_4ade,f1ff8_4d72,f1ff8_4da4,f1ff8_4de0});
