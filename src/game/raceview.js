// Race rendering glue and small race helpers in 1000:a000-a38f and 1000:a410-bfff (raceview agent).
// Object projection and draw order, road row setup (front and mirror), sky and mirror background,
// gauges, shape-table file loading, the .MAP packed-to-planar upload and the retrace wait.
// Analysis: docs/re/race.md (3D renderer, Dashboard and HUD), docs/re/resources.md (.MAP, .tbl),
// docs/re/graphics.md. Calling convention: docs/TRANSLATION_BRIEF.md (one parameter per pushed word).
//
// Not translated here:
// - 1000:a010-a14b is the tail of 1000:9e90 (it uses 9e90's BP frame; race agent).
// - 1000:bfd8 is an unreferenced debug routine (MDA printf via e382); skipped by instruction.
import {rb,rsb,rw,rsw,wb,ww,rd,rsd,wd,frb,frsw,frw,fwb,pseg,poff,salloc,sfree,gseg} from '../engine/mem.js';
import {s16,u16,idiv16,imod16,div16,imul16,sar16,lshl} from '../engine/int.js';
import {idle} from '../engine/host.js';
import * as ega from '../engine/ega.js';
import {vstatus,int10} from './bios.js';
import {F,provide} from './link.js';

// ---------------------------------------------------------------- local helpers (not original functions)
// CWD / XOR AX,DX / SUB AX,DX: absolute value of a 16-bit word; 0x8000 stays 0x8000 (negative).
const abs16=x=>{x=s16(x);return x<0?s16(-x):x;};
// OUT DX,AX to an EGA index/data pair.
const outw=(port,v)=>ega.outw(port,v);
// 1000:e80c signed long divide (software, truncating). Arguments are (lo,hi) words; result DX:AX.
const ldivw=(a,b)=>u16(F.f1000_e80c(a&0xffff,a>>>16&0xffff,b&0xffff,b>>>16&0xffff));
// The (long)v << CL loops (SHL AX,1 / RCL DX,1, CL times, skipped when CL = 0), CL = byte DS:9640.
const shl32=(v,n)=>lshl(s16(v),n&0xff);
// Slot-3 bitmap blit through the near bitmap table whose address is the word DS:tab.
const blitTab=(tab,idx2,x,y)=>F.f1ff8_2541(rw(rw(tab)+idx2),s16(x),s16(y));
// Packed far pointer stored at a DS dword (off, seg) as a far-pointer pair.
const tblEntry=shape=>{const off=rw(0x98dc),seg=rw(0x98de),o=u16(off+u16(shape<<2));return [frw(seg,o),frw(seg,o+2)];};

// ---------------------------------------------------------------- 1000:a14c-a38e (race helpers)

// 1000:a14c playerDestroyed: speed 0, sound DS:a254, end countdown DS:a672 = 25.
export function f1000_a14c(){
 ww(0x8926,0);
 F.f1ff8_3c64(rw(0xa254));
 ww(0xa672,0x19);
}

// 1000:a166 aheadContact(pos, speed, i): DS:9af4[i] = carAhead(i); 1 when pos[ahead]-3 <= pos + speed>>5.
export function f1000_a166(pos,speed,i){
 const ax=f1000_a210(i);
 ww(0x9af4+u16(i<<1),ax);
 if(s16(ax)<0)return 0;
 const sp=s16(speed)>>5;
 return s16(rw(0x96f2+u16(ax<<1))-3)<=s16(pos+sp)?1:0;
}

// 1000:a1ac sideBlocked: 1 when a live car 9..1 is in the player's lane with |rel| < speed>>5.
export function f1000_a1ac(){
 let si=9,di=0xa98c,rel=0x89de;
 do{
  if(rb(0x8a54+si)!==0&&f1000_a2ac(rw(0xa97a),rw(di))){
   if(abs16(rw(rel))<(rsw(0x8926)>>5))return 1;
  }
  di-=2;rel-=2;si--;
 }while(si>0);
 return 0;
}

// 1000:a210 carAhead(i): live car with the smallest pos strictly greater than pos[i], same lane; -1 if none.
// QUIRK: no start-line wrap (race.md, Translation notes 7).
export function f1000_a210(i){
 let best=-1,bestPos=10000;
 const pi=u16(0x96f2+u16(i<<1)),li=u16(0xa97a+u16(i<<1));
 for(let si=0;si<10;si++){
  const p=rsw(0x96f2+2*si);
  if(p<=rsw(pi))continue;
  if(si===u16(i))continue;
  if(!f1000_a2ac(rw(0xa97a+2*si),rw(li)))continue;
  if(p>=bestPos)continue;
  if(rb(0x8a54+si)===0)continue;
  best=si;bestPos=p;
 }
 return best;
}

// 1000:a294 gap(a, b): pos[b] - pos[a].
export function f1000_a294(a,b){return s16(rw(0x96f2+u16(b<<1))-rw(0x96f2+u16(a<<1)));}

// 1000:a2ac sameLane(a, b): 1 when the (16-bit wrapping) distance |a-b| < 30.
export function f1000_a2ac(a,b){
 a=s16(a);b=s16(b);
 const d=a>b?s16(a-b):s16(b-a);
 return d<0x1e?1:0;
}

// 1000:a2de textLine(idx, kind): copies string idx of a text table in segment 33ae to DS:5a1e.
// kind 0 bios (DS:21cc), 3 tracks (2562), 2 weapons (23b2), otherwise parts (2292). Huge-pointer walk.
export function f1000_a2de(idx,kind){
 kind=u16(kind);
 let tab,base;
 if(kind===0){tab=0x21cc;base=0x4;}
 else if(kind===3){tab=0x2562;base=0x2a73;}
 else if(kind===2){tab=0x23b2;base=0x12bb;}
 else{tab=0x2292;base=0x4db;}
 let ax=rw(tab+u16(idx<<1));
 let dx=ax&0x8000?0xffff:0;                   // CWD
 const sum=ax+base;if(sum>0xffff)dx=dx+1&0xffff;ax=sum&0xffff;
 let seg=u16((dx<<12)+gseg(0x33ae)),off=ax,si=0x5a1e;
 for(;;){
  const c=frb(seg,off);
  off++;if(off>0xffff){off=0;seg=seg+0x1000&0xffff;}
  wb(si,c);si=si+1&0xffff;
  if(!c)break;
 }
 return 0x5a1e;
}

// ---------------------------------------------------------------- draw order

const key=p=>rsw(0x8f48+(rsb(p)<<1));         // depth key DS:8f48[signed byte at DS:p]

// 1000:a410 sortCheck(idx): checks 38 pairs for descending depth; on an inversion sorts idx..idx+38.
// QUIRK (race.md, Translation notes 5; resources.md a410): after the first pair (idx, idx+1) the cursor
// does SI = DI, DI += 2, so the pairs are (1,2), (2,4), (4,6) ... (74,76) in DS:8eda entry numbers.
// Odd neighbours are never compared and entries 40..76 (bytes past DS:8f01) are read as indices.
export function f1000_a410(idx){
 let si=u16(idx),di=si+1&0xffff,dx=0x26,cx=0;
 for(;;){
  const ax=dx;dx=dx-1&0xffff;
  if(ax===0)break;
  const ks=key(si);
  if(key(di)>ks){cx++;break;}
  si=di;di=di+2&0xffff;
 }
 if(cx)f1000_a470(u16(idx+0x26),u16(idx));
}

// 1000:a470 qsortDesc(hi, lo): Hoare quicksort of the signed-byte indices DS:lo..hi, descending by the key.
// Pivot key[*lo] read once per outer pass; recurses into the smaller part (stdcall, RET 4).
export function f1000_a470(hi,lo){
 hi=u16(hi);lo=u16(lo);
 let si=hi+1&0xffff,di=lo;
 const swap=(a,b)=>{const t=rb(a);wb(a,rb(b));wb(b,t);};
 for(;;){
  if(lo>=hi)return;
  const piv=key(lo);
  for(;;){
   for(;;){di=di+1&0xffff;if(hi<=di)break;if(!(key(di)>piv))break;}
   for(;;){si=si-1&0xffff;if(lo>=si)break;if(!(key(si)<piv))break;}
   if(si>di){swap(di,si);continue;}
   break;
  }
  swap(lo,si);
  if(s16(si-lo)<s16(hi-si)){
   f1000_a470(si-1&0xffff,lo);
   lo=si+1&0xffff;di=lo;si=hi+1&0xffff;
  }else{
   f1000_a470(hi,si+1&0xffff);
   hi=si-1&0xffff;di=lo;                      // SI keeps the partition point (= new hi + 1)
  }
 }
}

// 1000:a536 setMode6: INT 10h AX=0006h (CGA start-up path only; the adapter check happens in the caller).
export function f1000_a536(){int10({ax:6,bx:0,cx:0,dx:0,si:0,di:0,ds:0,es:0});}

// 1000:a53c loadShapes(name): shape table "<name>.tbl" (default DS:2a3e "shape"), projection constants.
export function f1000_a53c(name){
 F.f2c46_006e(name?name:0x2a3e);
 ww(0x9640,7);ww(0xa8a2,0x80);ww(0x8ec0,1);ww(0x8e8a,0x2a44);
}

// 1000:a570 drawObjectsFront: back-to-front draw of entities ahead, sprites, and the pixel hit test.
// The hit test itself (7610 save/mark, 767c, 76e2 re-read, 775e restore) is race code reading the EGA.
export function f1000_a570(){
 let hit=0;                                   // [bp-0xc]
 ww(0x9b8e,0xa1);ww(0x9bb8,0x41);
 for(let i=0;i<6;i++)wb(0x98f4+i,rb(0xa93e+i));   // camera position = car 0
 wb(0x384b,1);
 F.f1000_0286();
 for(let b=1;b<0x28;b++)wb(0x8eda+b,b);
 f1000_a410(0x8edb);
 if(rw(0x8a4c)!==0){
  const w=rsb(0x9bc8);
  if(w===1){
   ww(0x8e8c,(rw(0x9636)&0xf)+rw(0x898a)-8);
   const t=rw(0x9636)>>8;
   ww(0x8e92,(t&0xf)+rw(0x8a1c)-8);
  }else if(w>=2&&w<=3){ww(0x8e8c,rw(0x898a));ww(0x8e92,rw(0x8a1c));}
  F.f1000_7610();F.f1000_767c();
 }
 ww(0x3847,0x20);
 for(let b=1;b<0x28;b++){
  const si=rsb(0x8eda+b),di=u16(si<<1);
  const rel=rsw(0x89cc+di);
  if(rel<0)continue;
  if(rel<rsw(0x8e70)){
   ww(0x3849,rw(0x5c1c+di));
   const p6=u16(si*6);
   if(si<0xa){
    if(rb(0x8e9c+si)===0){
     const st=rsb(0x8a54+si);
     if(st>0||st<-5){
      let l=rsw(0x89cc+di)>>3;if(l>4)l=4;
      if(l<2){
       const det=rw(0x1fa4);
       if(det!==0){if(det===1)l+=1;else if(det===2)l+=2;else l+=3;}
       else if(rw(0x9aa6+di)!==0)l+=5;
      }
      l=s16(l+rw(0xaa1e+di));
      f1000_aae4(l,0xa93e+p6,0x898c+p6);
      ww(0x998a+di,rw(0x8dc2));ww(0x99d6+di,rw(0x8e88));
     }else{
      if(st===0){
       if(rsw(0x1fa4)<4)f1000_aae4(0x21,0xa93e+p6,0x898c+p6);
      }else{
       f1000_aae4(s16(0x1c-st),0xa93e+p6,0x898c+p6);
       const k=-st-1;
       let l=idiv16(rw(0x89cc+di),0x19);if(l>5)l=5;
       const fr=rb(0x1f84+u16((l<<2)+k));
       if(rw(0x9a80)!==0){const d2=fr<<1;blitTab(0x9a80,d2,rw(0x990a+d2)+rw(0x8dc2),rw(0x999e+d2)+rw(0x8e88));}
      }
      ww(0x998a+di,0xffff);
     }
    }
   }else if(si<0x14){
    if(rb(0x8a54+si)!==0){
     const shape=rw(0xaa1e+di),j=si-0xa,timer=rsw(0x8dc4+2*j),j6=u16(j*6);
     if(rb(0x8a54+si)===0x0a){
      if(timer<4){
       const fr=rb(0x1f88+u16(-timer));
       if(rw(0x9a80)!==0){const d2=fr<<1;blitTab(0x9a80,d2,rw(0x990a+d2)+0xa0,rw(0x999e+d2)+0x50);}
      }
     }else{
      f1000_aae4(shape,0x9a42+j6,0x8e20+j6);
      const t=rb(0x8a54+si);
      if(t===6)wb(0x8e25+j6,rb(0x8e25+j6)+3);
      if((t===6||t===4)&&timer<4){
       let l=idiv16(rw(0x89cc+di),0x19);if(l>5)l=5;
       const fr=rb(0x1f84+u16((l<<2)+timer)),d2=fr<<1;
       blitTab(0x9a80,d2,rw(0x990a+d2)+rw(0x8dc2),rw(0x999e+d2)+rw(0x8e88));   // no DS:9a80 null test here
      }
     }
    }
   }else{
    if(rsw(0x1fa4)<2&&rb(0x8a54+si)!==0){
     let shape=rsw(0xaa1e+di);const k6=u16((si-0x14)*6);
     if(shape<=0xb&&rsw(0x89cc+di)>0x32)shape=3;
     f1000_aae4(shape,0x8f9e+k6,0xa9a4+k6);
    }
   }
  }
  // 1000:a88d: queued spark, then the hit test after each object (also for rel >= DS:8e70)
  if(rw(0x2a64)===u16(si)){
   const r2=(rw(0x9636)&3)<<1;
   blitTab(0x9a80,r2,rw(0x990a+r2)+rw(0x5aa0),rw(0x999e+r2)+rw(0x5aa2));
   ww(0x2a64,0);
  }
  if(rw(0x8a4c)!==0){
   ww(0x3849,0x64);
   if(u16(F.f1000_76e2())){hit=si;F.f1000_7610();F.f1000_767c();}
  }
 }
 if(hit!==0&&hit<0x14){
  ww(0x2a64,hit);ww(0x5aa0,rw(0x8e8c));ww(0x5aa2,rw(0x8e92));
  if(hit<0xa){
   const w=rsb(0x9bc8);
   if(w===1)F.f1000_9e90(hit,u16(-1));else if(w===2)F.f1000_9e90(hit,u16(-2));else if(w===3)F.f1000_9e90(hit,u16(-3));
  }
  if(hit>=0xa&&hit<0x14){ww(0x8db0+2*hit,5);wb(0x8a54+hit,1);}
  hit=0;
 }
 const w=rsb(0x9bc8);
 if(w===1)F.f1000_9370(0x3c);
 else if(w===4)F.f1000_9370(0x3e8);
 else if(w===5)F.f1000_925e();
 else F.f1000_9370(0x1e);
 F.f1000_775e();
 ww(0x8a4c,0);
}

// ---------------------------------------------------------------- projection and object draw

// 1000:aa2a projectPoint(v*, x*, y*): sx = cx +/- (x<<[9640])/max(|y|,near), sy = cy - (z<<[9640])/...
// x is mirrored while DS:2a68 != 0. Uses the software divide 1000:e80c.
// Returns the exit CX (sy when y* is non-null), which aae4 hands on to mat_mul's stale-CX quirk.
export function f1000_aa2a(v,px,py){
 let d=abs16(rw(v+2));
 if(d<rsw(0x8ec0))d=rsw(0x8ec0);
 let cx=0;
 if(px){
  const q=ldivw(shl32(rw(v),rb(0x9640)),s16(d));
  if(rw(0x2a68)!==0)ww(px,rw(0x9b8e)-q);
  else ww(px,q+rw(0x9b8e));
  cx=0; // UNKNOWN: CX after e80c depends on the runtime helper; overwritten below whenever y* != 0
 }
 if(py){
  const q=ldivw(shl32(rw(v+4),rb(0x9640)),s16(d));
  cx=u16(rw(0x9bb8)-q);ww(py,cx);
 }
 return cx;
}

// 1000:aae4 drawObject(shape, pos*, ang*): view transform, sphere cull, projected radius DS:98fc,
// corner frustum test, object matrix, 2c46:11ea. Writes the projected centre DS:8dc2/8e88 (-1 if culled).
export function f1000_aae4(shape,pos,ang){
 const base=salloc(6),bp=base+6;             // [bp-6], [bp-4], [bp-2]
 try{
  ww(0x8dc2,0xffff);ww(0x8e88,0xffff);
  ww(0x98ec,rw(pos)-rw(0x98f4));ww(0x98ee,rw(pos+2)-rw(0x98f6));ww(0x98f0,rw(pos+4)-rw(0x98f8));
  F.f2c46_0fa5(0x98ec,0x9622,0x9bf8);
  let [eo,es]=tblEntry(shape);
  const r=s16(F.f2c46_1504(eo,es));ww(bp-4,r);
  if(s16(r+rw(0x9bfa))<rsw(0x8ec0))return;
  const d=s16(rw(0x9bfa)-r);ww(bp-6,d);
  const pr=d<0x80?u16(r):ldivw(shl32(r,rb(0x9640)),d);
  ww(0x98fc,pr);
  if(pr===0)return;
  f1000_aa2a(0x9bf8,0x8dc2,0x8e88);
  ww(0x9a9e,abs16(rw(0x9bf8))-r);
  ww(0x9aa0,r+rw(0x9bfa));
  ww(0x9aa2,abs16(rw(0x9bfc))-r);
  const cx=f1000_aa2a(0x9a9e,bp-2,bp-6);
  if(rsw(bp-2)>rsw(0x3845))return;
  if(rsw(bp-6)<rsw(0x3847))return;
  const cxOut=F.f2c46_06a0(ang,0xaa6f,cx);    // 06a0 starts with MOV CL,3: CH survives from aa2a
  if(rb(0xaa81)!==0){
   // QUIRK (race.md, Translation notes 9): mat_mul consumes the stale CX left by 06a0.
   F.f2c46_0a8a(0xaa6f,0x9622,0x8e74,u16(cxOut));
   wb(0x9a9c,0);ww(0x9236,0x8e74);
  }else{wb(0x9a9c,1);ww(0x9236,0x9622);}
  [eo,es]=tblEntry(shape);
  F.f2c46_11ea(eo,es);
 }finally{sfree(6);}
}

// ---------------------------------------------------------------- shape table and file loaders

// 1000:ac4c makeName(name, ext) far: DS:5aa4 = name + "." + ext (no bound, no existing-extension check).
export function f1000_ac4c(name,ext){
 let si=0x5aa4,di=u16(name);
 while(rb(di)!==0){wb(si,rb(di));di=di+1&0xffff;si=si+1&0xffff;}
 wb(si,0x2e);si=si+1&0xffff;
 di=u16(ext);
 while(rb(di)!==0){wb(si,rb(di));di=di+1&0xffff;si=si+1&0xffff;}
 wb(si,0);
 return 0x5aa4;
}

// 1000:ac8e loadFileNear(name, len*) far: fopen(name, DS:2a7a), malloc(filelength), fread, fclose.
// Fatal (ad82) on open, allocation or short read. No direct caller found (static).
export function f1000_ac8e(name,plen){
 const fp=u16(F.f1000_d678(name,0x2a7a));
 if(!fp)f1000_ad82();
 const len=u16(F.f1000_e3d0(rsb(fp+7)));     // filelength(fp->_file); low word kept
 const buf=u16(F.f1000_de60(len));
 if(!buf)f1000_ad82();
 if(len!==u16(F.f1000_d6a0(buf,1,len,fp)))f1000_ad82();
 F.f1000_d5be(fp);
 if(plen)ww(plen,len);
 return buf;
}

// 1000:ad0a loadFileHuge(name) far: open(name, O_RDONLY|O_BINARY), filelength, halloc(len,1), hugeRead,
// close. Fatal (ad82) if open fails, the block is NULL or its offset is non-zero. Returns DX:AX packed.
export function f1000_ad0a(name){
 const fd=u16(F.f1000_daa4(name,0x8000));
 if(fd===0xffff)f1000_ad82();
 const len=F.f1000_e3d0(fd)>>>0;
 const lo=len&0xffff,hi=len>>>16;
 const p=F.f1000_e43c(lo,hi,1)>>>0;
 if(p===0||poff(p)!==0)f1000_ad82();
 F.f1ff8_39c2(poff(p),pseg(p),lo,hi,fd);
 F.f1000_da0a(fd);
 return p;
}

// 1000:ad82 shapeTableFatal far: protectionExit(DS:2a7d "FATAL ERROR: Unable to load 3D shape table.").
export function f1000_ad82(){F.f1000_0344(0x2a7d);}

// 1000:ad8e packedToPlanar(srcOff, srcSeg, dstOff, dstSeg, countLo, countHi): EGA upload of 4 bpp packed
// pixels (high nibble first), 4 source bytes -> one byte in each plane, write mode 0, map mask per plane.
// Only the low count word is used. QUIRK: runs count+1 groups (INC BP before the DEC/JZ loop), so one
// extra group past the chunk is converted; the loader's next chunk overwrites it (static).
// QUIRK: only the second word of each group renormalises the source segment (DS += 1000h on offset carry).
// Ends with map mask F and write mode 2 (GC5 = 2).
export function f1000_ad8e(so,ss,doff,dseg,clo,chi){
 outw(0x3ce,0x0005);outw(0x3ce,0x0003);outw(0x3ce,0xff08);
 let si=u16(so),ds=u16(ss),di=u16(doff),bp=u16(clo)+1&0xffff;
 const es=u16(dseg);
 outw(0x3c4,0x0102);
 let ch=0,cl=0,bh=0,bl=0;
 const take=b=>{for(let k=0;k<2;k++){
  ch=(ch<<1|b>>7&1)&0xff;cl=(cl<<1|b>>6&1)&0xff;bh=(bh<<1|b>>5&1)&0xff;bl=(bl<<1|b>>4&1)&0xff;b=b<<4&0xff;}};
 const put=v=>{
  if(es>=0xa000&&es<0xb000)ega.wr(((es-0xa000)<<4)+di,v);
  else fwb(es,di,v);                          // not video memory: each plane write lands on the same byte
 };
 for(;;){
  take(frb(ds,si));take(frb(ds,si+1));si=si+2&0xffff;             // LODSW
  take(frb(ds,si));take(frb(ds,si+1));
  const carry=si+2>0xffff;si=si+2&0xffff;                         // MOV AX,[SI] / ADD SI,2
  if(carry)ds=ds+0x1000&0xffff;
  ega.out(0x3c5,1);put(bl);ega.out(0x3c5,2);put(bh);ega.out(0x3c5,4);put(cl);ega.out(0x3c5,8);put(ch);
  di=di+1&0xffff;
  bp=bp-1&0xffff;if(bp===0)break;
 }
 ega.out(0x3c5,0xf);
 outw(0x3ce,0x0205);
}

// 1000:ae8e egaSetWriteMode(m): EGA only (DS:95d6 = 2): GC5 = m, GC3 = 0, GC8 = FF.
export function f1000_ae8e(m){
 if(rw(0x95d6)!==2)return;
 outw(0x3ce,(m&0xff)<<8|5);outw(0x3ce,0x0003);outw(0x3ce,0xff08);
}

// 1000:aeaa waitVRetraceStart far: 3DAh bit 3, wait while set, then until set. Generator (blocking.json).
export function* f1000_aeaa(){
 while(vstatus()&8)yield* idle();
 while(!(vstatus()&8))yield* idle();
}

// 1000:aeba ddaSetup(dda*, n): dda = {u16 frac, s16 x, s32 step}; step = ((end-x)<<16)/n via 1000:e97e,
// frac = 0x8000 when |step| < 0x8000, else low word of |step|. Returns 0 (n <= 0, all cleared) or 1.
// QUIRK: the flag byte at [BP-2] overlays the caller's saved SI, so the caller's SI comes back with its
// low byte = 0/1. Both callers (b522, b8f6) reload SI before using it, so it has no effect (static).
export function f1000_aeba(p,n){
 if(s16(n)<=0){ww(p+6,0);ww(p+4,0);ww(p,0);return 0;}
 ww(p,0);ww(p+4,0);
 wd(p+4,rd(p+4)-rd(p)>>>0);
 const nn=s16(n);
 F.f1000_e97e(u16(p+4),nn&0xffff,nn<0?0xffff:0);     // *(long*)(p+4) /= (long)n
 let neg=0;
 if(rsw(p+6)<0){wd(p+4,-rsd(p+4)>>>0);neg=1;}
 if(((rw(p+4)&0x8000)|rw(p+6))===0)ww(p,0x8000);else ww(p,rw(p+4));
 if(neg)wd(p+4,-rsd(p+4)>>>0);
 return 1;
}

// 1000:af74 octDist(a*, b*): max + (3*min >> 3) of |dx|, |dy| (unsigned compares, 16-bit wrap).
export function f1000_af74(a,b){
 let ax=u16(abs16(rw(a)-rw(b))),cx=u16(abs16(rw(a+2)-rw(b+2)));
 if(ax>cx){const t=ax;ax=cx;cx=t;}
 return u16((u16(ax*3)>>>3)+cx);
}

// 1000:afa9 advancePlayer: pos DS:96f2 += (speed+sub) IDIV 30, sub DS:9b90 = remainder. No caller found.
export function f1000_afa9(){
 const ax=s16(rw(0x8926)+rw(0x9b90));
 ww(0x96f2,rw(0x96f2)+idiv16(ax,0x1e));
 ww(0x9b90,imod16(ax,0x1e));
}

// ---------------------------------------------------------------- dashboard gauges

// 1000:afc4 gauges: speed bar (x 0x77.., rows 0x7d-0x80) and fuel bar (x 0x89.., rows 3-6), each redrawn
// on the hidden page and copied to the visible page only when its value changes. Skipped on 3 of 4
// frames once the fuel value is initialised (DS:9908 != -1).
export function f1000_afc4(){
 if(rsw(0x9908)!==-1&&(rb(0x924e)&3))return;
 const v=s16((abs16(rsw(0x8926)>>1))&0xfffe);
 if(v!==rsw(0x2ac4)){
  wb(0x384b,0);F.f1000_0278();
  if(v<=0x52){
   wb(0x384e,0xa);
   let si=0;
   for(;si<v;si+=2){
    if(si===0x2a)wb(0x384e,0xe);else if(si===0x42)wb(0x384e,0xc);
    const x=si+0x77;F.f1ff8_2454(x,0x7d,x,0x80);
   }
   wb(0x384e,8);
   for(si=v;si<=0x52;si+=2){const x=si+0x77;F.f1ff8_2454(x,0x7d,x,0x80);}
  }
  F.f1000_026a();F.f1ff8_2545(0x77,0x7d,0x52,4);F.f1000_0278();
  ww(0x2ac4,v);
 }
 const f=s16((abs16(rw(0x96a0))>>6)&0xfffe);
 if(f!==rsw(0x9908)){
  wb(0x384b,0);F.f1000_0278();
  if(f<=0x40){
   wb(0x384e,0xc);
   let si=0;
   for(;si<f;si+=2){
    if(si===0x10)wb(0x384e,0xa);else if(si===8)wb(0x384e,0xe);
    const x=si+0x89;F.f1ff8_2454(x,3,x,6);
   }
   wb(0x384e,8);
   for(si=f;si<0x40;si+=2){const x=si+0x89;F.f1ff8_2454(x,3,x,6);}
  }
  F.f1000_026a();F.f1ff8_2545(0x77,3,0x52,4);F.f1000_0278();
  wb(0x384b,1);
  ww(0x9908,f);
 }
 wb(0x3842,0);wb(0x3840,0xc);wb(0x3841,0);
}

// ---------------------------------------------------------------- front view background and road rows

// 1000:b17e skyFront: clip rows 0x20..min(8db2,99); panorama (detail < 5) scrolled by heading
// X = ((t - (t SAR 4)) << 3) mod 0x780 with t = 0xff - byte DS:8991; then the sky band fill (DS:9aec).
export function f1000_b17e(){
 const c=rb(0x9aec);wb(0x384d,c);wb(0x384e,c);
 let a=rsw(0x8db2);if(a>0x63)a=0x63;ww(0x3849,a);
 ww(0x3847,0x20);
 let si;
 if(rsw(0x1fa4)<5){
  if(rsw(0x8f98)>0x20){
   const top=s16(rw(0x8f98)-0x19);
   const t=0xff-rb(0x8991);
   const x=s16(s16(t-(t>>4))<<3);
   const X=imod16(x,0x780),X320=imod16(X,0x140);
   if(top<0x4a)F.f2f73_000f(0x20,top,X320,X,1);
  }
  si=s16(rw(0x8f98)-0x19);
 }else si=rsw(0x8f98);
 ww(0x3849,0x63);
 F.f1ff8_3810(0,0x20,0x140,s16(si-0x20));
}

// 1000:b234 roadFront: camera matrix 9622, horizon DS:8f98/5c18, 40-step track walk into the row table
// DS:9252+8r (+2 right x, +4 left x) via b522, lookahead DS:8e70, then clamps rows 8db2..0x63.
// QUIRK: sx divides by depth+1 for negative x (SAR by 16 gives -1) (race.md, Road and ground 3).
export function f1000_b234(){
 const base=salloc(0x22),bp=base+0x22,v=bp-0x12,t=bp-0xa;
 try{
  ww(0xaa96,0);ww(0xa460,0);ww(0xa8aa,0x64);
  F.f2c46_06a0(0x898c,0x9622);
  F.f2c46_0a63(0x9622);
  ww(v,-rw(0xa93e));ww(v+2,-rw(0xa940));ww(v+4,-rw(0xa942));
  F.f2c46_0fa5(v,0x9622,t);
  ww(0x8db2,0x136);
  let h=s16((s16(F.f2c46_3163(rw(0x898c)))>>7)+0x41);
  ww(0x5c18,h);ww(0x8f98,h);
  if(h<0x20){ww(0x5c18,0x20);ww(0x8f98,0x20);}
  ww(0xa666,0x28);ww(0x8966,0);
  for(let r=0x63,n=0x44;n>0;n--,r--){ww(0x9256+8*r,0x190);ww(0x9254+8*r,0);}
  ww(0x3858,rw(0x3852));
  ww(0x8e8e,rw(0x96f2));
  const step=()=>{  // 1000:b436 dispatch on DS:a666; returns false when the walk ends
   const a=rsw(0xa666);
   if(a===0)return false;
   if(a>=0x23){}
   else if(a<=0x1e){ww(0x8e8e,rw(0x8e8e)+(a>0x14?2:a>0xa?4:8));}
   else ww(0x8e8e,rw(0x8e8e)+1);
   return true;
  };
  while(step()){
   if(rsw(0x8e8e)>rsw(0x8988)){ww(0xa460,rw(0xa460)+1);ww(0x8e8e,rw(0x8e8e)-rw(0x8988));}
   const pt=u16(u16(rw(0x8e8e)*6)+0x5c9e);
   F.f2c46_0fa5(pt,0x9622,v);
   ww(v,rw(v)+rw(t));ww(v+2,rw(v+2)+rw(t+2));ww(v+4,rw(v+4)+rw(t+4));
   if(rsw(v+2)>1){
    const x=rsw(v),y=rsw(v+2),z=rsw(v+4);
    const dsi=x>0?s16((x>>15)+y):s16(y-(x>>15));   // SAR 16 = sign mask
    const sx=s16(ldivw(lshl(x,7),dsi)+0xa1);
    const sy=s16(0x41-ldivw(lshl(z,7),y));
    const od=f1000_af74(pt,0x9b86);ww(0x9016,od);
    ww(0x5c9c,(od>>>2)+1);
    const w=div16(0xdac,rw(0x5c9c));
    if(f1000_b522(sx,sy,w))break;
   }
   ww(0xa666,rw(0xa666)-1);
  }
  // 1000:b41f
  const p=rsw(0x8e8e),p0=rsw(0x96f2);
  ww(0x8e70,p0>p?p-p0+rw(0x8988):p-p0);
  if(rsw(0x8f98)<rsw(0x8db2)){ww(0x5c18,rw(0x8db2));ww(0x8db2,rw(0x8f98));}
  else ww(0x5c18,0x20);
  let s=rsw(0x8db2);if(s<0x21)s=0x21;ww(0x8db2,s);
  if(s>=0x64)return;
  const cx=rsw(0x5c18);
  for(;s<0x64;s++){
   const L=0x9256+8*s,R=0x9254+8*s;
   if(s>0x20&&s<0x64){
    if(cx>s){ww(L,0);ww(R,0);}
    if(rsw(R)<0||rsw(L)>0x13f){ww(L,0);ww(R,0);}
    else if(rsw(R)>0x13f)ww(R,0x13f);
    if(rsw(L)<0)ww(L,0);
   }
  }
 }finally{sfree(0x22);}
}

// Shared body of the road rasterisers b522 (front) and b8f6 (mirror); parameters select tables/limits.
function roadRaster(sx,sy,w,c){
 const base=salloc(0x26),bp=base+0x26,dl=bp-0x1e,dr=bp-0x16;
 try{
  sx=s16(sx);sy=s16(sy);
  const left=s16(sx-w),right=s16(sx+w);
  const fin=()=>{ww(0x8966,rw(0x8966)+1);ww(c.dist,rw(0x9016));ww(c.r,right);ww(c.l,left);return 0;};
  if(rw(0x8966)===0){ww(c.row,sy);return fin();}
  if(rw(c.dist)>rw(0x9016))return 1;                         // distance shrinks: stop (unsigned)
  if(sy>rsw(c.top)){
   // crest: record the row above the current top once
   const si=s16(rw(c.top)-1);
   const n=rw(0xaa96);
   if(n!==0){
    if(rsw(0xa8aa+2*n)===si)return fin();
    ww(0xaa96,n+1);const d=2*(n+1);
    ww(0xa8aa+d,si>c.crestMax?c.crestMax:si);ww(0x921c+d,rw(c.dist));
   }else{
    ww(0xaa96,1);ww(0xa8ac,si>c.crestMax?c.crestMax:si);ww(0x921e,rw(c.dist));
   }
   return fin();
  }
  ww(dl+2,left);ww(dl+6,rw(c.l));ww(dr+2,right);ww(dr+6,rw(c.r));
  const cnt=s16(rw(c.row)-sy);
  f1000_aeba(dl,cnt);f1000_aeba(dr,cnt);
  // (a dead store [bp-4] = 12 when DS:8e8e < 4 is omitted: the local is never read)
  if(sy<c.rowEnd&&rsw(c.row)>c.rowMin&&rsw(c.row)>=sy){
   const cx=rsw(c.row);
   let si=sy;
   do{
    if(sy>c.rowMin)ww(c.top,sy);
    if(si<c.rowEnd&&si>c.rowMin){
     const L=c.lt+c.stride*si,R=c.rt+c.stride*si;
     let ax=s16(rw(dl+2)-1);if(ax>rsw(L))ax=rsw(L);ww(L,ax);
     ax=rsw(dr+2);if(ax<rsw(R))ax=rsw(R);ww(R,ax);
    }
    wd(dl,rd(dl)+rd(dl+4)>>>0);wd(dr,rd(dr)+rd(dr+4)>>>0);
    si++;
   }while(cx>=si);
  }
  ww(c.row,sy);
  return fin();
 }finally{sfree(0x26);}
}
const FRONT={dist:0x5ae6,l:0x5ae4,r:0x5ae8,row:0x5aea,top:0x8db2,crestMax:0x63,rowEnd:0x64,rowMin:0x20,lt:0x9256,rt:0x9254,stride:8};
const MIRROR={dist:0x5aee,l:0x5aec,r:0x5af0,row:0x5af2,top:0x9706,crestMax:0x21,rowEnd:0x22,rowMin:0xb,lt:0x965c,rt:0x95da,stride:2};

// 1000:b522 roadRaster(sx, sy, halfWidth): DDA between the previous and current projected edges into
// the front row table (keeps min left, max right). Returns 1 when the distance shrinks (walk ends).
export function f1000_b522(sx,sy,w){return roadRaster(sx,sy,w,FRONT);}

// 1000:b6a2 easeByte(a, b, lim): signed step from byte b toward byte a, at most lim (byte maths).
export function f1000_b6a2(a,b,lim){
 const d=(a-b)<<24>>24;
 const cx=d<0?-d:d;
 let ax=(lim&0xff)<<24>>24;if(ax>cx)ax=cx;
 const al=ax<<24>>24;
 return d>=0?al:s16(-al);
}

// ---------------------------------------------------------------- mirror

// 1000:b6dc roadMirror: mirror clip (0x78..0xc7, 0x0b..0x21), heading byte += 0x80, pitch negated,
// DS:2a68 = 1, centre (0xa0,0x18), 20-step backward walk (pos+3, -3 then -6) into DS:965c/95da via b8f6.
// bc30 undoes the pitch and DS:2a68 (the heading byte is not restored here).
export function f1000_b6dc(){
 const base=salloc(0x24),bp=base+0x24,v=bp-0x14,t=bp-0xa;
 try{
  ww(0x3847,0xb);ww(0x3849,0x21);ww(0x3843,0x78);ww(0x3845,0xc7);
  wb(0x8991,rb(0x8991)+0x80);
  ww(0x898c,-rw(0x898c));
  ww(0x2a68,1);ww(0xaa96,0);ww(0xa8aa,0x22);ww(0x9b8e,0xa0);ww(0x9bb8,0x18);
  F.f2c46_06a0(0x898c,0x9622);
  F.f2c46_0a63(0x9622);
  ww(v,-rw(0xa93e));ww(v+2,-rw(0xa940));ww(v+4,-rw(0xa942));
  F.f2c46_0fa5(v,0x9622,t);
  ww(0x9706,0x64);
  const h=s16((s16(F.f2c46_3163(rw(0x898c)))>>7)+0x18);
  ww(0x980a,h);ww(0x9ad0,h);
  for(let r=0x21,n=0x17;n>0;n--,r--){ww(0x965c+2*r,0x190);ww(0x95da+2*r,0);}   // STD; REP STOSW
  let di=0x14;
  ww(0x8966,0);
  ww(0x3858,rw(0x3852));
  ww(0x8e8e,rw(0x96f2)+3);
  for(;;){
   ww(0x8e8e,rw(0x8e8e)-(di>0xa?3:6));
   if(rsw(0x8e8e)<0)ww(0x8e8e,rw(0x8e8e)+rw(0x8988));
   const pt=u16(u16(rw(0x8e8e)*6)+0x5c9e);
   F.f2c46_0fa5(pt,0x9622,v);
   ww(v,rw(v)+rw(t));ww(v+2,rw(v+2)+rw(t+2));ww(v+4,rw(v+4)+rw(t+4));
   if(rsw(v+2)>1){
    const y=rsw(v+2);
    const sx=s16(0xa0-ldivw(lshl(rsw(v),7),y));
    const sy=s16(0x18-ldivw(lshl(rsw(v+4),7),y));
    const od=f1000_af74(pt,0x9b86);ww(0x9016,od);
    ww(0x5c9c,(od>>>2)+1);
    const w=div16(0xdac,rw(0x5c9c));
    if(f1000_b8f6(sx,sy,w))break;
   }
   di--;if(di===0)break;
  }
  if(rsw(0x9ad0)>rsw(0x9706))ww(0x980a,0xb);
  else{ww(0x980a,rw(0x9706));ww(0x9706,rw(0x9ad0));}
  if(rsw(0x9706)<0xb)ww(0x9706,0xb);
 }finally{sfree(0x24);}
}

// 1000:b8f6 roadRasterMirror(sx, sy, halfWidth): b522 for the mirror tables (rows 0x0c..0x21).
export function f1000_b8f6(sx,sy,w){return roadRaster(sx,sy,w,MIRROR);}

// 1000:ba72 mirrorBackground: skyline bitmap pair from the per-city table DS:9aea (detail < 5),
// sky fill, ground fill (DS:1cdc[city]&15) and road spans (DS:1cf0[city]&15; striped 6/0 when DS:896c).
export function f1000_ba72(){
 ww(0x3858,rw(0x3852));
 let h;
 if(rsw(0x1fa4)<5){
  const si=s16(rw(0x9ad0)-5);
  if(si>0xb){
   let x=s16(s16((rsw(0x8990)>>8)+0x80)<<1);
   const c4=u16(rw(0x9808)<<2);
   if(x<0x100){
    x=s16(0x78-x);
    blitTab(0x9aea,c4,x,si);
    blitTab(0x9aea,c4+2,x+0x100,si);
   }else{
    x=s16(0x78-s16(x-0x100));
    blitTab(0x9aea,c4+2,x,si);
    blitTab(0x9aea,c4,x+0x100,si);
   }
  }
  h=s16(rw(0x9ad0)-0x10);
 }else h=s16(rw(0x9ad0)-0xb);
 if(h>0){
  const c=rb(0x9aec);wb(0x384e,c);wb(0x384d,c);
  F.f1ff8_3810(0x78,0xb,0x50,h);
 }
 const top=rsw(0x9706),gh=s16(0x22-top);
 if(gh>0){
  const c=rb(0x1cdc+u16(rw(0x9808)<<1))&0xf;wb(0x384d,c);wb(0x384e,c);
  F.f1ff8_3810(0x78,top,0x50,gh);
 }
 wb(0x384e,rb(0x1cf0+u16(rw(0x9808)<<1))&0xf);
 let si=rsw(0x9706);
 if(si>0x22)return;
 for(;si<=0x22;si++){
  const L=rsw(0x965c+2*si),R=rsw(0x95da+2*si);
  if(L<R){
   if(rw(0x896c)!==0)wb(0x384e,si&1?6:0);
   F.f1ff8_2454(L,si,R,si);
  }
 }
}

// 1000:bc30 drawObjectsMirror: entities with -99 <= rel <= 1 into the mirror (shapes from DS:9abc for cars),
// explosion sprites, then DS:2a68 = 0 and pitch DS:898c negated back.
// QUIRK: dying cars are always drawn with shape 0x1c here (front view uses 0x1c - state).
export function f1000_bc30(){
 for(let d=1;d<0x28;d++){
  const si=rsb(0x8eda+d),s2=u16(si<<1);
  const rel=rsw(0x89cc+s2);
  if(rel>1||rel<=-0x64)continue;
  ww(0x3849,rw(0x5c1c+s2));
  const p6=u16(si*6);
  if(si<0xa){
   const st=rsb(0x8a54+si);
   if(st>0||st<-5){
    let shape;
    if(rel<=-0xa)shape=rw(0x9abc+s2)+1;
    else{shape=rw(0x9abc+s2);if(rw(0x9aa6+s2)!==0)shape+=2;}
    f1000_aae4(s16(shape),0xa93e+p6,0x898c+p6);
   }else if(st===0){
    if(rsw(0x1fa4)<4)f1000_aae4(0x21,0xa93e+p6,0x898c+p6);
   }else f1000_aae4(0x1c,0xa93e+p6,0x898c+p6);
   if(st<0&&st>-5){
    const fr=rb(0x1f98+u16(-(st+1)));
    if(rw(0x9a80)!==0){const d2=fr<<1;blitTab(0x9a80,d2,rw(0x990a+d2)+rw(0x8dc2),rw(0x999e+d2)+rw(0x8e88));}
   }
  }else if(si<0x14){
   if(rb(0x8a54+si)===0)continue;
   const shape=rw(0xaa1e+s2),j=si-0xa,j6=u16(j*6);
   f1000_aae4(shape,0x9a42+j6,0x8e20+j6);
   if(rb(0x8a54+si)!==1)continue;
   wb(0x8e25+j6,rb(0x8e25+j6)+3);
   const timer=rsw(0x8dc4+2*j);
   if(timer>=4)continue;
   const fr=rb(0x1f98+u16(timer));
   if(rw(0x9a80)===0)continue;
   const d2=fr<<1;blitTab(0x9a80,d2,rw(0x990a+d2)+rw(0x8dc2),rw(0x999e+d2)+rw(0x8e88));
  }else{
   if(rw(0x1fa4)!==0||rb(0x8a54+si)===0)continue;
   let shape=rsw(0xaa1e+s2);if(shape<=0xb)shape=3;     // no distance condition in the mirror
   const k6=u16((si-0x14)*6);
   f1000_aae4(shape,0x8f9e+k6,0xa9a4+k6);
  }
 }
 ww(0x2a68,0);
 ww(0x898c,-rw(0x898c));
}

// 1000:be7e atan2C(a, b): C variant of 2c46:3220 with signed compares and the e80c divide;
// returns (ang12 - 0x400) << 4 (race.md, Camera and projection).
export function f1000_be7e(a,b){
 a=s16(a);b=s16(b);
 const na=a<0;if(na)a=s16(-a);
 const nb=b<0;if(nb)b=s16(-b);
 let v;
 if(a===0)v=0x400;
 else if(b===0)v=0;
 else if(a===b)v=0x200;
 else if(a<b)v=s16(0x400-F.f2c46_32c6(ldivw(lshl(a,9),b)));
 else v=u16(F.f2c46_32c6(ldivw(lshl(b,9),a)));
 if(na)v=0x800-v;
 if(nb)v=0x1000-v;
 v=v-0x400;
 return u16(v<<4);
}

// 1000:bf6c mdaText(str, x, y): writes str with attribute 0x18 to MDA text memory B000:(x+80y)*2.
// Only caller is the unreferenced debug routine 1000:bfd8.
export function f1000_bf6c(str,x,y){
 let off=0,seg=0xb000;
 x=u16(x+imul16(0x50,y));
 const ax=u16(x<<1),dx=ax&0x8000?0xffff:0;
 const sum=off+ax,bx=dx+(sum>0xffff?1:0)&0xffff;off=sum&0xffff;
 seg=u16(seg+(bx<<12));
 const inc=()=>{off++;if(off>0xffff){off=0;seg=seg+0x1000&0xffff;}};
 let si=u16(str);
 while(rb(si)!==0){fwb(seg,off,rb(si));si=si+1&0xffff;inc();fwb(seg,off,0x18);inc();}
}

export {f1000_a570 as drawObjectsFront,f1000_aae4 as drawObject,f1000_b234 as roadFront,f1000_aeaa as waitVRetraceStart};

provide({f1000_a14c,f1000_a166,f1000_a1ac,f1000_a210,f1000_a294,f1000_a2ac,f1000_a2de,f1000_a410,f1000_a470,
 f1000_a536,f1000_a53c,f1000_a570,f1000_aa2a,f1000_aae4,f1000_ac4c,f1000_ac8e,f1000_ad0a,f1000_ad82,f1000_ad8e,
 f1000_ae8e,f1000_aeaa,f1000_aeba,f1000_af74,f1000_afa9,f1000_afc4,f1000_b17e,f1000_b234,f1000_b522,f1000_b6a2,
 f1000_b6dc,f1000_b8f6,f1000_ba72,f1000_bc30,f1000_be7e,f1000_bf6c});
