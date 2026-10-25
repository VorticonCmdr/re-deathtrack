// EGA driver (segment 29f6 and 1ff8:44b4): draw into a fresh EGA model and compare planar bytes / pixels
// with expectations worked out from the disassembly (docs/re/graphics.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rb,rw,wb,ww,fwb,frb,frw} from '../src/engine/mem.js';
import * as ega from '../src/engine/ega.js';
import * as D from '../src/game/egadrv.js';

const assets=await loadAssets();
const P=ega.planes;
function fresh(){
 createMachine({assets});
 D.f29f6_13b5(0);
 ww(0x3858,0xa000);ww(0x3856,0xa200);
 wb(0x384b,0);wb(0x384f,0x0f);wb(0x385d,2);
}
const pix=(x,y,base=0)=>{const o=base+y*40+(x>>3),s=7-(x&7);let c=0;for(let p=0;p<4;p++)c|=(P[p][o]>>s&1)<<p;return c;};
function fill(colour,base=0,n=8000){for(let p=0;p<4;p++)P[p].fill(colour>>p&1?0xff:0,base,base+n);}
const bytesAt=o=>[P[0][o],P[1][o],P[2][o],P[3][o]];
// Packs a chunky sprite into the slot 3 record layout: planes 0..3 then mask (1 = transparent).
function putSprite(rec,seg,w,h,px){
 const bpr=w>>3,n=bpr*h;
 for(let y=0;y<h;y++)for(let b=0;b<bpr;b++){
  const v=[0,0,0,0];let m=0;
  for(let k=0;k<8;k++){const c=px[y][b*8+k];for(let p=0;p<4;p++)v[p]|=(c>>p&1)<<(7-k);if(!c)m|=1<<(7-k);}
  for(let p=0;p<4;p++)fwb(seg,p*n+y*bpr+b,v[p]);fwb(seg,4*n+y*bpr+b,m);
 }
 ww(rec,seg);ww(rec+2,0);ww(rec+4,4*n);ww(rec+6,w);ww(rec+8,h);
}
const SPR=[[1,2,0,0,3,0,0,15, 0,0,0,0,0,0,0,9],[5,5,5,5,5,5,5,5, 0,7,0,7,0,7,0,7]];

test('egaInit builds the row table, colour tables and register state',()=>{
 fresh();
 assert.equal(rw(0x3854),0xa000);assert.equal(rw(0x3852),0xa200);assert.equal(rw(0x3850),0xa400);
 assert.equal(rw(0x3d3e+2*199),40*199);assert.equal(rw(0x41a4+2*7),0x0707);assert.equal(rw(0x46a4+2*15),0x0f0f);
 assert.equal(ega.regs.writeMode,2);assert.equal(ega.regs.mapMask,0xf);
});

test('sprite blit at all 8 shifts: opaque pixels replace, colour 0 is transparent',()=>{
 for(let s=0;s<8;s++){
  fresh();fill(6);putSprite(0xf000,0x7000,16,2,SPR);
  D.f29f6_00a7(0xf000,8+s,3);
  for(let y=2;y<6;y++)for(let x=0;x<40;x++){
   const sx=x-8-s,sy=y-3,c=sy>=0&&sy<2&&sx>=0&&sx<16?SPR[sy][sx]:0;
   assert.equal(pix(x,y),c||6,`shift ${s} pixel ${x},${y}`);
  }
  assert.equal(ega.regs.writeMode,2);assert.equal(ega.regs.mapMask,0xf);assert.equal(ega.regs.bitMask,0xff);
 }
 // Literal bytes for shift 3, row 3, screen byte 1: pixels 11..15 = 1,2,0,0,3 over background 6.
 fresh();fill(6);putSprite(0xf000,0x7000,16,2,SPR);D.f29f6_00a7(0xf000,11,3);
 // byte 1 (x 8..15) = 6,6,6,1,2,6,6,3
 assert.deepEqual(bytesAt(3*40+1),[0b00010001,0b11101111,0b11100110,0b00000000]);
});

test('sprite plane enable mask [384f] keeps only enabled planes of the colour',()=>{
 fresh();fill(15);putSprite(0xf000,0x7000,16,2,SPR);wb(0x384f,0x3);
 D.f29f6_00a7(0xf000,16,0);
 assert.equal(pix(16,0),1);assert.equal(pix(23,0),15&3);assert.equal(pix(18,0),15);assert.equal(pix(31,0),9&3);
});

test('sprite clipping is byte-granular in x and exact in y',()=>{
 for(const x of [13,16,21]){
  fresh();fill(6);putSprite(0xf000,0x7000,16,2,SPR);
  wb(0x384b,1);ww(0x3843,17);ww(0x3845,26);ww(0x3847,4);ww(0x3849,199);
  D.f29f6_00a7(0xf000,x,3);
  // window: x in [17&~7, ((26+1)&~7)-1] = [16,23], rows >= 4
  for(let y=2;y<6;y++)for(let px=0;px<40;px++){
   const sx=px-x,sy=y-3,inWin=px>=16&&px<=23&&y>=4;
   const c=inWin&&sy>=0&&sy<2&&sx>=0&&sx<16?SPR[sy][sx]:0;
   assert.equal(pix(px,y),c||6,`x=${x} pixel ${px},${y}`);
  }
 }
});

test('span list fill: solid colour, and dither with 41a4 on even rows and 4424 on odd rows',()=>{
 fresh();fill(0);
 ww(0x41a4+2*20,0x0102);ww(0x4424+2*20,0x0304);wb(0x384d,20);
 const L=0xf100;ww(L,3);ww(L+2,3);ww(L+4,5);ww(L+6,20);ww(L+8,2);ww(L+10,12);ww(L+12,9);ww(L+14,8);
 D.f29f6_141a(L);
 const exp=(x,y)=>{
  const sp={3:[5,20],4:[2,12]}[y];if(!sp||x<sp[0]||x>sp[1])return 0;
  return y&1?(x&1?4:3):(x&1?2:1);
 };
 for(let y=2;y<7;y++)for(let x=0;x<32;x++)assert.equal(pix(x,y),exp(x,y),`dither ${x},${y}`);
 // row 5 has x2 < x1: skipped
 fresh();fill(0);wb(0x384d,9);
 ww(L,10);ww(L+2,1);ww(L+4,3);ww(L+6,4);
 D.f29f6_141a(L);
 // x 3..4 in byte 0: mask ff>>3 & ~(ff>>5) = 0x18
 assert.deepEqual(bytesAt(400),[0x18,0,0,0x18]);
});

test('horizontal spans: solid (slot 10) and dithered with phase toggle (slot 11)',()=>{
 fresh();fill(0);
 D.f29f6_1ece(0x0c,3,20,0,rw(0x3d3e+14),0xa000);
 for(let x=0;x<32;x++)assert.equal(pix(x,7),x>=3&&x<23?12:0);
 // left byte mask 1f, two full bytes? x 3..22: byte0 0x1f, byte1 ff, byte2 0xfe
 assert.deepEqual(bytesAt(280),[0,0,0x1f,0x1f]);assert.deepEqual(bytesAt(282),[0,0,0xfe,0xfe]);
 ww(0x386a,0);
 D.f29f6_1ddc(0x0102,1,10,0x0304,rw(0x3d3e+20),0xa000);  // phase 0 -> 1: AX = DX
 for(let x=0;x<16;x++)assert.equal(pix(x,10),x>=1&&x<11?(x&1?4:3):0);
 D.f29f6_1ddc(0x0102,1,10,0x0304,rw(0x3d3e+22),0xa000);  // phase 1 -> 0: AX kept
 for(let x=0;x<16;x++)assert.equal(pix(x,11),x>=1&&x<11?(x&1?2:1):0);
});

test('line: diagonal ends one row short when the last step crosses a byte',()=>{
 fresh();fill(0);
 const set=pts=>new Set(pts.map(([x,y])=>`${x},${y}`));
 const drawn=()=>{const s=new Set();for(let y=0;y<8;y++)for(let x=0;x<24;x++)if(pix(x,y))s.add(`${x},${y}`);return s;};
 wb(0x384e,14);
 D.f29f6_19b1(5,0,8,3,0xa000);
 assert.deepEqual(drawn(),set([[5,0],[6,0],[6,1],[7,1],[7,2],[8,2]]));
 assert.equal(pix(5,0),14);
 fresh();fill(0);wb(0x384e,14);
 D.f29f6_19b1(1,2,3,0,0xa000);   // upward diagonal inside one byte: full staircase
 assert.deepEqual(drawn(),set([[1,2],[2,2],[2,1],[3,1],[3,0]]));
 fresh();fill(0);wb(0x384e,14);
 D.f29f6_19b1(0,0,9,2,0xa000);   // x-major: q = 3, f = 0
 assert.deepEqual(drawn(),set([[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[5,1],[6,1],[7,1],[7,2],[8,2],[9,2]]));
 fresh();fill(0);wb(0x384e,14);
 D.f29f6_19b1(2,0,3,4,0xa000);   // y-major: dy 4, dx 1: q = 2, f = 0 -> run 3 then clamp 1
 assert.deepEqual(drawn(),set([[2,0],[2,1],[2,2],[2,3],[3,3],[3,4]]));
 fresh();fill(0);wb(0x384e,14);
 D.f29f6_19b1(4,5,4,2,0xa000);   // vertical upward: |dy|+1 pixels
 assert.deepEqual(drawn(),set([[4,2],[4,3],[4,4],[4,5]]));
});

test('glyph: unaligned opaque, aligned, transparent and the edge mask entry 5 = FF',()=>{
 const font=(w,h,rows)=>{wb(0x3874,w);wb(0x3888,h);wb(0x389c,0x20);wb(0x38b0,2);ww(0x38c4,0x7100);
  const bpr=(w+7)>>3,sz=h*bpr;rows.forEach((r,i)=>fwb(0x7100,sz+i,r));};
 fresh();fill(9);font(6,2,[0xa8,0x54]);wb(0x3868,12);wb(0x3869,3);wb(0x3842,0);
 D.f29f6_16ec(0x21,10,5,0xa000);
 for(let y=4;y<8;y++)for(let x=0;x<24;x++){
  const k=x-10,r=y-5;let e=9;
  if(r>=0&&r<2&&k>=0&&k<6)e=[0xa8,0x54][r]>>(7-k)&1?12:3;
  assert.equal(pix(x,y),e,`glyph ${x},${y}`);
 }
 // transparent: only fg pixels
 fresh();fill(9);font(6,2,[0xa8,0x54]);wb(0x3868,12);wb(0x3842,1);
 D.f29f6_16ec(0x21,10,5,0xa000);
 for(let x=8;x<24;x++)assert.equal(pix(x,5),x-10>=0&&x-10<6&&0xa8>>(17-x)&1?12:9);
 // aligned 8-wide
 fresh();fill(9);font(8,1,[0x81]);wb(0x3868,1);wb(0x3869,2);wb(0x3842,0);
 D.f29f6_16ec(0x21,16,0,0xa000);
 assert.deepEqual(bytesAt(2),[0x81|0,0x7e,0,0]);
 // QUIRK: width 5 uses edge mask 5010[5] = FF, so bg also covers pixels 5..7 of the cell
 fresh();fill(9);font(5,1,[0xf8]);wb(0x3868,1);wb(0x3869,2);wb(0x3842,0);
 D.f29f6_16ec(0x21,8,0,0xa000);
 for(let x=8;x<16;x++)assert.equal(pix(x,0),x<13?1:2);
 // char below first or past count: nothing drawn
 fresh();fill(9);font(5,1,[0xf8]);D.f29f6_16ec(0x1f,8,0,0xa000);D.f29f6_16ec(0x22,8,0,0xa000);
 for(let x=0;x<24;x++)assert.equal(pix(x,0),9);
});

test('page copy (slot 4) copies whole byte columns from [3856] to [3858]',()=>{
 fresh();
 for(let p=0;p<4;p++)for(let i=0;i<8000;i++)P[p][0x2000+i]=i*7+p*31&0xff;
 ww(0x3856,0xa200);ww(0x3858,0xa400);
 D.f29f6_1be8(10,2,12,3);
 for(let y=1;y<6;y++)for(let b=0;b<5;b++){
  const o=y*40+b,inside=y>=2&&y<5&&b>=1&&b<=2;
  assert.deepEqual(bytesAt(0x4000+o),inside?bytesAt(0x2000+o):[0,0,0,0],`copy ${b},${y}`);
 }
 assert.equal(ega.regs.writeMode,2);
});

test('save and restore rect round trip through a planar buffer (slots 5, 6, 7)',()=>{
 fresh();
 for(let p=0;p<4;p++)for(let i=0;i<8000;i++)P[p][0x2000+i]=i*3+p*17&0xff;
 ww(0x3856,0xa200);ww(0x3858,0xa400);
 assert.equal(D.f29f6_1cda(12,3),3*4*4);
 D.f29f6_1c4c(0x10,0x7400,4,1,12,3);    // normalised to 7401:0000; nb = (16>>3)-(0)+1 = 3 -> 2 words
 // plane 3 first: row 1 bytes 0..3
 assert.deepEqual([0,1,2,3].map(i=>frb(0x7401,i)),[0,1,2,3].map(i=>P[3][0x2000+40+i]));
 assert.deepEqual([0,1,2,3].map(i=>frb(0x7401,36+i)),[0,1,2,3].map(i=>P[0][0x2000+40+i]));
 D.f29f6_1d05(0x10,0x7400,4,1,12,3);
 for(let y=1;y<4;y++)for(let b=0;b<4;b++)assert.deepEqual(bytesAt(0x4000+y*40+b),bytesAt(0x2000+y*40+b));
 assert.deepEqual(bytesAt(0x4000+40+4),[0,0,0,0]);
});

test('flip swaps the page pointers and writes CRTC 0Ch only',()=>{
 fresh();
 D.f29f6_1d9c(0);
 assert.equal(rw(0x3854),0xa200);assert.equal(rw(0x3852),0xa000);assert.equal(ega.regs.start,0x2000);
 D.f29f6_1d9c(0);
 assert.equal(rw(0x3854),0xa000);assert.equal(ega.regs.start,0);
});

test('full-screen band (slot 17): packed nibbles to planes, opaque',()=>{
 fresh();fill(5);
 const src=[0x12,0x34,0x56,0x78,0x9a,0xbc,0xde,0xf0, 0x11,0x11,0x11,0x11,0x00,0x00,0x00,0x00];
 src.forEach((v,i)=>fwb(0x7200,i,v));
 D.f29f6_23d8(0,0x7200,9,10,16,2);    // x truncated to byte 1
 // pixels 8..15 = 1,2,3,4,5,6,7,8
 assert.deepEqual(bytesAt(400+1),[0xaa,0x66,0x1e,0x01]);
 for(let x=0;x<32;x++){
  const k=x-8;
  assert.equal(pix(x,10),k>=0&&k<16?src[k>>1]>>(k&1?0:4)&15:5);
  assert.equal(pix(x,11),k>=0&&k<16?(k<8?1:0):5);
 }
 assert.equal(ega.regs.mapMask,0xf);assert.equal(ega.regs.writeMode,2);
});

test('sprite conversion via A600 (slots 13, 14) feeds slot 3',()=>{
 fresh();fill(6);
 const list=0xf200,rec=0xf210;ww(list,rec);ww(list+2,0);ww(rec+6,16);ww(rec+8,2);
 assert.equal(D.f29f6_1f4c(list,0xf220),20);assert.equal(rw(0xf220),0);
 // packed 4 bpp of SPR (high nibble = left pixel)
 const packed=SPR.flatMap(r=>{const o=[];for(let i=0;i<16;i+=2)o.push(r[i]<<4|r[i+1]);return o;});
 packed.forEach((v,i)=>fwb(0x7300,i,v));
 D.f29f6_1f8d(list,0,0x7300,16,0);
 assert.deepEqual([rw(rec),rw(rec+2),rw(rec+4)],[0x7300,0,16]);
 // A600 scratch: first byte of row 0 = pixels 1,2,0,0,3,0,0,15
 assert.deepEqual(bytesAt(0x6000),[0b10001001,0b01001001,0b00000001,0b00000001]);
 // converted plane 0 then mask
 assert.equal(frb(0x7300,0),0b10001001);assert.equal(frb(0x7300,16),0b00110110);assert.equal(frb(0x7300,19),0b10101010);
 D.f29f6_00a7(rec,20,30);
 for(let y=29;y<33;y++)for(let x=16;x<40;x++){
  const sx=x-20,sy=y-30,c=sy>=0&&sy<2&&sx>=0&&sx<16?SPR[sy][sx]:0;
  assert.equal(pix(x,y),c||6);
 }
 assert.equal(ega.regs.readMap,3);
});

test('pixel get/put (slots 21, 22) and palette activation (slot 20)',()=>{
 fresh();fill(0);
 D.f29f6_238d(13,4,11);
 assert.equal(D.f29f6_2344(13,4),11);assert.equal(D.f29f6_2344(12,4),0);assert.equal(pix(13,4),11);
 ww(0x41a4+64+2*3,0x0009);ww(0x41a4+64+2*16,0x0405);ww(0x4424+64+2*16,0x0607);
 D.f29f6_22c9(1);
 assert.equal(ega.regs.palette[3],0x11);       // 9 >= 8 -> 9+8
 assert.equal(rw(0x41c4),0x0405);assert.equal(rw(0x4444),0x0607);assert.equal(rw(0x41a4+6),3);
});

test('dissolve (1ff8:44b4) copies the whole rectangle to the displayed page',()=>{
 for(const unit of [8,4,2,1]){
  fresh();
  for(let p=0;p<4;p++)for(let i=0;i<8000;i++)P[p][0x2000+i]=i*5+p*11+1&0xff;
  ww(0x3856,0xa200);ww(0x3854,0xa000);
  D.f1ff8_44b4(16,3,24,5,unit);
  for(let y=2;y<9;y++)for(let x=8;x<48;x++){
   const inside=x>=16&&x<40&&y>=3&&y<8;
   assert.equal(pix(x,y),inside?pix(x,y,0x2000):0,`unit ${unit} ${x},${y}`);
  }
  assert.equal(ega.regs.writeMode,2);assert.equal(ega.regs.mapMask,0xf);
 }
});
