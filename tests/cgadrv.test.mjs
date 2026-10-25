// CGA video path: driver (segment 2fd2, src/game/cgadrv.js), hardware model (src/engine/cga.js), adapter detection and INT 10h.
// Two kinds of evidence:
//  - hand-derived expectations from the disassembly (pixel patterns, interleaved row addressing, detection answers);
//  - differential runs: the original bytes of segment 2fd2, executed by the minimal 8086 interpreter in tests/x86mini.mjs from the
//    user's own loaded DTRACK.EXE, must leave memory and registers exactly as the translation does (seeded fuzzing).
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {B,rb,rw,wb,ww,frb,fwb,gseg,DGROUP,fp} from '../src/engine/mem.js';
import {UnsupportedError,lookup} from '../src/engine/host.js';
import {F,override} from '../src/game/link.js';
import '../src/game/modules.js';
import * as D from '../src/game/cgadrv.js';
import * as cga from '../src/engine/cga.js';
import {int10,int21,outp,inp} from '../src/game/bios.js';
import {Cpu,run} from './x86mini.mjs';
import {runUntil,PIT_HZ} from '../src/engine/host.js';
import {startGame} from '../src/game/boot.js';
import {memoryStorage} from '../src/web/storage.js';

const assets=await loadAssets();
const CS=gseg(0x2fd2),LIN=(s,o)=>(s<<4)+(o&0xffff);
const PAGE=0x4800,PAGE2=0x4c00,SRC=0x5000,VRAM=0xb800; // free conventional segments (above the DOS arena start, never allocated here)
function rng(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
const ri=(r,n)=>Math.floor(r()*n);
function fresh(){
 createMachine({assets});cga.hw.noEga=false;
 D.f2fd2_0252.call(null);
 ww(0x3858,PAGE);ww(0x3856,PAGE2);ww(0x3854,VRAM);ww(0x3852,PAGE2);wb(0x384b,0);wb(0x384e,3);wb(0x384d,3);wb(0x3842,0);
}
const pix=(seg,x,y)=>{const o=(y&1)*0x2000+(y>>1)*80+(x>>2);return B[LIN(seg,o)]>>(6-2*(x&3))&3;};
const setpix=(seg,x,y,c)=>{const o=LIN(seg,(y&1)*0x2000+(y>>1)*80+(x>>2)),s=6-2*(x&3);B[o]=B[o]&~(3<<s)|c<<s;};
const bytesAt=(seg,o,n)=>Array.from(B.subarray(LIN(seg,o),LIN(seg,o)+n));

// ---- differential harness ----
const SP0=0xb800,STACK_LO=0x9000,STACK_HI=0xba40;
function freadStub(){let n=0;return (buf,size,count,f)=>{for(let i=0;i<size*count;i++)wb(buf+i,(n++*37+f)&0xff);return count;};}
// Runs the original code at 2fd2:off. regs: ax bx cx dx si di bp ds es; args: stack words in C order (first = [bp+6]).
function oracle(off,{regs={},args=[]}={}){
 const cpu=new Cpu(),r=cpu.r,s=cpu.s;
 r[0]=regs.ax??0;r[3]=regs.bx??0;r[1]=regs.cx??0;r[2]=regs.dx??0;r[6]=regs.si??0;r[7]=regs.di??0;r[5]=regs.bp??0;
 s[3]=regs.ds??DGROUP;s[0]=regs.es??DGROUP;s[2]=DGROUP;s[1]=CS;r[4]=SP0;cpu.ip=off;
 const push=v=>{r[4]-=2;B[LIN(DGROUP,r[4])]=v&0xff;B[LIN(DGROUP,r[4]+1)]=v>>8;};
 for(let i=args.length-1;i>=0;i--)push(args[i]);
 push(0xdead);push(0);
 const regsOf=()=>({ax:r[0],bx:r[3],cx:r[1],dx:r[2],si:r[6],di:r[7],ds:s[3],es:s[0]});
 const back=o=>{r[0]=o.ax;r[3]=o.bx;r[1]=o.cx;r[2]=o.dx;};
 const arg=k=>B[LIN(DGROUP,r[4]+4+2*k)]|B[LIN(DGROUP,r[4]+5+2*k)]<<8;
 const ret=()=>{cpu.ip=B[LIN(DGROUP,r[4])]|B[LIN(DGROUP,r[4]+1)]<<8;s[1]=B[LIN(DGROUP,r[4]+2)]|B[LIN(DGROUP,r[4]+3)]<<8;r[4]+=4;};
 run(cpu,{
  far(c,seg,o){
   if(seg===gseg(0x1000)&&o===0xc214){r[0]=F.f1000_c214(arg(0),arg(1),arg(2),arg(3));ret();return;}
   if(seg===gseg(0x1ff8)&&o===0x3a88){const p=F.f1ff8_3a88(arg(0),arg(1));r[0]=p&0xffff;r[2]=p>>>16;ret();return;}
   throw Error(`unexpected far call ${seg.toString(16)}:${o.toString(16)}`);
  },
  int(c,n){const o=regsOf();o.ax=r[0];if(n===0x10)int10(o);else if(n===0x21){int21(o);c.cf=o.cf?1:0;}else throw Error('int '+n);back(o);},
 });
 return cpu;
}
function strip(a){a.fill(0,LIN(DGROUP,STACK_LO),LIN(DGROUP,STACK_HI));return a;}
// Runs `js` and the original on identical memory; throws on any difference in memory or in the named result registers.
function same(label,js,off,o,{ret}={}){
 const snap=B.slice();
 const fr=freadStub();
 const rst=override({f1000_c214:(b,s2,n,f)=>fr(b,s2,n,f)});
 let a,bb,rj,cpu;
 try{
  rj=js();a=strip(B.slice());
  B.set(snap);const fr2=freadStub();override({f1000_c214:(b,s2,n,f)=>fr2(b,s2,n,f)});
  cpu=oracle(off,o);bb=strip(B.slice());
 }finally{rst();}
 if(Buffer.compare(Buffer.from(a),Buffer.from(bb))!==0){
  let i=0;while(a[i]===bb[i])i++;
  const lo=Math.max(0,i-8);
  assert.fail(`${label}: memory differs at linear ${i.toString(16)} (js ${a[i].toString(16)} asm ${bb[i].toString(16)}); js ${Buffer.from(a.subarray(lo,i+8)).toString('hex')} asm ${Buffer.from(bb.subarray(lo,i+8)).toString('hex')}`);
 }
 if(ret)ret(rj,cpu);
 B.set(snap);
 return {rj,cpu};
}
const eqReg=(label,name,jsv,asm)=>assert.equal(jsv&0xffff,asm&0xffff,`${label}: ${name} js ${jsv&0xffff} asm ${asm&0xffff}`);
function randomPalette(r){for(let i=0;i<16;i++)for(const t of [0x41a4,0x41c4,0x4424,0x4444,0x46a4])ww(t+2*i,ri(r,65536));}
function randomFill(seg,off,n,r){for(let i=0;i<n;i++)B[LIN(seg,off+i)]=ri(r,256);}

// ---- hand-derived expectations ----
test('adapter 1 init: BIOS mode 4, row table interleaves even/odd scanlines, colour tables replicate (c&3)',()=>{
 fresh();
 assert.equal(rb(0x385d),1);assert.equal(rb(0x3861),4);
 assert.equal(cga.cga.mode,4);assert.ok(cga.cga.active);
 assert.equal(rw(0x3854),0xb800);assert.notEqual(rw(0x3852),0);assert.notEqual(rw(0x3850),0);
 // DS:3d3e[y] = 0x2000 * (y & 1) + 80 * (y >> 1)
 for(const y of [0,1,2,3,100,198,199])assert.equal(rw(0x3d3e+2*y),(y&1)*0x2000+(y>>1)*80,`row ${y}`);
 for(let c=0;c<16;c++){for(const t of [0x41a4,0x41c4,0x4424,0x4444,0x46a4])assert.equal(rw(t+2*c),(c&3)*0x5555);}
 // the three pages are cleared
 for(const s of [rw(0x3854),rw(0x3852),rw(0x3850)])assert.ok(bytesAt(s,0,0x4000).every(v=>v===0));
 // mode 4: mode control 2Ah, colour select 30h (BIOS data copies at 0040:0065/66)
 assert.equal(frb(0x40,0x65),0x2a);assert.equal(frb(0x40,0x66),0x30);
});

test('getPixel/putPixel address the interleaved frame buffer: even rows at +0, odd rows at +0x2000, 80 bytes per row',()=>{
 fresh();
 D.f2fd2_138e(0,0,3);D.f2fd2_138e(1,1,2);D.f2fd2_138e(7,2,1);D.f2fd2_138e(319,199,3);
 assert.equal(B[LIN(PAGE,0)],0xc0);                       // pixel 0 of byte 0, colour 3
 assert.equal(B[LIN(PAGE,0x2000)],0x20);                  // y = 1: odd bank, pixel 1 = 2
 assert.equal(B[LIN(PAGE,80+1)],0x01);                    // y = 2: second even line, x = 7 -> byte 1, pixel 3 (low bits) = 1
 assert.equal(B[LIN(PAGE,0x2000+99*80+79)],0x03);         // y = 199, x = 319
 assert.equal(D.f2fd2_1377(1,1),2);assert.equal(D.f2fd2_1377(0,0),3);assert.equal(D.f2fd2_1377(2,0),0);
 D.f2fd2_138e(0,0,1);                                      // replaces the pixel, neighbours untouched
 assert.equal(D.f2fd2_1377(0,0),1);
});

test('line: horizontal, vertical and single pixel patterns (colour 3 = both bits)',()=>{
 fresh();
 D.f2fd2_05dc(1,0,6,0,PAGE);                               // y = 0, x = 1..6
 assert.deepEqual(bytesAt(PAGE,0,3),[0x3f,0xfc,0x00]);
 fresh();
 D.f2fd2_05dc(2,0,2,3,PAGE);                               // x = 2, y = 0..3: rows at 0, 0x2000, 0x50, 0x2050
 for(const o of [0,0x2000,0x50,0x2050])assert.equal(B[LIN(PAGE,o)],0x0c);
 assert.equal(B[LIN(PAGE,0x2000+0x50*0+80*2)],0);
 fresh();wb(0x384e,1);
 D.f2fd2_05dc(5,7,5,7,PAGE);                               // single pixel: colour 1 at x = 5, y = 7 (odd row 3)
 assert.equal(pix(PAGE,5,7),1);assert.equal(B[LIN(PAGE,0x2000+3*80+1)],0x10);
});

test('hspan solid: edge masks and whole words',()=>{
 fresh();
 D.f2fd2_1430(0xaaaa,3,10,0,0,PAGE);                       // colour 2, x = 3..12 on row offset 0
 for(let x=0;x<16;x++)assert.equal(pix(PAGE,x,0),x>=3&&x<13?2:0,`x ${x}`);
 fresh();
 D.f2fd2_1430(0x5555,0,1,0,0,PAGE);D.f2fd2_1430(0xffff,5,0,0,0,PAGE); // width 1; width 0 draws nothing
 assert.deepEqual(bytesAt(PAGE,0,2),[0x40,0]);
 // dither entry: DS:386a toggles, odd calls use the DX word
 fresh();
 D.f2fd2_1427(0x5555,0,4,0xaaaa,0,PAGE);D.f2fd2_1427(0x5555,0,4,0xaaaa,0x2000,PAGE);
 assert.equal(B[LIN(PAGE,0)],0xaa);assert.equal(B[LIN(PAGE,0x2000)],0x55);
});

test('fill spans: row y+i gets span i, dither words alternate by row parity',()=>{
 fresh();
 const L=0x7100;ww(L,0);ww(L+2,3);ww(L+4,2);ww(L+6,9);ww(L+8,0);ww(L+10,3);ww(L+12,5);ww(L+14,4); // rows 0..2: [2,9], [0,3], [5,4] (empty)
 wb(0x384d,2);
 D.f2fd2_1746(L);
 for(let x=0;x<12;x++)assert.equal(pix(PAGE,x,0),x>=2&&x<=9?2:0);
 for(let x=0;x<8;x++)assert.equal(pix(PAGE,x,1),x<=3?2:0);
 assert.ok(bytesAt(PAGE,80,12).every(v=>v===0));            // third span is empty (x2 < x1)
 // dither: colour 1 even rows 0x1111.., odd rows 0x2222..
 fresh();
 for(let i=0;i<16;i++){ww(0x4424+2*i,0xaaaa);ww(0x41a4+2*i,0x5555);}
 wb(0x384d,0);ww(L,0);ww(L+2,2);ww(L+4,0);ww(L+6,7);ww(L+8,0);ww(L+10,7);
 D.f2fd2_1746(L);
 assert.deepEqual(bytesAt(PAGE,0,3),[0x55,0x55,0]);                // row 0 (even) takes [3864] = 0x5555 for pixels 0..7
 assert.deepEqual(bytesAt(PAGE,0x2000,3),[0xaa,0xaa,0]);          // row 1 (odd) takes [3866] = 0xaaaa
});

test('sprite: mask 00 pixels replace, 11 pixels keep; all four shifts, unclipped',()=>{
 for(let s=0;s<4;s++){
  fresh();
  for(let y=0;y<8;y++)for(let x=0;x<40;x++)setpix(PAGE,x,y,(x+y)&3);
  const w=8,h=3,data=[[1,2,3,1,0,2,2,3],[3,3,0,1,1,2,0,1],[2,2,2,2,3,3,3,3]];
  const mask=data.map(r=>r.map(c=>c?0:3));
  // write 2 bpp data and mask rows (2 bytes per row)
  const pack=r=>[r[0]<<6|r[1]<<4|r[2]<<2|r[3],r[4]<<6|r[5]<<4|r[6]<<2|r[7]];
  let o=0;for(const r of data)for(const b of pack(r))B[LIN(SRC,o++)]=b;
  o=0x100;for(const r of mask)for(const b of pack(r))B[LIN(SRC,o++)]=b;
  const rec=0x7200;ww(rec,SRC);ww(rec+2,0);ww(rec+4,0x100);ww(rec+6,w);ww(rec+8,h);
  const before=[];for(let y=0;y<8;y++){before.push([]);for(let x=0;x<40;x++)before[y].push(pix(PAGE,x,y));}
  D.f2fd2_0b87(rec,8+s,2);
  for(let y=0;y<8;y++)for(let x=0;x<40;x++){
   const sx=x-8-s,sy=y-2,inside=sx>=0&&sx<w&&sy>=0&&sy<h&&data[sy][sx]!==0;
   assert.equal(pix(PAGE,x,y),inside?data[sy][sx]:before[y][x],`shift ${s} pixel ${x},${y}`);
  }
 }
});

test('glyph: aligned opaque and transparent rows, 2 bpp font bytes',()=>{
 fresh();
 wb(0x3874,8);wb(0x3888,2);wb(0x389c,0x41);wb(0x38b0,2);ww(0x38c4,SRC);
 // glyph 'B' (index 1): rows c0 30 / 0c 03 (one pixel set per 2 bits... 11 = set)
 for(const [i,v] of [0xc0,0x30,0x0c,0x03].entries())B[LIN(SRC,4+i)]=v;
 wb(0x3868,0x55);wb(0x3869,0xaa);                        // fg colour 1, bg colour 2
 D.f2fd2_0318(0x42,4,0,PAGE);
 assert.deepEqual(bytesAt(PAGE,1,2),[0x55&0xc0|0xaa&0x3f,0x55&0x30|0xaa&0xcf]);
 assert.deepEqual(bytesAt(PAGE,0x2000+1,2),[0x55&0x0c|0xaa&0xf3,0x55&0x03|0xaa&0xfc]);
 fresh();
 wb(0x3874,8);wb(0x3888,1);wb(0x389c,0x41);wb(0x38b0,1);ww(0x38c4,SRC);B[LIN(SRC,0)]=0xc0;B[LIN(SRC,1)]=0x03;wb(0x3868,0xff);wb(0x3842,1);
 B[LIN(PAGE,0)]=0x12;B[LIN(PAGE,1)]=0x34;
 D.f2fd2_0318(0x41,0,0,PAGE);
 assert.deepEqual(bytesAt(PAGE,0,2),[0x12|0xc0,0x34|0x03]);  // transparent: only the set pixels change
 // a character outside the font (index >= count) draws nothing
 B.fill(0,LIN(PAGE,0),LIN(PAGE,0)+16);D.f2fd2_0318(0x43,0,0,PAGE);assert.ok(bytesAt(PAGE,0,8).every(v=>v===0));
});

test('rect copies: copy, present (words), save/restore and the buffer size formula',()=>{
 fresh();
 for(let y=0;y<40;y++)for(let x=0;x<60;x++)setpix(PAGE2,x,y,(x*3+y)&3);
 D.f2fd2_1224(8,4,20,6);                                   // [3856] (= PAGE2) -> [3858] (= PAGE)
 for(let y=4;y<10;y++)for(let x=8;x<28;x++)assert.equal(pix(PAGE,x,y),pix(PAGE2,x,y),`copy ${x},${y}`);
 assert.equal(pix(PAGE,7,5),0);
 // size: (w>>2) + 1 (+1 if w&3), rounded up to even, times h
 assert.equal(D.f2fd2_12f2(10,5),5*4);assert.equal(D.f2fd2_12f2(16,2),2*6);assert.equal(D.f2fd2_12f2(4,1),1*2);
 // save from [3856], restore to [3858] at another position: pixel content round-trips through the byte-aligned window
 B.fill(0,LIN(PAGE,0),LIN(PAGE,0)+0x4000);
 D.f2fd2_128f(0x0100,0x6000,16,10,12,5);D.f2fd2_1313(0x0100,0x6000,16,20,12,5);
 for(let y=0;y<5;y++)for(let x=16;x<28;x++)assert.equal(pix(PAGE,x,20+y),pix(PAGE2,x,10+y));
 // present: back page [3852] words -> B800
 ww(0x3852,PAGE2);D.f2fd2_13cd(0,0,16,2);
 assert.deepEqual(bytesAt(VRAM,0,4),bytesAt(PAGE2,0,4));
});

test('palette: read 0xa2 bytes into palette p, set copies p over palette 0',()=>{
 fresh();
 const rst=override({f1000_c214:(b,s,n,f)=>{for(let i=0;i<s*n;i++)wb(b+i,i+1);return n;}});
 try{
  assert.equal(D.f2fd2_0004(0x1234,2),2);
 }finally{rst();}
 assert.equal(rb(0x4190+2),1);assert.equal(rb(0x419a+2),2);
 assert.equal(rw(0x41a4+2*64),0x0403);                    // palette 2 starts at +128 bytes, data byte 3 (index 2 + 1)
 D.f2fd2_0071(2);assert.equal(rw(0x41a4),0x0403);
 D.f2fd2_0071(0);assert.equal(rw(0x41a4),0x0403);        // p = 0 does nothing
});

test('mask and dither conversion of packed 4 bpp pixels',()=>{
 fresh();
 // mask: 1 pixel colour 0 -> 11, any other colour -> 00 (then NOT of the opaque bits)
 B[LIN(SRC,0)]=0x01;B[LIN(SRC,1)]=0x00;                     // pixels 0,1,0,0 (high nibble first): word 0x0001 -> only pixel 3 set? bytes: p0=0 p1=1 | p2=0 p3=0
 D.f2fd2_01e9(0,PAGE,0,SRC,1);
 assert.equal(B[LIN(PAGE,0)],~0x30&0xff);
 // converter: palette 0 colour c has T = low byte of DS:41a4[c]. Row parity selects which 2-bit half is used.
 ww(0x41a4+2*5,0x00e4);                                    // T = 0xe4 = 11 10 01 00
 B[LIN(SRC,0)]=0x55;B[LIN(SRC,1)]=0x55;                    // four pixels of colour 5
 D.f2fd2_00be(SRC,0,PAGE,0x100,1,0);                       // even row: hi nibble T&3 = 0, lo nibble (T>>2)&3 = 1
 assert.equal(B[LIN(PAGE,0x100)],0b00_01_00_01);
 D.f2fd2_00be(SRC,0,PAGE,0x101,1,1);                       // odd row: hi (T>>2)&3 = 1, lo T&3 = 0
 assert.equal(B[LIN(PAGE,0x101)],0b01_00_01_00);
});

test('sprite sizing and conversion of a group (w/2*h packed bytes become data + mask of half size each)',()=>{
 fresh();
 const h1=0x7300,h2=0x7310,list=0x7320;
 ww(h1+6,8);ww(h1+8,2);ww(h2+6,16);ww(h2+8,3);
 ww(list,h1);ww(list+2,h2);ww(list+4,0);
 const r=D.f2fd2_167e(list,0x7330);
 assert.equal(r,(8>>1)*2+(16>>1)*3);assert.equal(rw(0x7330),(16>>1)*3);
 for(let i=0;i<8;i++)B[LIN(SRC,i)]=0x11+i;                   // sprite 1 packed pixels
 D.f2fd2_1572(list,0x0000,SRC,0,0,0x2000,SRC);
 assert.equal(rw(h1),SRC);assert.equal(rw(h1+2),0);assert.equal(rw(h1+4),4);   // data 4 bytes, mask follows
 assert.equal(rw(h2+2),8);                                    // next sprite starts after data+mask (4+4)
});

test('dissolve (slot 23) on the CGA copies the whole rectangle from the source page to the displayed page, every unit size',()=>{
 for(const unit of [1,2,4,8]){
  fresh();
  const r=rng(90+unit);randomFill(PAGE2,0,0x4000,r);randomFill(VRAM,0,0x4000,r);ww(0x3856,PAGE2);
  const outside=Array.from(B.subarray(LIN(VRAM,0),LIN(VRAM,0)+0x4000));
  F.f1ff8_44b4(16,8,64,24,unit);
  for(let y=0;y<200;y++)for(let x=0;x<320;x++){
   const inside=x>=16&&x<80&&y>=8&&y<32;
   const want=inside?pix(PAGE2,x,y):(outside[(y&1)*0x2000+(y>>1)*80+(x>>2)]>>(6-2*(x&3))&3);
   assert.equal(pix(VRAM,x,y),want,`unit ${unit} pixel ${x},${y}`);
  }
 }
});

// ---- adapter detection ----
test('detection: mask 1 (argument GC) answers CGA through the 6845 probe and mode 3; no hardware EGA test needed',()=>{
 createMachine({assets});
 wb(0x49b5,1);
 assert.equal(F.f1ff8_21f5(),1);
 assert.equal(cga.cga.crtc[15],0x0f);                       // QUIRK: the probe "restores" register 0Fh with 0Fh
 assert.equal(frb(0x40,0x10)&0x30,0x20);assert.equal(frb(0x40,0x49),3);
});

test('detection: auto request (mask 0Fh) falls from EGA to CGA when the BIOS has no EGA',()=>{
 createMachine({assets});
 wb(0x49b5,0x0f);cga.hw.noEga=true;
 try{assert.equal(F.f1ff8_21f5(),1);}finally{cga.hw.noEga=false;}
 createMachine({assets});wb(0x49b5,0x0f);
 assert.equal(F.f1ff8_21f5(),2);                           // with the EGA BIOS the EGA wins
});

test('detection: mask 5 with a Tandy BIOS reports 3 (unsupported later), Hercules mask is unsupported',()=>{
 createMachine({assets});
 wb(0x49b5,0x05);fwb(0xf000,0xfffe,0xff);fwb(0xc000,0,0x21);
 assert.equal(F.f1ff8_21f5(),3);
 createMachine({assets});wb(0x49b5,0x08);
 assert.throws(()=>F.f1ff8_21f5(),UnsupportedError);
});

test('gfxSelectAdapter(1,..) installs the CGA table and initialises mode 4',()=>{
 createMachine({assets});
 assert.equal(F.f1ff8_20ff(1,0),1);
 assert.equal(rb(0x385d),1);
 // the active table holds the far pointers of the CGA driver: slot 3 = 2fd2:0b87, slot 23 = 1ff8:44b4, slot 25 = 29f6:0044
 const slot=n=>(rw(0x4924+4*n+2)<<16|rw(0x4924+4*n))>>>0;
 assert.equal(slot(3),fp(gseg(0x2fd2),0x0b87));assert.equal(slot(23),fp(gseg(0x1ff8),0x44b4));assert.equal(slot(25),fp(gseg(0x29f6),0x0044));
 assert.equal(slot(8),fp(gseg(0x2fd2),0x0251));
});

// ---- hardware model ----
test('INT 10h mode set programs 3D8/3D9 and clears the frame buffer; ports 3D8/3D9 reach the model',()=>{
 createMachine({assets});
 B.fill(0xff,0xb8000,0xbc000);
 int10({ax:6});
 assert.equal(cga.cga.mode,6);assert.equal(cga.cga.modeCtl,0x1e);assert.equal(cga.cga.colorSel,0x3f);
 assert.ok(bytesAt(0xb800,0,0x4000).every(v=>v===0));
 int10({ax:0x0083});B.fill(0xaa,0xb8000,0xb8010);int10({ax:0x0084});assert.equal(cga.cga.active,true);
 outp(0x3d9,0x21);assert.equal(cga.cga.colorSel,0x21);
 int10({ax:0x0b00,bx:0x0005});assert.equal(cga.cga.colorSel&0x1f,5);
 int10({ax:0x0b00,bx:0x0101});assert.equal(cga.cga.colorSel&0x20,0x20);
 outp(0x3d4,0x0f);outp(0x3d5,0x66);assert.equal(inp(0x3d5),0x66);
});

test('cgaFrame: mode 4 palette 1 (black, cyan, magenta, white), mode 6 foreground from colour select',()=>{
 createMachine({assets});
 int10({ax:4});
 B[0xb8000]=0x1b;                                           // pixels 0,1,2,3 = 0,1,2,3
 B[0xb8000+0x2000]=0xe4;                                    // y = 1: 3,2,1,0
 let f=cga.cgaFrame();
 assert.equal(f.w,320);
 assert.deepEqual(Array.from(f.idx.subarray(0,4)),[0,11,13,15]);        // intensity bit 4 set: bright cyan, bright magenta, white
 assert.deepEqual(Array.from(f.idx.subarray(320,324)),[15,13,11,0]);
 outp(0x3d9,0x00);                                          // palette 0 (green, red, brown), no intensity, background black
 f=cga.cgaFrame();assert.deepEqual(Array.from(f.idx.subarray(0,4)),[0,2,4,6]);
 outp(0x3d9,0x05);                                          // background colour 5 for colour 0 pixels
 B[0xb8000+1]=0x00;f=cga.cgaFrame();assert.equal(f.idx[4],5);
 int10({ax:6});B[0xb8000]=0xa5;B[0xb8000+0x2000]=0x80;
 f=cga.cgaFrame();assert.equal(f.w,640);
 assert.deepEqual(Array.from(f.idx.subarray(0,8)),[15,0,15,0,0,15,0,15]);assert.equal(f.idx[640],15);
 outp(0x3d9,0x04);f=cga.cgaFrame();assert.equal(f.idx[0],4);    // foreground = colour select bits 0-3
});

// ---- differential: the original bytes against the translation ----
function setupFont(r){
 const w=1+ri(r,24),h=1+ri(r,8),count=1+ri(r,4);
 wb(0x3874,w);wb(0x3888,h);wb(0x389c,0x40+ri(r,3));wb(0x38b0,count);ww(0x38c4,SRC);
 wb(0x3868,ri(r,256));wb(0x3869,ri(r,256));wb(0x3842,ri(r,2));
 randomFill(SRC,0,0x400,r);
 return {w,h,count};
}
test('differential: glyph (aligned, shifted, partial widths, opaque and transparent)',()=>{
 const r=rng(11);
 for(let k=0;k<400;k++){
  fresh();randomFill(PAGE,0,0x4000,r);setupFont(r);
  const x=ri(r,8)===0?ri(r,40)*4:ri(r,250),y=ri(r,180),ch=0x3e+ri(r,8);
  if(rb(0x3874)%4===0&&ri(r,2))wb(0x3874,4*(1+ri(r,6)));
  const lbl=`glyph #${k} w=${rb(0x3874)} h=${rb(0x3888)} x=${x} y=${y} ch=${ch} tr=${rb(0x3842)}`;
  same(lbl,()=>D.f2fd2_0318(ch,x,y,PAGE),0x318,{regs:{ax:ch,dx:x,bp:y,es:PAGE}});
 }
});
test('differential: line (all octants, horizontal, vertical, diagonal, single pixel)',()=>{
 const r=rng(22);
 for(let k=0;k<1500;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomPalette(r);wb(0x384e,ri(r,16));
  let x1=ri(r,320),x2=ri(r,320),y1=ri(r,200),y2=ri(r,200);
  const kind=ri(r,10);
  if(kind===0)y2=y1;else if(kind===1)x2=x1;else if(kind===2){x2=Math.min(319,x1+ri(r,60));y2=Math.min(199,y1+(x2-x1));}
  else if(kind===3){x2=Math.min(319,x1+ri(r,60));y2=Math.max(0,y1-(x2-x1));}
  else if(kind===4){x2=x1;y2=y1;}
  if(x2<x1)[x1,x2,y1,y2]=[x2,x1,y2,y1];                  // the caller guarantees x1 <= x2
  if(kind===2||kind===3)x2=Math.max(x1,x2);
  same(`line #${k} (${x1},${y1})-(${x2},${y2})`,()=>D.f2fd2_05dc(x1,y1,x2,y2,PAGE),0x5dc,{regs:{bx:x1,cx:y1,dx:x2,si:y2,es:PAGE}});
 }
});
test('differential: sprite (unclipped and clipped, all shifts and flags)',()=>{
 const r=rng(33);
 for(let k=0;k<1200;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomFill(SRC,0,0x1000,r);
  const w=4*(1+ri(r,8)),h=1+ri(r,10),bytes=(w>>2)*h;
  const rec=0x7200;ww(rec,SRC);ww(rec+2,0x10);ww(rec+4,0x10+bytes);ww(rec+6,w);ww(rec+8,h);
  const clip=ri(r,3)>0;wb(0x384b,clip?1:0);
  const x0=ri(r,8),y0=ri(r,8);ww(0x3843,x0*4+ri(r,3));ww(0x3845,Math.min(319,x0*4+8+ri(r,300)));ww(0x3847,y0);ww(0x3849,y0+ri(r,190));
  const x=ri(r,330)-ri(r,12),y=ri(r,200)-ri(r,12);
  same(`sprite #${k} w=${w} h=${h} x=${x} y=${y} clip=${clip}`,()=>D.f2fd2_0b87(rec,x,y),0xb87,{args:[rec,x&0xffff,y&0xffff]});
 }
});
test('differential: hspan, fill spans, pixels',()=>{
 const r=rng(44);
 for(let k=0;k<600;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomPalette(r);
  const x=ri(r,330)-5,cx=ri(r,40)-3,di=(ri(r,2)*0x2000+ri(r,100)*80),ax=ri(r,65536),dx=ri(r,65536);
  wb(0x386a,ri(r,2));
  same(`hspan solid #${k}`,()=>D.f2fd2_1430(ax,x&0xffff,cx&0xffff,dx,di,PAGE),0x1430,{regs:{ax,bx:x&0xffff,cx:cx&0xffff,dx,di,es:PAGE}});
  same(`hspan dither #${k}`,()=>D.f2fd2_1427(ax,x&0xffff,cx&0xffff,dx,di,PAGE),0x1427,{regs:{ax,bx:x&0xffff,cx:cx&0xffff,dx,di,es:PAGE}});
 }
 for(let k=0;k<600;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomPalette(r);wb(0x384d,ri(r,16));
  if(ri(r,3)===0)for(let i=0;i<16;i++)ww(0x4424+2*i,rw(0x41a4+2*i));
  const L=0x7100,n=1+ri(r,6);ww(L,ri(r,190));ww(L+2,n);
  for(let i=0;i<n;i++){const a=ri(r,300),b=ri(r,3)?a+ri(r,60):a-ri(r,5);ww(L+4+4*i,a);ww(L+6+4*i,Math.max(0,b));}
  same(`fillspans #${k}`,()=>D.f2fd2_1746(L),0x1746,{regs:{si:L}});
 }
 for(let k=0;k<300;k++){
  fresh();randomFill(PAGE,0,0x4000,r);
  const x=ri(r,320),y=ri(r,200),c=ri(r,256);
  same(`put #${k}`,()=>D.f2fd2_138e(x,y,c),0x138e,{args:[x,y,c]});
  same(`get #${k}`,()=>D.f2fd2_1377(x,y),0x1377,{args:[x,y],ret:(rj,cpu)=>eqReg('get','al',rj,cpu.r[0])});
 }
});
test('differential: rect copy, save, restore, present, size',()=>{
 const r=rng(55);
 for(let k=0;k<300;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomFill(PAGE2,0,0x4000,r);randomFill(0x6000,0,0x800,r);
  const x=ri(r,300),y=ri(r,150),w=1+ri(r,60),h=1+ri(r,20);
  same(`copy #${k}`,()=>D.f2fd2_1224(x,y,w,h),0x1224,{args:[x,y,w,h]});
  same(`save #${k}`,()=>D.f2fd2_128f(0x0100,0x6000,x,y,w,h),0x128f,{args:[0x0100,0x6000,x,y,w,h]});
  same(`restore #${k}`,()=>D.f2fd2_1313(0x0100,0x6000,x,y,w,h),0x1313,{args:[0x0100,0x6000,x,y,w,h]});
  same(`present #${k}`,()=>D.f2fd2_13cd(x,y,w,h),0x13cd,{args:[x,y,w,h]});
  same(`size #${k}`,()=>D.f2fd2_12f2(w,h),0x12f2,{args:[w,h],ret:(rj,cpu)=>{eqReg('size','ax',rj,cpu.r[0]);eqReg('size','dx',rj>>>16,cpu.r[2]);}});
 }
});
test('differential: palette, converter, mask, blit, sprite groups, font loader, init',()=>{
 const r=rng(66);
 for(let k=0;k<60;k++){
  fresh();randomPalette(r);const p=ri(r,8)+(k%7===0?0:0);
  same(`readpal #${k}`,()=>D.f2fd2_0004(0x77,p),0x4,{args:[0x77,p]});
  same(`setpal #${k}`,()=>D.f2fd2_0071(p),0x71,{args:[p]});
 }
 for(let k=0;k<200;k++){
  fresh();randomPalette(r);randomFill(SRC,0,0x800,r);randomFill(PAGE,0,0x4000,r);
  const w4=1+ri(r,40),sOff=ri(r,0x20),dOff=ri(r,0x20),par=ri(r,2);
  same(`converter #${k}`,()=>{const o=D.f2fd2_00be(SRC,sOff,PAGE,dOff,w4,par);return o;},0xbe,{regs:{ds:SRC,si:sOff,es:PAGE,di:dOff,cx:w4,dx:par},
   ret:(o,cpu)=>{eqReg('conv','si',o.si,cpu.r[6]);eqReg('conv','di',o.di,cpu.r[7]);}});
  const w=4*(1+ri(r,12)),h=1+ri(r,6);
  same(`convertRows #${k}`,()=>D.f2fd2_014e(dOff,PAGE,sOff,SRC,w,h,par),0x14e,{args:[dOff,PAGE,sOff,SRC,w,h,par]});
  same(`buildMask #${k}`,()=>D.f2fd2_01e9(dOff,PAGE,sOff,SRC,w4),0x1e9,{args:[dOff,PAGE,sOff,SRC,w4]});
  const x=4*ri(r,60),y=ri(r,150),bw=4*(1+ri(r,20)),bh=1+ri(r,5);
  same(`blit #${k}`,()=>D.f2fd2_16c5(sOff,SRC,x,y,bw,bh),0x16c5,{args:[sOff,SRC,x,y,bw,bh]});
 }
 for(let k=0;k<80;k++){
  fresh();randomFill(SRC,0,0x1000,r);randomFill(0x6000,0,0x1000,r);
  const list=0x7320,n=1+ri(r,4);
  for(let i=0;i<n;i++){const h=0x7340+0x10*i;ww(list+2*i,h);ww(h+6,4*(1+ri(r,8)));ww(h+8,1+ri(r,6));}
  ww(list+2*n,0);
  same(`sizeof #${k}`,()=>D.f2fd2_167e(list,0x7330),0x167e,{args:[list,0x7330],ret:(rj,cpu)=>{eqReg('sz','ax',rj,cpu.r[0]);eqReg('sz','dx',rj>>>16,cpu.r[2]);}});
  const off=ri(r,0x20),aux=ri(r,0x20);
  same(`convert #${k}`,()=>D.f2fd2_1572(list,off,SRC,0,0,aux+0x800,SRC),0x1572,{args:[list,off,SRC,0,0,aux+0x800,SRC]});
 }
 for(let k=0;k<40;k++){
  fresh();
  const w=1+ri(r,20),h=1+ri(r,6),cnt=1+ri(r,4),i=ri(r,3);
  wb(0x3874+i,w);wb(0x3888+i,h);wb(0x38b0+i,cnt);
  same(`fontload #${k} w=${w} h=${h} cnt=${cnt} i=${i}`,()=>D.f2fd2_14c5(0x55,i),0x14c5,{args:[0x55,i],ret:(rj,cpu)=>eqReg('font','ax',rj,cpu.r[0])});
 }
 createMachine({assets});
 same('init',()=>D.f2fd2_0252(),0x252,{ret:(rj,cpu)=>eqReg('init','al',rj,cpu.r[0])});
});
test('differential: every sprite body is reached (13 handlers) with identical output',()=>{
 const seen=new Set();
 const r=rng(77);
 for(let k=0;k<400;k++){
  fresh();randomFill(PAGE,0,0x4000,r);randomFill(SRC,0,0x400,r);
  const rec=0x7200,w=4*(2+ri(r,6)),h=1+ri(r,4),bytes=(w>>2)*h;ww(rec,SRC);ww(rec+2,0x10);ww(rec+4,0x10+bytes);ww(rec+6,w);ww(rec+8,h);
  wb(0x384b,1);ww(0x3843,ri(r,2)?0:ri(r,12));ww(0x3845,ri(r,2)?319:20+ri(r,40));ww(0x3847,0);ww(0x3849,199);
  const x=ri(r,40),y=ri(r,30);
  same(`bodies #${k}`,()=>{const o=D.f2fd2_0b87(rec,x,y);seen.add(rw(0x506a+(rw(0x5066)<<3)+(rw(0x5064)<<1)));return o;},0xb87,{args:[rec,x,y]});
 }
 // clipped on both sides: a wide sprite over a narrow window, every start x (covers flag 3 with each remaining-width shift)
 for(let x=-3;x<12;x++){
  fresh();randomFill(PAGE,0,0x4000,r);randomFill(SRC,0,0x400,r);
  const rec=0x7200;ww(rec,SRC);ww(rec+2,0x10);ww(rec+4,0x90);ww(rec+6,32);ww(rec+8,3);
  wb(0x384b,1);ww(0x3843,8);ww(0x3845,24);ww(0x3847,0);ww(0x3849,199);
  same(`both-sided clip x=${x}`,()=>{const o=D.f2fd2_0b87(rec,x,4);seen.add(rw(0x506a+(rw(0x5066)<<3)+(rw(0x5064)<<1)));return o;},0xb87,{args:[rec,x&0xffff,4]});
 }
 assert.deepEqual([...seen].map(v=>v.toString(16)).sort(),['0ce3','0d40','0dad','0e0a','0e73','0eec','0f55','0fbc','1033','109a','1105','1180','11eb'].map(v=>v.replace(/^0/,'')).sort());
});
test('the game boots with argument GC into CGA mode 6 and draws its first screen through the driver',()=>{
 createMachine({assets,storage:memoryStorage(),strict:true,args:['GC']});
 const gen=startGame({sound:'speaker'});
 runUntil(gen,Math.round(2*PIT_HZ));
 assert.equal(rb(0x385d),1);assert.equal(rw(0x95d6),1);
 assert.equal(cga.cga.mode,6);                              // 1000:a536 switches to mode 6 after the driver's mode 4
 const f=cga.cgaFrame();
 assert.equal(f.w,640);
 assert.ok(f.idx.filter(v=>v).length>2000,'the first screen has lit pixels');
});
test('the translation registers every far-pointer target of the CGA table',()=>{
 createMachine({assets});
 F.f1ff8_20ff(1,0);
 const want=[0x0252,0x0318,0x05dc,0x0b87,0x1224,0x128f,0x12f2,0x1313,0x0251,0x13cd,0x1430,0x1427,0x14c5,0x167e,0x1572,0,0,0x16c5,0,0x0004,0x0071,0x1377,0x138e];
 for(let n=0;n<35;n++){
  const p=(rw(0x4924+4*n+2)<<16|rw(0x4924+4*n))>>>0;
  const e=lookup(p);
  assert.ok(e,`slot ${n} -> ${(p>>>16).toString(16)}:${(p&0xffff).toString(16)} is registered`);
  if(want[n])assert.equal(p&0xffff,want[n],`slot ${n}`);
 }
});
