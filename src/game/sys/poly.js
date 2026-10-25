// Segment 1ff8 polygon/line library: clipped line, convex polygon fill (span list + driver slot 27),
// Sutherland-Hodgman polygon clipper. Translated from the disassembly (docs/re/graphics.md).
// Driver slots are called through the active table DS:4924 (slot n at 4924+4n).
// Register-argument slots get one register object {ax,bx,cx,dx,si,di,bp,es} (agreed sys convention).
import {rb,rw,rsw,ww,fww,DGROUP} from '../../engine/mem.js';
import {s16,u16,u8,s8,imul16,idiv32_16,div32_16,mod32_16} from '../../engine/int.js';
import {callFar,unsupported} from '../../engine/host.js';
import {provide} from '../link.js';

const XMIN=0x3843,XMAX=0x3845,YMIN=0x3847,YMAX=0x3849,CLIP=0x384b,FILL=0x384c,FILLC=0x384d,LINEC=0x384e;
const PX=0x38ec,PY=0x3914,TX=0x393c,TY=0x3964,OX=0x398c,OY=0x39b4,CNT=0x39dc;
const slot=n=>rw(0x4924+4*n)|rw(0x4926+4*n)<<16;
// Span buffer segment: ES = DS + (0x39fe>>4) = DS+0x39f, row y at ES:4y (= DS:39f0+4y), {xl,xr}.
const SPANSEG=DGROUP+0x39f&0xffff;
// MSC-style 16x16 IMUL then 32/16 IDIV, as the original does for every interpolation.
const muldiv=(a,b,c)=>idiv32_16(imul16(a,b),c);

// 1ff8:2454 drawLine: clip (x1,y1)-(x2,y2) to DS:3843.. when [384b]!=0, then driver slot 2.
// Stage order ymin, xmin, ymax, xmax. ymin/xmin tests are signed (JL), ymax/xmax unsigned (JA).
export function f1ff8_2454(x1,y1,x2,y2){
 let bx=u16(x1),cx=u16(y1),si=u16(x2),di=u16(y2),t;
 const sw=()=>{t=si;si=bx;bx=t;t=di;di=cx;cx=t;};
 if(rb(CLIP)){
  // ymin (signed)
  let b=rsw(YMIN);
  if(s16(cx)<b){if(s16(di)<b)return;}
  else if(s16(di)<b)sw(); else b=null;
  if(b!==null){bx=u16(bx+muldiv(si-bx,b-cx,di-cx));cx=u16(b);}
  // xmin (signed)
  b=rsw(XMIN);
  if(s16(bx)<b){if(s16(si)<b)return;}
  else if(s16(si)<b)sw(); else b=null;
  if(b!==null){cx=u16(cx+muldiv(di-cx,b-bx,si-bx));bx=u16(b);}
  // ymax (unsigned)
  b=rw(YMAX);
  if(cx>b){if(di>b)return;}
  else if(di>b)sw(); else b=null;
  if(b!==null){bx=u16(bx+muldiv(si-bx,b-cx,di-cx));cx=b;}
  // xmax (unsigned)
  b=rw(XMAX);
  if(bx>b){if(si>b)return;}
  else if(si>b)sw(); else b=null;
  if(b!==null){cx=u16(cx+muldiv(di-cx,b-bx,si-bx));bx=b;}
 }
 // 252c: DX=x2, SI=y2; order so that x1 <= x2 (unsigned compare).
 let dx=si;si=di;
 if(bx>dx){t=dx;dx=bx;bx=t;t=si;si=cx;cx=t;}
 return callFar(slot(2),{bx,cx,dx,si,es:rw(0x3858)});
}

// 1ff8:255d fillSpans(list): driver slot 27 with SI = list (near span list {y,count,(x1,x2)*count}).
export function f1ff8_255d(list){return callFar(slot(27),{si:u16(list)});}

// 1ff8:2926 polyLines (near; SI = xs, DI = ys, BP = count): drawLine(xs[i+1],ys[i+1],xs[i],ys[i]) for i<count.
// QUIRK: BP=0 would loop 65536 times (DEC BP; JNZ); callers always pass >= 1.
export function f1ff8_2926(si,di,bp){
 do{f1ff8_2454(rw(si+2),rw(di+2),rw(si),rw(di));si+=2;di+=2;bp=u16(bp-1);}while(bp);
}

// 1ff8:2a29 edgeWalk (near): AX = first x, DI = first row, CH = rows (u8), CL = row step in bytes beyond
// the STOSW (signed byte: 2 = down, -6 = up), BX = fraction step F, SI = integer step, BP = accumulator.
// The original jumps into the unrolled 200-block table 2a50..2fc7 (each block: STOSW; ADD DI,CX;
// ADD BP,BX; ADC AX,SI; 2e73 is a mis-decoded fragment of it) at 2fc8-7*CH. Word 0/2 of the row is
// selected by [49cc]. Stores go to ES = DS+0x39f.
export function f1ff8_2a29(ax,di,ch,cl,bx,si,bp){
 di=u16((di<<2)+rw(0x49cc));ch=u8(ch);
 // QUIRK/unsupported: CH > 200 jumps before the table into unrelated code.
 if(ch>200)return unsupported('1ff8:2a29 edge >200 rows');
 const step=s8(cl);
 for(let k=0;k<ch;k++){
  fww(SPANSEG,di,ax);di=u16(di+2+step);
  const s=bp+u16(bx);bp=s&0xffff;ax=u16(ax+si+(s>0xffff?1:0));
 }
}

// Edge setups (near). Registers on entry: BX = xa, BP = xb, CX = ya, SI = yb. All end in edgeWalk.
// 1ff8:293d edgeVertical (dx = 0): rows min(y)..max(y), x constant. 2957 is a dead RET after the JMP.
export function f1ff8_293d(bx,bp,cx,si){
 let t;if(!(s16(cx)>s16(si))){t=si;si=cx;cx=t;}
 const di=si,ch=u8(cx-si+1);
 return f1ff8_2a29(bp,di,ch,2,0,0,0);
}
// 1ff8:2958 edgeSteep (dx < dy): from the left point toward the right one, F = ((dx+1)<<16)/(dy+1), I = 0.
// 298a is a dead RET.
export function f1ff8_2958(bx,bp,cx,si){
 let t;if(!(s16(bx)<s16(bp))){t=bp;bp=bx;bx=t;t=si;si=cx;cx=t;}
 const di=cx,d=s16(si-cx),dy=u16(Math.abs(d)),neg=d<0;
 const ch=u8(dy+1),cl=u8(2+(neg?0xf8:0));
 const dx1=u16(bp-bx+1),dy1=u16(dy+1);
 const f=div32_16(dx1*65536,dy1);
 return f1ff8_2a29(bx,di,ch,cl,f,0,f);
}
// 1ff8:298b edgeDiagonal (dx = dy): from the upper point, x +-1 per row. 29b0 is a dead RET.
export function f1ff8_298b(bx,bp,cx,si){
 let t;if(!(s16(cx)<s16(si))){t=bp;bp=bx;bx=t;t=si;si=cx;cx=t;}
 const di=cx,ch=u8(u16(-(cx-si))+1);
 const step=s16(bx)<s16(bp)?1:0xffff;
 return f1ff8_2a29(bx,di,ch,2,0,step,0);
}
// 1ff8:29b1 edgeShallowRight (dx > dy, right word): from the right point; step -(I+(F!=0)), acc0 = -F.
// 29ed is a dead RET.
export function f1ff8_29b1(bx,bp,cx,si){
 let t;if(!(s16(bx)>s16(bp))){t=bp;bp=bx;bx=t;t=si;si=cx;cx=t;}
 const di=cx,d=s16(si-cx),dy=u16(Math.abs(d)),neg=d<0;
 const ch=u8(dy+1),cl=u8((neg?0xf8:0)+2);
 const ax0=bp,dy1=u16(dy+1),dx1=u16(-(ax0-bx)+1);
 const i=div32_16(dx1,dy1),r=mod32_16(dx1,dy1);
 const f=div32_16(r*65536,dy1);
 const nf=u16(-f),is=u16(-(i+(f?1:0)));
 return f1ff8_2a29(bx,di,ch,cl,nf,is,nf);
}
// 1ff8:29ee edgeShallowLeft (dx > dy, left word): from the left point; I = (dx+1)/(dy+1), F = rem<<16/(dy+1).
// 2a21 is a dead RET; 2a22 is an unreachable copy of one table block.
export function f1ff8_29ee(bx,bp,cx,si){
 let t;if(!(s16(bx)<s16(bp))){t=bp;bp=bx;bx=t;t=si;si=cx;cx=t;}
 const di=cx,d=s16(si-cx),dy=u16(Math.abs(d)),neg=d<0;
 const ch=u8(dy+1),cl=u8((neg?0xf8:0)+2);
 const dx1=u16(bp-bx+1),dy1=u16(dy+1);
 const i=div32_16(dx1,dy1),r=mod32_16(dx1,dy1);
 const f=div32_16(r*65536,dy1);
 return f1ff8_2a29(bx,di,ch,cl,f,i,f);
}

// 1ff8:256d drawPolygon(n, xs, ys): outline ([384c]=0) or filled convex polygon. Returns the span
// header pointer [49d2] (filled and drawn) or 0.
export function f1ff8_256d(n,xs,ys){
 ww(0x49d2,0);
 n=s16(n);
 if(n<0)return rw(0x49d2); // QUIRK: no copy; AX<2 path returns 0
 ww(CNT,n);
 for(let i=0;i<n;i++){ww(PX+2*i,rw(xs+2*i));ww(PY+2*i,rw(ys+2*i));}
 if(n<2)return rw(0x49d2);
 if(n===2){f1ff8_2926(PX,PY,1);return rw(0x49d2);}
 if(!rb(FILL)){
  ww(PX+2*n,rw(PX));ww(PY+2*n,rw(PY));
  f1ff8_2926(PX,PY,n);return rw(0x49d2);
 }
 if(rb(LINEC)!==rb(FILLC)){
  // Save the closed (unclipped) polygon, n+1 points, for the outline pass.
  ww(0x49d4,n);
  for(let i=0;i<n;i++){ww(OX+2*i,rw(PX+2*i));ww(OY+2*i,rw(PY+2*i));}
  ww(OX+2*n,rw(PX));ww(OY+2*n,rw(PY));
 }
 if(rb(CLIP))f1ff8_4df6();
 let cnt=rsw(CNT);
 if(cnt===2){f1ff8_2926(PX,PY,1);return rw(0x49d2);}
 if(cnt<2)return rw(0x49d2);
 // 2616: walk vertices count-1..0, dropping repeats of the previously kept vertex (initially vertex 0);
 // kept ones go to 393c/3964 in reverse order. Track top (min y, tie: larger x) and bottom (max y, tie: <= x).
 let si=u16((cnt-1)*2),di=0;
 ww(0x49d0,rw(PY));ww(0x49ce,rw(PX));
 let dxMin=0x7fff,bxMax=-0x7fff,bpXb=0x7fff,cxXt=-0x7fff;
 ww(0x49c0,0);ww(0x49c2,0);
 for(;;){
  const y=rsw(PY+si),x=rsw(PX+si);
  if(!(y===rsw(0x49d0)&&x===rsw(0x49ce))){
   ww(0x49d0,y);ww(TY+di,y);
   if(y<dxMin||(y===dxMin&&x>cxXt)){ww(0x49c0,di);dxMin=y;cxXt=x;}
   if(y>bxMax||(y===bxMax&&x<=bpXb)){ww(0x49c2,di);bxMax=y;bpXb=x;}
   ww(0x49ce,x);ww(TX+di,x);di+=2;
  }
  si=s16(si-2);if(si<0)break;
 }
 if(dxMin===bxMax){f1ff8_2454(bpXb,bxMax,cxXt,dxMin);return rw(0x49d2);}
 const kept=di>>1;
 if(kept===2){f1ff8_2454(bpXb,bxMax,cxXt,dxMin);return rw(0x49d2);}
 if(kept<2)return rw(0x49d2);
 let cx=di;ww(CNT,kept);
 // 26c0 orientation: a = next after top, b = previous.
 si=rw(0x49c0);
 let dI=si+2;if(!(dI<cx))dI=0;
 let dxn=u16(rw(TX+dI)-rw(TX+si)),dyn=u16(rw(TY+dI)-rw(TY+si));
 if(!dyn){dyn=1;dxn=s16(dxn)<0?0x8001:0x7fff;}
 dI=si-2;if(dI<0)dI+=cx;
 let dxp=u16(rw(TX+dI)-rw(TX+si)),dyp=u16(rw(TY+dI)-rw(TY+si));
 if(!dyp){dyp=1;dxp=s16(dxp)<0?0x8001:0x7fff;}
 let reverse;
 if(s16(dxp)<0){
  if(s16(dxn)>=0)reverse=false;
  else{let t=u16(-dxn);dxn=u16(-dxp);dxp=t;t=dyp;dyp=dyn;dyn=t;reverse=cmpSlopes(dxp,dyp,dxn,dyn);}
 }else{
  if(s16(dxn)<=0)reverse=true;
  else reverse=cmpSlopes(dxp,dyp,dxn,dyn);
 }
 if(!reverse){
  for(let i=0;i<cx>>1;i++){ww(PX+2*i,rw(TX+2*i));ww(PY+2*i,rw(TY+2*i));}
 }else{
  for(let i=0;i<cx>>1;i++){ww(PX+cx-2-2*i,rw(TX+2*i));ww(PY+cx-2-2*i,rw(TY+2*i));}
  const dd=u16(cx-2);ww(0x49c0,u16(dd-rw(0x49c0)));ww(0x49c2,u16(dd-rw(0x49c2)));
 }
 // 27a8 chain 1: from top forward (wrapping) until y >= bottomY.
 let dyB=rsw(PY+rw(0x49c2));si=rw(0x49c0);di=0;
 for(;;){const y=rsw(PY+si);ww(TX+di,rw(PX+si));ww(TY+di,y);di+=2;if(!(y<dyB))break;si+=2;if(!(si<cx))si=0;}
 ww(0x49c4,di>>1);
 // chain 2: from bottom forward until y <= topY.
 const dyT=rsw(PY+rw(0x49c0));si=rw(0x49c2);
 for(;;){const y=rsw(PY+si);ww(TX+di,rw(PX+si));ww(TY+di,y);di+=2;if(!(y>dyT))break;si+=2;if(!(si<cx))si=0;}
 ww(0x49c6,u16((di>>1)-rw(0x49c4)));
 // Edges: chain 1 writes the right word (+2), chain 2 the left word (+0).
 ww(0x49cc,2);ww(0x49ca,0);
 let n2=rw(0x49c4);
 for(;;){
  n2=u16(n2-1);
  if(!n2){
   if(!rw(0x49cc))break;
   ww(0x49ca,u16(rw(0x49ca)+2));ww(0x49cc,0);n2=rw(0x49c6);continue;
  }
  ww(0x49c8,n2);
  const e=rw(0x49ca);ww(0x49ca,u16(e+2));
  const bx=rw(TX+e),bp=rw(TX+e+2),ecx=rw(TY+e),esi=rw(TY+e+2);
  const adx=u16(Math.abs(s16(bx-bp)));
  if(!adx){f1ff8_293d(bx,bp,ecx,esi);n2=rw(0x49c8);continue;}
  const ady=u16(Math.abs(s16(ecx-esi)));
  if(!ady){
   // 288c: one store at row ya; right word max x, left word min x.
   let lo=bx,hi=bp;if(!(s16(bx)<s16(bp))){lo=bp;hi=bx;}
   const w=rw(0x49cc);fww(SPANSEG,(ecx<<2)+w,w?hi:lo);n2=rw(0x49c8);continue;
  }
  if(s16(adx)<s16(ady))f1ff8_2958(bx,bp,ecx,esi);
  else if(s16(adx)>s16(ady)){if(rw(0x49cc))f1ff8_29b1(bx,bp,ecx,esi);else f1ff8_29ee(bx,bp,ecx,esi);}
  else f1ff8_298b(bx,bp,ecx,esi);
  n2=rw(0x49c8);
 }
 // 28d5: span header at DS:(39fe&fff0)+4*(topY-1) = {topY, bottomY-topY+1}; slot 27.
 const top=rw(PY+rw(0x49c0));
 const hdr=u16(((top-1)<<2)+0x39f0);
 ww(0x49d2,hdr);ww(hdr,top);ww(hdr+2,u16(rw(PY+rw(0x49c2))-top+1));
 callFar(slot(27),{si:hdr});
 if(rb(LINEC)!==rb(FILLC))f1ff8_2926(OX,OY,rw(0x49d4));
 return rw(0x49d2);
}
// 2727: compares next slope dxn/dyn with previous dxp/dyp as unsigned 16.16 quotients; true = reverse.
function cmpSlopes(dxp,dyp,dxn,dyn){
 const qp=div32_16(dxp,dyp),rp=mod32_16(dxp,dyp),qn=div32_16(dxn,dyn),rn=mod32_16(dxn,dyn);
 if(qn>qp)return false;
 if(qn<qp)return true;
 const fn=div32_16(rn*65536,dyn),fp_=div32_16(rp*65536,dyp);
 return fn<fp_;
}

// One clipping pass of 1ff8:4df6. A = clipped coordinate, B = the other one.
// Intersection based on Q toward R: A = V, B = B[Q] + (B[R]-B[Q])*(V-A[Q]) / (A[R]-A[Q]) (16-bit IMUL/IDIV).
function clipPass(sA,sB,dA,dB,lo,hi,bLo,bHi){
 const cnt=rw(CNT);
 const code=i=>{const a=rsw(sA+i);let c=0;if(a<rsw(lo))c|=bLo;if(a>rsw(hi))c|=bHi;return c;};
 let di=0;
 const emit=(a,b)=>{ww(dA+di,a);ww(dB+di,b);di=u16(di+2);};
 const isect=(q,r,v)=>{const V=rw(v);ww(dA+di,V);const b=u16(rw(sB+q)+muldiv(rw(sB+r)-rw(sB+q),V-rw(sA+q),rw(sA+r)-rw(sA+q)));ww(dB+di,b);di=u16(di+2);};
 let bx=u16((cnt-1)*2),cl=code(bx);
 for(let i=0;;){
  const si=u16(i*2),ch=code(si);
  if(!(cl|ch))emit(rw(sA+si),rw(sB+si));
  else if(!(cl&ch)){
   if(!cl){if(ch&bLo)isect(si,bx,lo);else if(ch&bHi)isect(si,bx,hi);}
   else if(!ch){if(cl&bLo)isect(bx,si,lo);else if(cl&bHi)isect(bx,si,hi);emit(rw(sA+si),rw(sB+si));}
   else{
    if(cl&bLo)isect(bx,si,lo);else if(cl&bHi)isect(bx,si,hi);
    if(ch&bLo)isect(si,bx,lo);else if(ch&bHi)isect(si,bx,hi);
   }
  }
  bx=si;cl=ch;i++;
  if(i===cnt)break;
 }
 return di;
}
// 1ff8:4df6 clipPolygon: clips DS:38ec/3914 (count [39dc]) to the clip box; pass x into 393c/3964,
// pass y back into 38ec/3914. Signed compares. QUIRK: no bound on the output size (can overrun 20 entries).
export function f1ff8_4df6(){
 if(!(rsw(CNT)>1))return;
 let di=clipPass(PX,PY,TX,TY,XMIN,XMAX,1,2);
 let n=di>>1;ww(CNT,n);
 if(!(s16(n)>1)){
  // 526a: copy the pass-x result back.
  for(let i=0;i<rw(CNT);i++){ww(PX+2*i,rw(TX+2*i));ww(PY+2*i,rw(TY+2*i));}
  return;
 }
 di=clipPass(TY,TX,PY,PX,YMIN,YMAX,8,4);
 ww(CNT,di>>1);
}

export {f1ff8_2454 as drawLine,f1ff8_256d as drawPolygon,f1ff8_4df6 as clipPolygon,f1ff8_255d as fillSpans};
provide({f1ff8_2454,f1ff8_255d,f1ff8_256d,f1ff8_2926,f1ff8_2a29,f1ff8_293d,f1ff8_2958,f1ff8_298b,f1ff8_29b1,f1ff8_29ee,f1ff8_4df6});
