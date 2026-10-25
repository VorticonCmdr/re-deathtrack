// Real-mode memory image. DS is fixed to DGROUP; far accessors take a segment.
// The image is loaded where DOSBox loads it (observed, docs/re/identity.md) so live dumps compare directly.
// Ghidra segment g maps to g-GHIDRA_BASE+LOAD_SEG; offsets are unchanged.
export const GHIDRA_BASE=0x1000, LOAD_SEG=0x01f5, PSP_SEG=0x01e5;
export const gseg=g=>g-GHIDRA_BASE+LOAD_SEG&0xffff, gaddr=(g,o)=>(gseg(g)<<16|o)>>>0;
export const DGROUP=gseg(0x36fa);
export const B=new Uint8Array(0x110000);
const D=DGROUP*16, lin=(s,o)=>(s<<4)+(o&0xffff);
export const rb=o=>B[D+(o&0xffff)];
export const rsb=o=>B[D+(o&0xffff)]<<24>>24;
export const rw=o=>B[D+(o&0xffff)]|B[D+(o+1&0xffff)]<<8;
export const rsw=o=>(B[D+(o&0xffff)]|B[D+(o+1&0xffff)]<<8)<<16>>16;
export const rd=o=>(rw(o)|rw(o+2)<<16)>>>0;
export const rsd=o=>rw(o)|rw(o+2)<<16;
export const wb=(o,v)=>{B[D+(o&0xffff)]=v;};
export const ww=(o,v)=>{B[D+(o&0xffff)]=v;B[D+(o+1&0xffff)]=v>>8;};
export const wd=(o,v)=>{ww(o,v);ww(o+2,v>>>16);};
export const frb=(s,o)=>B[lin(s,o)];
export const frsb=(s,o)=>B[lin(s,o)]<<24>>24;
export const frw=(s,o)=>B[lin(s,o)]|B[lin(s,o+1)]<<8;
export const frsw=(s,o)=>frw(s,o)<<16>>16;
export const frd=(s,o)=>(frw(s,o)|frw(s,o+2)<<16)>>>0;
export const frsd=(s,o)=>frw(s,o)|frw(s,o+2)<<16;
export const fwb=(s,o,v)=>{B[lin(s,o)]=v;};
export const fww=(s,o,v)=>{B[lin(s,o)]=v;B[lin(s,o+1)]=v>>8;};
export const fwd=(s,o,v)=>{fww(s,o,v);fww(s,o+2,v>>>16);};
export const fp=(s,o)=>((s&0xffff)<<16|o&0xffff)>>>0;
export const pseg=p=>p>>>16, poff=p=>p&0xffff;
// Far pointer arithmetic on the offset only, as MSC far (not huge) pointers do.
export const padd=(p,n)=>fp(p>>>16,(p&0xffff)+n);
// Stack memory for address-taken locals; SS=DS, top from the EXE header.
// SP after the MSC start-up aligns the stack (1000:d39c); the near heap begins here too.
export const STACK_TOP=0xba3e;
let SP=STACK_TOP;
export const salloc=n=>{SP-=n+1&~1;if(SP<0x9000)throw Error('Emulated stack overflow');return SP;};
export const sfree=n=>{SP+=n+1&~1;if(SP>STACK_TOP)throw Error('Emulated stack underflow');};
export const stackDepth=()=>STACK_TOP-SP;
export const resetStack=()=>{SP=STACK_TOP;};
export const setStack=v=>{SP=v;};
// C strings in DGROUP / far memory.
export const strAt=(o,max=4096)=>{let s='';for(let i=0;i<max;i++){const c=rb(o+i);if(!c)break;s+=String.fromCharCode(c);}return s;};
export const fstrAt=(s,o,max=4096)=>{let r='';for(let i=0;i<max;i++){const c=frb(s,o+i);if(!c)break;r+=String.fromCharCode(c);}return r;};
export const putStr=(o,str)=>{for(let i=0;i<str.length;i++)wb(o+i,str.charCodeAt(i));wb(o+str.length,0);};
