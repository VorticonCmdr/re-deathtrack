// Race simulation: 1000:6dbc–9fff (player input, physics, AI cars, projectiles, damage, small HUD pieces).
// Translated from the disassembly (docs/re/race.md is the analysis). All DS offsets are DGROUP 36fa.
// Cross-module calls go through F (link.js); within this module functions call each other directly.
// Every parameter is one pushed 16-bit word in C order (no far pointers or longs cross this module's boundary;
// the MSC long helpers e80c/e8a8 are int.js ldiv/lmul).
import {rb,rsb,rw,rsw,rd,wb,ww,wd,salloc,sfree} from '../engine/mem.js';
import {s16,u16,s8,idiv16,imod16,ldiv,lmul,lshl,lsar} from '../engine/int.js';
import {unsupported} from '../engine/host.js';
import {F,provide} from './link.js';

// ---- helpers (macro-level code shared by several original functions; not original functions) ----
// 32-bit frame counter DS:924e (low) / DS:9250 (high). The original compares `9250 != 0 || 924e > n`.
const frame=()=>rd(0x924e);
const state=e=>rsb(0x8a54+e);
// CWD / XOR AX,DX / SUB AX,DX: absolute value in 16 bits; 0x8000 stays -32768.
const abs16=x=>{x=s16(x);return s16(x<0?-x:x);};
// Track point table DS:5c9e+6p {x,y,z}. The index is scaled in 16 bits (SHL/ADD/SHL), so it wraps.
const ptX=p=>rsw(0x5c9e+u16(p*6)), ptY=p=>rsw(0x5ca0+u16(p*6)), ptZ=p=>rsw(0x5ca2+u16(p*6));
// Car height table DS:a942+6i.
const carZ=i=>rsw(0xa942+u16(i*6));
// Lateral offset of a pose from the segment (x0,y0)-(x1,y1), as compiled inline in 731a, 81ec and 9542:
// per-axis ((d SAR 1) * |lat|) low word SAR 3. Returns the offset segment end points.
function latOffsets(x0,y0,x1,y1,lat){
 const a=abs16(lat);let oy,ox;
 if(s16(lat)<0){oy=s16(s16(s16(x1-x0)>>1)*a)>>3;ox=s16(s16(s16(y0-y1)>>1)*a)>>3;}
 else{oy=s16(s16(s16(x0-x1)>>1)*a)>>3;ox=s16(s16(s16(y1-y0)>>1)*a)>>3;}
 return {xo0:s16(ox+x0),yo0:s16(oy+y0),xo1:s16(ox+x1),yo1:s16(oy+y1)};
}
const copyBytes=(d,s,n)=>{for(let i=0;i<n;i++)wb(d+i,rb(s+i));};
const cstrlen=s=>{let n=0;while(rb(s+n))n++;return n;};
const cstrcat=(d,s)=>{const o=d+cstrlen(d);for(let i=0;;i++){const c=rb(s+i);wb(o+i,c);if(!c)break;}};

// Emulated stack words that the original reads uninitialised (docs/re/race.md, Translation notes 4).
// bpm4: the word at [BP-4] of a near function called by 1000:047c with no arguments. 6dbc and 9542 are both
// called that way, so they share it: 6dbc writes the old lateral when steering, 9542 writes |lat| of a Terminator
// whose pose it rebuilds and the entity number of an AI-missile blast it spawns, and 9542 reads it for type-5
// missiles (QUIRK). APPROX: other functions that overwrite this stack word between those calls in the original
// (for example 06dc's far call on a flash frame, which leaves its return IP 0x06fb there) are not modelled, and
// the initial value is unknown (0 here).
// dmgBpm2: 9e90's [BP-2], read uninitialised for type-4 damage when DS:1fe2 is not 0..2. APPROX: modelled as
// the value 9e90 itself last stored there (bounty path); the real word depends on the caller's stack depth.
export const staleStack={bpm4:0,dmgBpm2:0};

// 1000:6dbc playerInput: fire buttons, key commands (ASCII jump table CS:716a, weapon fire table CS:705a),
// demo auto-fire (tail 71ec), throttle/brake/steering (tail 7216) and the per-frame random number DS:9636.
export function* f1000_6dbc(){
 let fireFlag=0; // byte [BP-2]
 F.f1000_0278();
 if(rw(0x1fe6))ww(0x1fe6,rw(0x1fe6)-1);
 if(rw(0x1fe6)===0){
  ww(0x1fe6,yield* F.f1ff8_4068(1));
  if(rw(0x1fe6)===0&&rb(0x4b9a)&&rw(0x1fc0))unsupported('1000:6e01 joystick button 1');
  if(rw(0x1fe6))ww(0x1fe6,4);
 }
 if(rw(0x1f82)===0){
  fireFlag=1;
  ww(0x1f82,yield* F.f1ff8_4068(0));
  if(rw(0x1f82)===0&&rb(0x4b9a)&&rw(0x1fc0))unsupported('1000:6e46 joystick button 0');
 }
 if(rw(0x1fa6)){
  // 1000:71ec (tail): demo race auto-launches a missile with probability 1/128 per frame.
  if((F.f1000_a3ca()&0x7f)===0&&rw(0x9b8c)&&rw(0x9a86))f1000_731a(rw(0x96f2),rw(0xa97a),5,0);
  return yield* steer();
 }
 let si=u16(yield* F.f1ff8_4457());
 if(si===0&&(yield* F.f1ff8_44a0(0x39)))si=0x3920;
 if(rw(0x1fe6))si=0;
 if(si===0x11b){yield* F.f1000_6d76(0x26,0x820);yield* F.f1000_68dc();return yield* steer();}
 if(si===0x1c0d){if(rsb(0x9bc8)===5)ww(0x8a94,rw(0x8a94)+1);return yield* steer();}
 let ch; // byte [BP-8]
 if(si===0x3920)ch=0x20;
 else ch=F.f1000_df1c(s8(si))&0xff; // CBW of AL, toupper
 if(ch===0x20)ch=rw(0x1f82)?0:0x20;
 if(fireFlag&&rw(0x1f82)){ch=0x20;ww(0x1f82,0);}
 if(rw(0x1fe6)===3)ch=0x57;
 const idx=u16(s8(ch)-0x20);
 if(idx<=0x3f)switch(ch){
  case 0x20: // 6f1e fire
   if(frame()<=0x74)break;
   if(rb(0x8a54)===0)break;
   switch(rsb(0x9bc8)){ // table CS:705a
    case 1: if(rw(0x8e5c)&&!rw(0x1f82))ww(0x1f82,1);break;            // 6f56 gun
    case 2: if(rw(0x9b0e)&&!rw(0x1f82))ww(0x1f82,rw(0x1f82)+2);break;  // 6f74 laser
    case 3: if(rw(0xa8c4)===10&&!rw(0x1f82))ww(0x1f82,rw(0x1f82)+3);break; // 6f90 beam
    case 4: // 6fac Terminator
     if(rw(0x9238)&&f1000_731a(rw(0x96f2),rw(0xa97a),4,0)){F.f2524_041a(10);ww(0x1f82,rw(0x1f82)+4);}
     break;
    case 5: // 6fe6 homing missile (needs a lock)
     if(rw(0x9a86)&&rw(0x9b8c)&&f1000_731a(rw(0x96f2),rw(0xa97a),5,0)){F.f2524_041a(2);ww(0x1f82,rw(0x1f82)+4);}
     break;
    case 6: // 701c mine
     if(rw(0x5c04)&&f1000_731a(rw(0x96f2),rw(0xa97a),6,0)){F.f2524_041a(9);ww(0x1f82,rw(0x1f82)+4);}
     break;
    case 7: // 7048 caltrop
     if(rw(0x96dc)&&f1000_731a(rw(0x96f2),rw(0xa97a),7,0)){F.f2524_041a(9);ww(0x1f82,rw(0x1f82)+4);}
     break;
   }
   break;
  case 0x50: yield* f1000_75ea(1);break; // 706c 'P' pause (pushes 1; 75ea ignores it)
  case 0x2b: case 0x3d:{ // 707a '+'/'=' more detail
   let v=s16(rw(0x1fa4)-1);ww(0x1fa4,v);if(v<0)v=0;ww(0x1fa4,v);break;}
  case 0x2d: case 0x5f:{ // 708a '-'/'_' less detail
   let v=s16(rw(0x1fa4)+1);ww(0x1fa4,v);if(v>5)v=5;ww(0x1fa4,v);break;}
  case 0x4d: // 70a0 'M' drop a mine (no trigger cool-down)
   if(rw(0x5c04)&&f1000_731a(rw(0x96f2),rw(0xa97a),6,0))F.f2524_041a(9);
   break;
  case 0x43: // 70d2 'C' drop a caltrop
   if(rw(0x96dc)&&f1000_731a(rw(0x96f2),rw(0xa97a),7,0))F.f2524_041a(8);
   break;
  case 0x48: wb(0xa462,rb(0xa462)^1);break; // 70fe 'H' HUD toggle
  case 0x57: wb(0x9bc8,rb(0x9bc8)+1);if(rsb(0x9bc8)>7)wb(0x9bc8,1);f1000_914a();break; // 7106 'W' cycle
  case 0x31: case 0x21: wb(0x9bc8,1);f1000_914a();break; // 7111
  case 0x32: case 0x40: wb(0x9bc8,2);f1000_914a();break; // 7118
  case 0x33: case 0x23: wb(0x9bc8,3);f1000_914a();break; // 7120
  case 0x34: case 0x24: wb(0x9bc8,4);f1000_914a();break; // 7128
  case 0x35: case 0x25: wb(0x9bc8,5);f1000_914a();break; // 7130
  case 0x36: case 0x5e: wb(0x9bc8,6);f1000_914a();break; // 7138
  case 0x37: case 0x26: wb(0x9bc8,7);f1000_914a();break; // 7140
  case 0x41: wb(0x9a82,rb(0x9a82)^1);F.f2524_4482();break; // 714c 'A' autopilot
  case 0x54: F.f2524_039c();break; // 715a 'T'
  case 0x53: F.f2524_03dc();break; // 7162 'S'
  default: break; // 7216
 }
 return yield* steer();

 // 1000:7216 (tail of 6dbc, same frame): throttle, brake and steering, then the frame random number.
 function* steer(){
  let bits=0;
  if(rb(0x4b9a)&&rw(0x1fc0))unsupported('1000:7227 joystick direction');
  if(bits===0)bits=u16(yield* F.f1ff8_4486(0));
  ww(0x9ad2,0);
  if(bits&&rw(0x9a82)===0&&rb(0x98e0)===0&&rb(0x8a54)!==0){
   if(bits&2){
    const v=s16(rw(0x8926)-rw(0x1c34));ww(0x8926,v<0?0:v);ww(0x9ad2,1);
   }else if(bits&1){
    if(rw(0x895a)===0){
     ww(0x8926,rw(0x8926)+rw(0x1c20));
     if(rsw(0x8926)>rsw(0x9b6c))ww(0x8926,rw(0x9b6c));
    }
   }
   let steered=false;
   if(bits&8){
    staleStack.bpm4=rw(0xa97a);
    ww(0xa97a,rw(0xa97a)+(rsw(0x8926)>>4));
    if(rsw(0xa97a)>0xa0)ww(0xa97a,0xa0);
    steered=true;
   }else if(bits&4){
    staleStack.bpm4=rw(0xa97a);
    ww(0xa97a,rw(0xa97a)-(rsw(0x8926)>>4));
    if(rsw(0xa97a)<-0xa0)ww(0xa97a,-0xa0);
    steered=true;
   }
   if(steered&&rw(0x9ad6)!==rw(0xa97a)&&F.f1000_a1ac())ww(0xa97a,staleStack.bpm4);
  }
  ww(0x9636,F.f1000_a3ca()); // 730f: the one rand() per frame (docs/re/race.md RNG 1)
 }
}

// 1000:731a spawnProjectile(pos, lat, type, owner): first free slot j (entity 10+j). Returns the entity or 0.
export function f1000_731a(pos,lat,type,owner){
 pos=s16(pos);lat=s16(lat);type=s16(type);owner=s16(owner);
 if(frame()<=0x74)return 0;
 for(let j=0;j<10;j++){
  const e=j+10;
  if(rb(0x8a54+e)!==0)continue;
  wb(0x8a54+e,type);
  ww(0xa97a+2*e,lat);
  const J=2*j,E=2*e;
  const dec=a=>ww(a,rw(a)-1);
  const prevPos=()=>{pos=pos!==0?s16(pos-1):s16(rw(0x8988)-1);};
  switch(type){
   case 4: // 747e Terminator
    dec(0x9238+2*owner);
    ww(0x95c2+J,owner);
    if(owner)F.f2524_041a(5);
    ww(0x8dc4+J,abs16(lat)<0x3c?0x3e8:0xa);
    ww(0xaa1e+E,1);
    // QUIRK: speed and sub come from the player even when an AI fires (docs/re/race.md Projectiles).
    ww(0x8926+E,rw(0x8926)+0x1e);
    ww(0x9b90+E,rw(0x9b90));
    pos=s16(pos+1);
    break;
   case 5: // 743c homing missile
    dec(0x9a86+2*owner);
    ww(0x5c6c,10);
    ww(0x8dc4+J,0x3e8);
    ww(0x95c2+J,owner);
    ww(0xaa82+J,rw(0x9b8c));
    ww(0xaa1e+E,2);
    ww(0x8926+E,0x100);
    ww(0xa97a+E,0xffff);
    break;
   case 6: // 7340 mine
    if(owner)F.f2524_041a(6);
    dec(0x5c04+2*owner);
    ww(0x8dc4+J,0xc8);
    prevPos();ww(0x95c2+J,owner);ww(0xaa1e+E,0);
    break;
   case 7: // 7400 caltrop
    prevPos();
    dec(0x96dc+2*owner);
    ww(0x8dc4+J,0x1f4);
    ww(0x95c2+J,owner);
    ww(0xaa1e+E,0xc);
    break;
   case 10: // 7366 AI-missile blast (timer set by the caller)
    prevPos();ww(0x95c2+J,owner);ww(0xaa1e+E,0);
    break;
  }
  // 7390: pose from track points pos and pos+1, sub = 0; the lateral is the argument (not lat[e]).
  ww(0x8970+J,pos);
  const z0=ptZ(pos),x0=ptX(pos),y0=ptY(pos),z1=ptZ(pos+1),x1=ptX(pos+1),y1=ptY(pos+1);
  const o=latOffsets(x0,y0,x1,y1,lat);
  const s=6*j;
  ww(0x8e20+s,F.f2c46_3220(0x1e,s16(z1-z0)));
  ww(0x8e24+s,F.f2c46_3220(s16(o.xo1-o.xo0),s16(o.yo1-o.yo0))-0x4000);
  ww(0x9a46+s,z0);ww(0x9a42+s,o.xo0);ww(0x9a44+s,o.yo0);
  return e;
 }
 return 0;
}

// 1000:75ea pause: "SIMULATION PAUSED" page (message 0x0e) with music paused.
export function* f1000_75ea(){
 F.f1000_0278();F.f1000_0304();F.f2524_4cc8();
 yield* F.f1000_6d76(0xe,0x820);
 yield* F.f1000_68dc();
 F.f2524_4cce();
}

// 1000:7610 hitSave: saves the pixel(s) under the aim point DS:8e8c/8e92 (four pixels when DS:896c != 0).
export function f1000_7610(){
 const x=rsw(0x8e8c),y=rsw(0x8e92);
 if(rw(0x896c)){
  wb(0x99d2,F.f1ff8_3cf9(x,y));wb(0x99d3,F.f1ff8_3cf9(s16(x+1),y));
  wb(0x99d4,F.f1ff8_3cf9(s16(x-1),y));wb(0x99d5,F.f1ff8_3cf9(x,s16(y+1)));
 }else wb(0x99d2,F.f1ff8_3cf9(x,y));
}
// 1000:767c hitMark: plants marker colours 0/1/2/3 (or 5) at the aim point.
export function f1000_767c(){
 const x=rsw(0x8e8c),y=rsw(0x8e92);
 if(rw(0x896c)){
  F.f1ff8_3d2b(x,y,0);F.f1ff8_3d2b(s16(x+1),y,1);F.f1ff8_3d2b(s16(x-1),y,2);F.f1ff8_3d2b(x,s16(y+1),3);
 }else F.f1ff8_3d2b(x,y,5);
}
// 1000:76e2 hitCheck: 0 while the markers are intact, 1 once something covered them.
export function f1000_76e2(){
 const x=rsw(0x8e8c),y=rsw(0x8e92);
 if(rw(0x896c)){
  if(F.f1ff8_3cf9(x,y)!==0)return 1;
  if(F.f1ff8_3cf9(s16(x+1),y)!==1)return 1;
  if(F.f1ff8_3cf9(s16(x-1),y)!==2)return 1;
  return F.f1ff8_3cf9(x,s16(y+1))===3?0:1;
 }
 return F.f1ff8_3cf9(x,y)===5?0:1;
}
// 1000:775e hitRestore: puts the saved pixel(s) back (CBW of the saved bytes).
export function f1000_775e(){
 const x=rsw(0x8e8c),y=rsw(0x8e92);
 if(rw(0x896c)){
  F.f1ff8_3d2b(x,y,rsb(0x99d2));F.f1ff8_3d2b(s16(x+1),y,rsb(0x99d3));
  F.f1ff8_3d2b(s16(x-1),y,rsb(0x99d4));F.f1ff8_3d2b(x,s16(y+1),rsb(0x99d5));
 }else F.f1ff8_3d2b(x,y,rsb(0x99d2));
}

// 1000:77c8 radarDots: erases and redraws every car's dot on the dashboard map (cars 9..0), then copies the rect.
export function f1000_77c8(){
 let si=0,di=0;
 for(let i=9;i>=0;i--){
  si=rsw(0x8a1e+2*i);di=rsw(0x8a34+2*i);
  wb(0x384d,15);wb(0x384e,15);
  if(si){
   if(rw(0x896c))F.f1ff8_3810(s16(si-1),s16(di-1),3,3);
   else F.f1ff8_3d2b(si,di,15);
  }
  if(rb(0x8a54+i)===0)continue;
  if(rsw(0x8ec4+2*i)>=rsw(0x8eb8))continue;
  const p=rsw(0x96f2+2*i);
  // e80c long divides: ((x + |minX|) << 6) / [8e96] and ((y + |minY|) << 5) / [8a32], 32-bit.
  const qx=s16(ldiv(lshl(ptX(p)+abs16(rw(0x980c)),6),rsw(0x8e96)));
  const qy=s16(ldiv(lshl(ptY(p)+abs16(rw(0x98da)),5),rsw(0x8a32)));
  si=s16(qx+0x7f);ww(0x8a1e+2*i,si);
  di=s16(0xbe-qy);ww(0x8a34+2*i,di);
  if(i!==0)F.f1ff8_3d2b(si,di,0);
  else if(rw(0x896c)){wb(0x384d,12);wb(0x384e,12);F.f1ff8_3810(s16(si-1),s16(di-1),3,3);}
  else F.f1ff8_3d2b(si,di,12);
 }
 F.f1000_026a();
 F.f1ff8_2545(0x7d,0x9d,0x45,0x24);
 F.f1000_0278();
 wb(0x384b,1);
}

// 1000:7982 updateCars: per-car update for cars 9..0, poses, ranking every 16 frames, corner drift.
export function* f1000_7982(){
 for(let i=9;i>=0;i--){
  if(rb(0x8a54+i)===0||rb(0x8e9c+i)!==0){
   if(rb(0x8a54+i)===0)f1000_7ca4(i);
   continue;
  }
  ww(0xa026,rw(0x96f2+2*i));
  if(i!==0){
   if(frame()>0x74){yield* f1000_7a9c(i);f1000_7ca4(i);}
   else{
    F.f2524_42f0();
    if(frame()>0x14||frame()<1){yield* f1000_7a9c(i);f1000_7ca4(i);}
    else f1000_85b4(i); // frames 1..20: height jitter only, no rel update
   }
  }else{
   yield* f1000_7a9c(0);
   f1000_7ecc();
  }
  f1000_7cf0(i);
  if(i!==0&&(rb(0x924e)&7)===0)f1000_7daa(i);
  if(state(i)<0)f1000_7fbe(i);
  f1000_8008(i);
 }
 f1000_7a6a();
 if((rb(0x924e)&0xf)===0){f1000_85f0();f1000_8a48();}
 if(rw(0x9a82)===0)f1000_84be();
}

// 1000:7a6a placeCars: player heading/slope, then the pose of every live car (car 0 only on autopilot).
export function f1000_7a6a(){
 f1000_8148();
 for(let i=s16(1-rw(0x9a82));i<10;i++)if(rb(0x8a54+i)!==0)f1000_81ec(i);
}

// 1000:7a9c advanceCar(i): speed control, fuel (player), contact with the car ahead, position, laps.
export function* f1000_7a9c(i){
 const I=2*i;
 if(i!==0){
  if(rb(0x98e0+i)===0){
   if(rsw(0x8926+I)<rsw(0x9b6c+I))ww(0x8926+I,rw(0x8926+I)+rw(0x1c20+I));
   else if(rsw(0x8926+I)>rsw(0x9b6c+I)){const v=s16(rw(0x8926+I)-2);ww(0x8926+I,v<0?0:v);}
  }
 }else{
  if(rw(0x9a82)&&frame()>0x14&&rb(0x98e0)===0){
   // 7b10: target = unsigned min(vmax, DS:98fa) via SUB/SBB/AND/ADD.
   const a=rw(0x9b6c),b=rw(0x98fa);
   const target=s16(a<b?a:b);
   if(target>rsw(0x8926)){if(rw(0x96a0))ww(0x8926,rw(0x8926)+rw(0x1c20));}
   else if(target<rsw(0x8926)){const v=s16(rw(0x8926)-2);ww(0x8926,v<0?0:v);}
  }
  if((rb(0x924e)&0xf)===0){
   let d=rsw(0x8926)>>3;if(d<5)d=5;
   const f=s16(rw(0x96a0)-d);ww(0x96a0,f<0?0:f);
  }
  if(rw(0x96a0)===0){
   const v=s16(rw(0x8926)-2);ww(0x8926,v<0?0:v);
   if(v<=0){yield* F.f1000_6d76(0x36,0x820);yield* F.f1000_68dc();}
  }
 }
 // 7ba7: running into the car ahead in the same lane.
 if(F.f1000_a166(rw(0x96f2+I),rw(0x8926+I),i)){
  const ah=rsw(0x9af4+I);
  if(abs16(carZ(ah)-carZ(i))<0x1e){
   const v=s16(rw(0x8926+2*ah)-5);ww(0x8926+I,v<0?0:v);
   if(i===0){f1000_9e90(ah,-8);F.f2524_041a(7);}
  }
 }
 // 7c23: t = speed+sub; pos += t/30; sub = t%30 (IDIV with CWD: truncation toward zero).
 const t=s16(rw(0x8926+I)+rw(0x9b90+I));
 ww(0x96f2+I,rw(0x96f2+I)+idiv16(t,30));
 ww(0x9b90+I,imod16(s16(rw(0x8926+I)+rw(0x9b90+I)),30));
 if(rsw(0x96f2+I)>rsw(0x8988)){
  const p=s16(rw(0x96f2+I)-rw(0x8988));ww(0x96f2+I,p<0?0:p);
  ww(0x8ec4+I,rw(0x8ec4+I)+1);
  if(i===0){
   f1000_89d6();
   if(rw(0x8ec4)===rw(0x8eb8))ww(0x924c,1);
  }else if(rw(0x8ec4+I)===rw(0x8eb8)){ww(0x5c84+I,0xfed4);ww(0x9b6c+I,0x32);}
 }
}

// 1000:7ca4 relPos(i): rel[i] = pos[i]-pos[0] wrapped into [-len/2, len/2).
export function f1000_7ca4(i){
 const I=2*i;let r;
 if(rsw(0x96f2+I)>=rsw(0x96f2))r=s16(rw(0x96f2+I)-rw(0x96f2));
 else r=s16(rw(0x96f2+I)-rw(0x96f2)+rw(0x8988));
 ww(0x89cc+I,r);
 if(!((rsw(0x8988)>>1)>rsw(0x89cc+I)))ww(0x89cc+I,rw(0x89cc+I)-rw(0x8988));
}

// 1000:7cf0 groundHit(i): car i against projectiles/obstacles 10..19 passed over this frame.
export function f1000_7cf0(i){
 for(let e=10;e<20;e++){
  const t=rb(0x8a54+e);
  if(t===0||t===5)continue;
  if(!F.f1000_a2ac(rw(0xa98e+2*(e-10)),rw(0xa97a+2*i)))continue;
  const j=e-10;
  if(rsw(0x8970+2*j)<rsw(0xa026))continue;
  if(rsw(0x8970+2*j)>rsw(0x96f2+2*i))continue;
  // QUIRK: the height table DS:a942 is indexed by the car's track position, not by a car index
  // (docs/re/race.md Projectiles, Motion 3); on long tracks this reads memory past DGROUP's BSS.
  if(carZ(rsw(0x96f2+2*i))<=s16(rw(0x9a46+6*j)+0xf)&&state(i)>0)f1000_9e90(i,e);
  return; // the first projectile in lane and in range ends the scan, hit or not
 }
}

// 1000:7daa aiWeapons(i): AI fire decisions (every 8th frame), driven by the frame random DS:9636.
export function f1000_7daa(i){
 const I=2*i,rel=rsw(0x89cc+I),r=rw(0x9636);
 if(rel<0){
  if(rel>=-0x14)return;
  if(rel>-0x2ee&&rw(0x9a86+I)&&u16(rw(0x1be4+I)+rw(0x8954))>r&&frame()>0x74&&rw(0x1fbc)===0){
   // QUIRK: any AI car can arm the missile attack, and its missile count is not decremented.
   ww(0x1fbc,(F.f1000_a3ca()&0x1f)+10);
   ww(0x1fbe,i);
   F.f2524_041a(4);
  }
  if(!(rsw(0x89cc+I)>-200))return;
  if(rw(0x1bf8+I)===0)return;
  if(!F.f1000_a2ac(rw(0xa97a+I),rw(0xa97a)))return;
  if(!(u16(rw(0x1bf8+I)+rw(0x8f0a))>r))return;
  f1000_731a(rw(0x96f2+I),rw(0xa97a+I),4,i);
 }else{
  if(rel>=200||rel<=0x32)return;
  if(rw(0x5c04+I)===0)return;
  if(!(u16(rw(0x1c0c+I)+rw(0x8954))>r))return;
  if(F.f1000_a2ac(rw(0xa97a+I),rw(0xa97a)))f1000_731a(rw(0x96f2+I),rw(0xa97a+I),6,i);
  else if(u16(rw(0x1c0c+I)<<1)>r)f1000_731a(rw(0x96f2+I),rw(0xa97a+I),7,i);
 }
}

// 1000:7ecc offRoad: off-road drag down to DS:961e; barrier crossing above speed 50 (damage type 11).
export function f1000_7ecc(){
 const x=s16(abs16(rw(0xa97a))-0x3e);
 if(x<=0||rsw(0x8926)<=rsw(0x961e))return;
 ww(0x8926,rw(0x8926)-((x>>3)+1));
 if(rsw(0x8926)<rsw(0x961e))ww(0x8926,rw(0x961e));
 if(rsw(0x8926)<=0x32)return;
 const p=rsw(0x1d18+2*rw(0x9808));
 if(rsw(0xa026)<p&&rsw(0x96f2)>=p){f1000_9e90(0,-11);ww(0x96f2,rw(0xa026));}
}

// 1000:7f3c numText(n): DS:98fe = prefix (DS:202e for one digit, DS:2031 otherwise) + itoa(n).
export function f1000_7f3c(n){
 const buf=salloc(0xc);
 try{
  F.f1000_def6(n,buf,10);
  if(cstrlen(buf)===1)copyBytes(0x98fe,0x202e,3);else copyBytes(0x98fe,0x2031,2);
  cstrcat(0x98fe,buf);
 }finally{sfree(0xc);}
}

// 1000:7fbe dyingTick(i): death countdown; at 0 the car is gone (cars-remaining count, speed and sub zeroed).
export function f1000_7fbe(i){
 // Dead code kept: (state <u 1 ? 1 : 0) never equals -5, so sound 0 is never played (docs/re/race.md).
 if((rb(0x8a54+i)<1?1:0)===0xfffb)F.f2524_041a(0);
 wb(0x8a54+i,rb(0x8a54+i)+1);
 if(rb(0x8a54+i)===0){
  ww(0xa8be,rw(0xa8be)-1);
  ww(0x9b90+2*i,0);ww(0x8926+2*i,0);
  if(i!==0)f1000_81ec(i);
 }
}

// 1000:8008 aiSteer(i): slowing behind the car ahead, lane changes after frame 100, lateral easing.
export function f1000_8008(i){
 if(i===0&&rw(0x9a82)===0)return;
 const I=2*i,ah=rsw(0x9af4+I);
 if(ah!==-1){
  let sp=rsw(0x8926+I);const sa=rsw(0x8926+2*ah);
  if(sp>=sa){
   const gap=s16(F.f1000_a294(i,ah));
   if(gap<3){
    const v=s16(sa-3);ww(0x8926+I,v<0?0:v);
    f1000_9e90(ah,-8);
   }else if(gap<0x28){
    let v;
    if(gap<0x14){
     // QUIRK: a second -2 after a non-negative result, so speeds 2/3 become -2/-1 (docs/re/race.md AI steering).
     sp=s16(sp-2);v=sp<0?0:s16(sp-2);
    }else v=sp<0?0:s16(sp-1);
    ww(0x8926+I,v);
    if(frame()>0x64){
     const lat=rsw(0xa97a+I);
     if(rsw(0x5c84+I)===lat){
      if(lat>0x10||lat<-0x10)ww(0x5c84+I,0);
      else ww(0x5c84+I,(rb(0x9636)&1)?0xffe0:0x20);
     }
    }
   }
  }
 }
 const lat=rsw(0xa97a+I),tg=rsw(0x5c84+I);
 if(tg===lat)return;
 if(tg>lat){ww(0xa97a+I,lat+2);return;}
 ww(0xa97a+I,lat-2);
 if(rsw(0xa97a+I)<-0x122)wb(0x8e9c+i,1);
}

// 1000:8148 playerHeading: player slope DS:a674 (interpolated by sub/30) and heading DS:8990.
export function f1000_8148(){
 const p=rsw(0x96f2);
 const x0=ptX(p),y0=ptY(p),z0=ptZ(p),x1=ptX(p+1),y1=ptY(p+1),z1=ptZ(p+1),z2=ptZ(p+2);
 ww(0xa674,F.f2c46_3220(0x1e,s16(z1-z0)));
 const s2=F.f2c46_3220(0x1e,s16(z2-z1));
 // IMUL then CWD: only the low word of the product is divided.
 ww(0xa674,rw(0xa674)+idiv16(s16(s16(s2-rw(0xa674))*rsw(0x9b90)),30));
 ww(0x8990,F.f2c46_3220(s16(x1-x0),s16(y1-y0))-0x4000);
}

// 1000:81ec carPose(i): world pose from the track and lateral; ground height, airborne state, landing.
export function f1000_81ec(i){
 const I=2*i,p=rsw(0x96f2+I);
 const x0=ptX(p),y0=ptY(p),z0=ptZ(p),x1=ptX(p+1),y1=ptY(p+1),z1=ptZ(p+1);
 const o=latOffsets(x0,y0,x1,y1,rw(0xa97a+I));
 const P=u16(6*i);
 let g;
 if(i!==0){
  if(state(i)<0){
   // dying: yaw spins by the table DS:1fe8[|state|]
   const a=F.f2c46_3220(s16(o.xo1-o.xo0),s16(o.yo1-o.yo0));
   ww(0x8990+P,a+rw(0x1fe8+2*abs16(state(i)))-0x4000);
  }else ww(0x8990+P,F.f2c46_3220(s16(o.xo1-o.xo0),s16(o.yo1-o.yo0))-0x4000);
  g=s16((s16(s16(z1-z0)*rsw(0x9b90+I))>>5)+z0);
 }else{
  g=s16((s16(s16(z1-z0)*rsw(0x9b90))>>5)+z0+0x12);
  ww(0x9b86,(s16(s16(x1-x0)*rsw(0x9b90))>>5)+x0);
  ww(0x9b88,(s16(s16(y1-y0)*rsw(0x9b90))>>5)+y0);
 }
 if(!(rsw(0xa942+P)>g)){
  // on the ground
  if(i!==0)ww(0x898c+P,F.f2c46_3220(0x1e,s16(z1-z0)));
  else{
   const al=F.f1000_b6a2(rsb(0xa675),rsb(0x898d),1)&0xff;
   ww(0x898c,rw(0x898c)+(al<<8));
  }
  ww(0xa942+P,g);ww(0x96c8+I,0);wb(0x98e0+i,0);
 }else{
  ww(0x96c8+I,rw(0x96c8+I)-1);
  const nz=state(i)>=0?s16(rw(0xa942+P)+rw(0x96c8+I)):z0;
  if(nz<g){
   // landing: bounce velocity (-vz) SAR 2
   ww(0x96c8+I,s16(-rsw(0x96c8+I))>>2);
   ww(0x898c+P,F.f2c46_3220(0x1e,s16(z1-z0)));
   ww(0xa942+P,g);wb(0x98e0+i,0);
  }else{
   ww(0x898c+P,rw(0x898c+P)-0x80);
   ww(0xa942+P,nz);wb(0x98e0+i,1);
  }
 }
 const sub=rsw(0x9b90+I);
 ww(0xa93e+P,(s16(s16(o.xo1-o.xo0)*sub)>>5)+o.xo0);
 ww(0xa940+P,(s16(s16(o.yo1-o.yo0)*sub)>>5)+o.yo0);
}

// 1000:84be cornerDrift: centrifugal lateral push when the segment heading changes; then the player's pose.
export function f1000_84be(){
 const p=rsw(0x96f2);
 const x0=ptX(p),y0=ptY(p),x1=ptX(p+1),y1=ptY(p+1);
 const h=s16(F.f1000_be7e(s16(x1-x0),s16(y1-y0)));
 if(h!==rsw(0x9bca)){
  const sn=s16(F.f2c46_311a(s16(rw(0x9bca)-h)));
  // e8a8 long multiply, then 15 x (SAR DX / RCR AX): arithmetic 32-bit shift, low word kept.
  let d=s16(lsar(lmul(sn,rsw(0x8926)),15));
  if(d!==0){
   if(rw(0xd28))d=s16(d+(d>>1));
   const thr=rsw(0x8dac)>0x1f4?u16(rw(0x1fd0)<<1):0;
   if(u16(abs16(d))>thr){ // unsigned JBE at 1000:8578
    ww(0xa97a,rw(0xa97a)-d);
    if(rsw(0xa97a)>0x9c)ww(0xa97a,0x9c);
    else if(rsw(0xa97a)<-0xa0)ww(0xa97a,-0xa0);
   }
  }
  ww(0x9bca,h);
 }
 f1000_81ec(0);
}

// 1000:85b4 startJitter(i): height = ground of the current point + (rand()&3)-1 (frames 1..20).
export function f1000_85b4(i){
 const j=s16((F.f1000_a3ca()&3)-1);
 ww(0xa942+u16(6*i),ptZ(rsw(0x96f2+2*i))+j);
}

// 1000:85f0 raceProgress: dword DS:a678+4i = (s16)(lap*len + pos) sign-extended, for live cars.
export function f1000_85f0(){
 const len=rw(0x8988);
 for(let i=9;i>=0;i--){
  if(rb(0x8a54+i)===0)continue; // QUIRK: dead cars keep their stale value
  // QUIRK: 16-bit IMUL low word, overflows beyond 32767 (docs/re/race.md Translation notes 6).
  const v=s16(s16(rsw(0x8ec4+2*i)*s16(len))+rw(0x96f2+2*i));
  wd(0xa678+4*i,v);
 }
}

// 1000:863c objDistClip(front): octagonal distance keys DS:8f48[e] and crest clip rows DS:5c1c[e].
export function f1000_863c(front){
 const key=(px,py)=>{
  let a=abs16(rw(0xa93e)-px),b=abs16(rw(0xa940)-py);
  if(a>b){const t=a;a=b;b=t;}
  return s16((s16(a*3)>>3)+b);
 };
 const crest=e=>{
  const E=2*e;let cnt=0;
  const n=rw(0xaa96);
  if(n!==0){
   const k=rsw(0x8f48+E);
   for(let di=1;di<=n;di++){
    if(rsw(0x921c+2*di)<=k){ww(0x5c1c+E,rw(0xa8aa+2*di));cnt++;}
   }
  }
  if(cnt===0)ww(0x5c1c+E,front?0x63:0x21);
 };
 for(let e=1;e<10;e++){ // car 0 is skipped; no state test for cars
  ww(0x8f48+2*e,key(rw(0xa93e+6*e),rw(0xa940+6*e)));crest(e);
 }
 for(let e=10;e<20;e++){
  if(rb(0x8a54+e)===0)continue;
  const j=6*(e-10);
  ww(0x8f48+2*e,key(rw(0x9a42+j),rw(0x9a44+j)));crest(e);
 }
 for(let e=20;e<40;e++){
  if(rb(0x8a54+e)===0)continue;
  const k=6*(e-20);
  ww(0x8f48+2*e,key(rw(0x8f9e+k),rw(0x8fa0+k)));crest(e);
 }
}

// 1000:89d6 drawLap: lap number at (0x112,0xa4).
export function f1000_89d6(){
 wb(0x384b,0);
 F.f1ff8_3692(rw(0x8e72));
 wb(0x3842,0);wb(0x3840,2);wb(0x3841,0);
 f1000_7f3c(rw(0x8ec4));
 F.f1ff8_23ba(0x98fe,0x112,0xa4);
 F.f1000_026a();
 F.f1ff8_2545(0x113,0xa4,0xc,5);
 F.f1000_0278();
 wb(0x3842,1);
 F.f1ff8_3692(rw(0x8e98));
 wb(0x384b,rb(0x384b)+1);
}

// 1000:8a48 drawPlace: place = 1 + cars 1..9 whose progress is (unsigned 32-bit) greater than the player's.
export function f1000_8a48(){
 let place=1;
 wb(0x384b,0);
 ww(0x3858,rw(0x3852));
 F.f1ff8_3692(rw(0x8e72));
 wb(0x3842,0);wb(0x3840,0xe);wb(0x3841,0);
 const p0=rd(0xa678);
 for(let i=1;i<10;i++)if(rd(0xa678+4*i)>p0)place++;
 f1000_7f3c(place);
 F.f1ff8_23ba(0x98fe,0x112,0xbc);
 F.f1000_026a();
 F.f1ff8_2545(0x113,0xbc,0xc,5);
 F.f1000_0278();
 wb(0x3842,1);
 F.f1ff8_3692(rw(0x8e98));
 wb(0x384b,rb(0x384b)+1);
}

// 1000:8afa clearTarget: drops the lock (DS:9b8c = 0) and redraws the empty target box.
export function f1000_8afa(){
 wb(0x384b,0);
 wb(0x384b,0);ww(0x9b8c,0);wb(0x3841,0);wb(0x3840,4);wb(0x3842,0);
 F.f1ff8_3692(rw(0x8e72));
 F.f1ff8_23ba(0x2034,0x2a,0x95);
 F.f1ff8_3692(rw(0x8e98));
 F.f1ff8_2541(rw(rw(0x8dc0)+0x14),0x1f,0x9d);
 F.f1000_026a();
 F.f1ff8_2545(0x1f,0x95,0x20,0x2f);
 F.f1000_0278();
 F.f1ff8_2541(rw(rw(0x8dc0)+0x12),0x1f,0x9d);
 wb(0x3842,rb(0x3842)+1);
 wb(0x384b,rb(0x384b)+1);
}

// 1000:8b94 relObjects: rel for live roadside objects e = 20..39 (positions DS:9dfe+2k).
export function f1000_8b94(){
 const half=rsw(0x8988)>>1;
 for(let k=0;k<20;k++){
  const e=20+k;
  if(rb(0x8a54+e)===0)continue;
  const pk=rsw(0x9dfe+2*k);let r;
  if(pk>=rsw(0x96f2))r=s16(pk-rw(0x96f2));else r=s16(pk-rw(0x96f2)+rw(0x8988));
  ww(0x89cc+2*e,r);
  if(!(rsw(0x89cc+2*e)<half))ww(0x89cc+2*e,rw(0x89cc+2*e)-rw(0x8988));
 }
}

// 1000:8c10 hudOverlay: warnings, reticle frame, weapon name and ammo (jump table CS:9126); wreck overlay.
export function f1000_8c10(){
 if(rb(0x8a54)===0){
  // 9136: player wrecked
  f1000_92ae();f1000_9316();
  wb(0x384b,1);wb(0x384c,1);return;
 }
 wb(0x3842,1);wb(0x384c,0);wb(0x384b,0);
 const w=rw(0x9232);
 if(w!==0){
  let str=0;
  if(w===5){
   wb(0x3840,(rb(0x924e)&2)?0xe:(rw(0x896c)?0:5));str=0x203a;
  }else if(w===4){
   wb(0x3840,(rb(0x924e)&2)?0xf:(rw(0x896c)?0:0xc));str=0x204c;
  }else{
   wb(0x3840,(rb(0x924e)&2)?0:0xf);
   if(w===6)str=0x2061;else if(w===7)str=0x2070;
  }
  if(str)F.f1ff8_23ba(str,0x47,0x29);
  ww(0x9232,0);
 }
 wb(0x3840,0xf);wb(0x384e,0xf);
 F.f1ff8_2454(0x41,0x26,0x41,0x5e);
 F.f1ff8_2454(0xff,0x26,0xff,0x5e);
 F.f1ff8_2454(0x41,0x26,0x49,0x26);
 F.f1ff8_2454(0x41,0x5e,0x49,0x5e);
 F.f1ff8_2454(0xf7,0x26,0xff,0x26);
 F.f1ff8_2454(0xf7,0x5e,0xff,0x5e);
 F.f1ff8_3692(rw(0x8e98));
 const buf=salloc(0x14); // [BP-0x16]
 try{
  const x=rsw(0x898a),y=rsw(0x8a1c);
  const ammo=(v,ax,label)=>{
   F.f1000_def6(v,buf,10);
   if(v===0)wb(0x3840,0xe);
   F.f1ff8_23ba(buf,ax,0x57);
   F.f1ff8_23ba(label,0x47,0x57);
  };
  const box=()=>{
   F.f1ff8_3810(s16(x-5),s16(y-5),0xb,0xa);
   F.f1ff8_3810(s16(x-7),s16(y-7),0xf,0xe);
  };
  switch(rsb(0x9bc8)){
   case 1: // 8dac gun: cross hair and ammo
    F.f1ff8_2454(s16(x-7),y,s16(x-0xe),y);
    F.f1ff8_2454(s16(x+8),y,s16(x+0xf),y);
    F.f1ff8_2454(x,s16(y-7),x,s16(y-0xe));
    F.f1ff8_2454(x,s16(y+7),x,s16(y+0xe));
    ammo(rw(0x8e5c),0x65,0x2082);
    break;
   case 2: // 8e68 laser
    F.f1ff8_23ba(0x2088,s16(x-0xb),s16(y-3));
    F.f1ff8_23ba(0x208a,s16(x+8),s16(y-3));
    if(rw(0x9b0e))F.f1ff8_23ba(0x208c,0x47,0x57);
    else{wb(0x3840,0xe);F.f1ff8_23ba(0x2092,0x47,0x57);}
    break;
   case 3: // 8ecc beam
    box();
    wb(0x3842,1);
    F.f1ff8_23ba(0x20aa,s16(x-0xb),s16(y-3));
    F.f1ff8_23ba(0x20ac,s16(x+8),s16(y-3));
    if(rsw(0xa8c4)<10){wb(0x3840,0xe);F.f1ff8_23ba(0x20ae,0x47,0x57);}
    else F.f1ff8_23ba(0x20bc,0x47,0x57);
    break;
   case 4: // 8f6a Terminators
    ammo(rw(0x9238),0x8f,0x20c7);
    break;
   case 5: // 8fae missile: LAUNCHED / LOCKED / free reticle
    if(rw(0x5c6c)){
     ww(0x5c6c,rw(0x5c6c)-1);
     wb(0x3840,0xe);F.f1ff8_23ba(0x20d4,0xcd,0x57);
    }else if(rw(0x9b8c)){
     F.f1ff8_3194(5,x,y);
     F.f1ff8_3194(7,x,y);
     if(rb(0x924e)&4){wb(0x3840,0xc);F.f1ff8_23ba(0x20dd,0xd9,0x57);}
    }else box();
    ammo(rw(0x9a86),0x7d,0x20e4);
    break;
   case 6: ammo(rw(0x5c04),0x6b,0x20ee);break; // 909e mines
   case 7: ammo(rw(0x96dc),0x7d,0x20f5);break; // 90e2 caltrops
  }
 }finally{sfree(0x14);}
 wb(0x384b,1);wb(0x384c,1);
}

// 1000:914a resetReticle: reticle to (0xa1,0x41), clear the lock, request a lock cycle.
export function f1000_914a(){
 ww(0x898a,0xa1);ww(0x8a1c,0x41);
 f1000_8afa();
 ww(0x8a94,rw(0x8a94)+1);
}

// 1000:915e cycleLock: next AI car (after DS:9b8c, wrapping 9 -> 1) ahead whose screen position is in the window.
export function f1000_915e(){
 let cnt=1,si=rw(0x9b8c)+1;
 for(;;){
  if(si===10)si=1;
  cnt++;
  const S=2*si;
  if(rsw(0x89cc+S)>10&&rsw(0x998a+S)>0x45&&rsw(0x998a+S)<0xfb&&rsw(0x99d6+S)>0x2b&&rsw(0x99d6+S)<0x59&&
     rsw(0x99d6+S)<rsw(0x5c1c+S)){
   ww(0x898a,rw(0x998a+S));ww(0x8a1c,rw(0x99d6+S));
   ww(0x9b8c,si);ww(0x8a94,0);
   f1000_9406(si);
   return;
  }
  si=u16(si+1);
  if(!(cnt<10))break;
 }
 if(rw(0x9b8c))f1000_8afa();
}

// 1000:9214 trackLock: reticle follows the locked car while it stays in the window, else drop the lock.
export function f1000_9214(){
 const S=u16(2*rw(0x9b8c));
 if(rsw(0x998a+S)>0x45&&rsw(0x998a+S)<0xfb&&rsw(0x99d6+S)>0x2b&&rsw(0x99d6+S)<0x59&&rsw(0x99d6+S)<rsw(0x5c1c+S)){
  ww(0x898a,rw(0x998a+S));ww(0x8a1c,rw(0x99d6+S));return;
 }
 if(rw(0x9b8c))f1000_8afa();
}

// 1000:925e aim: lock cycling / tracking; an unlocked reticle drifts back to (0xa1,0x41) by 1 px per frame.
export function f1000_925e(){
 if(rw(0x8a94)||rw(0x9b8c)===0)f1000_915e();
 else f1000_9214();
 if(rw(0x9b8c))return;
 if(rsw(0x898a)<0xa1)ww(0x898a,rw(0x898a)+1);
 else if(rsw(0x898a)>0xa1)ww(0x898a,rw(0x898a)-1);
 if(rsw(0x8a1c)<0x41)ww(0x8a1c,rw(0x8a1c)+1);
 else if(rsw(0x8a1c)>0x41)ww(0x8a1c,rw(0x8a1c)-1);
}

// 1000:92ae wreckLines1: 21 lines from byte tables DS:1adc/1b06/1add/1b07 (colour 0, line 7 onwards colour 7).
export function f1000_92ae(){
 wb(0x384e,0);
 for(let si=0;si<0x15;si++){
  if(si===7)wb(0x384e,7);
  const o=2*si;
  F.f1ff8_2454(rb(0x1adc+o),rb(0x1b06+o),rb(0x1add+o),rb(0x1b07+o));
 }
}

// 1000:9316 wreckLines2: 74 lines, x words DS:1920/1922 (stride 4), y bytes DS:1a48/1a49 (stride 2), colour 7.
export function f1000_9316(){
 wb(0x384e,7);
 for(let k=0;k<0x4a;k++){
  F.f1ff8_2454(rw(0x1920+4*k),rb(0x1a48+2*k),rw(0x1922+4*k),rb(0x1a49+2*k));
 }
}

// 1000:9370 selectTarget(range): nearest live AI car in the player's lane with 0 < rel < range.
export function f1000_9370(range){
 range=s16(range);
 let best=0;
 for(let si=1;si<10;si++){
  if(rb(0x8a54+si)===0)continue;
  if(!F.f1000_a2ac(rw(0xa97a+2*si),rw(0xa97a)))continue;
  const r=rsw(0x89cc+2*si);
  if(!(r<range)||r<=0)continue;
  if(rsw(0x89cc+2*best)>r||best===0)best=si;
 }
 if(best){
  if(best===rw(0x9b8c))return;
  ww(0x9b8c,best);
  f1000_9406(best);
  return;
 }
 if(rw(0x9b8c))f1000_8afa();
}

// 1000:9406 drawTargetBox(e): the target's place (unsigned 32-bit progress compare over all 10 cars) and portrait.
export function f1000_9406(e){
 let place=1;
 wb(0x384b,0);wb(0x3841,0);wb(0x3840,4);wb(0x3842,0);
 F.f1ff8_3692(rw(0x8e72));
 const pe=rd(0xa678+u16(4*e));
 for(let i=0;i<10;i++)if(rd(0xa678+4*i)>pe)place++;
 const p=salloc(0x16),txt=p,num=p+0xa; // [BP-0x18], [BP-0xe]
 try{
  F.f1000_def6(place,num,10);
  if(cstrlen(num)===1)copyBytes(txt,0x20ff,2);else copyBytes(txt,0x2101,1);
  cstrcat(txt,num);
  F.f1ff8_23ba(txt,0x2a,0x95);
 }finally{sfree(0x16);}
 F.f1ff8_3692(rw(0x8e98));
 F.f1ff8_2541(rw(rw(0x8dc0)+u16(2*e)-2),0x1f,0x9d);
 F.f1000_026a();
 F.f1ff8_2545(0x1f,0x95,0x20,0x2f);
 F.f1000_0278();
 wb(0x3842,rb(0x3842)+1);
 wb(0x384b,rb(0x384b)+1);
}

// 1000:9542 updateProjectiles: Terminator flight and hits, projectile rel and warnings, AI missile attack.
export function f1000_9542(){
 for(let j=0;j<10;j++){
  const e=j+10,E=2*e,J=2*j;
  if(rb(0x8a54+e)===0)continue;
  let hit=false;
  if(rb(0x8a54+e)===4){
   if(rsw(0x8926+E)<0x12c)ww(0x8926+E,rw(0x8926+E)+3);
   ww(0xa026,rw(0x8970+J));
   ww(0x8970+J,rw(0x8970+J)+idiv16(s16(rw(0x8926+E)+rw(0x9b90+E)),30));
   if(rsw(0x8970+J)>rsw(0x8988)){const p=s16(rw(0x8970+J)-rw(0x8988));ww(0x8970+J,p<0?0:p);}
   // QUIRK (9807): the remainder is computed from and stored to car j's speed/sub (index 2j instead of 2e),
   // so the Terminator's own sub never changes and car j's sub is re-reduced.
   ww(0x9b90+J,imod16(s16(rw(0x8926+J)+rw(0x9b90+J)),30));
   for(let c=0;c<10;c++){
    if(rb(0x8a54+c)===0)continue;
    if(!F.f1000_a2ac(rw(0xa97a+2*c),rw(0xa97a+E)))continue;
    if(rsw(0x8970+J)<rsw(0x96f2+2*c))continue;
    if(rsw(0x96f2+2*c)<rsw(0xa026))continue;
    // QUIRK: height table indexed by the car's track position (docs/re/race.md Projectiles, Motion 3).
    if(carZ(rsw(0x96f2+2*c))>s16(rw(0x9a46+6*j)+0xf))continue;
    f1000_9e90(c,e);
    hit=true;break;
   }
   if(!hit){
    // 9561: pose of the flying Terminator, interpolated with its sub.
    const p=rsw(0x8970+J);
    const z0=ptZ(p),x0=ptX(p),y0=ptY(p),z1=ptZ(p+1),x1=ptX(p+1),y1=ptY(p+1);
    const lat=rsw(0xa97a+E);
    staleStack.bpm4=u16(abs16(lat)); // [BP-4]
    const o=latOffsets(x0,y0,x1,y1,lat);
    const S=6*j,dz=s16(z1-z0),dx=s16(o.xo1-o.xo0),dy=s16(o.yo1-o.yo0);
    ww(0x8e20+S,F.f2c46_3220(0x1e,dz));
    ww(0x8e24+S,F.f2c46_3220(dx,dy)-0x4000);
    const sub=rsw(0x9b90+E);
    ww(0x9a46+S,(s16(dz*sub)>>5)+z0);
    ww(0x9a42+S,(s16(dx*sub)>>5)+o.xo0);
    ww(0x9a44+S,(s16(dy*sub)>>5)+o.yo0);
   }
  }
  if(!hit){
   if(rb(0x8a54+e)===5){
    // QUIRK (9778): a missile's rel is copied from rel[[BP-4]], a stale stack word (see staleStack).
    ww(0x89cc+E,rw(0x89cc+u16(2*staleStack.bpm4)));
    continue;
   }
   const pp=rsw(0x8970+J);let r;
   if(pp>=rsw(0x96f2))r=s16(pp-rw(0x96f2));else r=s16(pp-rw(0x96f2)+rw(0x8988));
   ww(0x89cc+E,r);
   if(!(rsw(0x89cc+E)<(rsw(0x8988)>>1)))ww(0x89cc+E,rw(0x89cc+E)-rw(0x8988));
  }
  // 970c: warnings
  const t=rb(0x8a54+e),rel=rsw(0x89cc+E);
  if(t===7){if(rel>0&&rel<0xc8)ww(0x9232,7);}
  else if(t===6){if(rel>0&&rel<0xc8)ww(0x9232,6);}
  else if(t===4){if(rel<0&&rel>-200)ww(0x9232,4);}
 }
 // 98c2: AI missile attack countdown.
 if(rw(0x1fbc)===0)return;
 ww(0x1fbc,rw(0x1fbc)-1);
 ww(0x9232,5);
 if(rw(0x9ad2)){
  let off;
  if(rw(0x1fbc)===0)off=10;
  else if(rw(0x8926)===0)off=5;
  else if(rsw(0x8926)<0x32&&rw(0x9ad2))off=0x14;
  else off=0;
  if(off===0)return;
  ww(0x1fbc,0);
  const e=f1000_731a(s16(off+rw(0x96f2)),rw(0xa97a),10,0);
  staleStack.bpm4=e; // [BP-4]
  if(e)ww(0x8db0+2*e,4);
  return;
 }
 if(rw(0x1fbc)===0)f1000_9e90(0,-5);
}

// 1000:996c updateTimers: beam charge, projectile lifetimes (expiry splash), homing missile steering.
export function f1000_996c(){
 if(rsb(0x9bc8)===3){
  // QUIRK: alternates 10/11 once charged (docs/re/race.md Beam charge).
  const old=rsw(0xa8c4);ww(0xa8c4,old+1);
  ww(0xa8c4,old>10?10:old+1);
 }
 for(let j=0;j<10;j++){
  const J=2*j,e=j+10;
  if(rw(0x8dc4+J)===0)continue;
  ww(0x8dc4+J,rw(0x8dc4+J)-1);
  if(rw(0x8dc4+J)===0){
   wb(0x8a54+e,0);
   // QUIRK: tests the state of car j (slot number) for 4/6 instead of the cleared projectile type.
   for(let c=0;c<10;c++){
    const t=state(j);
    if(t!==4&&t!==6)continue;
    const rc=rsw(0x89cc+2*c),re=rsw(0x89cc+2*e);
    if(s16(rc+5)<re)continue;
    if(s16(rc-5)>re)continue;
    f1000_9e90(c,e);
   }
   continue;
  }
  if(rb(0x8a54+e)!==5)continue;
  // 99ff: homing
  const tg=rsw(0xaa82+J),M=6*j,T=u16(6*tg);
  const d1=s16(F.f1000_af74(0xa93e,0x9a42+M));
  const d2=s16(F.f1000_af74(u16(0xa93e+T),0x9a42+M));
  if(d2>0x40){
   const tx=rsw(0xa93e+T),ty=rsw(0xa940+T),tz=rsw(0xa942+T);
   if(d1<d2)ww(0x9a46+M,(d1>>2)+rw(0xa942));
   else ww(0x9a46+M,(d2>>2)+tz);
   ww(0x8e20+M,F.f2c46_3220(d2,s16(rw(0x9a46+M)-tz)));
   ww(0x8e24+M,F.f2c46_3220(s16(tx-rw(0x9a42+M)),s16(ty-rw(0x9a44+M)))-0x4000);
   ww(0x9a42+M,rw(0x9a42+M)+ldiv(lshl(s16(tx-rw(0x9a42+M)),8),d2));
   ww(0x9a44+M,rw(0x9a44+M)+ldiv(lshl(s16(ty-rw(0x9a44+M)),8),d2));
  }else{
   f1000_9e90(tg,e);
   const cx=rw(0xaa82+J);
   for(let k=10;k<20;k++)if(rb(0x8a54+k)===5&&rw(0xaa82+2*(k-10))===cx)wb(0x8a54+k,0);
  }
 }
 for(let k=0;k<10;k++)ww(0x998a+2*k,0xffff);
}

// 1000:9bcc fireDirect: gun sparks, laser and beam polygons, ammo/charge, trigger countdown DS:1f82.
export function f1000_9bcc(){
 const w=rsb(0x9bc8);
 if(w===1){
  if(rw(0x8e5c)===0)return;
  ww(0x8e5c,rw(0x8e5c)-1);
  // eight nibbles of DS:9636 by repeated SAR 4 (the upper four repeat the sign).
  const r=rsw(0x9636),n=k=>(r>>(4*k))&0xf;
  const x=rsw(0x898a),y=rsw(0x8a1c);
  F.f1ff8_3d2b(s16(n(0)+x-8),s16(n(1)+y-8),0xf);
  F.f1ff8_3d2b(s16(n(2)+x-8),s16(n(3)+y-8),0xf);
  F.f1ff8_3d2b(s16(n(4)+x-8),s16(n(5)+y-8),0xf);
  F.f1ff8_3d2b(s16(n(6)+x-8),s16(n(7)+y-8),0xf);
  ww(0x8a4c,1);
  if(rw(0x1f82)===0)return;
  F.f2524_041a(3);
  ww(0x1f82,rw(0x1f82)-1);
  return;
 }
 if(w===2){
  if(rw(0x9b0e)===0)return;
  ww(0x9b0e,rw(0x9b0e)-1);
  wb(0x384d,rw(0x1fd6)===2?5:0xc);
  wb(0x384e,4);
  ww(0x3849,0x63);
  if(rw(0x1f82)!==2){
   ww(0x3843,0x70);ww(0x3845,rw(0x898a)-1);
   F.f1ff8_256d(3,0x2102,0x210e);
   ww(0x3843,rw(0x898a)+1);ww(0x3845,0xd0);
   F.f1ff8_256d(3,0x2108,0x2114);
  }else{
   ww(0x3845,0x6e);
   F.f1ff8_256d(3,0x2102,0x211a);
   ww(0x3843,0xd2);ww(0x3845,0x140);
   F.f1ff8_256d(3,0x2108,0x2120);
  }
  if(rw(0x1f82))ww(0x1f82,rw(0x1f82)-1);
  if(rw(0x1f82)===0){ww(0x8a4c,1);return;}
  if(rw(0x1f82)===1)F.f2524_041a(1);
  return;
 }
 if(w===3){
  if(rw(0xa8c4)===0)return;
  ww(0xa8c4,0);
  wb(0x384d,rw(0x1fde)===2?0xe:0xa);
  wb(0x384e,2);
  const t=rw(0x1f82);
  if(t===1)ww(0x3847,0x3d);
  else if(t===2){ww(0x3847,0x33);ww(0x3849,0x3c);}
  else if(t===3)ww(0x3849,0x32);
  F.f1ff8_256d(3,0x2126,0x2132);
  F.f1ff8_256d(3,0x212c,0x2138);
  if(rw(0x1f82))ww(0x1f82,rw(0x1f82)-1);
  if(rw(0x1f82)===0){ww(0x8a4c,1);return;}
  if(rw(0x1f82)===1)F.f2524_041a(2);
  return;
 }
 if(rw(0x1f82))ww(0x1f82,rw(0x1f82)-1);
}

// 1000:9e90 damage(victim, src): src > 0 is a projectile entity, src < 0 a direct cause (-type).
// Includes the tails 9fe0 (player victim) and a010 (death check), which run in this frame (docs/re/race.md).
// Jump table CS:9fcc (types 1..9) is the AI-victim switch.
export function f1000_9e90(victim,src){
 victim=s16(victim);src=s16(src);
 const V=u16(2*victim);
 if(rsw(0x8ec4+V)>=rsw(0x8eb8))return;
 const t=src<0?s16(-src):rsb(0x8a54+src);
 const owner=()=>rsw(0x95ae+u16(2*src)); // DS:95c2+2(src-10)
 if(victim===0){
  // 9fe0: player victim
  switch(t){
   case 4: F.f2524_44d6(0x64);F.f2524_4528();F.f2524_4556();break;
   case 5: F.f2524_44d6(0x46);break;
   case 11: // falls through into the type-6 path, then the type-7 path (a062 -> a083 -> a09e)
    F.f2524_44d6(rw(0x1c5c));F.f2524_44fc(0);F.f2524_4542();F.f2524_4556();
    // fallthrough
   case 6:
    F.f2524_44d6(0x3c);F.f2524_4542();F.f2524_456a();F.f2524_4528();
    // fallthrough
   case 7: F.f2524_44fc(0);break;
  }
 }else if(t===7){
  F.f2524_44fc(victim);F.f2524_4528();
 }else{
  if(src>0&&owner()!==0)ww(0x9aa6+V,rw(0x9aa6+V)+0x3e8); // any AI weapon destroys an AI car
  const add=a=>ww(0x9aa6+V,rw(0x9aa6+V)+a);
  switch(t){ // table CS:9fcc; the player's upgrade levels apply whoever fired
   case 1: add(u16(rw(0x1fd8)*4+3));break;
   case 2: add(u16(rw(0x1fd6)*5+7));break;
   case 3: add(u16(rw(0x1fde)*12+0x14));break;
   case 4:{
    const l=rw(0x1fe2);
    if(l===0)staleStack.dmgBpm2=0x2d;else if(l===1)staleStack.dmgBpm2=0x5c;else if(l===2)staleStack.dmgBpm2=0xb4;
    // QUIRK: other levels use the uninitialised local [BP-2] (see staleStack).
    add(staleStack.dmgBpm2);break;}
   case 5: add(u16(0x50*rw(0x1fdc)+0x3c));break;
   case 6: add(u16(rw(0x1fda)*13+0x14));break;
   case 8: add(u16(rw(0x1fe0)+1));break;
   case 9: add(u16(rw(0x1fe4)+1));break;
  }
 }
 // a010: death check
 if(rsw(0x9aa6+V)>=rsw(0x1c5c+V)){
  ww(0x9aa6+V,rw(0x1c5c+V));
  if(state(victim)>0){
   if(src>0)ww(0x5c6e+u16(2*owner()),rw(0x5c6e+u16(2*owner()))+1);
   else if(src===-5)ww(0x5c6e+u16(2*rw(0x1fbe)),rw(0x5c6e+u16(2*rw(0x1fbe)))+1);
   else if(rb(0x8a54+victim)===1)ww(0x5c6e,rw(0x5c6e)+1);
   if(rw(0x9a84)&&victim===rsw(0x9a84)){
    if(src>=0)staleStack.dmgBpm2=rw(0x95ae+u16(2*src));
    else staleStack.dmgBpm2=src===-5?5:0;
    if(staleStack.dmgBpm2===0)ww(0x901a,1);
   }
   wb(0x8a54+victim,(t===1||t===3)?0xdd:0xfb);
  }
  if(victim===0)F.f1000_a14c();
 }
 if(victim===0)F.f2524_406e();
 if(src>0)wb(0x8a54+src,0);
}

provide({
 f1000_6dbc,f1000_731a,f1000_75ea,f1000_7610,f1000_767c,f1000_76e2,f1000_775e,f1000_77c8,f1000_7982,f1000_7a6a,
 f1000_7a9c,f1000_7ca4,f1000_7cf0,f1000_7daa,f1000_7ecc,f1000_7f3c,f1000_7fbe,f1000_8008,f1000_8148,f1000_81ec,
 f1000_84be,f1000_85b4,f1000_85f0,f1000_863c,f1000_89d6,f1000_8a48,f1000_8afa,f1000_8b94,f1000_8c10,f1000_914a,
 f1000_915e,f1000_9214,f1000_925e,f1000_92ae,f1000_9316,f1000_9370,f1000_9406,f1000_9542,f1000_996c,f1000_9bcc,
 f1000_9e90,
});
export {
 f1000_6dbc as playerInput,f1000_731a as spawnProjectile,f1000_7982 as updateCars,f1000_7a9c as advanceCar,
 f1000_8008 as aiSteer,f1000_9542 as updateProjectiles,f1000_996c as updateTimers,f1000_9e90 as damage,
};
