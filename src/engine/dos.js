// DOS services used by the game: MCB-chain memory allocation (first fit, like DOSBox) and file access.
import {B,frb,fwb,frw,fww,PSP_SEG,DGROUP} from './mem.js';
const MCB_TOP=0xa000;
// Mirrors the observed DOSBox arena: program block owned by the PSP ends at DGROUP+64K.
export const ARENA_START=DGROUP+0x1000;
// Observed in DOSBox (scripts/dosbox/trace-arena.mjs): the owner name "DTRACK" is stamped on the allocated block only when
// a larger free block is split; an exact fit and the free remainder keep whatever bytes were there. Freeing keeps the name.
function mcb(seg,type,owner,paras){fwb(seg,0,type);fww(seg,1,owner);fww(seg,3,paras);}
const stamp=seg=>{for(let i=0;i<8;i++)fwb(seg,8+i,i<6?'DTRACK'.charCodeAt(i):0);};
export function initArena(){mcb(ARENA_START,0x5a,0,MCB_TOP-ARENA_START-1);}
function* blocks(){for(let s=ARENA_START;;){const t=frb(s,0),own=frw(s,1),n=frw(s,3);if(t!==0x4d&&t!==0x5a)throw Error(`MCB chain corrupt at ${s.toString(16)}`);yield {seg:s,type:t,owner:own,paras:n};if(t===0x5a)return;s+=n+1;}}
// INT 21h AH=48h. Returns {seg} or {error:8, largest}.
export const arenaLog=[];
export function dosAlloc(paras){const r=dosAlloc0(paras);arenaLog.push(`alloc ${paras.toString(16)} -> ${r.seg?.toString(16)??"fail"}`);return r;}
function dosAlloc0(paras){
 let largest=0;
 for(const b of blocks()){
  if(b.owner)continue;
  // DOS coalesces adjacent free blocks while searching.
  let n=b.paras,t=b.type;for(let s=b.seg+n+1;t!==0x5a;){const ty=frb(s,0);if(frw(s,1))break;n+=frw(s,3)+1;t=ty;s=b.seg+n+1;}
  mcb(b.seg,t,0,n);
  if(n>=paras){if(n>paras){mcb(b.seg+paras+1,t,0,n-paras-1);mcb(b.seg,0x4d,PSP_SEG,paras);stamp(b.seg);}else mcb(b.seg,t,PSP_SEG,paras);return {seg:b.seg+1};}
  largest=Math.max(largest,n);
 }
 return {error:8,largest};
}
// INT 21h AH=49h.
export function dosFree(seg){arenaLog.push(`free ${seg.toString(16)}`);const m=seg-1;const t=frb(m,0);if(t!==0x4d&&t!==0x5a)return {error:9};fww(m,1,0);return {};}
// INT 21h AH=4Ah on an allocated block.
export function dosResize(seg,paras){arenaLog.push(`resize ${seg.toString(16)} ${paras.toString(16)}`);
 const m=seg-1,t=frb(m,0),n=frw(m,3);if(t!==0x4d&&t!==0x5a)return {error:9};
 if(paras<=n){if(paras<n){mcb(m+paras+1,t,0,n-paras-1);mcb(m,0x4d,frw(m,1),paras);}return {};}
 const nx=m+n+1;if(t===0x4d&&!frw(nx,1)){const tot=n+1+frw(nx,3),tt=frb(nx,0);if(tot>=paras){if(tot>paras){mcb(m+paras+1,tt,0,tot-paras-1);mcb(m,0x4d,frw(m,1),paras);}else mcb(m,tt,frw(m,1),paras);return {};}return {error:8,largest:tot};}
 return {error:8,largest:n};
}
export function arenaBlocks(){return [...blocks()];}

// Files: originals are read-only; writes go to an overlay persisted by the storage provider.
export const ioWork={readBytes:0,decoded:0};
export class FileSystem{
 constructor(assets,storage){this.assets=assets;this.storage=storage;this.handles=new Map();}
 // DOS returns the lowest free entry of the 20-entry job file table (0-4 are the standard devices).
 freeHandle(){for(let h=5;h<20;h++)if(!this.handles.has(h))return h;return -1;}
 // DOS truncates each name part to 8.3 ("ACTIVISIO" opens ACTIVISI, as title.ttm relies on).
 key(name){const b=name.replace(/^.*[\\/:]/,'').toUpperCase(),i=b.indexOf('.');return i<0?b.slice(0,8):b.slice(0,i).slice(0,8)+'.'+b.slice(i+1).slice(0,3);}
 lookup(name){const k=this.key(name);const w=this.storage?.read(k);if(w)return w;return this.assets.get(k)||null;}
 open(name,mode){const k=this.key(name),d=this.lookup(name);if(!d&&!(mode&0x100))return -2;
  const h=this.freeHandle();if(h<0)return -4;this.handles.set(h,{name:k,data:d?d.slice():new Uint8Array(0),pos:0,dirty:!!(mode&0x100),write:!!(mode&3)});if(mode&0x200)this.handles.get(h).data=new Uint8Array(0);return h;}
 read(h,seg,off,n){const f=this.handles.get(h);if(!f)return -6;const c=Math.max(0,Math.min(n,f.data.length-f.pos));ioWork.readBytes+=c;for(let i=0;i<c;i++)fwb(seg,off+i,f.data[f.pos+i]);f.pos+=c;return c;}
 write(h,seg,off,n){const f=this.handles.get(h);if(!f)return -6;if(f.pos+n>f.data.length){const d=new Uint8Array(f.pos+n);d.set(f.data);f.data=d;}for(let i=0;i<n;i++)f.data[f.pos+i]=frb(seg,off+i);f.pos+=n;f.dirty=true;return n;}
 seek(h,pos,whence){const f=this.handles.get(h);if(!f)return -6;const p=whence===0?pos:whence===1?f.pos+pos:f.data.length+pos;if(p<0)return -25;f.pos=p;return p;}
 close(h){const f=this.handles.get(h);if(!f)return -6;if(f.dirty)this.storage?.write(f.name,f.data);this.handles.delete(h);return 0;}
 truncate(h){const f=this.handles.get(h);if(!f)return -6;f.data=f.data.slice(0,f.pos);f.dirty=true;return 0;}
 size(h){return this.handles.get(h)?.data.length??-6;}
 exists(name){return !!this.lookup(name);}
 list(){const names=new Set(this.assets.keys());for(const k of this.storage?.keys?.()||[])names.add(k);return [...names].sort();}
}
