// render3d: segment 2c46 (3D maths, matrices, shape transform/projection/polygon setup) and
// segment 2f73 (sky panorama blit and per-scanline ground/road fill). Analysis: docs/re/race.md
// (3D renderer), docs/re/resources.md (.tbl format), docs/re/graphics.md (2f73).
//
// Code versus data in 2c46 (static, from the bytes):
// - 2c46:0000-0009 is the tail of a 29f6 function (OUT 3CE,0003; POP; RETF), not ours.
// - 2c46:1514-3119 are the trig tables (cos 1514, asin 2516, acos 2918, atan 2d1a). Every Ghidra
//   "function" from 2c46:1515 to 2c46:244b (incl. the 3278-byte "244b") is table bytes; none is code.
//   The tables are read through the far accessors below and never copied into source.
// - Ghidra fragments folded into their real function: 0310, 0373, 03d5 (inside 026c), 0742, 0782, 08fb
//   (inside 06a0; 08de is an instruction inside 06a0, not an entry). 1434 is a JMP-target tail of 14b3
//   and is exported separately.
// - 2c46:32d3.. is 2f73:0003 (shared sky epilogue).
//
// Register conventions of the near helpers are documented per function. Nothing here blocks.
import {rb,rw,rsw,wb,ww,frb,fwb,frw,frsw,fww,gseg,pseg,poff} from '../engine/mem.js';
import {s16,u16,s8,idiv32_16,div32_16,imul16} from '../engine/int.js';
import {unsupported,register} from '../engine/host.js';
import * as ega from '../engine/ega.js';
import {F,provide} from './link.js';

const CS=()=>gseg(0x2c46);
const T_COS=0x1514,T_ASIN=0x2516,T_ACOS=0x2918,T_ATAN=0x2d1a;

// The inline table lookup used throughout 2c46: idx = u16(a)>>4, folded at 0x800; CS:[1514+2*idx].
function cosLook(a){
 let ax=u16(a)>>>4;
 if(ax&0x800)ax=u16(-ax+0x1000);
 return frsw(CS(),u16(T_COS+u16(ax<<1)));
}
const C=a=>cosLook(a), S=a=>cosLook(u16(a)+0xc000);
const h=v=>s16(v)>>1;                         // SAR 1
// IMUL then SHL AX/RCL DX twice, keep DX: s16 of the wrapped 32-bit value >> 14.
const q14=v=>s16((v|0)>>14);
const mh=(a,b)=>q14(imul16(a,b));

// 8086 "CWD; shift DX:AX left by [9640]" sequence used before every projection IDIV (2c46:0144 etc.).
// CL<8 (signed byte compare): LOOP runs CX times (CX=0 runs 65536 times). CL>=8: a byte move does
// the first 8 bits, then LOOP runs (CX-8) times unless CL-8 is 0.
function projShift(ax){
 const cxw=rw(0x9640);let v=s16(ax),n;
 if(s8(cxw)<8)n=cxw||0x10000;
 else{v=v<<8|0;const cl=(cxw&0xff)-8&0xff;n=cl?((cxw&0xff00)|cl):0;}
 return n>=32?0:v<<n|0;
}

// ---------------------------------------------------------------- table management

// 2c46:000a relocateTable: adds the table base (DS:98dc far pointer) to every {off,para} dword of the
// header list at its start, up to the zero dword. 32-bit ADD/ADC; the cursor advances by offset only.
export function f2c46_000a(){
 const bo=rw(0x98dc),bs=rw(0x98de);let o=bo;const s=bs;
 while(frw(s,o)|frw(s,o+2)){
  const lo=frw(s,o)+bo,hi=frw(s,o+2)+bs+(lo>>>16);
  fww(s,o,lo);fww(s,o+2,hi);
  o=u16(o+4);
 }
}
// 2c46:004e selectShapeTbl: current table DS:98dc = shape.tbl pointer DS:2a6a.
export function f2c46_004e(){ww(0x98dc,rw(0x2a6a));ww(0x98de,rw(0x2a6c));}
// 2c46:005e selectModelTbl: current table DS:98dc = driver/car table DS:2a6e.
export function f2c46_005e(){ww(0x98dc,rw(0x2a6e));ww(0x98de,rw(0x2a70));}
// 2c46:006e loadShapeTbl(name): free the old shape.tbl, load "<name>.tbl", select and relocate it.
export function f2c46_006e(name){
 if(rw(0x2a6a)|rw(0x2a6c)){f2c46_004e();f2c46_00fa();ww(0x2a6c,0);ww(0x2a6a,0);}
 const path=F.f1000_ac4c(name,0x2a72);                 // DS:2a72 "tbl"
 const p=F.f1000_ad0a(path);                           // packed far pointer (DX:AX)
 ww(0x2a6a,poff(p));ww(0x2a6c,pseg(p));
 f2c46_004e();f2c46_000a();
}
// 2c46:00b4 loadModelTbl(name): same for the driver/car table at DS:2a6e.
export function f2c46_00b4(name){
 // QUIRK: JNZ where 006e has JZ: the old block is freed only when the pointer is already NULL, so every
 // reload leaks the previous block (docs/re/resources.md, .tbl loading).
 if(!(rw(0x2a6e)|rw(0x2a70))){f2c46_005e();f2c46_00fa();ww(0x2a70,0);ww(0x2a6e,0);}
 const path=F.f1000_ac4c(name,0x2a76);                 // DS:2a76 "tbl"
 const p=F.f1000_ad0a(path);
 ww(0x2a6e,poff(p));ww(0x2a70,pseg(p));
 f2c46_005e();f2c46_000a();
}
// 2c46:00fa freeCurrentTbl: DOS-free the current table when non-NULL (does not clear the pointers).
export function f2c46_00fa(){
 if(rw(0x98dc)|rw(0x98de))F.f1ff8_3ae2(rw(0x98dc),rw(0x98de));   // dosFree(off, seg)
}
// 2c46:1504 shapeRadius(off, seg): s16 bounding radius at shape+0.
export function f2c46_1504(off,seg){return frsw(seg,off);}

// ---------------------------------------------------------------- trig (tables in CS)

// 2c46:311a sin16(a): cos table at a+0xc000; s16 Q14.
export function f2c46_311a(a){return S(a);}
// 2c46:3140 cos16(a): s16 Q14.
export function f2c46_3140(a){return C(a);}
// 2c46:3163 tan16(a): IDIV (sin<<14)/cos; traps (DivideError) when |tan| >= 2 or cos = 0 (race.md note 11).
export function f2c46_3163(a){return idiv32_16(S(a)*16384,C(a));}
// 2c46:31b6 asin16(x): table at CS:2516 indexed by |x| SAR 5; negative x gives 0x1000-v; returns u16 v<<4.
// 0x8000 stays negative after NEG, so SAR gives a negative index (literal: reads before the table).
export function f2c46_31b6(x){
 let ax=u16(x),neg=false;if(ax&0x8000){neg=true;ax=u16(-ax);}
 ax=frw(CS(),u16(T_ASIN+u16(s16(ax)>>5<<1)));
 if(neg)ax=u16(0x1000-ax);
 return u16(ax<<4);
}
// 2c46:31eb acos16(x): as asin with the table at CS:2918 and 0x1400-v for negative x (literal constant).
export function f2c46_31eb(x){
 let ax=u16(x),neg=false;if(ax&0x8000){neg=true;ax=u16(-ax);}
 ax=frw(CS(),u16(T_ACOS+u16(s16(ax)>>5<<1)));
 if(neg)ax=u16(0x1400-ax);
 return u16(ax<<4);
}
// 2c46:3220 atan2_16(a,b): binary angle (u16). Uses |a|,|b| via NEG (0x8000 = 32768 unsigned), unsigned
// compare and DIV into the atan table at CS:2d1a; folds by the signs; both zero returns 0 unshifted.
export function f2c46_3220(a,b){
 let ax=u16(a),bx=u16(b),si=1,di=1;
 if(ax&0x8000){si=-1;ax=u16(-ax);}
 if(bx&0x8000){di=-1;bx=u16(-bx);}
 let v;
 if(ax===0){if(bx===0)return 0;v=0x400;}
 else if(bx===0)v=0;
 else if(ax===bx)v=0x200;
 else if(ax>bx)v=frw(CS(),u16(T_ATAN+u16(div32_16(bx*512,ax)<<1)));
 else v=u16(0x400-frw(CS(),u16(T_ATAN+u16(div32_16(ax*512,bx)<<1))));
 if(si<=0)v=u16(0x800-v);
 if(di<=0)v=u16(0x1000-v);
 return u16(v<<4);
}
// 2c46:32c6 atanTab(i): raw word CS:[2d1a+2i].
export function f2c46_32c6(i){return frw(CS(),u16(T_ATAN+u16(i<<1)));}

// ---------------------------------------------------------------- matrices (19 bytes: 9 s16 Q14 + type)

// 2c46:06a0 matFromAngles(angles*, mat*, cxIn): builds the matrix for angles {a0,a1,a2} (DS offsets).
// Type at +0x12: 0 all zero, 1 a0=a1=0 (yaw only), 2 a0=0, 3 general (2 and 3 share one formula).
// The C return is void. Returns the exit CX, a register leak that the caller's mat_mul (2c46:0a8a) consumes:
// type 0 -> CH of cxIn, CL 0; type 1 -> CH of cxIn, CL 1; types 2/3 -> SAR1(sin(a2-a0)) from 2c46:0a2f.
export function f2c46_06a0(si,di,cxIn=0){
 const A=k=>rw(si+k);
 let cl=3;
 if(!A(0)){cl--;if(!A(2)){cl--;if(!A(4))cl--;}}
 wb(di+0x12,cl);
 if(cl===0){
  ww(di,0x4000);ww(di+8,0x4000);ww(di+0x10,0x4000);
  for(const k of [2,4,6,0xa,0xc,0xe])ww(di+k,0);
  return cxIn&0xff00;
 }
 if(cl===1){
  const c=C(A(4));ww(di,c);ww(di+8,c);
  const s=S(A(4));ww(di+2,s);ww(di+6,-s);
  for(const k of [4,0xa,0xc,0xe])ww(di+k,0);
  ww(di+0x10,0x4000);
  return (cxIn&0xff00)|1;
 }
 // General path 2c46:0761-0a5c, in the original order (each angle word re-read from memory).
 const bp=S(A(0));ww(di+0xa,bp);                                  // m12 = sin a0
 let bx=s16(h(C(A(2)-A(4)))+h(C(A(2)+A(4))));                      // P
 let cx=s16(h(C(A(2)-A(4)))-h(C(A(2)+A(4))));                      // Q
 ww(di,bx-mh(bp,cx));                                              // m00
 ww(di+0xe,cx-mh(bp,bx));                                          // m21
 bx=s16(h(S(A(4)+A(2)))+h(S(A(4)-A(2))));                          // R
 cx=s16(h(S(A(2)+A(4)))+h(S(A(2)-A(4))));                          // S
 ww(di+2,mh(bp,cx)+bx);                                            // m01
 ww(di+0xc,mh(bp,bx)+cx);                                          // m20
 cx=h(C(A(0)+A(4)));ww(di+8,h(C(A(0)-A(4)))+cx);                   // m11
 cx=h(C(A(0)+A(2)));ww(di+0x10,h(C(A(0)-A(2)))+cx);                // m22
 cx=h(S(A(2)-A(0)));ww(di+4,-(h(S(A(2)+A(0)))+cx));                // m02
 cx=h(S(A(4)-A(0)));ww(di+6,-(h(S(A(4)+A(0)))+cx));                // m10
 return u16(cx);
}
// 2c46:0a63 matTranspose(mat*): swaps the off-diagonal pairs in place (type byte unchanged).
export function f2c46_0a63(bx){
 for(const [i,j] of [[2,6],[4,0xc],[0xa,0xe]]){const t=rw(bx+i);ww(bx+i,rw(bx+j));ww(bx+j,t);}
}
// 2c46:0a8a matMul(a*, b*, dst*, cx): dst = a x b (row-major Q14), dispatched on the two type bytes.
// QUIRK (race.md translation note 9): in every 2-term dot product (type pairs (1,1), (1,>=2), (>=2,1))
// the code has MOV AX,CX (8b c1) where MOV CX,AX was meant, so the first product's low word is replaced
// by the entry CX: t = (p1 & 0xffff0000) + CX + p2. CX is therefore a required argument (the register
// value at the call; see f2c46_06a0's return). Each element is written as soon as it is computed and all
// operands are re-read from memory, so aliasing dst with a or b behaves as in the original.
// Returns AX: the result type (copy path), 1 or 3.
export function f2c46_0a8a(bx,si,di,cx){
 if(typeof cx!=='number')throw Error('2c46:0a8a needs the caller\'s CX (stale-register quirk)');
 const A=k=>rsw(bx+k),Bm=k=>rsw(si+k);
 const q2=(a1,b1,a2,b2)=>{const p1=imul16(A(a1),Bm(b1));const p2=imul16(A(a2),Bm(b2));return q14((p1&~0xffff)+(cx&0xffff)+p2);};
 const q3=(a1,b1,a2,b2,a3,b3)=>{const p1=imul16(A(a1),Bm(b1)),p2=imul16(A(a2),Bm(b2)),p3=imul16(A(a3),Bm(b3));return q14(p1+p2+p3);};
 const ta=rb(bx+0x12),tb=rb(si+0x12);
 if(!ta||!tb){
  const src=ta?bx:si;                       // a type 0: copy b; b type 0: copy a
  const t=rb(src+0x12);wb(di+0x12,t);
  for(let k=0;k<18;k+=2)ww(di+k,rw(src+k)); // REP MOVSW, forward
  return t;
 }
 if(ta===1&&tb===1){
  ww(di,q2(0,0,2,6));ww(di+2,q2(0,2,2,8));ww(di+6,q2(6,0,8,6));ww(di+8,q2(6,2,8,8));
  for(const k of [4,0xa,0xc,0xe])ww(di+k,0);
  ww(di+0x10,0x4000);wb(di+0x12,1);return 1;
 }
 if(ta===1){                                // (1,>=2) 2c46:0d8d
  ww(di,q2(0,0,2,6));ww(di+2,q2(0,2,2,8));ww(di+4,q2(0,4,2,0xa));
  ww(di+6,q2(6,0,8,6));ww(di+8,q2(6,2,8,8));ww(di+0xa,q2(6,4,8,0xa));
  ww(di+0xc,rw(si+0xc));ww(di+0xe,rw(si+0xe));ww(di+0x10,rw(si+0x10));
  wb(di+0x12,3);return 3;
 }
 if(tb===1){                                // (>=2,1) 2c46:0e98
  ww(di,q2(0,0,2,6));ww(di+2,q2(0,2,2,8));ww(di+4,rw(bx+4));
  ww(di+6,q2(6,0,8,6));ww(di+8,q2(6,2,8,8));ww(di+0xa,rw(bx+0xa));
  ww(di+0xc,q2(0xc,0,0xe,6));ww(di+0xe,q2(0xc,2,0xe,8));ww(di+0x10,rw(bx+0x10));
  wb(di+0x12,3);return 3;
 }
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)  // (>=2,>=2) 2c46:0b9c, exact 3-term sums
  ww(di+6*i+2*j,q3(6*i,2*j,6*i+2,6+2*j,6*i+4,12+2*j));
 wb(di+0x12,3);return 3;
}
// Shared body of 2c46:0fa5 and 2c46:10d2: out = v x M by M's type (0 copy, 1 two-term + copy z, else 3-term).
function vecMul(bx,si,di){
 const t=rb(si+0x12),V=k=>rsw(bx+k),M=k=>rsw(si+k);
 if(!t){ww(di,rw(bx));ww(di+2,rw(bx+2));ww(di+4,rw(bx+4));return;}
 if(t===1){
  ww(di,q14(imul16(V(0),M(0))+imul16(V(2),M(6))));
  ww(di+2,q14(imul16(V(0),M(2))+imul16(V(2),M(8))));
  ww(di+4,rw(bx+4));return;
 }
 for(let j=0;j<3;j++)ww(di+2*j,q14(imul16(V(0),M(2*j))+imul16(V(2),M(6+2*j))+imul16(V(4),M(12+2*j))));
}
// 2c46:0fa5 vecMul(v*, mat*, out*): far C entry.
export function f2c46_0fa5(v,m,out){vecMul(v,m,out);}
// 2c46:10d2 vecMulR: near register helper. BX = v*, SI = mat*, DI = out* (BP preserved).
export function f2c46_10d2(bx,si,di){vecMul(bx,si,di);}

// ---------------------------------------------------------------- shape pipeline
// Vertex cache (index i, bytes): DS:9708[i] 0 empty, 1 transformed, 2 projected, 3 behind the near plane.
// Words [2i]: 9e26 x', a260 depth y', a466 z'; 9bfe projected x offset, a02a projected z offset.

// Transform with cache (2c46:1317 adds the view translation DS:9bf8..9bfc, 2c46:13ad does not; they
// share one cache, so a vertex first seen by 13ad stays untranslated). ES:BP = vertex array, AL = index.
// Returns {bx: 2*index, cx, dx, di} = registers on exit (x', y', z').
function xform(es,bp,al,translate){
 let bx=al&0xff;
 if(rb(0x9708+bx)){bx<<=1;return {bx,cx:rw(0x9e26+bx),dx:rw(0xa260+bx),di:rw(0xa466+bx)};}
 wb(0x9708+bx,1);bx<<=1;
 const si=u16(bx*3);
 ww(0x9a9e,frw(es,bp+si));ww(0x9aa0,frw(es,bp+si+2));ww(0x9aa2,frw(es,bp+si+4));
 f2c46_10d2(0x9a9e,rw(0x9236),0x895e);
 let cx=rw(0x895e),dx=rw(0x8960),di=rw(0x8962);
 if(translate){cx=u16(cx+rw(0x9bf8));dx=u16(dx+rw(0x9bfa));di=u16(di+rw(0x9bfc));}
 ww(0x9e26+bx,cx);ww(0xa260+bx,dx);ww(0xa466+bx,di);
 return {bx,cx,dx,di};
}
// 2c46:1317 xformPoint: ES:BP vertex array, AL index -> rotated by DS:[9236] matrix plus translation.
export function f2c46_1317(es,bp,al){return xform(es,bp,al,true);}
// 2c46:13ad xformNormal: as 1317 without the translation (same cache).
export function f2c46_13ad(es,bp,al){return xform(es,bp,al,false);}
// 2c46:1434 faceDotRaw: tail of 14b3 (entered by JMP when DS:9a9c != 0, shares its frame). BX = AH:AL vertex
// indices. Untransformed vertices: (V[AH] + DS:98ec..98f0) . V[AL]; returns DX:AX packed (DX<<16|AX)>>>0.
export function f2c46_1434(es,bp,bx){
 const v=i=>{const si=u16(i*6);return [frw(es,bp+si),frw(es,bp+si+2),frw(es,bp+si+4)];};
 const a=v(bx&0xff),b=v(bx>>8&0xff);
 return imul16(b[0]+rw(0x98ec),a[0])+imul16(b[1]+rw(0x98ee),a[1])+imul16(b[2]+rw(0x98f0),a[2])>>>0;
}
// 2c46:14b3 faceDot: AX = AH:AL vertex indices (AL normal, AH point). Returns DX:AX packed (DX<<16|AX)>>>0: xformNormal(AL) . xformPoint(AH) with the transformed caches, or 1434 when DS:9a9c != 0.
export function f2c46_14b3(es,bp,ax){
 if(rb(0x9a9c))return f2c46_1434(es,bp,ax);
 const si=f2c46_13ad(es,bp,ax&0xff).bx;
 const bx=f2c46_1317(es,bp,ax>>8&0xff).bx;
 return imul16(rw(0x9e26+bx),rw(0x9e26+si))+imul16(rw(0xa260+bx),rw(0xa260+si))+imul16(rw(0xa466+bx),rw(0xa466+si))>>>0;
}

// Shared body of 2c46:0114 and 2c46:03d8 (byte-identical): near-plane intersection of edge SI->BX (word
// offsets 2*index) where BX is the vertex at the far side of the plane; the projected result overwrites
// BX's 9bfe/a02a slots. Hardware IDIVs trap (DivideError) on overflow.
function clipEdge(si,bx){
 const bp=u16(rw(0xa260+si)-rw(0xa260+bx));
 const cx=u16(rw(0x8ec0)-rw(0xa260+bx));
 let q=idiv32_16(imul16(rw(0x9e26+si)-rw(0x9e26+bx),cx),bp);
 ww(0x9bfe+bx,idiv32_16(projShift(rw(0x9e26+bx)+q),rw(0x8ec0)));
 q=idiv32_16(imul16(rw(0xa466+si)-rw(0xa466+bx),cx),bp);
 ww(0xa02a+bx,idiv32_16(projShift(rw(0xa466+bx)+q),rw(0x8ec0)));
}
// 2c46:0114 clipEdgeMirror: SI, BX = word offsets (2*index). Preserves CX; BP is clobbered (caller saves).
export function f2c46_0114(si,bx){clipEdge(si,bx);}
// 2c46:03d8 clipEdge: identical code, used by the non-mirrored path.
export function f2c46_03d8(si,bx){clipEdge(si,bx);}

// Shared body of 2c46:01a4 (mirror: x = cx - px) and 2c46:0468 (x = px + cx): clip the polygon in
// DS:a8ee[0..39dc-1] against the near plane (Sutherland-Hodgman, one edge at a time) into 38ec/3914.
// No bound check on the 20-entry output (race.md note 13): written through rw/ww like the original.
function clipPoly(mirror){
 const X=si=>mirror?u16(rw(0x9b8e)-rw(0x9bfe+si)):u16(rw(0x9bfe+si)+rw(0x9b8e));
 const put=(di,si)=>{ww(0x38ec+di,X(si));ww(0x3914+di,u16(rw(0x9bb8)-rw(0xa02a+si)));};
 let di=0,bx=rb(0xa8ee+u16(rw(0x39dc)-1));
 let cx=0;
 do{
  let si=rb(0xa8ee+cx);
  const al=rb(0x9708+bx),ah=rb(0x9708+si);
  if(ah!==3){
   if(al!==3){put(di,si<<1);di+=2;}
   else{clipEdge(si<<1,bx<<1);put(di,bx<<1);put(di+2,si<<1);di+=4;}
  }else if(al!==3){
   clipEdge(bx<<1,si<<1);put(di,si<<1);di+=2;
  }
  bx=si;cx=u16(cx+1);
 }while(cx!==rw(0x39dc));
 ww(0x39dc,di>>>1);
}
// 2c46:01a4 clipPolyMirror (near, no register arguments).
export function f2c46_01a4(){clipPoly(true);}
// 2c46:0468 clipPoly (near, no register arguments).
export function f2c46_0468(){clipPoly(false);}

// Shared body of 2c46:026c (mirror, flag DS:2b08, clip 01a4) and 2c46:0534 (normal, flag DS:2b0a, clip
// 0468). ES:DI = group (DI points at its header word), BP = vertex array offset. For each face: backface
// test, colours through the map DS:[8e8a], transform/project each vertex, near clip if any vertex is
// behind DS:8ec0, then drawPolygon 1ff8:256d(n, 38ec, 3914).
function drawGroup(es,di,bp,mirror){
 const flag=mirror?0x2b08:0x2b0a;
 di=u16(di+2);
 for(;;di=u16(di+2)){
  let si=frw(es,di);
  if(si===0xffff)return;
  if(frb(es,si)!==0xff){
   if(frb(es,si+1)===0xff)continue;
   const d=f2c46_14b3(es,bp,frb(es,si)|frb(es,si+3)<<8);
   if(!(d&0x80000000))continue;           // visible iff DX (high word) < 0 signed
  }
  const map=rw(0x8e8a);
  wb(0x384e,rb(map+frb(es,si+1)));wb(0x384d,rb(map+frb(es,si+2)));
  wb(flag,0);ww(0x39dc,0);
  for(;;si=u16(si+1)){
   const al=frb(es,si+3);if(al===0xff)break;
   let bx=f2c46_1317(es,bp,al).bx>>1;
   if(rb(0x9708+bx)!==2){
    const b2=bx<<1;
    if(rsw(0xa260+b2)<rsw(0x8ec0)){wb(0x9708+bx,3);wb(flag,3);}
    else{
     const dv=rw(0xa260+b2);
     ww(0x9bfe+b2,idiv32_16(projShift(rw(0x9e26+b2)),dv));
     ww(0xa02a+b2,idiv32_16(projShift(rw(0xa466+b2)),dv));
     wb(0x9708+bx,2);
    }
   }
   const n=rw(0x39dc);wb(0xa8ee+n,bx);ww(0x39dc,n+1);
  }
  if(rb(flag)){mirror?f2c46_01a4():f2c46_0468();}
  else{
   const n=rw(0x39dc);if(!n)continue;
   const cxv=rw(0x9b8e),cyv=rw(0x9bb8);
   for(let i=0;i<n;i++){
    const s2=rb(0xa8ee+i)<<1;
    ww(0x38ec+2*i,mirror?cxv-rw(0x9bfe+s2):rw(0x9bfe+s2)+cxv);
    ww(0x3914+2*i,cyv-rw(0xa02a+s2));
   }
  }
  F.f1ff8_256d(rw(0x39dc),0x38ec,0x3914);
 }
}
// 2c46:026c drawGroupMirror: ES:DI group, BP vertex array (BX, CX preserved). Mirror view (DS:2a68 != 0).
export function f2c46_026c(es,di,bp){drawGroup(es,di,bp,true);}
// 2c46:0534 drawGroup: ES:DI group, BP vertex array. Normal view.
export function f2c46_0534(es,di,bp){drawGroup(es,di,bp,false);}

// 2c46:11ea drawShape(far shape): LOD select by DS:98fc, clear the vertex cache, sort the groups far to
// near by faceDot(group normal, reference vertex) (selection sort, signed high word then unsigned low
// word, ties keep order), then draw every group. Arguments: far pointer (off, seg).
export function f2c46_11ea(off,seg){
 const es=seg;let di=u16(off);
 wb(0x2b0c,frb(es,di+3));
 const bp=frw(es,di+4);
 di=u16(di+6);
 const lim=rsw(0x98fc);let ax;
 for(;;){ax=frw(es,di);if(s16(ax)<=lim)break;di=u16(di+4);}   // JNG
 if(ax===0xffff)di=u16(di-4);
 di=frw(es,di+2);
 if(frb(es,di)&0x80)return;
 const n=rb(0x2b0c);for(let i=0;i<n;i++)wb(0x9708+i,0);        // REP STOSB with ES=DS
 wb(0x2bcd,frb(es,di+1));
 di=u16(di+2);let bx=0;
 for(;;){
  ax=frw(es,di);if(ax===0xffff)break;
  ww(bx+0x2b0d,ax);
  const d=f2c46_14b3(es,bp,frb(es,ax+1)|rb(0x2bcd)<<8);
  ww(bx+0x2b4d,d);ww(bx+0x2b8d,d>>>16);
  bx=u16(bx+2);di=u16(di+2);
 }
 // UNKNOWN: with no groups CX becomes 0xfffe and the original's inner sort loop never ends (SI wraps).
 // No shipped .tbl has an empty group list (all 13 files checked), so this throws instead of hanging.
 if(bx===0)throw Error('2c46:11ea: empty group list (the original hangs here)');
 let cx=u16(bx-2);
 if(cx){
  bx=0;
  do{
   let lo=rw(bx+0x2b4d),hi=rsw(bx+0x2b8d),sel=bx;
   for(let s=bx+2;s<=cx;s+=2){
    const sh=rsw(s+0x2b8d);
    if(sh>hi||(sh===hi&&rw(s+0x2b4d)>lo)){hi=sh;lo=rw(s+0x2b4d);sel=s;}
   }
   if(bx!==sel)for(const base of [0x2b0d,0x2b8d,0x2b4d]){const t=rw(bx+base);ww(bx+base,rw(sel+base));ww(sel+base,t);}
   bx+=2;
  }while(bx<cx);
 }
 const cnt=(cx>>>1)+1;
 for(let i=0,b=0;i<cnt;i++,b+=2){
  const g=rw(b+0x2b0d);
  if(rw(0x2a68))f2c46_026c(es,g,bp);else f2c46_0534(es,g,bp);
 }
}

// ---------------------------------------------------------------- segment 2f73 (EGA paths only)

// ES/DS:offset to an offset in the EGA model; the game only points these at A000-AFFF.
function voff(seg,off){
 const lin=seg*16+u16(off);
 if(lin<0xa0000||lin>0xaffff)throw Error(`2f73: video segment ${seg.toString(16)} outside A000-AFFF`);
 return lin-0xa0000;
}
// OUT DX,AX to an index/data pair (the EGA model ignores the data byte of a word whose high byte is 0).
function outw(port,v){ega.out(port,v&0xff);ega.out(port+1,v>>8&0xff);}

// 2f73:000f drawSky(top, start, xoff, pan): city panorama latch copy (EGA branch 2f73:0022).
export function f2f73_000f(top,start,xoff,pan){
 const id=rw(0x95d6);
 if(id===3)return unsupported('2f73:01c5 Tandy sky panorama');
 if(id===1)return cgaSky(top,start,xoff,pan);
 if(id!==2)return unsupported('2f73:00f0 MCGA/mode-4 sky panorama');
 const es=rw(0x3852);
 outw(0x3ce,0x0105);outw(0x3c4,0x0f02);                    // write mode 1, map mask F
 let cx=0;const d=u16(top-start);if(!(d&0x8000))cx=d;      // JS on the 16-bit difference
 let di=rw(0x3d3e+u16(u16(start+cx)<<1));
 const dx=u16(rw(0x9642)-cx);
 if(dx===0){outw(0x3ce,0x0205);return;}                   // JZ 2f73:0003, shared epilogue
 let ax=u16(pan),k=0;
 for(;;){ax=u16(ax-0x140);if(ax&0x8000)break;k++;}
 const kb=u16(k<<2);
 const cx8=u16(cx<<3),cx32=u16(cx8<<2);                    // SHL CX x3, ADD; SHL CX x2, ADD
 let si=u16(rw(0x9bce+kb)+cx8+cx32);const ds=rw(0x9bd0+kb);
 const c=u16(xoff)>>>3,w=u16(0x28-c);
 // QUIRK: the row counter is DEC DL, so a count whose low byte is 0 runs 256 rows and a negative count
 // runs u8(count) rows (race.md note 14).
 const rows=(dx&0xff)||256;
 {let s=si,t=di;
  for(let r=0;r<rows;r++){s=u16(s+c);for(let i=0;i<w;i++){const v=ega.rd(voff(ds,s));ega.wr(voff(es,t),v);s=u16(s+1);t=u16(t+1);}t=u16(t+c);}}
 if(c){
  let k2=k+1;if(k2>=6)k2=0;const kb2=k2<<2;               // BX is k here (CMP BX,6 / JC)
  let s=u16(rw(0x9bce+kb2)+cx32+(cx32>>>2));const ds2=rw(0x9bd0+kb2); // CX still holds skip*32 here
  let t=u16(di+w);
  for(let r=0;r<rows;r++){for(let i=0;i<c;i++){const v=ega.rd(voff(ds2,s));ega.wr(voff(es,t),v);s=u16(s+1);t=u16(t+1);}t=u16(t+w);s=u16(s+w);}
 }
 outw(0x3ce,0x0205);
}

// 2f73:00f0 CGA sky (adapter 1), the branch of 2f73:000f taken for id 1: plain RAM copy of 80-byte panorama rows
// (strip k = pan div 320 at [9bce+4k], +80 per skipped row) to the 80-byte-wide back page [3852]; no latches.
// APPROX: CGA VRAM cost (the destination is B800 RAM; no work counter is charged).
function cgaSky(top,start,xoff,pan){
 const es=rw(0x3852);
 let cx=0;const d=u16(top-start);if(!(d&0x8000))cx=d;     // SUB AX,BX / JS: skip = top-start when >= 0
 const row0=u16(u16(start+cx)<<1);                        // ADD BX,CX / SHL BX,1
 const dx=u16(rw(0x9642)-cx);
 // QUIRK: JLE 2f73:00eb leads to POP..POP + near RET in a far-called function (stack mismatch). The original
 // would run off; this throws instead. Only reachable when [9642] <= top-start (UNKNOWN: never seen).
 if(rsw(0x9642)<=s16(cx))throw Error('2f73:00f0: [9642] <= skip (the original returns with a near RET from a far call)');
 let ax=u16(pan),k=0;
 for(;;){ax=u16(ax-0x140);if(ax&0x8000)break;k++;}
 const kb=u16(k<<2),dh=kb&0xff;
 const cx16=u16(cx<<4),cx64=u16(cx16<<2);                  // SHL CX x4, ADD; SHL CX x2, ADD -> 80*skip
 const si0=u16(rw(0x9bce+kb)+cx16+cx64),ds=rw(0x9bd0+kb);
 const c=u16(xoff)>>>2,bp=u16(0x50-c);                     // xoff bytes, destination run length
 // QUIRK: the row counter is DEC DL (a count with a zero low byte runs 256 rows), as in the EGA branch.
 const rows=(dx&0xff)||256;
 {let s=si0,bx=row0;
  for(let r=0;r<rows;r++){
   let di=rw(0x3d3e+bx);s=u16(s+c);
   for(let i=0;i<bp;i++){fwb(es,di,frb(ds,s));s=u16(s+1);di=u16(di+1);}
   bx=u16(bx+2);
  }}
 if(c){
  let b2=u16(dh+4);if(b2>=0x18)b2=0;                       // CMP BX,18h / JC: segment (k+1) mod 6
  let s=u16(rw(0x9bce+b2)+cx64+(cx64>>>2));const ds2=rw(0x9bd0+b2); // CX still holds skip*64 here
  let bx=row0;
  for(let r=0;r<rows;r++){
   let di=u16(rw(0x3d3e+bx)+bp);
   for(let i=0;i<c;i++){fwb(es,di,frb(ds2,s));s=u16(s+1);di=u16(di+1);}
   s=u16(s+bp);bx=u16(bx+2);
  }
 }
}

// 2f73:02a4 drawGroundByAdapter: JMP [DS:2afc + 2*DS:95d6]. EGA (02ae) and CGA (035f, id 1) are translated.
export function f2f73_02a4(){
 const id=rw(0x95d6),t=rw(0x2afc+u16(id<<1));
 if(t===0x02ae)return f2f73_02ae();
 if(t===0x035f&&id===1)return f2f73_035f();
 return unsupported(`2f73:02a4 ground fill, adapter ${id} -> 2f73:${t.toString(16).padStart(4,'0')}`);
}
// 2f73:02ae egaDrawGround: rows [8db2]-1 .. 99 of page DS:3858 from the 8-byte records DS:9252+8*row
// (+0 middle colour, +2 b, +4 a, +6 left colour, +7 right colour), EGA write mode 2. Entry state assumed
// from the caller: map mask F, GC3 = 0. Note: row 99 is painted; only r0 >= 99 skips everything
// (race.md's "..98" is wrong; graphics.md is right).
export function f2f73_02ae(){
 outw(0x3ce,0x0205);ega.out(0x3ce,8);
 const es=rw(0x3858);
 let row=u16(rw(0x8db2)-1);
 if(s16(row)>=0x63){outw(0x3ce,0x0205);return;}
 let si=u16(0x9252+u16(row<<3));
 for(;;){
  const col=rw(si);let b=rw(si+2),a=rw(si+4);si=u16(si+6);
  if(a>b){a=0;b=0;}
  // left verge: bytes 0 .. ((a+7)>>3)-1
  let di=rw(0x3d3e+u16(row<<1)),n=u16(a+7)>>>3;
  ega.out(0x3cf,0xff);let v=rb(si);si=u16(si+1);
  for(let i=0;i<n;i++){ega.wr(voff(es,di),v);di=u16(di+1);}
  // right verge: bytes b>>3 .. 39 (count wraps as a 16-bit REP count)
  di=u16(rw(0x3d3e+u16(row<<1))+(b>>>3));n=u16(0x28-(b>>>3));
  ega.out(0x3cf,0xff);v=rb(si);si=u16(si+1);
  for(let i=0;i<n;i++){ega.wr(voff(es,di),v);di=u16(di+1);}
  if(a!==b)f2f73_0469(a,b,row,col);
  row=u16(row+1);
  if(row===0x64)break;
 }
 outw(0x3ce,0x0205);
}
// 2f73:0469 egaGroundMiddle: AX = a, BX = b (inclusive), DI = row, colour = CX pushed (low byte).
// ES is the page segment DS:3858 (set by 02ae). Leaves GC index at 8 (or GC5=2/GC3=0 in the one-byte case).
export function f2f73_0469(a,b,row,colour){
 const es=rw(0x3858);
 const e=u16(b+1);
 let di=u16(rw(0x3d3e+u16(row<<1))+(u16(a)>>>3));
 const al=colour&0xff;
 if(((e^a)&0x1f8)===0){                                   // a and b+1 in the same byte
  let cl=rb(0x2ace+(e&7));
  if(a&7)cl&=rb(0x2ac6+(a&7));
  outw(0x3ce,0x0205);outw(0x3ce,0x0003);outw(0x3ce,0x08|cl<<8);
  ega.rd(voff(es,di));ega.wr(voff(es,di),al);
  return;
 }
 const lm=rb(0x2ac6+(a&7));
 let cx=u16(u16(e-a)-(8-(a&7)));
 const rm=rb(0x2ace+(cx&7));
 cx=cx>>>3;
 ega.out(0x3ce,8);
 if(lm){ega.out(0x3cf,lm);ega.rd(voff(es,di));ega.wr(voff(es,di),al);di=u16(di+1);cx=u16(cx-1);}
 cx=u16(cx+1);
 if(s16(cx)>0){ega.out(0x3cf,0xff);for(let i=0;i<cx;i++){ega.wr(voff(es,di),al);di=u16(di+1);}}
 if(rm){ega.out(0x3cf,rm);ega.rd(voff(es,di));ega.wr(voff(es,di),al);}
}
// 2f73:035f cgaDrawGround: rows [8db2]-1 .. 99 of page DS:3858 (B800, 80 bytes per row, 4 pixels per byte) from the
// 8-byte records DS:9252+8*row (+0 middle colour word, +2 b, +4 a, +6 left colour byte, +7 right colour byte).
// Entry: nothing assumed (no EGA state). The left verge is bytes 0..((a+3)>>2)-1, the right verge bytes
// (b>>2)..79; then the middle 2f73:0513 unless a == b. Unlike the EGA version there is no a > b clamp.
// APPROX: CGA VRAM cost (B800 RAM; no work counter is charged).
export function f2f73_035f(){
 const es=rw(0x3858);
 let si=0x9252,ax=rw(0x8db2);
 ax=u16(ax-1);let di=ax;si=u16(si+u16(ax<<3));
 if(rsw(0x8db2)>=0x64)return;                              // CMP AX,BP / JGE
 const fill=(off,n,v)=>{for(let i=0;i<n;i++)fwb(es,u16(off+i),v);};
 do{
  const col=rw(si),b=rw(si+2),a=rw(si+4);si=u16(si+6);
  let d=rw(0x3d3e+u16(di<<1));
  fill(d,u16(a+3)>>>2,rb(si));si=u16(si+1);                // CX=(a+3)>>2, AX=0 so DI keeps the row start
  d=rw(0x3d3e+u16(di<<1));
  const bq=b>>>2;                                          // AX = b>>2; CX = 0x142>>2
  fill(u16(d+bq),u16(0x50-bq),rb(si));si=u16(si+1);
  if(a!==b)f2f73_0513(es,a,b,col,di);
  di=u16(di+1);
 }while(di!==0x64);
}
// 2f73:0513 cgaGroundSpan (near, register arguments: ES = page segment, AX = a, BX = b, CX = colour word, DI = row):
// left partial byte (mask DS:2ad6[a&3] keeps the left pixels), then (b-a+(a&3))>>2 bytes from DI+1 as colour
// word pairs (STOSB when bit 2 of the count is set, then (count>>3) STOSW), then the right partial byte
// (mask DS:2ada[count&3] keeps the right pixels). QUIRK (static, unverified against DOSBox): the byte count is
// taken after the left byte was already written, so the middle reaches up to 4 pixels past b.
export function f2f73_0513(es,ax,bx,cx,di){
 let d=rw(0x3d3e+u16(di<<1));
 let len=u16(bx-ax);const bp=ax&3;len=u16(len+bp);
 d=u16(d+(u16(ax)>>>2));
 const lo=cx&0xff,hi=cx>>>8&0xff;
 let al=rb(0x2ad6+bp);
 fwb(es,d,frb(es,d)&al);fwb(es,d,frb(es,d)|(~al&lo&0xff));
 d=u16(d+1);
 const bp2=len&3;
 let n=len>>>3;
 if(len&4){fwb(es,d,lo);d=u16(d+1);}
 for(let i=0;i<n;i++){fwb(es,d,lo);d=u16(d+1);fwb(es,d,hi);d=u16(d+1);}
 al=rb(0x2ada+bp2);
 fwb(es,d,frb(es,d)&al);fwb(es,d,frb(es,d)|(~al&lo&0xff));
}

// 2f73:05d8 setGroundSpanRoutine(AX = adapter id): stores the near span routine for the adapter in DS:2b06
// (2 -> 0469, 3 -> 0564, else 0513). DS:2b06 has no reader in the program (static).
export function f2f73_05d8(ax){ww(0x2b06,ax===2?0x0469:ax===3?0x0564:0x0513);}

// Code addresses stored in data: DS:2afc (02a4 jump table) and DS:2b06 (05d8).
register(0x2f73,0x02ae,f2f73_02ae);
register(0x2f73,0x035f,f2f73_035f);
register(0x2f73,0x0469,f2f73_0469);

provide({f2c46_000a,f2c46_004e,f2c46_005e,f2c46_006e,f2c46_00b4,f2c46_00fa,f2c46_0114,f2c46_01a4,f2c46_026c,
 f2c46_03d8,f2c46_0468,f2c46_0534,f2c46_06a0,f2c46_0a63,f2c46_0a8a,f2c46_0fa5,f2c46_10d2,f2c46_11ea,f2c46_1317,
 f2c46_13ad,f2c46_1434,f2c46_14b3,f2c46_1504,f2c46_311a,f2c46_3140,f2c46_3163,f2c46_31b6,f2c46_31eb,f2c46_3220,
 f2c46_32c6,f2f73_000f,f2f73_02a4,f2f73_02ae,f2f73_035f,f2f73_0469,f2f73_05d8});
export {f2c46_06a0 as matFromAngles,f2c46_0a8a as matMul,f2c46_11ea as drawShape,f2c46_3220 as atan2_16,
 f2c46_311a as sin16,f2c46_3140 as cos16,f2f73_02a4 as drawGroundByAdapter,f2f73_000f as drawSky};
