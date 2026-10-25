// CGA (adapter id 1) game-side branches: dither/ground tables 2524:030a, the .MAP strip loader 1000:140c, the sky
// panorama 2f73:00f0 and the ground fill 2f73:035f/0513 on a B800 image. Expected values are hand-derived from the
// disassembly (see the comments); the image tables (DS:2ad6/2ada masks) are read, not transcribed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rb,rw,rsw,wb,ww,wd,rd,frb,fwb,fww,B,DGROUP,salloc,sfree} from '../src/engine/mem.js';
import {UnsupportedError} from '../src/engine/host.js';
import {dosAlloc} from '../src/engine/dos.js';
import {F,override} from '../src/game/link.js';
import * as R from '../src/game/render3d.js';
import * as U from '../src/game/seg2524.js';
import * as FL from '../src/game/flow.js';

const assets=await loadAssets();
createMachine({assets});
const calls=[];
const rec=n=>(...a)=>{calls.push([n,...a]);return 0;};

// ---- 2524:030a: CGA dither / ground tables ----
test('2524:0260 on adapter 1 sets the low-colour flag and builds the 100 ground records (030a)',()=>{
 override({f2f73_05d8:rec('05d8'),f1ff8_40c7:rec('40c7'),f1ff8_3af2:rec('3af2'),f1ff8_3fee:()=>0,f1ff8_3dd1:rec('3dd1'),f1000_c442:rec('c442'),f1000_c52d:rec('c52d')});
 wb(0x385d,1);ww(0x896c,0x77);ww(0x1fc0,0);ww(0x2d28,0);
 for(let i=0;i<10;i++){ww(0x1cf0+2*i,0x55);ww(0x1cdc+2*i,0x66);}
 U.f2524_0260();
 assert.equal(rw(0x896c),1);
 for(let i=0;i<10;i++){assert.equal(rw(0x1cf0+2*i),0);assert.equal(rw(0x1cdc+2*i),3);}
 // Row r: word +6 = aaaah (even r) / 5555h (odd r); word +0 = 0 (even r) / the running word after the XOR (odd r) = aaaah.
 for(let r=0;r<100;r++){
  assert.equal(rw(0x9258+8*r),r&1?0x5555:0xaaaa,`+6 row ${r}`);
  assert.equal(rw(0x9252+8*r),r&1?0xaaaa:0,`+0 row ${r}`);
 }
 // Adapter 2 clears the flag again (0376) and leaves the tables alone.
 wb(0x385d,2);ww(0x896c,1);U.f2524_0260();assert.equal(rw(0x896c),0);
});

// ---- 1000:140c: .MAP strips converted by the CGA driver ----
test('1000:1208 on adapter 1 converts 160-byte source rows into 80-byte strips via 2fd2:014e',()=>{
 // Fake .MAP stream: n=2, widths (read over by the heights), heights {25, 25}, then 2*25 rows of 160 bytes.
 const N=2,H=25,rowsTotal=N*H;
 const payload=new Uint8Array(rowsTotal*160).map((_,i)=>(i*7+3)&0xff);
 const stream=[...Uint8Array.of(N,0),...Uint8Array.of(0x40,1,0x40,1),...Uint8Array.of(H,0,H,0),...payload];
 let pos=0;const log=[];
 const blocks=[];
 override({
  f1000_c1a2:()=>0x1234,f1000_e3d0:()=>stream.length,f1ff8_0d47:()=>5,
  f1ff8_11f0:(h,off,seg,n)=>{log.push(['read',off,seg,n]);for(let i=0;i<n;i++)fwb(seg,off+i,stream[pos++]);return n;},
  f1ff8_3a88:(lo,hi)=>{const {seg}=dosAlloc(((hi<<16|lo)+15>>4)+1);blocks.push({seg,size:hi<<16|lo});return (seg<<16)>>>0;},
  f1ff8_3ae2:(off,seg)=>{log.push(['free',off,seg]);},
  f1000_e80c:(alo,ahi,blo,bhi)=>Math.trunc(((ahi<<16|alo)|0)/((bhi<<16|blo)|0))>>>0,
  f2fd2_014e:(do_,ds,so,ss,w,rows,fl)=>{log.push(['conv',do_,ds,so,ss,w,rows,fl]);},
  f1ff8_100d:rec('close'),f1000_c264:rec('fclose'),
 });
 ww(0x95d6,1);ww(0x9bce,0);ww(0x9bd0,0);
 FL.f1000_1208(0x100);
 // total = 50*160 = 8000 bytes; the strip block holds total/2 = 4000 bytes (first allocation), then the 4000-byte read buffer.
 assert.equal(blocks[0].size,4000);assert.equal(blocks[1].size,0xfa0);
 const conv=log.filter(l=>l[0]==='conv');
 assert.equal(conv.length,2);
 const dst=blocks[0].seg,buf=blocks[1].seg;
 // chunk 0xfa0 = 25 rows; width 0x140; flag 0. The destination advances by chunk/2 = 2000 bytes.
 assert.deepEqual(conv[0],['conv',0,dst,0,buf,0x140,25,0]);
 assert.deepEqual(conv[1],['conv',2000,dst,0,buf,0x140,25,0]);
 // The read buffer is freed once; strip pointers step by height*80 = 2000.
 assert.equal(log.filter(l=>l[0]==='free').length,1);
 assert.deepEqual(log.find(l=>l[0]==='free'),['free',0,buf]);
 assert.equal(rw(0x9bce),0);assert.equal(rw(0x9bd0),dst);
 assert.equal(rw(0x9bce+4),2000);assert.equal(rw(0x9bd0+4),dst);
});

// ---- B800 helpers ----
const rowOff=r=>(r&1)*0x2000+(r>>1)*80;                       // the CGA interlaced row table (DS:3d3e, set by the driver)
function cgaSetup(){
 for(let r=0;r<200;r++)ww(0x3d3e+2*r,rowOff(r));
 ww(0x3852,0xb800);ww(0x3858,0xb800);
 B.fill(0xee,0xb8000,0xbc000);
}
const row=(r,n=80)=>[...Array(n)].map((_,i)=>frb(0xb800,rowOff(r)+i));
function rec2(r,col,b,a,lc,rc){const o=0x9252+8*r;ww(o,col);ww(o+2,b);ww(o+4,a);wb(o+6,lc);wb(o+7,rc);}

test('2f73:02a4 on adapter 1 is the CGA ground fill 035f/0513 (masks read from the image)',()=>{
 assert.deepEqual([...Array(4)].map((_,i)=>rb(0x2ad6+i)),[0x00,0xc0,0xf0,0xfc]);
 assert.deepEqual([...Array(4)].map((_,i)=>rb(0x2ada+i)),[0xff,0x3f,0x0f,0x03]);
 assert.equal(rw(0x2afc+2),0x035f);
 cgaSetup();ww(0x95d6,1);ww(0x8db2,0x62);               // rows 0x61..0x63
 rec2(0x61,0x1234,21,5,0xaa,0xcc);
 rec2(0x62,0x1234,8,8,0xaa,0xcc);                       // a == b: no middle
 rec2(0x63,0x77ee,4,0,0xaa,0xcc);                       // count has bit 2 set: STOSB path
 R.f2f73_02a4();
 // Row 0x61: left verge (5+3)>>2 = 2 bytes of aa; right verge from byte 21>>2 = 5 (75 bytes of cc).
 // Middle: len = 21-5 = 16, a&3 = 1 -> 17. Byte 1 (a>>2): (aa & c0) | (~c0 & 34) = 80|34 = b4. Then 17>>3 = 2 words
 // (STOSW AL,AH = 34 12) at bytes 2..5; bit 2 of 17 is 0 (no STOSB). Byte 6: (cc & 3f) | (~3f & 34) = 0c | 00 = 0c.
 const r61=row(0x61);
 assert.deepEqual(r61.slice(0,8),[0xaa,0xb4,0x34,0x12,0x34,0x12,0x0c,0xcc]);
 assert.ok(r61.slice(7).every(v=>v===0xcc));
 // Row 0x62: left verge 2 bytes of aa, right verge from byte 2; nothing else.
 const r62=row(0x62);assert.deepEqual(r62.slice(0,3),[0xaa,0xaa,0xcc]);assert.ok(r62.slice(2).every(v=>v===0xcc));
 // Row 0x63: a=0 -> no left verge, right verge from byte 1. Middle len 4: left byte 0 = (aa&00)|(~00&ee) = ee,
 // bit 2 set -> STOSB ee at byte 1, no words, right mask [0] = ff keeps byte 2 (cc).
 const r63=row(0x63);assert.deepEqual(r63.slice(0,3),[0xee,0xee,0xcc]);assert.ok(r63.slice(2).every(v=>v===0xcc));
 // Row 0x60 (above [8db2]-1) is untouched.
 assert.ok(row(0x60).every(v=>v===0xee));
});
test('2f73:035f draws nothing when [8db2] >= 100; id 4 stays unsupported',()=>{
 cgaSetup();ww(0x95d6,1);ww(0x8db2,0x64);rec2(0x63,0,10,2,1,2);
 R.f2f73_02a4();
 assert.ok(row(0x63).every(v=>v===0xee));
 ww(0x95d6,4);assert.throws(()=>R.f2f73_02a4(),UnsupportedError);
});

// ---- 2f73:00f0: CGA sky panorama ----
test('2f73:000f on adapter 1 copies 80-byte panorama rows with the wrap into strip (k+1) mod 6',()=>{
 cgaSetup();ww(0x95d6,1);ww(0x9642,25);
 const segs=[];
 const px=(k,r,c)=>(k*37+r*5+c*3)&0xff;
 for(let k=0;k<6;k++){
  const {seg}=dosAlloc(0x80);segs.push(seg);
  for(let r=0;r<25;r++)for(let c=0;c<80;c++)fwb(seg,r*80+c,px(k,r,c));
  ww(0x9bce+4*k,0);ww(0x9bd0+4*k,seg);
 }
 const check=(pan,k,xoff,top,start)=>{
  B.fill(0xee,0xb8000,0xbc000);
  R.f2f73_000f(top,start,xoff,pan);
  const c=xoff>>2,skip=top-start,rows=25-skip;
  for(let i=0;i<rows;i++){
   const got=row(start+skip+i);
   const exp=[...Array(80)].map((_,x)=>x<80-c?px(k,skip+i,c+x):px((k+1)%6,skip+i,x-(80-c)));
   assert.deepEqual(got,exp,`k=${k} row ${i}`);
  }
  assert.ok(row(start+skip-1).every(v=>v===0xee));       // the row above is untouched
  assert.ok(row(start+skip+rows).every(v=>v===0xee));    // and the one below
 };
 check(0x150,1,40,3,1);                                   // skip 2, c = 10 bytes
 check(5*320+10,5,100,5,5);                               // k = 5 wraps to strip 0 (BX = 24 -> 0)
 check(0x7f,0,0,10,10);                                   // c = 0: only the first run
});
test('2f73:000f on adapter 1: id 3 (Tandy) is still unsupported',()=>{
 ww(0x95d6,3);assert.throws(()=>R.f2f73_000f(3,1,0,0),UnsupportedError);
});
