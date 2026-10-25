// Minimal 8086 interpreter used as a differential oracle for translated asm: it executes the original bytes from the
// loaded image (never copied into source), so a translation can be checked against the instructions themselves.
// Covers the integer subset used by the CGA driver (segment 2fd2); an unknown opcode throws.
import {B} from '../src/engine/mem.js';

const M16=0xffff;
const PAR=(()=>{const t=new Uint8Array(256);for(let i=0;i<256;i++){let n=0;for(let b=i;b;b>>=1)n^=b&1;t[i]=n^1;}return t;})();
export class Cpu{
 constructor(){
  this.r=new Uint16Array(8); // ax cx dx bx sp bp si di
  this.s=new Uint16Array(4); // es cs ss ds
  this.ip=0;this.cf=0;this.zf=0;this.sf=0;this.of=0;this.pf=0;this.df=0;this.steps=0;
 }
}
const AX=0,CX=1,DX=2,BX=3,SP=4,BP=5,SI=6,DI=7,ES=0,CS=1,SS=2,DS=3;
const lin=(s,o)=>((s<<4)+(o&M16))&0xfffff;
// hooks: {far(cpu,seg,off), int(cpu,n)}: called for CALL FAR to another segment (the return address is already pushed; the hook
// emulates the callee and pops it) and for INT n (the hook emulates the handler). CALL FAR within the current segment just jumps.
export function run(cpu,hooks,{stop=0xdead,max=2e6}={}){
 const r=cpu.r,s=cpu.s;
 const rb=(sg,o)=>B[lin(sg,o)], rw=(sg,o)=>B[lin(sg,o)]|B[lin(sg,o+1)]<<8;
 const wb=(sg,o,v)=>{B[lin(sg,o)]=v;}, ww=(sg,o,v)=>{B[lin(sg,o)]=v;B[lin(sg,o+1)]=v>>8;};
 const fetch=()=>B[lin(s[CS],cpu.ip++)&0xfffff];
 const fetch16=()=>{const a=fetch();return a|fetch()<<8;};
 const push=v=>{r[SP]-=2;ww(s[SS],r[SP],v);};
 const pop=()=>{const v=rw(s[SS],r[SP]);r[SP]+=2;return v;};
 // register access by size
 const getR=(i,w)=>w?r[i]:(i<4?r[i]&0xff:r[i-4]>>8);
 const setR=(i,w,v)=>{if(w)r[i]=v;else if(i<4)r[i]=r[i]&0xff00|v&0xff;else r[i-4]=r[i-4]&0xff|(v&0xff)<<8;};
 let seg=-1;
 let ea,eaSeg,mod,rm,regf;
 function modrm(){
  const b=fetch();mod=b>>6;regf=b>>3&7;rm=b&7;
  if(mod===3){ea=-1;return;}
  let o=0,dseg=DS;
  switch(rm){case 0:o=r[BX]+r[SI];break;case 1:o=r[BX]+r[DI];break;case 2:o=r[BP]+r[SI];dseg=SS;break;case 3:o=r[BP]+r[DI];dseg=SS;break;
   case 4:o=r[SI];break;case 5:o=r[DI];break;case 6:if(mod===0){o=fetch16();}else{o=r[BP];dseg=SS;}break;case 7:o=r[BX];break;}
  if(mod===1){o+=fetch()<<24>>24;}else if(mod===2){o+=fetch16();}
  ea=o&M16;eaSeg=seg>=0?seg:dseg;
 }
 const rdE=w=>mod===3?getR(rm,w):(w?rw(s[eaSeg],ea):rb(s[eaSeg],ea));
 const wrE=(w,v)=>{if(mod===3)setR(rm,w,v);else if(w)ww(s[eaSeg],ea,v);else wb(s[eaSeg],ea,v);};
 const flagsLogic=(v,w)=>{const m=w?0xffff:0xff;v&=m;cpu.cf=0;cpu.of=0;cpu.zf=v===0?1:0;cpu.sf=v>>(w?15:7)&1;cpu.pf=PAR[v&0xff];return v;};
 function alu(op,a,b,w){
  const m=w?0xffff:0xff,top=w?0x8000:0x80;let v;
  switch(op){
   case 0:case 2:{const c=op===2?cpu.cf:0;v=a+b+c;cpu.cf=v>m?1:0;cpu.of=(~(a^b)&(a^v)&top)?1:0;break;} // add, adc
   case 5:case 7:case 3:{const c=op===3?cpu.cf:0;v=a-b-c;cpu.cf=v<0?1:0;cpu.of=((a^b)&(a^v)&top)?1:0;break;} // sub, cmp, sbb
   case 1:return flagsLogic(a|b,w);
   case 4:return flagsLogic(a&b,w);
   case 6:return flagsLogic(a^b,w);
  }
  v&=m;cpu.zf=v===0?1:0;cpu.sf=v&top?1:0;cpu.pf=PAR[v&0xff];return v;
 }
 const incdec=(a,d,w)=>{const cf=cpu.cf;const v=alu(d>0?0:5,a,1,w);cpu.cf=cf;return v;};
 function shift(op,a,n,w){
  const bits=w?16:8,m=w?0xffff:0xff,top=1<<(bits-1);
  if(n===0)return a;
  let v=a;
  switch(op){
   case 0:for(let i=0;i<n;i++){cpu.cf=v&top?1:0;v=(v<<1|cpu.cf)&m;}cpu.of=((v&top)?1:0)^cpu.cf;return v; // rol
   case 1:for(let i=0;i<n;i++){cpu.cf=v&1;v=(v>>1|(cpu.cf?top:0))&m;}cpu.of=((v>>(bits-1))^(v>>(bits-2)))&1;return v; // ror
   case 2:for(let i=0;i<n;i++){const c=v&top?1:0;v=(v<<1|cpu.cf)&m;cpu.cf=c;}cpu.of=((v&top)?1:0)^cpu.cf;return v; // rcl
   case 3:for(let i=0;i<n;i++){const c=v&1;v=(v>>1|(cpu.cf?top:0))&m;cpu.cf=c;}cpu.of=((v>>(bits-1))^(v>>(bits-2)))&1;return v; // rcr
   case 4:case 6:{for(let i=0;i<n;i++){cpu.cf=v&top?1:0;v=(v<<1)&m;}cpu.of=((v&top)?1:0)^cpu.cf;break;} // shl
   case 5:{for(let i=0;i<n;i++){cpu.cf=v&1;v>>=1;}cpu.of=a&top?1:0;break;} // shr
   case 7:{const sg=a&top;for(let i=0;i<n;i++){cpu.cf=v&1;v=v>>1|sg;}cpu.of=0;break;} // sar
  }
  cpu.zf=v===0?1:0;cpu.sf=v&top?1:0;cpu.pf=PAR[v&0xff];return v;
 }
 const cond=c=>{
  let t;
  switch(c>>1){case 0:t=cpu.of;break;case 1:t=cpu.cf;break;case 2:t=cpu.zf;break;case 3:t=cpu.cf|cpu.zf;break;
   case 4:t=cpu.sf;break;case 5:t=cpu.pf;break;case 6:t=cpu.sf!==cpu.of?1:0;break;default:t=(cpu.zf|(cpu.sf!==cpu.of?1:0));}
  return c&1?!t:!!t;
 };
 for(;;){
  if(++cpu.steps>max)throw Error('x86mini: step limit');
  if(s[CS]===stop)return;
  seg=-1;let rep=0;
  let op=fetch();
  for(;;){
   if(op===0x26)seg=ES;else if(op===0x2e)seg=CS;else if(op===0x36)seg=SS;else if(op===0x3e)seg=DS;
   else if(op===0xf3||op===0xf2){rep=op;}else break;
   op=fetch();
  }
  const w=op&1;
  if(op<0x40&&(op&7)<6){ // ALU r/m,reg / reg,r/m / acc,imm
   const aop=op>>3&7,k=op&7;
   if(k<4){modrm();const dir=k&2,wd=k&1;
    const a=dir?getR(regf,wd):rdE(wd),b=dir?rdE(wd):getR(regf,wd);
    const v=alu(aop,a,b,wd);if(aop!==7){if(dir)setR(regf,wd,v);else wrE(wd,v);}
   }else{const wd=k&1;const b=wd?fetch16():fetch();const a=getR(0,wd);const v=alu(aop,a,b,wd);if(aop!==7)setR(0,wd,v);}
   continue;
  }
  switch(true){
   case op===0x06||op===0x0e||op===0x16||op===0x1e:push(s[op>>3]);break;
   case op===0x07||op===0x17||op===0x1f:s[op>>3]=pop();break;
   case op>=0x40&&op<0x48:r[op&7]=incdec(r[op&7],1,1);break;
   case op>=0x48&&op<0x50:r[op&7]=incdec(r[op&7],-1,1);break;
   case op>=0x50&&op<0x58:push(op===0x54?(r[SP]-2)&M16:r[op&7]);break;
   case op>=0x58&&op<0x60:r[op&7]=pop();break;
   case op>=0x70&&op<0x80:{const d=fetch()<<24>>24;if(cond(op&15))cpu.ip=cpu.ip+d&M16;break;}
   case op===0x80||op===0x81||op===0x83:{modrm();const wd=op&1;const a=rdE(wd);const b=op===0x81?fetch16():op===0x83?(fetch()<<24>>24)&0xffff&(wd?0xffff:0xff):fetch();
    const v=alu(regf,a,wd?b&0xffff:b&0xff,wd);if(regf!==7)wrE(wd,v);break;}
   case op===0x84||op===0x85:{modrm();alu(4,rdE(w),getR(regf,w),w);break;}
   case op===0x86||op===0x87:{modrm();const a=rdE(w),b=getR(regf,w);wrE(w,b);setR(regf,w,a);break;}
   case op===0x88||op===0x89:modrm();wrE(w,getR(regf,w));break;
   case op===0x8a||op===0x8b:modrm();setR(regf,w,rdE(w));break;
   case op===0x8c:modrm();wrE(1,s[regf&3]);break;
   case op===0x8e:modrm();s[regf&3]=rdE(1);break;
   case op===0x8d:modrm();r[regf]=ea;break;
   case op===0x90:break;
   case op>0x90&&op<0x98:{const t=r[AX];r[AX]=r[op&7];r[op&7]=t;break;}
   case op===0x98:r[AX]=(r[AX]&0xff)<<24>>24&0xffff;break;
   case op===0x99:r[DX]=r[AX]&0x8000?0xffff:0;break;
   case op===0x9a:{const o=fetch16(),sg=fetch16();push(s[CS]);push(cpu.ip);if(sg===s[CS])cpu.ip=o;else hooks.far(cpu,sg,o);break;}
   case op===0xa0:{const o=fetch16();setR(0,0,rb(s[seg>=0?seg:DS],o));break;}
   case op===0xa1:{const o=fetch16();r[AX]=rw(s[seg>=0?seg:DS],o);break;}
   case op===0xa2:{const o=fetch16();wb(s[seg>=0?seg:DS],o,r[AX]);break;}
   case op===0xa3:{const o=fetch16();ww(s[seg>=0?seg:DS],o,r[AX]);break;}
   case op===0xa4||op===0xa5||op===0xaa||op===0xab||op===0xac||op===0xad:{
    const wd=op&1,step=(cpu.df?-1:1)*(wd?2:1);
    const body=()=>{
     if(op<0xa6){const v=wd?rw(s[seg>=0?seg:DS],r[SI]):rb(s[seg>=0?seg:DS],r[SI]);if(wd)ww(s[ES],r[DI],v);else wb(s[ES],r[DI],v);r[SI]+=step;r[DI]+=step;}
     else if(op<0xac){if(wd)ww(s[ES],r[DI],r[AX]);else wb(s[ES],r[DI],r[AX]);r[DI]+=step;}
     else{const v=wd?rw(s[seg>=0?seg:DS],r[SI]):rb(s[seg>=0?seg:DS],r[SI]);setR(0,wd,v);r[SI]+=step;}
    };
    if(rep){while(r[CX]){body();r[CX]--;if(++cpu.steps>max)throw Error('x86mini: step limit');}}else body();
    break;}
   case op===0xa8||op===0xa9:{const b=w?fetch16():fetch();alu(4,getR(0,w),b,w);break;}
   case op>=0xb0&&op<0xb8:setR(op&7,0,fetch());break;
   case op>=0xb8&&op<0xc0:r[op&7]=fetch16();break;
   case op===0xc3:cpu.ip=pop();break;
   case op===0xcb:cpu.ip=pop();s[CS]=pop();break;
   case op===0xc6||op===0xc7:{modrm();const v=w?fetch16():fetch();wrE(w,v);break;}
   case op===0xcd:{const n=fetch();hooks.int(cpu,n);break;}
   case op>=0xd0&&op<=0xd3:{modrm();const wd=op&1;const n=op<0xd2?1:r[CX]&0xff;wrE(wd,shift(regf,rdE(wd),n,wd));break;}
   case op===0xe1||op===0xe2:{const d=fetch()<<24>>24;r[CX]--;if(r[CX]!==0&&(op===0xe2||cpu.zf))cpu.ip=cpu.ip+d&M16;break;}
   case op===0xe8:{const d=fetch16();push(cpu.ip);cpu.ip=cpu.ip+d&M16;break;}
   case op===0xe9:{const d=fetch16();cpu.ip=cpu.ip+d&M16;break;}
   case op===0xeb:{const d=fetch()<<24>>24;cpu.ip=cpu.ip+d&M16;break;}
   case op===0xf8:cpu.cf=0;break;
   case op===0xf9:cpu.cf=1;break;
   case op===0xfc:cpu.df=0;break;
   case op===0xf6||op===0xf7:{
    modrm();const a=rdE(w);
    switch(regf){
     case 0:case 1:alu(4,a,w?fetch16():fetch(),w);break;
     case 2:wrE(w,~a&(w?0xffff:0xff));break;
     case 3:{const v=alu(5,0,a,w);cpu.cf=a?1:0;wrE(w,v);break;}
     case 4:{if(w){const p=r[AX]*a;r[AX]=p&0xffff;r[DX]=p>>>16;cpu.cf=cpu.of=r[DX]?1:0;}else{const p=(r[AX]&0xff)*a;r[AX]=p;cpu.cf=cpu.of=p>>8?1:0;}break;}
     case 5:{if(w){const p=(r[AX]<<16>>16)*(a<<16>>16);r[AX]=p&0xffff;r[DX]=p>>16&0xffff;cpu.cf=cpu.of=p!==(p<<16>>16)?1:0;}else{const p=((r[AX]&0xff)<<24>>24)*(a<<24>>24);r[AX]=p&0xffff;cpu.cf=cpu.of=p!==(p<<24>>24)?1:0;}break;}
     case 6:{if(w){const n=(r[DX]*65536+r[AX]);if(!a||Math.floor(n/a)>0xffff)throw Error('x86mini: divide fault');r[AX]=Math.floor(n/a);r[DX]=n%a;}else throw Error('x86mini: byte div');break;}
     default:throw Error('x86mini: idiv');
    }
    break;}
   case op===0xfe||op===0xff:{
    modrm();
    if(regf===0||regf===1){wrE(w,incdec(rdE(w),regf?-1:1,w));}
    else if(regf===6){push(rdE(1));}
    else if(regf===4&&w){cpu.ip=rdE(1);}
    else if(regf===2&&w){const t=rdE(1);push(cpu.ip);cpu.ip=t;}
    else throw Error('x86mini: FF /'+regf);
    break;}
   default:throw Error(`x86mini: opcode ${op.toString(16)} at ${s[CS].toString(16)}:${(cpu.ip-1).toString(16)}`);
  }
 }
}
