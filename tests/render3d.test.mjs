// render3d checks: trig tables against the raw EXE bytes, mat_mul (incl. the stale-CX quirk) and
// matFromAngles against hand-executed asm, shape projection/near clip through 2c46:0534/026c, and the
// 2f73 EGA ground fill pixel-exact. Expected numbers are hand-executed from the disassembly (see comments).
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine,machine} from '../src/engine/machine.js';
import {rb,rw,rsw,wb,ww,fwb,fww} from '../src/engine/mem.js';
import {DivideError,s16} from '../src/engine/int.js';
import {UnsupportedError} from '../src/engine/host.js';
import {dosAlloc} from '../src/engine/dos.js';
import * as ega from '../src/engine/ega.js';
import {provide} from '../src/game/link.js';
import * as R from '../src/game/render3d.js';

const assets=await loadAssets();
createMachine({assets});
// Raw table words from the unpacked image (not from the memory the code reads).
const img=()=>machine.exe.image;
const rawW=(off)=>{const p=(0x2c46-0x1000)*16+off;return img()[p]|img()[p+1]<<8;};
const rawCos=i=>s16(rawW(0x1514+2*i)),rawAtan=i=>rawW(0x2d1a+2*i);
const fold=a=>{let i=(a&0xffff)>>>4;if(i&0x800)i=0x1000-i;return i;};

test('cos/sin table lookups match the raw CS:1514 table',()=>{
 assert.equal(rawCos(0),0x4000);
 for(const a of [0,0x10,0x1234,0x4000,0x7ff0,0x8000,0x8010,0xc000,0xfff0,0xffff]){
  assert.equal(R.f2c46_3140(a),rawCos(fold(a)),`cos ${a.toString(16)}`);
  assert.equal(R.f2c46_311a(a),rawCos(fold(a+0xc000)),`sin ${a.toString(16)}`);
 }
 assert.equal(R.f2c46_3140(0x8000),rawCos(0x800));     // idx 0x800 (180 deg, no fold)
 assert.equal(R.f2c46_3140(0x8010),rawCos(0x7ff));     // idx 0x801 folds to 0x7ff
 assert.equal(R.f2c46_311a(0),rawCos(0x400));          // sin 0 = cos table[0x400]
 assert.equal(R.f2c46_32c6(5),rawAtan(5));
});
test('tan16 is an IDIV that traps at 90 degrees',()=>{
 assert.equal(R.f2c46_3163(0),Math.trunc(rawCos(0x400)*16384/rawCos(0)));
 assert.throws(()=>R.f2c46_3163(0x4000),DivideError);
});
test('atan2_16 folds and divides as 2c46:3220',()=>{
 assert.equal(R.f2c46_3220(0,0),0);
 assert.equal(R.f2c46_3220(0,5),0x4000);               // 0x400<<4
 assert.equal(R.f2c46_3220(5,0),0);
 assert.equal(R.f2c46_3220(3,3),0x2000);
 const v=rawAtan(256);                                 // (50<<9) DIV 100 = 256
 assert.equal(R.f2c46_3220(100,50),v<<4&0xffff);
 assert.equal(R.f2c46_3220(-100,50),(0x800-v)<<4&0xffff);
 assert.equal(R.f2c46_3220(50,-100),(0x1000-(0x400-v))<<4&0xffff);
});

// Matrices in unused DGROUP space (top of DGROUP is zero in a fresh image).
const MA=0xc100,MB=0xc120,MD=0xc140,ANG=0xc160;
const putM=(at,v,t)=>{v.forEach((x,i)=>ww(at+2*i,x));wb(at+0x12,t);};
const getM=at=>[...Array(9)].map((_,i)=>rsw(at+2*i));

test('mat_mul (1,1) keeps the stale CX in place of the first product low word',()=>{
 putM(MA,[0x4000,0,0, 0,0x4000,0, 0,0,0x4000],1);
 putM(MB,[1,0x2000,0, 0,0x4000,0, 0,0,0x4000],1);
 // m00: p1=0x4000*1=0x00004000 (hi 0, low dropped), p2=0 -> t=CX=1 -> 0 (exact would be 1)
 // m01: p1=0x08000000, t=0x08000001 -> 0x2000; m10: t=1 -> 0; m11: p2=0x10000000 -> 0x4000
 assert.equal(R.f2c46_0a8a(MA,MB,MD,0x0001),1);
 assert.deepEqual(getM(MD),[0,0x2000,0, 0,0x4000,0, 0,0,0x4000]);assert.equal(rb(MD+0x12),1);
 R.f2c46_0a8a(MA,MB,MD,0xc000);                         // m00: t=0xc000 -> 3
 assert.equal(rsw(MD),3);
 putM(MA,[-0x4000,0,0, 0,0x4000,0, 0,0,0x4000],1);
 R.f2c46_0a8a(MA,MB,MD,0);                              // p1=0xffffc000 -> t=0xffff0000 -> -4 (exact -1)
 assert.equal(rsw(MD),-4);
 assert.throws(()=>R.f2c46_0a8a(MA,MB,MD),/CX/);
});
test('mat_mul (1,>=2) quirk with CX=0x8000 and the copied third row',()=>{
 putM(MA,[0,0x4000,0, -0x4000,0,0, 0,0,0x4000],1);
 putM(MB,[1,0x2000,3, 0x1000,5,-7, 11,12,13],3);
 // m00 t=0x8000+0x04000000 -> 0x1002; m01 t=0x8000+0x14000 -> 7; m02 t=0x8000-0x1c000 -> -5
 // m10 t=0xffff0000+0x8000 -> -2; m11 t=-0x08000000+0x8000 -> -0x1ffe; m12 t=0xffff0000+0x8000 -> -2
 assert.equal(R.f2c46_0a8a(MA,MB,MD,0x8000),3);
 assert.deepEqual(getM(MD),[0x1002,7,-5, -2,-0x1ffe,-2, 11,12,13]);assert.equal(rb(MD+0x12),3);
});
test('mat_mul general case is exact and ignores CX; type 0 copies',()=>{
 putM(MA,[0x4000,0,0, 0,0,0x4000, 0,-0x4000,0],3);
 putM(MB,[0x1000,0x2000,0x3000, 0x4000,0x5000,0x6000, 0x7000,-0x1000,-0x2000],3);
 R.f2c46_0a8a(MA,MB,MD,0x5555);
 assert.deepEqual(getM(MD),[0x1000,0x2000,0x3000, 0x7000,-0x1000,-0x2000, -0x4000,-0x5000,-0x6000]);
 putM(MA,[1,2,3,4,5,6,7,8,9],0);
 assert.equal(R.f2c46_0a8a(MA,MB,MD,0),3);             // a type 0 -> copy b with b's type
 assert.deepEqual(getM(MD),getM(MB));
});
test('matFromAngles types 0/1 and the exit CX leak',()=>{
 ww(ANG,0);ww(ANG+2,0);ww(ANG+4,0);
 assert.equal(R.f2c46_06a0(ANG,MD,0xab12),0xab00);assert.equal(rb(MD+0x12),0);
 assert.deepEqual(getM(MD),[0x4000,0,0,0,0x4000,0,0,0,0x4000]);
 ww(ANG+4,0x1000);
 assert.equal(R.f2c46_06a0(ANG,MD,0xab12),0xab01);assert.equal(rb(MD+0x12),1);
 const c=rawCos(0x100),s=rawCos(fold(0x1000+0xc000));
 assert.deepEqual(getM(MD),[c,s,0,-s,c,0,0,0,0x4000]);
 // pitch only (type 3): m00 = P = 2*SAR1(cos 0); exit CX = SAR1(sin(a2-a0)) = SAR1(sin(-0x1000))
 ww(ANG,0x1000);ww(ANG+4,0);
 const cx=R.f2c46_06a0(ANG,MD,0);assert.equal(rb(MD+0x12),3);
 assert.equal(s16(cx),rawCos(fold(-0x1000+0xc000))>>1);
 assert.equal(rsw(MD),0x4000);assert.equal(rsw(MD+0xa),rawCos(fold(0x1000+0xc000)));
});

// ---- shape projection: a tiny shape in a DOS block, identity object matrix, stubbed drawPolygon ----
const polys=[];
provide({f1ff8_256d:(n,xs,ys)=>{polys.push({n,xs:[...Array(n)].map((_,i)=>rsw(xs+2*i)),ys:[...Array(n)].map((_,i)=>rsw(ys+2*i))});return 0;}});
function buildShape(verts,faces){
 const {seg}=dosAlloc(0x40);
 // +0 radius, +3 nv, +4 vertex offset, +6 LOD {1, sub} ffff; sub at 0x10; group at 0x20; faces from 0x40
 fww(seg,0,100);fwb(seg,2,0);fwb(seg,3,verts.length);fww(seg,4,0x200);
 fww(seg,6,1);fww(seg,8,0x10);fww(seg,0xa,0xffff);
 fwb(seg,0x10,0);fwb(seg,0x11,0);fww(seg,0x12,0x20);fww(seg,0x14,0xffff);
 fwb(seg,0x20,0);fwb(seg,0x21,0);
 let fo=0x40;faces.forEach((f,i)=>{fww(seg,0x22+2*i,fo);[0xff,3,3,...f,0xff].forEach((b,j)=>fwb(seg,fo+j,b));fo+=0x10;});
 fww(seg,0x22+2*faces.length,0xffff);
 verts.forEach((v,i)=>v.forEach((c,j)=>fww(seg,0x200+6*i+2*j,c)));
 return seg;
}
function viewSetup(mirror){
 putM(MA,[0x4000,0,0,0,0x4000,0,0,0,0x4000],0);ww(0x9236,MA);
 ww(0x9bf8,0);ww(0x9bfa,0);ww(0x9bfc,0);ww(0x9640,7);ww(0x8ec0,1);ww(0x9b8e,0xa1);ww(0x9bb8,0x41);
 ww(0x8e8a,0x2a44);ww(0x98fc,1);wb(0x9a9c,0);ww(0x2a68,mirror?1:0);polys.length=0;
}
test('projection: sx = cx + (x<<7) IDIV y, sy = cy - (z<<7) IDIV y; mirror subtracts',()=>{
 const seg=buildShape([[10,100,20],[-10,100,20],[0,50,-30]],[[0,1,2]]);
 viewSetup(false);R.f2c46_11ea(0,seg);
 // 1280/100=12 -> 173; -12.8 -> -12 -> 149; 0 -> 161. z: 2560/100=25 -> 40; -3840/50=-76 -> 141
 assert.deepEqual(polys,[{n:3,xs:[173,149,161],ys:[40,40,141]}]);
 assert.equal(rb(0x384e),3);assert.equal(rb(0x384d),3);
 viewSetup(true);R.f2c46_11ea(0,seg);
 assert.deepEqual(polys,[{n:3,xs:[149,173,161],ys:[40,40,141]}]);
});
test('near-plane clip writes the intersection into the hidden vertex slot',()=>{
 const seg=buildShape([[10,100,20],[-10,100,20],[0,0,0],[40,-20,0]],[[0,1,3]]);
 viewSetup(false);R.f2c46_11ea(0,seg);
 // edge 3->0: BP=120, CX=21, x=40+(-30*21 IDIV 120=-5)=35 -> 4480+161; z=0+(20*21/120=3) -> 65-384
 // edge 1->3: x=40+(-50*21/120=-8)=32 -> 4096+161
 assert.deepEqual(polys,[{n:4,xs:[4641,173,149,4257],ys:[-319,40,40,-319]}]);
});
test('projection IDIV overflow traps',()=>{
 const seg=buildShape([[300,1,0],[0,10,0],[1,10,0]],[[0,1,2]]);
 viewSetup(false);assert.throws(()=>R.f2c46_11ea(0,seg),DivideError);
});

// ---- 2f73 ground fill ----
function groundSetup(r0){
 ega.setMode(0x0d);
 ww(0x95d6,2);ww(0x3858,0xa000);ww(0x8db2,r0+1);
 for(let y=0;y<200;y++)ww(0x3d3e+2*y,40*y);
}
const rec=(r,col,a,b,L,Rc)=>{const p=0x9252+8*r;ww(p,col);ww(p+2,b);ww(p+4,a);wb(p+6,L);wb(p+7,Rc);};
const runs=(...spec)=>{const o=[];for(const [n,c] of spec)for(let i=0;i<n;i++)o.push(c);assert.equal(o.length,320);return o;};
const rowPx=y=>[...ega.pageIndices(0).slice(y*320,y*320+320)];

test('2f73 masks and jump table in the image',()=>{
 assert.deepEqual([...Array(8)].map((_,i)=>rb(0x2ac6+i)),[0,0x7f,0x3f,0x1f,0x0f,7,3,1]);
 assert.deepEqual([...Array(8)].map((_,i)=>rb(0x2ace+i)),[0,0x80,0xc0,0xe0,0xf0,0xf8,0xfc,0xfe]);
 assert.equal(rw(0x2afc+4),0x02ae);
});
test('2f73:02a4 EGA ground fill is pixel-exact, row 99 included',()=>{
 groundSetup(0x61);
 rec(0x61,3,20,50,1,2);   // L bytes 0-2, R bytes 6-39, middle 20..50
 rec(0x62,3,17,21,1,2);   // one-byte middle: mask 2ace[6]&2ac6[1]=0x7c over R's byte 2
 rec(0x63,5,16,40,4,6);   // byte-aligned a
 R.f2f73_02a4();
 assert.deepEqual(rowPx(0x60),runs([320,0]));
 assert.deepEqual(rowPx(0x61),runs([20,1],[31,3],[269,2]));
 assert.deepEqual(rowPx(0x62),runs([16,1],[1,2],[5,3],[298,2]));
 assert.deepEqual(rowPx(0x63),runs([16,4],[25,5],[279,6]));
 assert.equal(ega.regs.writeMode,2);
});
test('2f73 ground quirks: a==b draws no middle, a>b paints right colour, r0>=99 draws nothing',()=>{
 groundSetup(0x62);
 rec(0x62,3,20,20,1,2);rec(0x63,3,60,10,1,2);
 R.f2f73_02a4();
 assert.deepEqual(rowPx(0x62),runs([16,1],[304,2]));
 assert.deepEqual(rowPx(0x63),runs([320,2]));
 groundSetup(0x63);rec(0x63,3,20,50,1,2);R.f2f73_02a4();
 assert.deepEqual(rowPx(0x63),runs([320,0]));
 ww(0x95d6,1);assert.throws(()=>R.f2f73_02a4(),UnsupportedError);
});
