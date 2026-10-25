// Segment 1ff8 graphics library, part 2: text, rectangle, ellipse, clipped pixels, dissolve,
// the JMPF slot stubs and the EGA state helpers. Driver slots are reached through the table at DS:4924.
// Register-argument slots take positional registers per src/game/egadrv.js: slot 1 (ax,dx,bp,es), 10/11 (ax,bx,cx,dx,di,es).
import {rb,rw,rd,wb,ww,wd,frb} from '../../engine/mem.js';
import {s8,s16,u8,u16,shr16} from '../../engine/int.js';
import {callFar,register,unsupported} from '../../engine/host.js';
import * as ega from '../../engine/ega.js';
import {provide} from '../link.js';
import {f1ff8_2454} from './poly.js';

const slot=n=>rd(0x4924+4*n);
const outw=ega.outw; // OUT DX,AX to EGA ports
// Video offset of seg:off relative to A000.
const vo=(seg,off)=>(seg-0xa000)*16+(off&0xffff);
// ES for the drawing routines: [3858], or the Tandy mapping call when [4d8c] is set (not supported).
function drawSeg(where){if(rw(0x4d8c))unsupported(`${where} Tandy page mapping 3168:02c4`);return rw(0x3858);}

// ---- JMPF stubs: arguments and return value pass straight through to the slot ----
// 1ff8:2541 drawSprite(spr,x,y): slot 3
export function f1ff8_2541(...a){return callFar(slot(3),...a);}
// 1ff8:2545 copyRect(x,y,w,h): slot 4
export function f1ff8_2545(...a){return callFar(slot(4),...a);}
// 1ff8:2549 saveRect(off,seg,x,y,w,h): slot 5
export function f1ff8_2549(...a){return callFar(slot(5),...a);}
// 1ff8:254d saveRectSize(w,h): slot 6
export function f1ff8_254d(...a){return callFar(slot(6),...a);}
// 1ff8:2551 restoreRect(off,seg,x,y,w,h): slot 7
export function f1ff8_2551(...a){return callFar(slot(7),...a);}
// 1ff8:2555 flipPages(wait): slot 8. Its EGA target waits for retrace when wait!=0; the game only passes 0
// (1000:05bf), so this stays a plain function. INDIRECT: a non-zero wait would need callFarG.
export function f1ff8_2555(...a){return callFar(slot(8),...a);}
// 1ff8:2559 slot9(x,y,w,h): slot 9 (EGA no-op)
export function f1ff8_2559(...a){return callFar(slot(9),...a);}
// 1ff8:3cf1 setBorder(c): slot 25
export function f1ff8_3cf1(...a){return callFar(slot(25),...a);}
// 1ff8:3cf5 setPaletteReg(r,c): slot 26
export function f1ff8_3cf5(...a){return callFar(slot(26),...a);}
// 1ff8:5282 blitPacked(srcOff,srcSeg,x,y,w,h): slot 17
export function f1ff8_5282(...a){return callFar(slot(17),...a);}
// 1ff8:5286 blitPackedAlt(...): slot 18 (EGA no-op)
export function f1ff8_5286(...a){return callFar(slot(18),...a);}

// 1ff8:52b1 egaResetState: on EGA ([385d]=2) GC5=02, GC3=00, GC8=FF
export function f1ff8_52b1(){
 if(rb(0x385d)!==2)return;
 outw(0x3ce,0x0205);outw(0x3ce,0x0003);outw(0x3ce,0xff08);
}
// 1ff8:528a tandyCheck: [385c]=1 when F000:FFFE=FFh and C000:0000=21h; returns (s8)[385c] (CBW)
export function f1ff8_528a(){
 if(frb(0xf000,0xfffe)===0xff&&frb(0xc000,0)===0x21)wb(0x385c,1);
 return rsb385c();
}
const rsb385c=()=>s8(rb(0x385c));

// 1ff8:23ba drawText(str,x,y): NUL-terminated near string in the current font through slot 1
export function f1ff8_23ba(str,x,y){
 const es=drawSeg('1ff8:23ba');
 wb(0x3869,rw(0x46a4+2*rb(0x3841)));wb(0x3868,rw(0x46a4+2*rb(0x3840)));
 let si=u16(str),dx=u16(x);const bp=u16(y);
 if(rb(0x384b)){
  if(s16(bp)<rsw(0x3847))return;
  // QUIRK: y+h is an 8-bit add (ADD AL,[3888]) and the test is y+h > ymax, so a string whose bottom row
  // equals ymax is not drawn (graphics.md, drawText).
  if(s16(bp&0xff00|bp+rb(0x3888)&0xff)>rsw(0x3849))return;
 }
 for(;;){
  const ch=rb(si);si=si+1&0xffff;if(!ch)return;
  if(rb(0x384b)){
   if(s16(dx)<rsw(0x3843)){dx=u16(dx+rb(0x3874));continue;} // left of the box: skip the glyph
   if(s16(dx+rb(0x3874)-1)>rsw(0x3845))return;             // crosses xmax: stop the string
  }
  callFar(slot(1),ch,dx,bp,es); // slot 1 preserves DX, SI, BP
  dx=u16(dx+rb(0x3874));
 }
}
const rsw=o=>s16(rw(o));

// 1ff8:3810 drawRect(x,y,w,h): outline [384e], fill [384d] when [384c], clipped when [384b]==1
export function f1ff8_3810(x,y,w,h){
 f1ff8_52b1();
 const es=drawSeg('1ff8:3810');
 const c=rb(0x384d)*2,A=rw(0x41a4+c),Bv=rw(0x4424+c);
 ww(0x3864,A);ww(0x3866,Bv);
 wd(0x3870,Bv===A?rd(0x494c):rd(0x4950)); // solid span (slot 10) or dithered span (slot 11)
 ww(0x3862,rw(0x41a4+rb(0x384e)*2));
 let bx=s16(x),si=s16(y),cx=s16(w),bp=s16(h);
 if(cx<=0||bp<=0)return;
 let di=0;
 if(rb(0x384b)===1){ // exactly 1 (CMP byte,1)
  let t=bx-rsw(0x3843);
  if(t<0){bx=rsw(0x3843);t=cx+t;if(t<=0)return;cx=s16(t);di|=1;}
  t=si-rsw(0x3847);
  if(t<0){si=rsw(0x3847);t=bp+t;if(t<=0)return;bp=s16(t);di|=2;}
  t=s16(rsw(0x3845)+1)-s16(cx+bx);
  if(t<0){t=cx+s16(t);if(t<=0)return;cx=s16(t);di|=4;}
  t=s16(rsw(0x3849)+1)-s16(bp+si);
  if(t<0){di|=8;t=bp+s16(t);if(t<=0)return;bp=s16(t);}
 }
 const span10=(row)=>callFar(slot(10),rw(0x3862),u16(bx),u16(cx),0,rw(0x3d3e+(row<<1&0xffff)),es);
 if(!(rb(0x384c)&&rb(0x384e)===rb(0x384d))){
  const saved=rb(0x384b);wb(0x384b,0);
  if(!(di&1)){
   f1ff8_2454(bx,si,bx,s16(si+bp-1));
   bx=s16(bx+1);cx=s16(cx-1);
   if(cx<0){unsupported('1ff8:3810 drawRect w=1 stack corruption');return;}
  }
  if(!(di&4)){
   const xr=s16(bx+cx-1);
   f1ff8_2454(xr,si,xr,s16(si+bp-1));
   cx=s16(cx-1);
   // QUIRK: w=1 without left clipping exits with the saved [384b] still on the stack (graphics.md, drawRect).
   if(cx<0){unsupported('1ff8:3810 drawRect w=1 stack corruption');return;}
  }
  if(!(bp<3&&(di&0xa)===0xa)){
   let done=false;
   if(!(di&2)){span10(si);si=s16(si+1);bp=s16(bp-1);if(bp<=0)done=true;}
   if(!done&&!(di&8)){span10(s16(si+bp-1));bp=s16(bp-1);}
  }
  wb(0x384b,saved);
  if(bp<=0)return;
 }
 if(!rb(0x384c))return;
 // QUIRK: the phase is set once and slot 11 toggles before drawing, so even rows get the 4424 word and odd
 // rows the 41a4 word, the opposite of polygons and ellipses (graphics.md, drawRect).
 ww(0x386a,si&1);
 for(;;){
  callFar(rd(0x3870),rw(0x3864),u16(bx),u16(cx),rw(0x3866),rw(0x3d3e+(si<<1&0xffff)),es);
  si=s16(si+1);bp=s16(bp-1);if(!bp)return;
 }
}

// 1ff8:3194 drawEllipse(r,cx,cy): filled and outlined circle, x scaled by 1.25 (tables 49ec/4a53/4aba)
export function f1ff8_3194(r,cx,cy){
 const es=drawSeg('1ff8:3194');
 ww(0x4b21,es);
 r=s16(r);
 if(r<=1){if(r===1)f1ff8_3d2b(cx,cy,rb(0x384d));return;}
 if(u16(r)>0x66)r=0x66;
 // Midpoint circle: in[k] = floor(1.25*(r-h)) at 49ec, len[k] = W - 2*in[k] at 4aba.
 const W=u16(((r>>>2)+r)<<1);
 let x=0,y=r,d=s16(-(2*r-3));
 while(x<=y){
  let a=u16(r-x);a=u16((a>>>2)+a);wb(0x49ec+(r-y),a);wb(0x4aba+(r-y),-(u16(a<<1)-W));
  a=u16(r-y);a=u16((a>>>2)+a);wb(0x49ec+(r-x),a);wb(0x4aba+(r-x),-(u16(a<<1)-W));
  if(x===y)break;
  const old=d;d=s16(x*4+d+6);x++;
  if(old>=0){d=s16(d-y*4+4);y--;}
 }
 // Per row: out[k] at 4a53 (outline run), fill[k] at 4aba; 8-bit arithmetic.
 wb(0x4a53,rb(0x4aba));wb(0x4aba,0);
 let dl=rb(0x49ec);
 for(let k=1;k<=r;k++){
  const al=rb(0x49ec+k);
  dl=u8(dl-al+1);wb(0x4a53+k,dl);dl=u8(dl<<1);
  const bl=u8(rb(0x4aba+k)-dl);
  if(!bl)wb(0x4a53+k,dl);
  wb(0x4aba+k,bl);dl=al;
 }
 const c=rb(0x384d)*2,A=rw(0x41a4+c),Bv=rw(0x4424+c);
 ww(0x3864,A);ww(0x3866,Bv);
 wd(0x3870,Bv===A?rd(0x494c):rd(0x4950));
 ww(0x3862,rw(0x41a4+rb(0x384e)*2));
 let F=u16((r>>>2)+r);const L=s16(cx-F);F=u16(F<<1);
 let lo,hi;
 const clip=!!rb(0x384b);
 if(!clip){lo=F>>8;hi=F&0xff;}
 else{
  lo=0;
  const xmin=rsw(0x3843);
  if(!(xmin<=L)){const t=s16(xmin-L);if(s16(F)<=t)return;lo=t;}
  const xr=u16(L+F);let h2=F;
  if(!(rw(0x3845)>=xr)){h2=s16(F-u16(xr-rw(0x3845))+1);if(h2<=0)return;}
  hi=h2&0xff;lo&=0xff;
 }
 // One row k at row offset `ro`: left outline, fill, right outline, each clipped to [lo,hi).
 const row=(k,ro)=>{
  const draw=(al,n,fill)=>fill
   ?callFar(rd(0x3870),rw(0x3866),u16(L+al),n,rw(0x3864),ro,es)
   :callFar(slot(10),rw(0x3862),u16(L+al),n,0,ro,es);
  // Common clip tail: returns the position after the run (or after the clipped-away run).
  const run=(al,cl,fill)=>{
   if(s8(al)<s8(lo)){al=u8(al-lo);cl=u8(cl+al);if(s8(cl)<=0)return {al:u8(cl+lo),gone:true};al=lo;}
   cl=u8(cl+al);if(cl>hi)cl=hi;cl=u8(cl-al);
   draw(al,cl,fill);return {al:u8(al+cl)};
  };
  let al=rb(0x49ec+k);
  // QUIRK: signed byte compares against hi: with W>=128 (r>=52) every row is skipped (static).
  if(s8(al)>s8(hi))return;
  al=run(al,rb(0x4a53+k),false).al;
  const fl=rb(0x4aba+k);if(!fl)return;
  if(rb(0x384c)){if(s8(al)>s8(hi))return;al=run(al,fl,true).al;}
  else al=u8(al+fl);
  if(s8(al)>s8(hi))return;
  const o=run(al,rb(0x4a53+k),false); // right outline; a clipped-away run ends the row either way
  void o;
 };
 // Upper half: rows cy-r .. cy-1, k = 0..r-1; [386a] = row&1 before every row.
 let n=r,di=s16(cy-r),k=0,upper=true;
 if(clip){
  const ymin=rsw(0x3847);
  if(!(ymin<=di)){const t=s16(ymin-di);n=s16(n-t);if(n<=0)upper=false;else{k+=t;di=ymin;}}
  if(upper&&!(u16(n+di)<=rw(0x3849))){n=s16(rw(0x3849)-di+1);if(n<=0)upper=false;}
 }
 if(upper){
  let bp2=u16(di<<1);ww(0x386a,di&1);let ro=rw(0x3d3e+bp2);
  for(;;){
   row(k,ro);
   bp2=u16(bp2+2);ww(0x386a,bp2>>>1&1);ro=rw(0x3d3e+bp2);k++;
   if(!(n=s16(n-1)))break;
  }
 }
 // Lower half: rows cy .. cy+r, k = r..0.
 n=r+1;di=s16(cy);k=r;
 if(clip){
  const ymin=rsw(0x3847);
  // QUIRK: the top clip tests the table index k for <= 0, not the row count (graphics.md, drawEllipse).
  if(!(ymin<=di)){const t=s16(ymin-di);n=s16(n-t);k=k-t;if(k<=0)return;di=ymin;}
  if(!(u16(n+di)<=rw(0x3849))){n=s16(rw(0x3849)-di+1);if(n<=0)return;}
 }
 // QUIRK: the phase is set once; afterwards only slot 11 toggles it (graphics.md, drawEllipse).
 ww(0x386a,di&1);
 let bp2=u16(di<<1),ro=rw(0x3d3e+bp2);
 for(;;){
  row(k,ro);
  bp2=u16(bp2+2);ro=rw(0x3d3e+bp2);k--;
  if(!(n=s16(n-1)))return;
 }
}

const outside=(x,y)=>{x=s16(x);y=s16(y);return x<rsw(0x3843)||x>rsw(0x3845)||y<rsw(0x3847)||y>rsw(0x3849);};
// 1ff8:3cf9 getPixelClipped(x,y): 0xffff outside the inclusive clip box when [384b], else slot 21
export function f1ff8_3cf9(x,y){if(rb(0x384b)&&outside(x,y))return 0xffff;return callFar(slot(21),x,y);}
// 1ff8:3d2b putPixelClipped(x,y,c): same test, else slot 22
export function f1ff8_3d2b(x,y,c){if(rb(0x384b)&&outside(x,y))return 0xffff;return callFar(slot(22),x,y,c);}

// 1ff8:44b4 dissolveRect (EGA slot 23) is translated in src/game/egadrv.js (main session decision).

export {f1ff8_23ba as drawText,f1ff8_3810 as drawRect,f1ff8_3194 as drawEllipse,f1ff8_3cf9 as getPixelClipped,
 f1ff8_3d2b as putPixelClipped,f1ff8_52b1 as egaResetState,f1ff8_528a as tandyCheck};

provide({f1ff8_2541,f1ff8_2545,f1ff8_2549,f1ff8_254d,f1ff8_2551,f1ff8_2555,f1ff8_2559,f1ff8_3cf1,f1ff8_3cf5,
 f1ff8_5282,f1ff8_5286,f1ff8_52b1,f1ff8_528a,f1ff8_23ba,f1ff8_3810,f1ff8_3194,f1ff8_3cf9,f1ff8_3d2b});
