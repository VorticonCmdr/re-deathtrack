// raceview checks: shape.tbl loading layout, draw-order presort/quicksort (with the read-past-end quirk),
// .MAP skyline packed-to-planar upload, and small pure helpers against hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine,machine} from '../src/engine/machine.js';
import {rb,wb,rw,rsw,ww,wd,rd,frb,frw,putStr,strAt,fstrAt,fwb,DGROUP,pseg,poff,fp} from '../src/engine/mem.js';
import {dosAlloc} from '../src/engine/dos.js';
import {ldiv} from '../src/engine/int.js';
import {state,IDLE,advanceTo,inRetrace} from '../src/engine/host.js';
import * as ega from '../src/engine/ega.js';
import {int21} from '../src/game/bios.js';
import {provide} from '../src/game/link.js';
import {unpack} from '../src/formats.js';
import * as rv from '../src/game/raceview.js';

const assets=await loadAssets();
const reg=(o)=>({ax:0,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:0,...o});

// Test-only stubs for runtime (1000:c000-ffff) and sys helpers, built on the DOS layer.
const fatal=[];
class Fatal extends Error{}
provide({
 f1000_daa4:(path,flag)=>{const r=int21(reg({ax:0x3d00,dx:path}));return r.cf?0xffff:r.ax;},
 f1000_e3d0:(fd)=>{const r=int21(reg({ax:0x4202,bx:fd,cx:0,dx:0}));const len=(r.dx<<16|r.ax)>>>0;int21(reg({ax:0x4200,bx:fd,cx:0,dx:0}));return len;},
 f1000_e43c:(lo,hi,size)=>{const n=(hi<<16|lo)>>>0;const a=dosAlloc(Math.ceil(n/16));return a.error?0:fp(a.seg,0);},
 f1ff8_39c2:(off,seg,lo,hi,fd)=>{let n=(hi<<16|lo)>>>0,tot=0;while(n>0){const c=Math.min(n,0x8000);const got=machine.fs.read(fd,seg,off,c);tot+=got;if(got<c)break;n-=c;off+=c;if(off>0xffff){off-=0x10000;seg+=0x1000;}}return tot>>>0;},
 f1000_da0a:(fd)=>{int21(reg({ax:0x3e00,bx:fd}));return 0;},
 f1000_0344:(msg)=>{fatal.push(strAt(msg));throw new Fatal(strAt(msg));},
 f1000_e80c:(alo,ahi,blo,bhi)=>ldiv(ahi<<16|alo,bhi<<16|blo)>>>0,
 f1000_e97e:(p,lo,hi)=>{const q=ldiv(rd(p)|0,hi<<16|lo);wd(p,q);return q>>>0;},
});

test('shape.tbl: a53c loads SHAPE.tbl into a DOS block with the documented layout',()=>{
 createMachine({assets});
 // Stand-in for 2c46:006e (render3d): ac4c(name,"tbl") + ad0a, pointer to DS:2a6a/98dc (no relocation).
 provide({f2c46_006e:(name)=>{const p=rv.f1000_ad0a(rv.f1000_ac4c(name,0x2a72));ww(0x2a6a,poff(p));ww(0x2a6c,pseg(p));ww(0x98dc,poff(p));ww(0x98de,pseg(p));}});
 putStr(0x99ec,'SHAPE');
 rv.f1000_a53c(0x99ec);
 assert.equal(strAt(0x5aa4),'SHAPE.tbl');
 assert.equal(rw(0x9640),7);assert.equal(rw(0xa8a2),0x80);assert.equal(rw(0x8ec0),1);assert.equal(rw(0x8e8a),0x2a44);
 const seg=rw(0x2a6c),file=assets.get('SHAPE.TBL');
 assert.equal(rw(0x2a6a),0);
 // whole file, including the part past the first 64 KiB, lands at seg:0 as a huge block
 for(let i=0;i<file.length;i+=97)assert.equal(frb(seg+(i>>4),i&15),file[i],`byte ${i}`);
 // header: 124 {u16 off, u16 para} entries (para:0000), then a zero dword (resources.md .tbl)
 let n=0;while(frw(seg,4*n)|frw(seg,4*n+2))n++;
 assert.equal(n,124);
 assert.equal(frw(seg,0),0);assert.equal(frw(seg,2),0x20);
 for(let i=0;i<n;i++)assert.equal(frw(seg,4*i),0,`entry ${i} offset`);
 // model 0 at para 0x20: +2 byte 0, LOD list (1, 0x0c) ended by 0xffff, vertex array inside the model
 const m=seg+0x20,next=seg+frw(seg,6);
 assert.equal(frb(m,2),0);
 assert.equal(frw(m,6),1);assert.equal(frw(m,8),0x0c);assert.equal(frw(m,10),0xffff);
 const nv=frb(m,3),vo=frw(m,4);
 assert.ok(nv>0&&vo+6*nv<=(next-m)*16,'vertex array within the model');
});

test('shape.tbl: a missing file takes the fatal path with the original message',()=>{
 createMachine({assets});fatal.length=0;
 putStr(0x99ec,'NOSUCH');
 assert.throws(()=>rv.f1000_ad0a(rv.f1000_ac4c(0x99ec,0x2a72)),Fatal);
 assert.equal(fatal[0],'FATAL ERROR: Unable to load 3D shape table.');
});

// Draw order: DS:8eda[1..39] are entity indices, keys DS:8f48[e] (signed words).
function setupSort(keys,tail=0){
 createMachine({assets});
 for(let e=0;e<40;e++)ww(0x8f48+2*e,keys[e]??0);
 for(let b=1;b<40;b++)wb(0x8eda+b,b);
 for(let b=40;b<=76;b++)wb(0x8eda+b,tail);   // bytes past the array, read by the a410 quirk
}
const order=()=>Array.from({length:39},(_,i)=>rb(0x8edb+i));
const desc=e=>1000-10*e;                      // distinct keys, descending with the index

test('a410 presort: odd neighbours are never compared (quirk), so an inversion at (2,3) is missed',()=>{
 const k=Array.from({length:40},(_,e)=>desc(e));k[0]=-32768;
 k[3]=k[2]+5;                                 // entries 2 and 3 out of order
 setupSort(k,0);
 rv.f1000_a410(0x8edb);
 assert.deepEqual(order(),Array.from({length:39},(_,i)=>i+1));
});

test('a410 presort detects a compared inversion and a470 sorts 39 entries descending',()=>{
 const k=Array.from({length:40},(_,e)=>desc(e));k[0]=-32768;
 k[6]=k[4]+5;k[17]=2000;k[30]=-500;k[3]=k[2]+5;
 setupSort(k,0);
 rv.f1000_a410(0x8edb);
 const o=order();
 assert.deepEqual([...o].sort((a,b)=>a-b),Array.from({length:39},(_,i)=>i+1));
 for(let i=1;i<39;i++)assert.ok(k[o[i-1]]>=k[o[i]],`descending at ${i}`);
 assert.equal(o[0],17);assert.equal(o[38],30);
});

test('a410 read-past-end: a byte after DS:8f01 triggers the sort of otherwise ordered entries',()=>{
 const k=Array.from({length:40},(_,e)=>desc(e));
 k[3]=k[2]+5;                                 // missed by the stride-2 check
 k[0]=5000;                                   // entry 40 (byte 0 past the end) indexes key[0]
 setupSort(k,0);
 rv.f1000_a410(0x8edb);
 const o=order();
 assert.equal(o[0],1);assert.equal(o[1],3);assert.equal(o[2],2);  // the sort ran and fixed (2,3)
});

test('a470 with equal keys keeps a permutation in non-increasing order',()=>{
 const k=Array.from({length:40},(_,e)=>[5,3,9,3,5,1][e%6]);
 setupSort(k,0);
 rv.f1000_a470(0x8edb+38,0x8edb);
 const o=order();
 assert.deepEqual([...o].sort((a,b)=>a-b),Array.from({length:39},(_,i)=>i+1));
 for(let i=1;i<39;i++)assert.ok(k[o[i-1]]>=k[o[i]]);
});

test('.MAP skyline: ad8e converts the strips of boston.map to planar video memory at A734:0000',()=>{
 createMachine({assets});ega.setMode(0x0d);
 const d=unpack(assets.get('BOSTON.MAP'));
 assert.equal(d[0]|d[1]<<8,6);
 for(let i=0;i<6;i++){assert.equal(d[2+2*i],160);assert.equal(d[14+2*i],25);}
 const src=dosAlloc(0x200).seg;               // 8 KiB staging buffer, like the loader's 4000-byte chunks
 for(let c=0;c<6;c++){
  for(let i=0;i<4004;i++)fwb(src,i,d[26+c*4000+i]??0);
  rv.f1000_ad8e(0,src,c*1000,0xa734,1000,0);
 }
 assert.equal(ega.regs.writeMode,2);assert.equal(ega.regs.mapMask,0xf);
 for(let s=0;s<6;s++)for(let y=0;y<25;y++)for(let x=0;x<320;x++){
  const b=d[26+s*4000+y*160+(x>>1)],want=x&1?b&15:b>>4;
  const o=0x7340+s*1000+y*40+(x>>3),bit=7-(x&7);
  let got=0;for(let p=0;p<4;p++)got|=(ega.planes[p][o]>>bit&1)<<p;
  if(got!==want)assert.fail(`strip ${s} (${x},${y}): ${got} != ${want}`);
 }
});

test('ad8e converts count+1 groups (quirk): one extra plane byte per call',()=>{
 createMachine({assets});ega.setMode(0x0d);
 const src=dosAlloc(1).seg;
 for(let i=0;i<8;i++)fwb(src,i,0xff);        // group 0 and the extra group 1: all pixels colour 15
 rv.f1000_ad8e(0,src,0,0xa734,1,0);
 // count 1 runs two groups: plane bytes at 0x7340 and 0x7341 are written
 for(let p=0;p<4;p++){assert.equal(ega.planes[p][0x7340],0xff);assert.equal(ega.planes[p][0x7341],0xff);assert.equal(ega.planes[p][0x7342],0);}
});

test('af74 octagonal distance and be7e atan2 match hand-computed values',()=>{
 createMachine({assets});
 ww(0x100,10);ww(0x102,0);ww(0x104,0);ww(0x106,4);
 assert.equal(rv.f1000_af74(0x100,0x104),10+(12>>3));   // max 10, min 4 -> 10 + 1
 ww(0x100,0x8000);ww(0x102,0);ww(0x104,0);ww(0x106,0);
 assert.equal(rv.f1000_af74(0x100,0x104),0x8000);        // |0x8000| stays 0x8000, compared unsigned
 provide({f2c46_32c6:(i)=>i});                          // identity table makes the arithmetic visible
 assert.equal(rv.f1000_be7e(0,5),(0x400-0x400)<<4&0xffff);
 assert.equal(rv.f1000_be7e(5,0),(0-0x400)<<4&0xffff);
 assert.equal(rv.f1000_be7e(3,3),(0x200-0x400)<<4&0xffff);
 assert.equal(rv.f1000_be7e(1,2),((0x400-256)-0x400)<<4&0xffff); // a<b: 0x400 - tab[(1<<9)/2]
 assert.equal(rv.f1000_be7e(-1,2),((0x800-(0x400-256))-0x400)<<4&0xffff);
});

test('aeba DDA setup: 16.16 step and rounding seed',()=>{
 createMachine({assets});
 const p=0x200;
 ww(p+2,10);ww(p+6,20);
 assert.equal(rv.f1000_aeba(p,4),1);
 assert.equal(rd(p+4),(10<<16)/4);assert.equal(rw(p),(10<<16)/4&0xffff);   // |step| >= 0x8000: low word
 ww(p+2,10);ww(p+6,11);rv.f1000_aeba(p,4);
 assert.equal(rd(p+4),0x4000);assert.equal(rw(p),0x8000);                 // small step: 0x8000
 ww(p+2,11);ww(p+6,10);rv.f1000_aeba(p,4);
 assert.equal(rd(p+4)|0,-0x4000);assert.equal(rw(p),0x8000);
 assert.equal(rv.f1000_aeba(p,0),0);assert.equal(rd(p+4),0);assert.equal(rw(p),0);
});

test('aeaa waits for the start of the next vertical retrace, polling with idle',()=>{
 createMachine({assets});
 const g=rv.f1000_aeaa();let polls=0;
 for(;;){const r=g.next();if(r.done)break;assert.equal(r.value,IDLE);polls++;advanceTo(state.clock+state.quantum);}
 assert.ok(polls>0);assert.ok(inRetrace());
});

test('a2ac lane test and a2de text copy from segment 33ae',()=>{
 createMachine({assets});
 assert.equal(rv.f1000_a2ac(10,39),1);assert.equal(rv.f1000_a2ac(10,40),0);
 assert.equal(rv.f1000_a2ac(30000,-30000),1);   // 16-bit wrap of the difference
 assert.equal(rv.f1000_a2de(0,1),0x5a1e);
 assert.ok(strAt(0x5a1e).length>0);
});
