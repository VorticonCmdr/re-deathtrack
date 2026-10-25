// Segment 2524 checks: argv parsing, the quiz shuffle 21d2, sound option mapping 23fe, TTM indexing and
// interpretation of the real title.ttm.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rb,rsb,wb,rw,ww,rd,gaddr,B,salloc,sfree,putStr,strAt,DGROUP,frb,fwb} from '../src/engine/mem.js';
import {lookup} from '../src/engine/host.js';
import {chunks,unpack} from '../src/formats.js';
import {rand,randReset,strcpy,strcat,stricmp,strlen,strcmp} from '../src/game/crt.js';
import {F} from '../src/game/link.js';
import * as U from '../src/game/seg2524.js';

const assets=await loadAssets();
const calls=[];
const rec=name=>(...a)=>{calls.push([name,...a]);return 0;};
const recG=name=>function*(...a){calls.push([name,...a]);return 0;};
// Near heap for the tests: bump allocator in a free DGROUP area.
let heap=0xc000;
const stubs={
 f1000_c144:()=>rand(), f1000_c132:stricmp, f1000_c2ce:strcpy, f1000_c298:strcat, f1000_c058:strlen, f1000_c10c:strcmp,
 f1000_c0a8:(alo,ahi,blo,bhi)=>((ahi<<16|alo)>>>0)%((bhi<<16|blo)>>>0),
 f1000_c080:(alo,ahi,blo,bhi)=>Math.floor(((ahi<<16|alo)>>>0)/((bhi<<16|blo)>>>0))>>>0,
 f1000_c094:(alo,ahi,blo,bhi)=>Math.imul(ahi<<16|alo,bhi<<16|blo)>>>0,
 f1000_c272:n=>{if(n===0xffff)return 0;const p=heap;heap+=n+1&~1;return p;},
 f1000_c280:rec('free'), f1000_c552:()=>1, f1000_c715:rec('musicStop'), f1000_c6dc:rec('mute'), f1000_c6fa:rec('unmute'),
 f1000_c54a:rec('speakerOn'), f1000_c60a:rec('musicPlay'), f1000_c156:rec('cls'), f1000_c03e:rec('box'),
 f1000_c070:recG('delay'), f1000_a39c:function*(){return 0;}, f1000_a390:rec('timerSet'), f1000_a3aa:recG('delayTicks'),
 f1000_aeaa:recG('retrace'),
 f1ff8_4457:function*(){return 0;}, f1ff8_4068:function*(){return 0;}, f1ff8_3fc2:function*(){return 0;}, f1ff8_4025:recG('mouseGet'),
 f1ff8_20ff:(a,b)=>{calls.push(['detect',a,b]);return 2;},
 f1ff8_2545:rec('blit'), f1ff8_2541:rec('drawFrame'), f1ff8_2454:rec('line'), f1ff8_3810:rec('fill'), f1ff8_3194:rec('circle'),
 f1ff8_44b4:rec('dissolve'), f1ff8_3cf1:rec('border'), f1ff8_3692:rec('font'), f1ff8_3cf5:rec('attr'),
 f1ff8_0476:rec('freeBitmap'), f1ff8_3722:rec('freeFont'), f1ff8_3ca6:rec('freePal'), f1ff8_3c64:p=>p,
 f1ff8_0006:n=>{calls.push(['loadBitmap',strAt(n)]);return 0x7000;},
 f1ff8_356e:n=>{calls.push(['loadFont',strAt(n)]);return 1;},
 f1ff8_3b7a:n=>{calls.push(['loadPal',strAt(n)]);return 2;},
 f1ff8_2fca:n=>{calls.push(['loadScreen',strAt(n)]);return 1;},
};
// Chunk/stream stubs serving decoded TTM: payloads by name.
const ttm=unpack(chunks(assets.get('TITLE.TTM'))[0].data);
Object.assign(stubs,{
 f1ff8_4de0:()=>0,
 f1ff8_4a48:n=>{const s=strAt(n);calls.push(['open',s]);return /TITLE\.TTM$/i.test(s)?0x1234:0;},
 f1ff8_4ade:()=>0x100, f1ff8_4d72:()=>ttm.length, f1ff8_0d47:()=>7, f1ff8_1310:()=>ttm.length,
 f1ff8_11f0:(h,off,seg,n)=>{assert.equal(seg,DGROUP);for(let i=0;i<n;i++)wb(off+i,ttm[i]);return n;},
 f1ff8_100d:rec('streamClose'), f1ff8_4da4:rec('chunkClose'),
});
// The stubs replace whatever other modules provide (assignment through the link proxy), so this file
// tests segment 2524 in isolation.
for(const [k,v] of Object.entries(stubs))F[k]=v;
const run=g=>{for(let i=0;i<1e6;i++){const r=g.next();if(r.done)return r.value;}throw Error('generator did not finish');};

test('argv parsing: DEMO, adapter, joystick, music, sound',()=>{
 createMachine({assets});
 const argv=a=>{const ps=a.map(s=>{const p=salloc(s.length+1);putStr(p,s);return p;});const v=salloc(2*a.length+2);ps.forEach((p,i)=>ww(v+2*i,p));return v;};
 ww(0x1fa8,0);ww(0x1fb2,1);ww(0x1fb0,1);ww(0x1fc0,1);
 calls.length=0;
 U.f2524_043c(6,argv(['DTRACK.EXE','demo','ge','M0','S0','J0']));
 assert.equal(rw(0x1fa8),1);assert.equal(rw(0x1fb2),0);assert.equal(rw(0x1fb0),0);assert.equal(rw(0x1fc0),0);
 assert.deepEqual(calls.find(c=>c[0]==='detect'),['detect',0,2]);   // GE -> EGA request 2
 assert.equal(rw(0x95d6),2);                                        // detection result stored
 const adapter=s=>{calls.length=0;U.f2524_043c(2,argv(['X',s]));return calls.find(c=>c[0]==='detect')[2];};
 assert.equal(adapter('GC'),1);assert.equal(adapter('gh'),8);assert.equal(adapter('Gt'),4);assert.equal(adapter('GX'),0xf);
 U.f2524_043c(2,argv(['X','T1']));assert.equal(rw(0x1fb2),1);
 U.f2524_043c(2,argv(['X','M']));assert.equal(rw(0x1fb2),0xffd0);   // QUIRK: NUL - '0'
 U.f2524_043c(2,argv(['X','s7']));assert.equal(rw(0x1fb0),7);
 ww(0x1fa8,0);U.f2524_043c(1,argv(['X']));assert.equal(rw(0x1fa8),0);assert.equal(rw(0x95d6),2);
});

// Reference for 2524:21d2 written from the disassembly independently of the translation.
function quizReference(d,r){
 const a=[d&0xff];
 while(a.length<5){const v=(r()&0xf)+10&0xff;if(!a.slice(1).includes(v))a.push(v);}
 for(let n=0;n<100;n++){const i=r()&3,j=(r()+1&0xffff)&3;[a[i],a[j]]=[a[j],a[i]];}
 return a;
}
test('copy-protection shuffle 21d2 from a known RNG state',()=>{
 createMachine({assets});randReset();
 // Advance 4 draws so the candidate sequence is 11,15,19,15,...: the second 15 must be redrawn.
 for(let i=0;i<4;i++)rand();
 const save=B.slice(DGROUP*16+0x2154,DGROUP*16+0x215a+0x70);
 let draws=0;const ref=quizReference(5,()=>{draws++;return rand();});
 assert.equal(draws,4+3+200); // three rejected duplicates
 B.set(save,DGROUP*16+0x2154);
 // Hand-checked result for d=5 with the table from DTRACK.EXE after randReset (computed by quizReference).
 assert.deepEqual(ref,[11,5,15,19,22]); // 8eda[4]=22 is the last accepted draw and is never swapped
 ww(0x1fb6,0xffff);wb(0x8eda+5,0xa5);
 U.f2524_21d2(5);
 assert.equal(rb(0x8eda+5),0xa5); // only 5 bytes written
 const got=[0,1,2,3,4].map(i=>rb(0x8eda+i));
 assert.deepEqual(got,ref);
 assert.equal(rw(0x1fb6),ref.indexOf(5)+1);
});

test('sound option mapping 23fe',()=>{
 createMachine({assets});
 const expect=[[1,1],[0,1],[1,0],[0,0]]; // [music 1fb2, effects 1fb0] per option
 ww(0x8f06,0x10);ww(0x8f08,0x3000);    // music loaded
 for(let k=0;k<4;k++)for(const [m0,e0] of [[0,0],[0,1],[1,0],[1,1]]){
  ww(0x1fb2,m0);ww(0x1fb0,e0);
  U.f2524_23fe(k);
  assert.deepEqual([rw(0x1fb2),rw(0x1fb0)],expect[k],`k=${k} from ${m0},${e0}`);
  U.f2524_2396();
  for(let i=0;i<4;i++)assert.equal(rb(rw(0x2816+2*i)),i===k?0x2a:0x20);
 }
 ww(0x8f06,0);ww(0x8f08,0);              // no music: music forced off
 U.f2524_23fe(0);assert.deepEqual([rw(0x1fb2),rw(0x1fb0)],[0,1]);
 ww(0x1fb2,5);U.f2524_23fe(7);assert.equal(rw(0x1fb2),0);
});

test('TTM: title.ttm decodes, indexes and runs every part without unknown opcodes',()=>{
 createMachine({assets});
 assert.equal(ttm.length,477);
 heap=0xc000;calls.length=0;
 const unknown=[];U.hooks.ttmUnknown=op=>unknown.push(op);
 U.f2524_089c();
 U.f2524_2be8(0x1fa);
 const slot=U.f2524_08de(0x99ec);
 assert.equal(slot,0);
 const buf=rw(0x5da);assert.equal(rw(0x5e4),buf+476);
 assert.equal(U.f2524_0a7c(slot),1);
 const parts=[];for(let i=0;i<300&&rw(0x5790+2*i);i++)parts.push(rw(0x5790+2*i)-buf);
 // Independent scan of the part boundaries: each part ends at a '/' opcode.
 assert.equal(parts[0],0);assert.ok(parts.length>10);
 for(let i=1;i<parts.length;i++)assert.equal(ttm[parts[i]-1],0x2f);
 for(let e=0;e<parts.length;e++)assert.equal(run(U.f2524_0bb6(e)),1,`part ${e}`);
 assert.equal(run(U.f2524_0bb6(parts.length)),0);
 assert.deepEqual(unknown,[]);
 assert.deepEqual(calls.filter(c=>c[0]==='loadBitmap').map(c=>c[1].replace(/^.*\\/,'')),['DYNAMIX.BMP','CITYLINE.BMP','TITLE.BMP']);
 assert.deepEqual(calls.filter(c=>c[0]==='loadScreen').map(c=>c[1].replace(/^.*\\/,'')),['CITYPIC.SCR']);
 assert.ok(calls.some(c=>c[0]==='open'&&/ACTIVISIO$/.test(c[1])));   // opcode '*'
 assert.ok(calls.some(c=>c[0]==='dissolve'));                         // transitions / '#'
 // Whole player: runs to the end and cleans up.
 U.hooks.ttmUnknown=null;heap=0xc000;
 assert.equal(run(U.f2524_0584()),0);
 assert.equal(rw(0x3849),0xc7);assert.equal(rw(0x5da),0);
});

test('screen transition 1528 mode P wipes rows bottom-up',()=>{
 createMachine({assets});calls.length=0;
 U.f2524_1528(0,0,320,200,0x50);
 const b=calls.filter(c=>c[0]==='blit');
 assert.deepEqual(b[0],['blit',0,197,320,3]);
 assert.deepEqual(b.at(-1),['blit',0,3,320,3]);
 assert.equal(b.length,195);
});

test('screen transition 1528 mode I shrinks rings with 32-bit scale factors',()=>{
 createMachine({assets});calls.length=0;
 U.f2524_1528(0,0,320,200,0x49);
 const b=calls.filter(c=>c[0]==='blit');
 // w=160 h=100 m=160: sx=160000/160=1000, sy=100000/160=625. k=157: dx=157 dy=98 -> first 3-wide sides.
 assert.deepEqual(b[0],['blit',0,0,3,200]);
 assert.deepEqual(b[1],['blit',317,0,3,200]);
 assert.deepEqual(b.at(-1),['blit',160,0,160,200]); // k=0: dx=dy=0
});

test('TTM operand sizes of 0a7c agree with the interpreter 0c66 for every opcode',()=>{
 createMachine({assets});heap=0xc000;
 const unknown=[];U.hooks.ttmUnknown=op=>unknown.push(op);
 const buf=0xd000,put=a=>{for(let i=0;i<64;i++)wb(buf+i,a[i]??0);ww(0x5da,buf);ww(0x5e4,buf+a.length-1);};
 const handled=new Set([0x0b,0x0c,0x0d,0x23,0x24,0x26,0x2a,0x2b,0x2d,0x31,0x32,0x34,0x37,0x38,0x39,0x3b,0x3f,0x40,0x42,0x43,0x44,
  ...Array.from({length:11},(_,i)=>0x47+i),0x52,0x53,0x5e,0x60]);
 let checked=0;
 for(let op=0;op<256;op++){
  if(op===0x2f)continue;
  put([op,...Array(12).fill(0x2f),0]);
  if(U.f2524_0a7c(0)!==1)continue;                          // 0a7c cannot size it (e.g. 'A')
  const second=rw(0x5792);
  const isString=second===0||second-buf>12;                   // skipped up to the NUL: an inline-name opcode
  const size=isString?2:second-buf-1;
  put([op,...Array(size-1).fill(0),0x2f,0]);
  ww(0x5790,buf);unknown.length=0;calls.length=0;
  const r=run(U.f2524_0c66(0));
  if(handled.has(op)){assert.equal(r,1,`op ${op.toString(16)}`);assert.deepEqual(unknown,[]);}
  else{assert.equal(r,0,`op ${op.toString(16)}`);assert.deepEqual(unknown,[op<0x80?op:op-256]);}
  checked++;
 }
 assert.ok(checked>40);
 U.hooks.ttmUnknown=null;
});

test('picker drawer far pointers in DS:1178 are relocated and registered',()=>{
 createMachine({assets});
 const want=[0x38fa,0x392a,0x39ea,0x395a,0x39a2];
 want.forEach((o,i)=>{assert.equal(rd(0x1178+4*i),gaddr(0x2524,o));assert.ok(lookup(rd(0x1178+4*i)));});
});
