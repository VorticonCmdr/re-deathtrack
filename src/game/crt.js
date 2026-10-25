// Microsoft C 5.1 runtime used by DTRACK.EXE (1000:c000-ffff), translated over DGROUP near pointers.
// Heap, _iob FILE structs, _osfile and errno live at their original DS offsets (docs/re/resources.md
// "C runtime services"), so stored pointers and heap addresses match the original.
// Exported fXXXX_YYYY functions take one parameter per pushed word (a long is (lo, hi), a far pointer
// (off, seg)) and return DX:AX results as one packed unsigned number (DX<<16|AX)>>>0.
// Internal helpers (lseek32, ftell32, fseek32) work on signed 32-bit longs.
import {rb,wb,rw,ww,frb,fwb,frw,fww,fp,pseg,poff,gseg,gaddr,salloc,sfree,DGROUP,PSP_SEG,STACK_TOP,stackDepth,fstrAt} from '../engine/mem.js';
import {s16,u16,s32,u32,lmul,ldiv,lmod,uldiv,ulmod,lshr,div16,DivideError} from '../engine/int.js';
import {register,callFar,record,unsupported} from '../engine/host.js';
import {int21} from './bios.js';
import {F,provide} from './link.js';

// ---- helpers ----
const DOSV=0x53eb, ERRNO=0x53e3, DOSERR=0x53ee, NFILE=0x53f0, OSFILE=0x53f2, IOB=0x5446, IOB2=0x54e6, LASTIOB=0x555e;
const i2of=f=>IOB2+(s16(f-IOB)>>3)*6&0xffff;            // &_iob2[fp-_iob]
const bufOwned=f=>(rb(f+6)&0x0c)!==0||(rb(i2of(f))&1)!==0; // _IOMYBUF|_IONBF or _IOYOURBUF
const fileOf=f=>s16(rb(f+7)<<24>>24);
// INT 21h with DS = DGROUP unless given.
function dos(ax,o={}){const r={ax:ax&0xffff,bx:0,cx:0,dx:0,si:0,di:0,ds:DGROUP,es:DGROUP,...o};int21(r);r.cf=r.cf?1:0;return r;}
const L=(lo,hi)=>(lo&0xffff|(hi&0xffff)<<16)|0;
// Real SP at the end of C startup: EXE SP 0xfa0 + 0xaa9e, made even (1000:d3bb-d3d2).
const START_SP=0xba3e;
const curSP=()=>STACK_TOP-stackDepth()&0xffff;

// 1000:ed62 _dosmaperr: AL = DOS error, AH != 0 is taken as errno directly.
export function f1000_ed62(ax){
 let al=ax&0xff;const ah=ax>>8&0xff;wb(DOSERR,al);
 if(ah){ww(ERRNO,s16((ah<<24>>24)));return;}
 if(rb(DOSV)>=3&&al<0x22){if(al>=0x20)al=5;else if(al>0x13)al=0x13;}
 else if(rb(DOSV)>=3)al=0x13;
 else if(al>0x13)al=0x13;
 ww(ERRNO,s16(rb(0x5432+al)<<24>>24));
}
// 1000:ed4f / ed3c / ed5c shared epilogues: CF -> errno and -1 (AX=DX=-1) / 0 or -1 / errno only.
const ed4f=r=>{if(r.cf){f1000_ed62(r.ax);return -1;}return null;};
export function f1000_ed5c(ax){f1000_ed62(ax&0xff);}

// ---- string functions (existing API kept) ----
// 1000:c058 strlen
export function strlen(s){let n=0;while(rb(s+n))n++;return n;}
// 1000:c2ce strcpy(dst,src) -> dst
export function strcpy(d,s){let i=0;for(;;i++){const c=rb(s+i);wb(d+i,c);if(!c)break;}return d;}
// 1000:c298 strcat(dst,src) -> dst
export function strcat(d,s){strcpy(d+strlen(d),s);return d;}
// 1000:c2f6 -> 1000:e4da strchr(s,c): first occurrence including the terminator, else 0.
// (resources.md calls e4da strrchr; the code scans forward: REPNE SCASB over strlen+1 bytes.)
export function strchr(s,c){c&=0xff;for(let i=0;;i++){const v=rb(s+i);if(v===c)return s+i&0xffff;if(!v)return 0;}}
// 1000:c10c strcmp(a,b): -1/0/1 from unsigned byte comparison
export function strcmp(a,b){for(let i=0;;i++){const x=rb(a+i),y=rb(b+i);if(x!==y)return x<y?-1:1;if(!x)return 0;}}
// 1000:c132 -> 1000:e504 stricmp(a,b): folds A-Z to lower case, -1/0/1
export function stricmp(a,b){
 const f=c=>c>=0x41&&c<=0x5a?c+0x20:c;
 for(let i=0;;i++){const x=rb(a+i),y=rb(b+i);if(x===y){if(!x)return 0;continue;}const fx=f(x),fy=f(y);if(fx!==fy)return fx<fy?-1:1;if(!x)return 0;}
}
// 1000:a3ca rand: additive lagged-Fibonacci over the 56-word table at DS:215a, indices at DS:2154/2156.
export function rand(){
 let bx=rw(0x2154),si=rw(0x2156);
 const v=rw(bx+0x215a)+rw(si+0x215a)&0xffff;
 ww(si+0x215a,v);ww(0x2158,v);
 bx=bx-2&0xffff;if(bx&0x8000)bx=0x6e;ww(0x2154,bx);
 si=si-2&0xffff;if(si&0x8000)si=0x6e;ww(0x2156,si);
 return v;
}
// 1000:a403 srand-equivalent: resets the table indices only (the table keeps its state).
export function randReset(){ww(0x2154,0x30);ww(0x2156,0x6e);}
export {rand as f1000_a3ca,randReset as f1000_a403};

// Word-wise forward copy as REP MOVSW + MOVSB (inline strcpy/strcat in the thunks).
function movs(d,s,n){for(let i=0;i<n>>1;i++){ww(d,rw(s));d+=2;s+=2;}if(n&1)wb(d,rb(s));}

// ---- far thunks 1000:c000-c34x ----
// 1000:c00e floppyMotorOffWait (near): if [385c]==0, 0:0440=1, then poll 0:043F&3 up to 20*65535 times.
export function f1000_c00e(){
 if(rb(0x385c)!==0)return;
 fwb(0,0x440,1);
 for(let dx=0x14;dx;dx--)for(let cx=0xffff;cx;cx--)if((frb(0,0x43f)&3)===0)return;
}
// 1000:c03e -> 1000:4808 (game drawing helper, 5 word args)
export function f1000_c03e(a,b,c,d,e){return F.f1000_4808(a,b,c,d,e);}
// 1000:c058 strlen (inline REPNE SCASB)
export function f1000_c058(s){return strlen(s)&0xffff;}
// 1000:c070 delayTicksFar(n) -> 1000:a3aa
export function* f1000_c070(n){yield* F.f1000_a3aa(n);}
// 1000:c080 uldiv / c094 lmul / c0a8 ulmod far wrappers (alo, ahi, blo, bhi)
export function f1000_c080(a,b,c,d){return f1000_e9c0(a,b,c,d);}
export function f1000_c094(a,b,c,d){return f1000_e8a8(a,b,c,d);}
export function f1000_c0a8(a,b,c,d){return f1000_ea22(a,b,c,d);}
// 1000:c0bc / c144 rand far wrappers
export function f1000_c0bc(){return rand();}
export function f1000_c144(){return rand();}
// 1000:c0c0 -> 1000:4d06 (game code, 3 args); c0f4 -> 1000:4bd4 (4 args); c156 -> 1000:031a
export function f1000_c0c0(a,b,c){return F.f1000_4d06(a,b,c);}
export function f1000_c0f4(a,b,c,d){return F.f1000_4bd4(a,b,c,d);}
export function f1000_c156(){return F.f1000_031a();}
// 1000:c0d4 chdir -> e70b; c0e2 getcwd -> e740
export function f1000_c0d4(p){return f1000_e70b(p);}
export function f1000_c0e2(buf,n){return f1000_e740(buf,n);}
// 1000:c10c strcmp (inline)
export function f1000_c10c(a,b){return strcmp(a,b);}
// 1000:c132 stricmp -> e504
export function f1000_c132(a,b){return f1000_e504(a,b);}
// 1000:c148 abs(int): abs(-32768) = -32768
export function f1000_c148(v){v=s16(v);return s16(v<0?-v:v);}
// 1000:c15a open(path,oflag) / c16c open(path,oflag,pmode) / c180 close / c18e read / c1ee lseek. No callers.
export function f1000_c15a(p,o){return f1000_daa4(p,o,undefined);}
export function f1000_c16c(p,o,m){return f1000_daa4(p,o,m);}
export function f1000_c180(h){return f1000_da0a(h);}
export function f1000_c18e(h,b,n){return f1000_dc48(h,b,n);}
export function f1000_c1ee(h,lo,hi,w){return lseek32(h,lo,hi,w);}
// 1000:c1a2 fopenRetry(name, mode): fopen; while NULL and [1fba] != 0: [a462]++ and retry with no limit.
export function f1000_c1a2(name,mode){
 for(;;){
  const f=f1000_d678(name,mode);
  if(rw(0x1fba)===0||f!==0)return f;
  ww(0xa462,rw(0xa462)+1);
  // The original retries forever without yielding (an "insert disk" hang); report it instead.
  unsupported(`1000:c1a2 fopen retry loop for ${JSON.stringify(strAtDs(name))}`);
  return 0;
 }
}
const strAtDs=o=>fstrAt(DGROUP,o,128);
// 1000:c1d6 fseek -> df34; c206 ftell -> e1d4; c214 fread -> d6a0; c22c fwrite -> d886
export function f1000_c1d6(f,lo,hi,w){return f1000_df34(f,lo,hi,w);}
export function f1000_c206(f){return f1000_e1d4(f);}
export function f1000_c214(b,s,n,f){return f1000_d6a0(b,s,n,f);}
export function f1000_c22c(b,s,n,f){return f1000_d886(b,s,n,f);}
// 1000:c244 fputc -> d9c2; c256 rewind -> e350; c264 fclose -> d5be; c272 malloc -> de60
export function f1000_c244(c,f){return f1000_d9c2(c,f);}
export function f1000_c256(f){return f1000_e350(f);}
export function f1000_c264(f){return f1000_d5be(f);}
export function f1000_c272(n){return f1000_de60(n);}
// 1000:c280 free(p), then malloc(0xffff) with the result discarded (resources.md translation notes).
export function f1000_c280(p){f1000_de4e(p);f1000_de60(0xffff);}
// 1000:c298 strcat (inline: REP MOVSW/MOVSB of strlen(src)+1 bytes onto the terminator) -> dst
export function f1000_c298(d,s){const n=strlen(s)+1,e=d+strlen(d)&0xffff;movs(e,s,n);return d&0xffff;}
// 1000:c2ce strcpy (inline) -> dst
export function f1000_c2ce(d,s){movs(d,s,strlen(s)+1);return d&0xffff;}
// 1000:c2f6 -> e4da strchr
export function f1000_c2f6(s,c){return f1000_e4da(s,c);}
// 1000:c308 calloc -> dea6; c31a fgetc -> d9ea
export function f1000_c308(n,sz){return f1000_dea6(n,sz);}
export function f1000_c31a(f){return f1000_d9ea(f);}

// ---- C startup and exit ----
// 1000:d39c entry: DOS version check, program block resize, BSS clear, _cinit, _setenvp, _setargv, main, exit.
export function* f1000_d39c(){
 const v=dos(0x3000);
 if((v.ax&0xff)<2)throw Error('1000:d3a4 DOS 1.x: INT 20h');
 let si=frw(PSP_SEG,2)-DGROUP&0xffff;
 if(si>=0x1000)si=0x1000;
 // SS = DGROUP, SP = 0xba3e. APPROX: the emulated stack (mem.js STACK_TOP) is aligned down to it here.
 if(curSP()>START_SP)salloc(curSP()-START_SP);
 ww(0x5378,START_SP);ww(0x5374,START_SP);
 ww(0x5372,(si<<4)-1);
 si=si+DGROUP&0xffff;fww(PSP_SEG,2,si);
 dos(0x4a00,{es:PSP_SEG,bx:si-PSP_SEG&0xffff});
 ww(0x53e9,PSP_SEG);
 for(let o=0x5782;o<0xaaa0;o++)wb(o,0);
 f1000_d44e();
 f1000_ec7a();
 f1000_eaec();
 const r=yield* F.f1000_0010(rw(0x5406),rw(0x5408),rw(0x540a));
 f1000_d512(r);
}
// 1000:d430 INT 0 handler (R6003 integer divide by 0). The port raises DivideError instead; kept for the vector.
export function f1000_d430(){ww(0x5376,0xd512);f1000_ea8e();f1000_ed13(3);f1000_d512(0xff);}
// 1000:d43f fatal runtime error (AX = message number): banner, message, exit(255) through [5376].
export function f1000_d43f(code){
 ww(0x5376,0xd512);f1000_ea8e();f1000_ed13(code);
 callFar(gaddr(0x1000,rw(0x5376)),0xff);
 throw Error(`1000:d43f fatal R60${String(code).padStart(2,'0')} returned`);
}
// 1000:d44e _cinit (part): DOS version, hook INT 0, FP init hook, _C_FILE_INFO, device flags, init tables.
export function f1000_d44e(){
 ww(DOSV,dos(0x3000).ax);
 const r=dos(0x3500);ww(0x53d7,r.bx);ww(0x53d9,r.es);
 dos(0x2500,{ds:gseg(0x1000),dx:0xd430});
 if(rw(0x569a)!==0){
  // Floating-point emulator init through [5698]; [569a] is 0 in this build (static).
  unsupported('1000:d485 floating-point initialiser');
 }
 const env=frw(rw(0x53e9),0x2c);
 if(env){
  // Look for ";C_FILE_INFO" ... in the environment (12 bytes at DS:53ca) and copy its handle flags.
  let di=0;
  outer:for(;;){
   if(frb(env,di)===0)break;
   let eq=true;for(let k=0;k<12;k++)if(frb(env,di+k)!==rb(0x53ca+k)){eq=false;di=di+k+1;break;}
   if(eq){
    di+=12;let si=di;const n=frb(env,si)<<24>>24;si++;let cx=n&0xffff,o=OSFILE;
    do{let al=frb(env,si++);al=al+1&0xff;if(al!==0)al=al-1&0xff;wb(o++,al);cx=cx-1&0xffff;}while(cx);
    break;
   }
   // REPNE SCASB to the end of this string (from the mismatch position)
   for(let k=0;k<0x7fff;k++){if(frb(env,di-1)===0)break;if(frb(env,di++)===0)break;}
   if(frb(env,di-1)!==0)break outer;
  }
 }
 for(let bx=4;bx>=0;bx--){
  wb(bx+OSFILE,rb(bx+OSFILE)&0xbf);
  const q=dos(0x4400,{bx});
  if(!q.cf&&(q.dx&0x80))wb(bx+OSFILE,rb(bx+OSFILE)|0x40);
 }
 f1000_d5aa(0x56a4,0x56a4);f1000_d59b(0x56a4,0x56a4);
}
// 1000:d512 exit(code): onexit/near terminator tables (56a4 holds _endstdio 1000:ff54), then _exit.
export function f1000_d512(code){f1000_d59b(0x5bfa,0x5bfa);f1000_d59b(0x56a4,0x56a6);return d52c(code);}
// 1000:d529 _exit-like entry without the terminator tables.
export function f1000_d529(code){return d52c(code);}
function d52c(code){
 f1000_d59b(0x56a6,0x56a6);f1000_d5aa(0x56a6,0x56a6);
 if(f1000_eaca()!==0&&(code&0xffff)===0)code=0xff;
 for(let bx=5,cx=0xf;cx;cx--,bx++)if(rb(bx+OSFILE)&1)dos(0x3e00,{bx});
 f1000_d56e();
 dos(0x4c00|code&0xff);
 throw Error('1000:d56c INT 21h AH=4Ch returned');
}
// 1000:d56e _ctermsub: FP terminator, restore INT 0 and the optional saved vector at 5414.
export function f1000_d56e(){
 if(rw(0x569a)!==0)unsupported('1000:d577 floating-point terminator');
 dos(0x2500,{ds:rw(0x53d9),dx:rw(0x53d7)});
 if(rb(0x5414)!==0)dos(0x2500|rb(0x5415),{ds:rw(0x5418),dx:rw(0x5416)});
}
// 1000:d59b call the near function pointers in [si, di) backwards (null entries skipped).
// Indirect: targets are near functions in segment 1000 (the only one in this build is ff54).
export function f1000_d59b(si,di){while(si<di){di-=2;const cx=rw(di);if(cx)callFar(gaddr(0x1000,cx));}}
// 1000:d5aa call the far function pointers in [si, di) backwards. Empty in this build.
export function f1000_d5aa(si,di){while(si<di){di-=4;const p=fp(rw(di+2),rw(di));if(p)callFar(p);}}
// 1000:ea8e runtime-error banner: message 0xfc, optional hook [542c], message 0xff.
export function f1000_ea8e(){
 f1000_ed13(0xfc);
 if(rw(0x542c)!==0)callFar(gaddr(0x1000,rw(0x542c)));
 f1000_ed13(0xff);
}
// 1000:eaae R6002 (floating point not loaded)
export function f1000_eaae(){return f1000_d43f(2);}
// 1000:eab4 _chkstk: no-op in the port (the emulated stack checks its own bounds).
export function f1000_eab4(){}
// 1000:eaca null-pointer check: XOR of DS:0000..0041 must be 0x55, else R6001; returns 1 on failure.
export function f1000_eaca(){
 let ah=0;for(let i=0;i<0x42;i++)ah^=rb(i);
 if((ah^0x55)===0)return 0;
 f1000_ea8e();f1000_ed13(1);return 1;
}
// 1000:eaec _setargv: argv[0] from the environment tail (DOS 3+), then the PSP command tail with MSC quoting.
// The argv block is carved from the caller's stack (SUB SP,DX), so it is allocated with salloc() and kept.
export function f1000_eaec(){
 let dx=2;const psp=rw(0x53e9);
 if(rb(DOSV)!==2){
  const es=frw(psp,0x2c);ww(0x540e,es);
  let di=0,cx=0x8000;
  do{ // REPNE SCASB; SCASB; JNZ
   while(cx){cx--;if(frb(es,di++)===0)break;}
  }while(frb(es,di++)!==0);
  di+=2;ww(0x540c,di);
  let n=0;while(frb(es,di+n)!==0)n++;dx=n+1;
 }
 // Pass 1: count arguments (DI) and string bytes (DX).
 let di=1,si=0x81,al,cx;const g=()=>frb(psp,si++);
 let L='eb2c';
 for(;;){
  switch(L){
   case 'eb2c':al=g();if(al===0x20||al===9){L='eb2c';break;}if(al===0xd||al===0){L='end';break;}di++;si--;L='eb3f';break;
   case 'eb3e':si--;L='eb3f';break;
   case 'eb3f':al=g();if(al===0x20||al===9){L='eb2c';break;}if(al===0xd||al===0){L='end';break;}
    if(al===0x22){L='eb78';break;}if(al===0x5c){cx=0;L='eb5d';break;}dx++;L='eb3f';break;
   case 'eb5d':cx++;al=g();if(al===0x5c){L='eb5d';break;}if(al===0x22){dx+=(cx>>1)+(cx&1);L=cx&1?'eb3f':'eb78';break;}dx+=cx;L='eb3e';break;
   case 'eb77':si--;L='eb78';break;
   case 'eb78':al=g();if(al===0xd||al===0){L='end';break;}if(al===0x22){L='eb3f';break;}if(al===0x5c){cx=0;L='eb8e';break;}dx++;L='eb78';break;
   case 'eb8e':cx++;al=g();if(al===0x5c){L='eb8e';break;}if(al===0x22){dx+=(cx>>1)+(cx&1);L=cx&1?'eb78':'eb3f';break;}dx+=cx;L='eb77';break;
  }
  if(L==='end')break;
 }
 ww(0x5406,di);
 dx=dx+di&0xffff;di++;di<<=1;dx=dx+di&0xfffe;
 const argv=salloc(dx);ww(0x5408,argv);
 let bx=argv;di=di+bx&0xffff;
 ww(bx,di);bx+=2;
 {const s=rw(0x540e),o=rw(0x540c);for(let k=0;;k++){const c=frb(s,o+k);wb(di++,c);if(!c)break;}}
 // Pass 2: copy the arguments.
 si=0x81;const put=c=>{wb(di,c);di=di+1&0xffff;};
 L='ebe1';
 for(;;){
  switch(L){
   case 'ebde':put(0);L='ebe1';break;
   case 'ebe1':al=g();if(al===0x20||al===9){L='ebe1';break;}if(al===0xd||al===0){L='ec70';break;}ww(bx,di);bx+=2;L='ebfd';break;
   case 'ebfd':si--;L='ebfe';break;
   case 'ebfe':al=g();if(al===0x20||al===9){L='ebde';break;}if(al===0xd||al===0){L='ec6d';break;}
    if(al===0x22){L='ec3a';break;}if(al===0x5c){cx=0;L='ec1c';break;}put(al);L='ebfe';break;
   case 'ec1c':cx++;al=g();if(al===0x5c){L='ec1c';break;}
    if(al===0x22){const odd=cx&1;for(let k=cx>>1;k;k--)put(0x5c);if(!odd){L='ec3a';break;}put(0x22);L='ebfe';break;}
    for(;cx;cx--)put(0x5c);L='ebfd';break;
   case 'ec39':si--;L='ec3a';break;
   case 'ec3a':al=g();if(al===0xd||al===0){L='ec6d';break;}if(al===0x22){L='ebfe';break;}if(al===0x5c){cx=0;L='ec50';break;}put(al);L='ec3a';break;
   case 'ec50':cx++;al=g();if(al===0x5c){L='ec50';break;}
    if(al===0x22){const odd=cx&1;for(let k=cx>>1;k;k--)put(0x5c);if(!odd){L='ebfe';break;}put(0x22);L='ec3a';break;}
    for(;cx;cx--)put(0x5c);L='ec39';break;
   case 'ec6d':put(0);L='ec70';break;
  }
  if(L==='ec70')break;
 }
 ww(bx,0);
}
// 1000:ec7a _setenvp: envp array and string copies carved from the heap top by fe2a (R6009 on failure).
// Strings starting with ";C" (_C_FILE_INFO) are copied but get no envp entry.
export function f1000_ec7a(){
 const env=frw(rw(0x53e9),0x2c);
 let bp=0,di=0;
 if(env&&frb(env,0)!==0){
  for(;;){while(frb(env,di++)!==0);bp++;if(frb(env,di++)===0)break;}
 }
 bp++;
 let ax=di+1&0xfffe;const cnt=bp;bp<<=1;ax=ax+bp&0xffff;
 const base=f1000_fe2a(ax,9);
 let cx=cnt;di=base+bp&0xffff;bp=base;ww(0x540a,bp);
 let si=0;cx--;
 while(cx){
  if(frw(env,si)!==0x433b){ww(bp,di);bp+=2;}
  for(;;){const c=frb(env,si++);wb(di++,c);if(!c)break;}
  cx--;
 }
 ww(bp,cx);
}
// 1000:ece8 find runtime message n in the table at DS:56b0 ({u16 id, string}, ended by id FFFFh); 0 if none.
export function f1000_ece8(n){
 let si=0x56b0;
 for(;;){const id=rw(si);si+=2;if(id===(n&0xffff))return si;if(id===0xffff)return 0;while(rb(si++)!==0);}
}
// 1000:ed13 write runtime message n to handle 2.
export function f1000_ed13(n){
 const p=f1000_ece8(n);if(!p)return;
 const len=strlen(p);record('stderr',{text:strAtDs(p)});
 dos(0x4000,{bx:2,cx:len,dx:p});
}

// ---- heap (near heap above the startup stack top, descriptor at DS:541e) ----
// 1000:fe2a grow the top of DGROUP by `size` bytes (register args AX=size, DI=error code); returns the old top
// (BP in the original). Fatal error `code` when DGROUP is exhausted.
export function f1000_fe2a(size,code){
 const dx=size&0xffff;let ax=dx+rw(0x5378);
 if(ax>0xffff)return f1000_d43f(code);
 if(!(rw(0x5372)>=ax)){
  ax+=0xf;const c=ax>0xffff?1:0;ax&=0xffff;
  let par=(ax>>1|c<<15)>>3;
  par=par+(DGROUP-rw(0x53e9))&0xffff;
  const r=dos(0x4a00,{es:rw(0x53e9),bx:par});
  if(r.cf)return f1000_d43f(code);
  ww(0x5372,(ax&0xfff0)-1);
 }
 const old=rw(0x5378);ww(0x5378,old+dx);return old;
}
// 1000:feda resize the arena entry for segment `seg` (table DS:5378, 4-byte {top, seg} entries up to 53c8)
// by `size`. Returns {cf, ax: old top, dx: seg}. Register helper of fe6c (DI = 5378, DX = size).
function f1000_feda(size,seg){
 let si=0x5378;const di=0x5378;
 for(;;){if(rw(si+2)===seg)break;si+=4;if(si===0x53c8)return {cf:1};}
 let bx=size+rw(si);if(bx>0xffff)return {cf:1};
 const top=bx;
 if(!(si===di&&rw(0x5372)>=bx)){
  bx+=0xf;const c=bx>0xffff?1:0;bx&=0xffff;bx=(bx>>1|c<<15)>>3;
  let es=seg;
  if(si===di){bx=bx+seg-rw(0x53e9)&0xffff;es=rw(0x53e9);}
  const r=dos(0x4a00,{es,bx});if(r.cf)return {cf:1};
  if(si===di)ww(0x5372,top);
 }
 const old=rw(si);ww(si,top);return {cf:0,ax:old,dx:seg};
}
// 1000:fe6c heap-grow helper (mode, sizeLo, sizeHi, ..., seg at [BP+0Ch]). Returns {ax,dx}; DX:AX = -1 on failure.
export function f1000_fe6c(mode,lo,hi,seg){
 if((hi&0xffff)!==0)return {ax:0xffff,dx:0xffff};
 const dx=lo&0xffff;
 if((mode&0xffff)===1){const r=f1000_feda(dx,seg);return r.cf?{ax:0xffff,dx:0xffff}:{ax:r.ax,dx:r.dx};}
 // Modes other than 1 (try other arena entries, then INT 21h 48h) are not used by fbfc, the only caller.
 let si=rw(0x53c8);
 if(mode-1!==1&&si!==0x5378){seg=rw(si+2);const r=f1000_feda(dx,seg);if(!r.cf)return {ax:r.ax,dx:r.dx};}
 si+=4;
 if(si>=0x53c8||dx===0)return {ax:0xffff,dx:0xffff};
 let bx=dx+0xf;const c=bx>0xffff?1:0;bx=((bx&0xffff)>>1|c<<15)>>3;
 const r=dos(0x4800,{bx});if(r.cf)return {ax:0xffff,dx:0xffff};
 ww(si,0);ww(si+2,r.ax);ww(0x53c8,si);return {ax:0,dx:r.ax};
}
// 1000:fbfc grow the heap segment by `size` (register AX). Returns {ax, ok}; ok is false (ZF) on failure or size 0.
export function f1000_fbfc(size){
 const r=f1000_fe6c(1,size,0,DGROUP);
 if(r.dx===0xffff)return {ax:r.ax,ok:false};
 return {ax:r.ax,ok:(size&0xffff)!==0};
}
// 1000:fbda append `size` bytes to the heap: the old end marker becomes a free block, a new end marker
// FFFEh is written at the new top. Register helper: SI = current end pointer, DI = caller's DI.
// Returns {ok, si: new end, di: old end, ax: caller's DI}.
function fbda(size,si,di){
 const r=f1000_fbfc(size);
 if(!r.ok)return {ok:false,si,di,ax:r.ax};
 const odi=di;di=si;si=r.ax+size&0xffff;
 ww(si-2,0xfffe);ww(0x541e+6,si);
 ww(di-2,si-di-1&0xffff);
 return {ok:true,si,di,ax:odi};
}
// 1000:fba0 grow the heap enough for CX bytes, rounding the new top up to a multiple of a power of two
// derived from _amblksiz [557c]. Returns {ok, ...fbda result}.
function fba0(cx,si,di){
 const h=rw(di-2);
 if(h&1)cx=cx-h-1&0xffff;
 cx=cx+2&0xffff;
 let dx=0x7fff;while(dx>rw(0x557c)){dx>>=1;if(!dx)break;}
 for(;;){
  let ax=cx+si;
  if(ax>0xffff)return {ok:false};
  ax+=dx;
  if(ax<=0xffff){
   ax=(ax&~dx&0xffff)-si&0xffff;
   const r=fbda(ax,si,di);
   if(r.ok)return r;
  }
  dx>>=1;if(!dx)return {ok:false};
 }
}
// 1000:fabd near-heap allocator core (BX = descriptor 541e, CX = size). First fit from the rover with
// coalescing of free neighbours; two passes, then growth. Returns the block or 0.
export function f1000_fabd(n){
 const BX=0x541e;
 const fail=()=>{ww(BX+2,rw(BX));return 0;};
 let cx=n+1&0xffff;if(cx===0)return fail();
 cx&=0xfffe;if(cx>=0xffee)return fail();
 let si=rw(BX+2),ax=rw(si),di;si+=2;di=si;
 let L=(ax&1)?'fad3':'fb15';
 for(;;){
  switch(L){
   case 'fad3':case 'fb2b':{
    ax=ax-1&0xffff;
    if(ax>=cx){L='faed';break;}
    const dx=ax;si=si+ax&0xffff;ax=rw(si);si+=2;
    if(!(ax&1)){L='fb1b';break;}
    ax=ax+dx+2&0xffff;si=di;ww(si-2,ax);L='fb2b';break;
   }
   case 'faed':{
    di=si;
    if(ax===cx){di=di+cx&0xffff;wb(si-2,rb(si-2)-1);}
    else{di=di+cx&0xffff;ww(si-2,cx);ww(di,ax-cx-1&0xffff);}
    ww(BX+2,di);return si;
   }
   case 'fb15':wb(0x5580,2);L='fb1b';break;
   case 'fb1b':
    if(ax===0xfffe){L='fb45';break;}
    di=si;si=si+ax&0xffff;L='fb24';break;
   case 'fb24':ax=rw(si);si+=2;if(!(ax&1)){L='fb1b';break;}di=si;L='fb2b';break;
   case 'fb45':
    if(rw(BX+8)!==0)unsupported('1000:fb4c multi-segment near heap');
    wb(0x5580,rb(0x5580)-1);
    if(rb(0x5580)===0){L='fb68';break;}
    si=rw(BX);L='fb24';break;
   case 'fb68':{
    si=rw(BX+6);
    const t=fbda(0,si,di); // probe: AX = current top
    if(t.ax!==si){
     const pad=(t.ax&1)+2;
     const p=fbda(pad,si,di);if(!p.ok)return fail();
     si=p.si;di=p.di;wb(di-2,rb(di-2)-1);
    }
    const g=fba0(cx,si,di);if(!g.ok)return fail();
    si=g.ax-2&0xffff;L='fb24';break;
   }
  }
 }
}
// 1000:de4e free(p): set the free bit of the header word. NULL is a no-op.
export function f1000_de4e(p){if(p)wb(p-2,rb(p-2)|1);}
// 1000:de60 malloc(n): the first call creates the heap at the current DGROUP top (fbfc(5)).
export function f1000_de60(n){
 if(rw(0x541e)===0){
  const r=f1000_fbfc(5);if(!r.ok)return 0;
  const ax=r.ax+1&0xfffe;
  ww(0x541e,ax);ww(0x5420,ax);ww(ax,1);ww(ax+2,0xfffe);ww(0x5424,ax+4);
 }
 return f1000_fabd(n&0xffff);
}
// 1000:dea6 calloc(n, size): 32-bit product; > 0xffff returns 0; then memset 0.
export function f1000_dea6(n,size){
 const p=lmul(n&0xffff,size&0xffff)>>>0;
 if(p>0xffff)return 0;
 const m=f1000_de60(p);
 return m?f1000_fd90(m,0,p):0;
}
// 1000:e43c halloc(nLo, nHi, size): huge DOS block, zero-filled; packed far pointer seg:pad or 0.
export function f1000_e43c(nl,nh,bx){
 nl&=0xffff;nh&=0xffff;bx&=0xffff;
 let lo=nl*bx, cx=lo&0xffff, dx=(lo/0x10000>>>0)+nh*bx&0xffff;
 if((dx|cx)===0)return 0;
 let si=0;const ax=bx-1&0xffff;
 if(dx>0xf||dx===0xf&&cx>0xfff0)return 0;
 if(dx>2||dx===2&&cx!==0){if(ax&bx)return 0;}
 else if(dx>=1&&(ax&bx)){
  if(!bx)throw new DivideError('1000:e485 divide by zero');
  const rem=0x10000%bx;si=rem;cx+=rem;if(cx>0xffff)return 0;dx=1;
 }
 let paras=((dx*0x10000+cx+0xf)>>>4)&0xffff;
 const r=dos(0x4800,{bx:paras});if(r.cf)return 0;
 let es=r.ax;const seg=r.ax;
 for(;;){
  const n=paras<0x1000?paras:0x1000;
  for(let i=0;i<n*16;i++)fwb(es,i,0);
  if(paras<=0x1000)break;
  paras-=0x1000;es=es+0x1000&0xffff;
 }
 return fp(seg,si);
}
// 1000:e430 hfree(seg): INT 21h AH=49h. Unreferenced.
export function f1000_e430(off,seg){dos(0x4900,{es:seg});}

// ---- memory and string helpers used by the runtime ----
// 1000:fd64 memcpy(dst,src,n) -> dst
export function f1000_fd64(d,s,n){n&=0xffff;let i=0;if(n&&(d&1)){wb(d,rb(s));i=1;}for(;i<n;i++)wb(d+i,rb(s+i));return d&0xffff;}
// 1000:fd90 memset(dst,c,n) -> dst
export function f1000_fd90(d,c,n){n&=0xffff;for(let i=0;i<n;i++)wb(d+i,c);return d&0xffff;}
// 1000:e546 memmove(dst,src,n): backward when dst is above src and overlaps -> dst
export function f1000_e546(d,s,n){
 n&=0xffff;if(!n)return d;
 if(d>s&&d<(s+n&0xffff))for(let i=n-1;i>=0;i--)wb(d+i,rb(s+i));
 else for(let i=0;i<n;i++)wb(d+i,rb(s+i));
 return d&0xffff;
}
// 1000:fc1c strcat / fc5c strcpy / fc8e strlen (runtime-internal copies)
export function f1000_fc1c(d,s){movs(d+strlen(d)&0xffff,s,strlen(s)+1);return d&0xffff;}
export function f1000_fc5c(d,s){movs(d,s,strlen(s)+1);return d&0xffff;}
export function f1000_fc8e(s){return strlen(s)&0xffff;}
// 1000:e4da strchr(s,c) (see strchr above)
export function f1000_e4da(s,c){return strchr(s,c);}
// 1000:e504 stricmp
export function f1000_e504(a,b){return stricmp(a,b);}
// 1000:e58e abs. Unreferenced.
export function f1000_e58e(v){v=s16(v);return s16(v<0?-v:v);}
// 1000:df1c toupper(c): _ctype[c+1] & 2 (DS:5583) -> c-0x20. No bounds check.
export function f1000_df1c(c){c=c&0xffff;return rb(c+0x5583)&2?c-0x20&0xffff:c;}

// ---- number conversion ----
// 1000:fdbe/fdca _xtoa core: value DX:AX, buffer, radix, signed flag (BL). Lower-case digits. Returns buf.
function xtoa(v,buf,radix,neg){
 radix&=0xffff;let di=buf&0xffff;
 let hi=v>>>16&0xffff,lo=v&0xffff;
 if(neg&&radix===10&&(hi&0x8000)){wb(di++,0x2d);const t=(-(hi*0x10000+lo))>>>0;hi=t>>>16;lo=t&0xffff;}
 if(radix===0)throw new DivideError('1000:fdf2 divide by zero');
 if(radix===1)throw Error('1000:fdca radix 1 never terminates');
 const si=di;
 do{
  let r=0;if(hi){r=hi%radix;hi=Math.floor(hi/radix);}
  const x=r*0x10000+lo;lo=Math.floor(x/radix);let d=x%radix;
  d+=0x30;if(d>0x39)d+=0x27;wb(di++,d);
 }while(hi|lo);
 wb(di,0);
 for(let a=si,b=di-1;a<b;a++,b--){const t=rb(a);wb(a,rb(b));wb(b,t);}
 return buf&0xffff;
}
// 1000:def6 itoa(v, buf, radix): signed only for radix 10, otherwise unsigned 16-bit.
export function f1000_def6(v,buf,radix){v&=0xffff;const x=(radix&0xffff)===10?s16(v):v;return xtoa(x,buf,radix,true);}
// 1000:df12 ultoa(lo, hi, buf, radix): never writes '-'.
export function f1000_df12(lo,hi,buf,radix){return xtoa(L(lo,hi)>>>0,buf,radix,false);}
// 1000:fcaa atol(s): spaces/tabs, optional sign, decimal digits, 32-bit wraparound. Packed DX:AX.
export function f1000_fcaa(s){
 let si=s&0xffff,v=0,al;
 do al=rb(si++);while(al===0x20||al===9);
 const first=al;
 if(al===0x2d||al===0x2b)al=rb(si++);
 for(;;){if(al>0x39||al<0x30)break;v=Math.imul(v,10)+(al-0x30)|0;al=rb(si++);}
 if(first===0x2d)v=-v|0;
 return v>>>0;
}
// 1000:def2 JMP fcaa (atoi thunk used by 1000:047c)
export function f1000_def2(s){return f1000_fcaa(s);}

// ---- long arithmetic (MSC helpers; int.js semantics, DivideError on /0 as INT 0) ----
// Arguments (alo, ahi, blo, bhi); result packed unsigned.
// 1000:e80c _aNldiv (signed, truncates toward zero)
export function f1000_e80c(alo,ahi,blo,bhi){const x=L(alo,ahi),y=L(blo,bhi);return ldiv(x,y)>>>0;}
// 1000:e8a8 _aNlmul (low 32 bits)
export function f1000_e8a8(alo,ahi,blo,bhi){const x=L(alo,ahi),y=L(blo,bhi);return lmul(x,y)>>>0;}
// 1000:e8dc _aNlrem (sign of the dividend)
export function f1000_e8dc(alo,ahi,blo,bhi){const x=L(alo,ahi),y=L(blo,bhi);return lmod(x,y)>>>0;}
// 1000:e9c0 _aNuldiv / ea22 _aNulrem (unsigned)
export function f1000_e9c0(alo,ahi,blo,bhi){const x=L(alo,ahi),y=L(blo,bhi);return uldiv(x,y)>>>0;}
export function f1000_ea22(alo,ahi,blo,bhi){const x=L(alo,ahi),y=L(blo,bhi);return ulmod(x,y)>>>0;}
// 1000:e97e *(long*)p /= b (p, blo, bhi)
export function f1000_e97e(p,blo,bhi){const y=L(blo,bhi);const q=ldiv(rw(p)|rw(p+2)<<16,y);ww(p,q);ww(p+2,q>>>16);}
// 1000:e9a0 *(ulong*)p >>= n via fe1e
export function f1000_e9a0(p,n){const q=f1000_fe1e((rw(p)|rw(p+2)<<16)>>>0,n);ww(p,q);ww(p+2,q>>>16);}
// 1000:fe1e DX:AX >>= CL (register args; CH cleared)
export function f1000_fe1e(v,cl){return lshr(v>>>0,cl&0xff)>>>0;}
// 1000:d384 far wrapper of e80c (used by the 1ff8 encoder) is provided by music.js (segment-range owner).

// ---- low-level I/O (INT 21h) ----
// 1000:da0a close(h): 0, or -1 with errno.
export function f1000_da0a(h){
 h&=0xffff;
 if(!(h<rw(NFILE))){f1000_ed62(0x900);return -1;}
 const r=dos(0x3e00,{bx:h});
 if(r.cf){f1000_ed62(r.ax);return -1;}
 wb(h+OSFILE,0);return 0;
}
// 1000:da2a lseek(h, offLo, offHi, whence): new position, or FFFFFFFFh with errno. Clears the EOF flag.
export function f1000_da2a(h,lo,hi,whence){return lseek32(h,L(lo,hi),whence)>>>0;}
function lseek32(h,off,whence){
 h&=0xffff;off|=0;whence&=0xffff;
 if(!(h<rw(NFILE))){f1000_ed62(0x900);return -1;}
 const hiw=off>>>16&0xffff,low=off&0xffff;
 if(hiw&0x8000){
  if(whence===0){f1000_ed62(0x1600);return -1;}
  const c=dos(0x4201,{bx:h,cx:0,dx:0});if(c.cf){f1000_ed62(c.ax);return -1;}
  const cur=(c.dx<<16|c.ax)|0;
  if(whence&2){
   const e=dos(0x4202,{bx:h,cx:0,dx:0});
   if(((e.dx<<16|e.ax)+off|0)<0){dos(0x4200,{bx:h,cx:cur>>>16&0xffff,dx:cur&0xffff});f1000_ed62(0x1600);return -1;}
  }else if((cur+off|0)<0){f1000_ed62(0x1600);return -1;}
 }
 const r=dos(0x4200|whence&0xff,{bx:h,cx:hiw,dx:low});
 if(r.cf){f1000_ed62(r.ax);return -1;}
 wb(h+OSFILE,rb(h+OSFILE)&0xfd);
 return (r.dx<<16|r.ax&0xffff)|0;
}
// 1000:daa4 open(path, oflag, pmode): handle with _osfile set, or -1 with errno.
export function f1000_daa4(path,oflag,pmode){
 oflag&=0xffff;pmode=(pmode??0)&0xffff;
 const share=0;let existed=0,osf=0,h,attr=pmode;
 if(!(oflag&0x8000)&&((oflag&0x4000)||!(rb(0x5575)&0x80)))osf=0x80;
 let r=dos(0x3d00|(oflag&3|share),{dx:path});
 let L;
 if(r.cf){
  if(r.ax===2&&(oflag&0x100))L='db89';
  else{f1000_ed62(r.ax);return -1;}
 }else{
  h=r.ax;
  if((oflag&0x500)===0x500){dos(0x3e00,{bx:h});f1000_ed62(0x1100);return -1;}
  existed=1;
  const q=dos(0x4400,{bx:h});if(q.dx&0x80)osf|=0x40;
  if(osf&0x40)L='dbf0';
  else if(oflag&0x200){
   if(oflag&3){dos(0x4000,{bx:h,cx:0,dx:path});L='dbf0';}
   else{dos(0x3e00,{bx:h});const a=dos(0x4300,{dx:path});attr=a.cx;L='dba6';}
  }else if((osf&0x80)&&(oflag&2)){
   // Text read/write: drop a trailing ^Z.
   dos(0x4202,{bx:h,cx:0xffff,dx:0xffff});
   const b=salloc(2);
   try{
    const rr=dos(0x3f00,{bx:h,cx:1,dx:b});
    if(rr.ax!==0&&rb(b)===0x1a){dos(0x4202,{bx:h,cx:0xffff,dx:0xffff});dos(0x4000,{bx:h,cx:0,dx:b});}
   }finally{sfree(2);}
   dos(0x4200,{bx:h,cx:0,dx:0});L='dbf0';
  }else L='dbf0';
 }
 if(L==='db89'){
  existed=0;
  attr=f1000_dc37(pmode);pmode=attr;
  if(share!==0||!(oflag&2))attr&=0xfe;
  L='dba6';
 }
 if(L==='dba6'){
  r=dos(0x3c00,{dx:path,cx:attr});
  if(r.cf){f1000_ed62(r.ax);return -1;}
  h=r.ax;
  if(!(share===0&&(oflag&2))){
   dos(0x3e00,{bx:h});
   r=dos(0x3d00|(oflag&3|share),{dx:path});
   if(r.cf){f1000_ed62(r.ax);return -1;}
   h=r.ax;
   if(!(existed&1)&&(pmode&1)){
    const s=dos(0x4301,{dx:path,cx:attr|1});
    if(s.cf){f1000_ed62(s.ax);return -1;}
   }
  }
 }
 let cl;
 if(osf&0x40)cl=0;
 else{const a=dos(0x4300,{dx:path});cl=a.cx&1?0x10:0;if(oflag&8)cl|=0x20;}
 if(!(h<rw(NFILE))){dos(0x3e00,{bx:h});f1000_ed62(0x1800);return -1;}
 wb(h+OSFILE,cl|osf|1);
 return h;
}
// 1000:dc37 pmode -> DOS attribute: read-only (1) unless the S_IWRITE bit survives the umask [53e5].
export function f1000_dc37(cx){const ax=~rw(0x53e5)&cx;return ax&0x80?0:1;}
// 1000:dc48 read(h, buf, n): bytes read; text mode drops CR before LF and stops at ^Z.
export function f1000_dc48(h,buf,n){
 h&=0xffff;n&=0xffff;
 if(!(h<rw(NFILE))){f1000_ed62(0x900);return -1;}
 if(n===0)return 0;
 if(rb(h+OSFILE)&2)return 0;
 const r=dos(0x3f00,{bx:h,cx:n,dx:buf});
 if(r.cf){f1000_ed62(0x900|r.ax&0xff);return -1;}
 if(!(rb(h+OSFILE)&0x80))return r.ax;
 wb(h+OSFILE,rb(h+OSFILE)&0xfb);
 let si=buf,di=buf,cx=r.ax;const dx=buf;
 if(cx===0)return 0;
 if(rb(si)===0xa)wb(h+OSFILE,rb(h+OSFILE)|4);
 const store=al=>{wb(di,al);di=di+1&0xffff;};
 for(;;){
  const al=rb(si);si=si+1&0xffff;
  if(al===0xd){
   if(cx!==1){if(rb(si)===0xa){cx--;if(!cx)break;continue;}store(al);cx--;if(!cx)break;continue;}
   // CR at the end of the buffer: peek the next byte.
   if(rb(h+OSFILE)&0x40){
    const q=dos(0x4400,{bx:h});
    if(!(q.dx&0x20)){const b=salloc(2);try{const p=dos(0x3f00,{bx:h,cx:1,dx:b});if(p.cf){f1000_ed62(0x900|p.ax&0xff);return -1;}}finally{sfree(2);}}
    store(0xa);break;
   }
   const b=salloc(2);let next,got;
   try{wb(b,0);const p=dos(0x3f00,{bx:h,cx:1,dx:b});if(p.cf){f1000_ed62(0x900|p.ax&0xff);return -1;}got=p.ax;next=rb(b);}finally{sfree(2);}
   if(got===0){store(0xd);break;}
   if(n===1&&next===0xa){store(0xa);break;}
   dos(0x4201,{bx:h,cx:0xffff,dx:0xffff});
   if(next===0xa)break;
   store(0xd);break;
  }
  if(al===0x1a){wb(h+OSFILE,rb(h+OSFILE)|2);break;}
  store(al);cx--;if(!cx)break;
 }
 return di-dx&0xffff;
}
// 1000:dd26 write(h, buf, n): append mode seeks to the end first; text mode converts LF to CRLF.
export function f1000_dd26(h,buf,n){
 h&=0xffff;n&=0xffff;
 if(!(h<rw(NFILE))){f1000_ed62(0x900);return -1;}
 if(rb(h+OSFILE)&0x20){const s=dos(0x4202,{bx:h,cx:0,dx:0});if(s.cf){f1000_ed62(s.ax);return -1;}}
 if(!(rb(h+OSFILE)&0x80))return f1000_de1a(h,buf,n);
 if(n===0)return 0;
 let has=false;for(let i=0;i<n;i++)if(rb(buf+i)===0xa){has=true;break;}
 if(!has)return f1000_de1a(h,buf,n);
 const avail=f1000_faa8();
 if(avail<=0xa8)return f1000_d43f(0);
 const size=avail>=0x228?0x200:0x80;
 const tmp=salloc(size+2);
 let written=0,lfs=0,di=tmp;const end=tmp+size;
 const flush=()=>{
  const cx=di-tmp;
  if(cx){
   const r=dos(0x4000,{bx:h,cx,dx:tmp});
   if(r.cf)return {err:0x900|r.ax&0xff};
   written+=r.ax;
   if(r.ax===0){
    if((rb(h+OSFILE)&0x40)&&rb(buf)===0x1a)return {ok:true,stop:true};
    return {err:0x1c00};
   }
  }
  di=tmp;return null;
 };
 try{
  let si=buf;
  for(let cx=n;cx;cx--){
   let al=rb(si++);
   if(al===0xa){if(di===end){const e=flush();if(e){if(e.err){f1000_ed62(e.err);return -1;}return written-lfs&0xffff;}}wb(di++,0xd);lfs++;}
   if(di===end){const e=flush();if(e){if(e.err){f1000_ed62(e.err);return -1;}return written-lfs&0xffff;}}
   wb(di++,al);
  }
  const e=flush();if(e&&e.err){f1000_ed62(e.err);return -1;}
  // de0c: written - LF count; a borrow (short write) sets CF and reports an error.
  if(written<lfs){f1000_ed62(written-lfs&0xffff);return -1;}
  return written-lfs&0xffff;
 }finally{sfree(size+2);}
}
// 1000:de1a binary write tail of dd26: 0 bytes written is ENOSPC unless a device got a leading ^Z.
export function f1000_de1a(h,buf,n){
 if(n===0)return 0;
 const r=dos(0x4000,{bx:h,cx:n,dx:buf});
 if(r.cf){f1000_ed62(0x900|r.ax&0xff);return -1;}
 if(r.ax!==0)return r.ax;
 if((rb(h+OSFILE)&0x40)&&rb(buf)===0x1a)return 0;
 f1000_ed62(0x1c00);return -1;
}
// 1000:faa8 stackavail: SP - [542e] (stack limit), or 0.
export function f1000_faa8(){const lim=rw(0x542e),sp=curSP();return lim<sp?sp-lim:0;}
// 1000:e3d0 filelength(h): lseek(cur), lseek(end), restore. -1L on error.
export function f1000_e3d0(h){
 const cur=lseek32(h,0,1);if(cur===-1)return 0xffffffff;
 const end=lseek32(h,0,2);lseek32(h,cur,0);return end>>>0;
}
// 1000:e70b chdir(p) / e704 mkdir / e718 rmdir: 0 or -1.
export function f1000_e70b(p){const r=dos(0x3b00,{dx:p});if(r.cf){f1000_ed62(r.ax);return -1;}return 0;}
export function f1000_e704(p){const r=dos(0x3900,{dx:p});if(r.cf){f1000_ed62(r.ax);return -1;}return 0;}
export function f1000_e718(p){
 const r=dos(0x3a00,{dx:p});if(!r.cf)return 0;
 let ax=r.ax;
 if(ax===0x10){let bx=p;ax=0x10;for(;;){const al=rb(bx++);if(al===0)break;if(al===0x3f||al===0x2a){ax=3;break;}}}
 f1000_ed62(ax);return -1;
}
// 1000:e7fe unlink(p)
export function f1000_e7fe(p){const r=dos(0x4100,{dx:p});if(r.cf){f1000_ed62(r.ax);return -1;}return 0;}
// 1000:e740 getcwd(buf, n) = _getdcwd(0, buf, n)
export function f1000_e740(buf,n){return f1000_e754(0,buf,n);}
// 1000:e754 _getdcwd(drive, buf, n): "X:\" + INT 21h AH=47h; NULL buf -> malloc(max(n, len)); ERANGE if too long.
export function f1000_e754(drive,buf,n){
 let si=s16(n);const loc=salloc(0x60);
 try{
  const b=loc;let di=b;
  if(drive===0){drive=(f1000_fd0a(0x19,0,0)&0xff)+1;}
  wb(di++,drive+0x40);wb(di++,0x3a);wb(di++,0x5c);
  const regs=b+0x50,out=b+0x42;
  wb(regs+1,0x47);wb(regs+6,drive);ww(regs+8,di);
  f1000_fd1c(regs,out);
  const len=s16(strlen(b)+1);
  let d=buf&0xffff;
  if(d===0){
   if(len>si)si=len;
   d=f1000_de60(si);
   if(!d){ww(ERRNO,0xc);return 0;}
  }
  if(len>si){ww(ERRNO,0x22);return 0;}
  return f1000_fc5c(d,b);
 }finally{sfree(0x60);}
}
// 1000:fd0a bdos(ah, dx, al): AX after INT 21h.
export function f1000_fd0a(ah,dx,al){return dos((ah&0xff)<<8|al&0xff,{dx}).ax;}
// 1000:fd1c intdos(in, out): REGS {ax,bx,cx,dx,si,di,cflag}; sets errno on CF. Returns AX.
export function f1000_fd1c(inp,out){
 const r=dos(rw(inp),{bx:rw(inp+2),cx:rw(inp+4),dx:rw(inp+6),si:rw(inp+8),di:rw(inp+10)});
 ww(out,r.ax);ww(out+2,r.bx);ww(out+4,r.cx);ww(out+6,r.dx);ww(out+8,r.si);ww(out+10,r.di);
 if(r.cf){f1000_ed5c(r.ax);ww(out+12,1);return rw(out);}
 ww(out+12,0);return r.ax;
}

// ---- stdio ----
// 1000:fa6e _getstream: first _iob entry with (_flag & 83h) == 0, cleared, _file = FFh; or 0.
export function f1000_fa6e(){
 const last=rw(LASTIOB);
 for(let si=IOB;;si+=8){
  if((rb(si+6)&0x83)===0){ww(si+2,0);wb(si+6,0);ww(si+4,0);ww(si,0);wb(si+7,0xff);return si;}
  if(si===last)return 0;
 }
}
// 1000:f040 _openfile(name, mode, fp): mode "r"/"w"/"a" with "+", "b", "t"; open(..., 0x1a4).
export function f1000_f040(name,mode,f){
 let di,flag,cx=1,c=rb(mode);
 if(c===0x61){di=0x109;flag=2;}else if(c===0x72){di=0;flag=1;}else if(c===0x77){di=0x301;flag=2;}else return 0;
 let dl=flag;
 for(;;){
  mode=mode+1&0xffff;
  if(rb(mode)===0||cx===0)break;
  c=rb(mode);
  if(c===0x2b){if(di&2)cx=0;else{di=(di|2)&0xfffe;dl=0x80;}}
  else if(c===0x62){if(di&0xc000)cx=0;else di|=0x8000;}
  else if(c===0x74){if(di&0xc000)cx=0;else di|=0x4000;}
  else cx=0;
 }
 const h=f1000_daa4(name,di,0x1a4);
 if(s16(h)<0)return 0;
 wb(f+6,dl);ww(0x5684,rw(0x5684)+1);
 const i2=i2of(f);wb(i2,0);ww(f+2,0);ww(i2+4,0);ww(f,0);ww(f+4,0);wb(f+7,h);
 return f;
}
// 1000:d678 fopen(name, mode)
export function f1000_d678(name,mode){const f=f1000_fa6e();return f?f1000_f040(name,mode,f):0;}
// 1000:efd4 _getbuf: malloc(512) buffer, else the 1-byte _charbuf in _iob2.
export function f1000_efd4(f){
 const i2=i2of(f);
 const p=f1000_de60(0x200);ww(f+4,p);
 if(p){wb(f+6,rb(f+6)|8);ww(i2+2,0x200);}
 else{wb(f+6,rb(f+6)|4);ww(f+4,i2+1);ww(i2+2,1);}
 ww(f,rw(f+4));ww(f+2,0);
}
// 1000:efa6 _freebuf
export function f1000_efa6(f){
 if((rb(f+6)&0x83)&&(rb(f+6)&8)){f1000_de4e(rw(f+4));wb(f+6,rb(f+6)&0xf7);ww(f,0);ww(f+4,0);ww(f+2,0);}
}
// 1000:ed90 _filbuf: refill the buffer; EOF/error flags; returns the next byte or -1.
export function f1000_ed90(f){
 const i2=i2of(f);
 if(!(rb(f+6)&0x83)||(rb(f+6)&0x40))return -1;
 if(rb(f+6)&2){wb(f+6,rb(f+6)|0x20);return -1;}
 wb(f+6,rb(f+6)|1);wb(i2,rb(i2)&0xfb);
 if(!bufOwned(f))f1000_efd4(f);else ww(f,rw(f+4));
 const n=f1000_dc48(fileOf(f),rw(f+4),rw(i2+2))&0xffff;
 ww(f+2,n);
 if(n===0||n===0xffff){wb(f+6,rb(f+6)|(rw(f+2)!==0?0x20:0x10));ww(f+2,0);return -1;}
 ww(f+2,n-1);const p=rw(f);ww(f,p+1);return rb(p);
}
// 1000:ee50 _flsbuf(c, fp): flush and store c; stdout/stderr get static buffers unless they are devices.
export function f1000_ee50(c,f){
 const h=fileOf(f),i2=i2of(f);
 const err=()=>{wb(f+6,rb(f+6)|0x20);return -1;};
 if(!(rb(f+6)&0x83)||(rb(f+6)&0x40))return err();
 if(rb(f+6)&1)return err();
 wb(f+6,rb(f+6)|2);wb(f+6,rb(f+6)&0xef);
 ww(f+2,0);let di=0,wr=0;
 if(!bufOwned(f)){
  if(f===0x544e||f===0x5456){
   if(f1000_ff30(h)===0){
    ww(0x5684,rw(0x5684)+1);
    const b=f===0x544e?0x8bac:0xa6a2;ww(f+4,b);ww(f,b);ww(i2+2,0x200);wb(i2,1);
   }
  }else f1000_efd4(f);
 }
 if(rb(f+6)&8||rb(i2)&1){
  di=s16(rw(f)-rw(f+4));
  ww(f,rw(f+4)+1);ww(f+2,rw(i2+2)-1);
  if(di>0)wr=f1000_dd26(h,rw(f+4),di);
  else if(rb(h+OSFILE)&0x20)lseek32(h,0,2);
  wb(rw(f+4),c);
 }else{
  di=1;const p=salloc(2);
  try{wb(p,c);wr=f1000_dd26(h,p,1);}finally{sfree(2);}
 }
 if((wr&0xffff)!==(di&0xffff))return err();
 return c&0xff;
}
// 1000:d9c2 fputc(c, fp)
export function f1000_d9c2(c,f){
 ww(f+2,rw(f+2)-1);
 if(!(rw(f+2)&0x8000)){const p=rw(f);ww(f,p+1);wb(p,c);return c&0xff;}
 return f1000_ee50(c,f);
}
// 1000:d9ea fgetc(fp)
export function f1000_d9ea(f){
 ww(f+2,rw(f+2)-1);
 if(!(rw(f+2)&0x8000)){const p=rw(f);ww(f,p+1);return rb(p);}
 return f1000_ed90(f);
}
// 1000:f138 fflush(fp): write out a dirty write buffer; 0 or -1.
export function f1000_f138(f){
 let r=0;
 if((rb(f+6)&3)===2&&bufOwnedW(f)){
  const n=s16(rw(f)-rw(f+4));
  if(n>0&&f1000_dd26(fileOf(f),rw(f+4),n)!==n){wb(f+6,rb(f+6)|0x20);r=-1;}
 }
 ww(f,rw(f+4));ww(f+2,0);return r;
}
const bufOwnedW=f=>(rb(f+6)&8)!==0||(rb(i2of(f))&1)!==0;
// 1000:ff54 _endstdio / flushall: fflush every open stream; returns how many succeeded.
export function f1000_ff54(){
 let di=0;
 for(let si=IOB;rw(LASTIOB)>=si;si+=8)if(rb(si+6)&0x83){if(f1000_f138(si)!==-1)di++;}
 return di;
}
// 1000:ff30 isatty-like: _osfile[h] & 40h for a valid handle.
export function f1000_ff30(h){h=s16(h);if(h>=s16(rw(NFILE))||h<0)return 0;return rb(h+OSFILE)&0x40?1:0;}
// 1000:fcfe clearerr(fp): clear EOF and error.
export function f1000_fcfe(f){wb(f+6,rb(f+6)&0xcf);}
// 1000:d5be fclose(fp): fflush, free the buffer, close; removes "\<tmpnum>" for temporary files. 0 or -1.
export function f1000_d5be(f){
 let di=-1;
 if((rb(f+6)&0x83)&&!(rb(f+6)&0x40)){
  di=f1000_f138(f);
  const tmp=rw(i2of(f)+4);
  f1000_efa6(f);
  if(f1000_da0a(fileOf(f))<0)di=-1;
  else if(tmp){
   const b=salloc(0x10);
   try{
    const name=b+2;f1000_fc5c(name,0x541a);
    let p=name+2;
    if(rb(p-2)===0x5c)p--;else f1000_fc1c(name,0x541c);
    f1000_def6(tmp,p,10);
    if(f1000_e7fe(name)!==0)di=-1;
   }finally{sfree(0x10);}
  }
 }
 wb(f+6,0);return di;
}
// 1000:d6a0 fread(buf, size, n, fp): whole items read. size*n is a 16-bit product.
export function f1000_d6a0(buf,size,n,f){
 size&=0xffff;n&=0xffff;buf&=0xffff;
 const total=size*n&0xffff;let left=total;
 const done=()=>div16(total-left,size);
 const h=fileOf(f);
 let L;
 if(size===0||n===0)return total;
 if(bufOwned(f))L='d771';
 else if(!(rb(h+OSFILE)&0x80)&&!(left&0x1ff)){
  if(left===0)return done();
  for(;;){
   const r=f1000_dc48(h,buf,left);
   if(r===0||r===-1){wb(f+6,rb(f+6)|(r===-1?0x20:0x10));return done();}
   left=left-r&0xffff;buf=buf+r&0xffff;if(left===0)return done();
  }
 }else{
  // d742: one getc allocates the buffer
  ww(f+2,rw(f+2)-1);let c;
  if(rw(f+2)&0x8000)c=f1000_ed90(f);else{const p=rw(f);ww(f,p+1);c=rb(p);}
  if((c&0xffff)===0xffff)return 0;
  wb(buf,c);buf=buf+1&0xffff;left=left-1&0xffff;
  L='d771';
 }
 if(!bufOwnedW(f)){
  // d83a: unbuffered read loop
  if(left===0)return done();
  for(;;){
   const r=f1000_dc48(h,buf,left);
   if(r===0||r===-1){wb(f+6,rb(f+6)|(r===-1?0x20:0x10));return done();}
   left=left-r&0xffff;buf=buf+r&0xffff;if(left===0)return done();
  }
 }
 for(;;){ // d801
  if(left===0)return done();
  const cnt=rw(f+2);
  if(cnt!==0){
   const k=cnt<left?cnt:left;
   f1000_fd64(buf,rw(f),k);
   ww(f,rw(f)+k);buf=buf+k&0xffff;left=left-k&0xffff;ww(f+2,cnt-k);
   continue;
  }
  if(left>=0x200){
   const k=left&0xfe00;
   const r=f1000_dc48(h,buf,k);
   if(r===0||r===-1){wb(f+6,rb(f+6)|(r===-1?0x20:0x10));return done();}
   left=left-r&0xffff;buf=buf+r&0xffff;continue;
  }
  const c=f1000_ed90(f);
  if((c&0xffff)===0xffff)return done();
  wb(buf,c);buf=buf+1&0xffff;left=left-1&0xffff;
 }
}
// 1000:d886 fwrite(buf, size, n, fp): whole items written.
export function f1000_d886(buf,size,n,f){
 size&=0xffff;n&=0xffff;let si=buf&0xffff;
 const total=size*n&0xffff;let left=total;
 const h=fileOf(f);
 const putc=()=>{ // d8f8/d93e
  ww(f+2,rw(f+2)-1);
  if(!(rw(f+2)&0x8000)){const p=rw(f);ww(f,p+1);wb(p,rb(si));}
  else f1000_ee50(rb(si)<<24>>24&0xffff,f);
 };
 if(size===0||n===0)return 0;
 if(!bufOwned(f)){
  if(!(left&0x1ff)){
   const r=f1000_dd26(h,si,left);
   if(r===-1)return 0;
   return div16(r,size);
  }
  putc();
  if(rb(f+6)&0x20)return 0;
  si=si+1&0xffff;left=left-1&0xffff;
 }
 if(bufOwnedW(f)){
  for(;;){ // d963
   if(left===0)break;
   const cnt=rw(f+2);
   if(cnt===0){putc();if(rb(f+6)&0x20)break;si=si+1&0xffff;left=left-1&0xffff;continue;}
   const k=cnt<left?cnt:left;
   f1000_fd64(rw(f),si,k);
   ww(f,rw(f)+k);si=si+k&0xffff;left=left-k&0xffff;ww(f+2,cnt-k);
  }
 }else{
  const r=f1000_dd26(h,si,left);
  if(r!==-1)left=left-r&0xffff;
 }
 return div16(total-left&0xffff,size);
}
// 1000:e1d4 ftell(fp): logical position, or FFFFFFFFh.
export function f1000_e1d4(f){return ftell32(f)>>>0;}
function ftell32(f){
 if(rw(f+2)&0x8000)ww(f+2,0);
 const h=fileOf(f);
 let pos=lseek32(h,0,1);
 if(pos<0)return -1;
 if(!bufOwnedW(f))return pos-s16(rw(f+2))|0;
 let off=s16(rw(f)-rw(f+4));
 if(rb(f+6)&3){
  if(rb(h+OSFILE)&0x80){let cx=off;for(let d=rw(f+4);rw(f)>d;d++)if(rb(d)===0xa)cx++;off=s16(cx);}
 }else if(!(rb(f+6)&0x80)){ww(ERRNO,0x16);return -1;}
 if(pos===0)return off;
 if(!(rb(f+6)&1))return pos+off|0;
 if(rw(f+2)===0){off=0;return pos+off|0;}
 let e=rw(f)-rw(f+4)+rw(f+2)&0xffff;
 if(rb(h+OSFILE)&0x80){
  const end=lseek32(h,0,2);
  if(end===pos){let cx=e;const lim=e+rw(f+4)&0xffff;for(let d=rw(f+4);lim>d;d++)if(rb(d)===0xa)cx++;e=cx&0xffff;}
  else{lseek32(h,pos,0);e=rw(i2of(f)+2);if(rb(h+OSFILE)&4)e=e+1&0xffff;}
 }
 pos=pos-s16(e)|0;
 return pos+off|0;
}
// 1000:df34 fseek(fp, offLo, offHi, whence): 0 or -1. Read streams reuse the buffer when the target lies in the
// block it holds (block = off rounded down to _bufsiz).
export function f1000_df34(f,lo,hi,whence){return fseek32(f,L(lo,hi),whence);}
function fseek32(f,off,whence){
 off|=0;whence=s16(whence);
 let crlf=0;
 const einval=()=>{ww(ERRNO,0x16);return -1;};
 if(!(rb(f+6)&0x83)||whence>2||whence<0)return einval();
 const h=fileOf(f),i2=i2of(f);
 wb(f+6,rb(f+6)&0xef);
 const viaLseek=()=>{ // df99/df9e
  whence=0;
  f1000_f138(f);
  if(rb(f+6)&0x80)wb(f+6,rb(f+6)&0xfc);
  return lseek32(h,off,whence)===-1?-1:0;
 };
 if(rb(f+6)&0x82){
  if(whence===1){off=off+ftell32(f)|0;}
  return viaLseek();
 }
 if(!bufOwned(f))f1000_efd4(f);
 else if(rb(i2)&4){crlf=1;wb(i2,rb(i2)&0xfb);}
 const cur=lseek32(h,0,1);
 if(cur===-1)return -1;
 if(whence===1){
  if(off===0&&crlf===0)return 0;
  off=off+(cur-s16(rw(f+2))|0)|0;
 }
 if(whence===2||(rb(i2)&8)||off>cur){
  const end=lseek32(h,0,2);
  lseek32(h,cur,0);
  if(whence===2)off=off+end|0;
  if(off>end)wb(i2,rb(i2)|8);else wb(i2,rb(i2)&0xf7);
 }
 const bufsiz=rw(i2+2);
 if(off<0)return einval();
 if(rb(i2)&8)return viaLseek();
 if(rb(f+6)&4)return viaLseek();
 const bs=s16(bufsiz);
 let di=lmod(off,bs)&0xffff;
 const blk=off-s16(di)|0;
 let reuse=false;
 if(rw(f+2)!==0&&crlf===0)reuse=lmul(ldiv(cur-1|0,bs),bs)===blk;
 if(reuse)ww(f+2,rw(f+2)+(rw(f)-rw(f+4)));
 else{
  if(lseek32(h,blk,0)===-1)return einval();
  const n=f1000_dc48(h,rw(f+4),bufsiz);
  ww(f+2,n);
  if((n&0xffff)===0xffff)return einval();
 }
 if(rb(h+OSFILE)&0x80){
  if((rb(h+OSFILE)&4)&&di!==0)di=di+1&0xffff;
  ww(f,rw(f+4));
  for(;;){const ax=s16(di);di=di-1&0xffff;if(ax<=0)return 0;if(rb(rw(f))===0xa)di=di-1&0xffff;ww(f+2,rw(f+2)-1);ww(f,rw(f)+1);}
 }
 ww(f,rw(f+4)+di);ww(f+2,rw(f+2)-di);
 return 0;
}
// 1000:e350 rewind(fp): fflush, clearerr, lseek(0).
export function f1000_e350(f){
 f1000_f138(f);f1000_fcfe(f);
 if(rb(f+6)&0x80)wb(f+6,rb(f+6)&0xfc);
 lseek32(fileOf(f),0,0);
}

// ---- qsort (1000:e5a4) ----
// The comparator is a near function in segment 1000, called through the registry (indirect call).
const cmpCall=(cmp,a,b)=>s16(callFar(gaddr(0x1000,cmp),a,b));
// 1000:e5a4 qsort(base, num, width, cmp): returns early when already sorted.
export function f1000_e5a4(base,num,width,cmp){
 base&=0xffff;num&=0xffff;width&=0xffff;
 let si=base,di=base+width&0xffff,cnt=num-1&0xffff,unsorted=0;
 if(num!==0){
  for(;;){const ax=cnt;cnt=cnt-1&0xffff;if(ax===0)break;if(cmpCall(cmp,si,di)<=0){si=di;di=di+width&0xffff;continue;}unsorted++;break;}
 }
 if(!unsorted)return;
 ww(0x5428,width);ww(0x542a,cmp);
 f1000_e614((num-1)*rw(0x5428)+base&0xffff,base);
}
// 1000:e614 quicksort core (hi, lo); w and cmp from DS:5428/542a.
export function f1000_e614(hi,lo){
 const w=()=>rw(0x5428),cmp=(a,b)=>cmpCall(rw(0x542a),a,b);
 let si=hi+w()&0xffff,di=lo;
 while(lo<hi){
  di=lo;si=hi+w()&0xffff;
  for(;;){
   do di=di+w()&0xffff;while(hi>di&&cmp(di,lo)<=0);
   do si=si-w()&0xffff;while(lo<si&&cmp(si,lo)>=0);
   if(si>di)f1000_e6cc(w(),si,di);else break;
  }
  f1000_e6cc(w(),si,lo);
  if(s16(si-lo)<s16(hi-si)){f1000_e614(si-w()&0xffff,lo);lo=si+w()&0xffff;}
  else{f1000_e614(hi,si+w()&0xffff);hi=si-w()&0xffff;}
 }
}
// 1000:e6cc swap n bytes (n, a, b)
export function f1000_e6cc(n,a,b){for(let i=0;i<n;i++){const t=rb(a+i);wb(a+i,rb(b+i));wb(b+i,t);}}

export {f1000_d678 as fopen,f1000_d6a0 as fread,f1000_d886 as fwrite,f1000_d5be as fclose,f1000_df34 as fseek,f1000_e1d4 as ftell,
 f1000_de60 as malloc,f1000_de4e as free,f1000_dea6 as calloc,f1000_def6 as itoa,f1000_df12 as ultoa,f1000_fcaa as atol,f1000_e5a4 as qsort};

// Functions stored in data: the terminator table entry DS:56a4 -> ff54, the exit pointer [5376] -> d512,
// the INT 0 vector -> d430, and fread/fwrite through the save-game pointer DS:8e94 (1000:5368).
register(0x1000,0xff54,f1000_ff54);
register(0x1000,0xd512,f1000_d512);
register(0x1000,0xd529,f1000_d529);
register(0x1000,0xd430,f1000_d430);
register(0x1000,0xd6a0,f1000_d6a0);
register(0x1000,0xd886,f1000_d886);
provide({f1000_a3ca:rand,f1000_a403:randReset,
 f1000_c00e,f1000_c03e,f1000_c058,f1000_c070,f1000_c080,f1000_c094,f1000_c0a8,f1000_c0bc,f1000_c0c0,f1000_c0d4,f1000_c0e2,f1000_c0f4,
 f1000_c10c,f1000_c132,f1000_c144,f1000_c148,f1000_c156,f1000_c15a,f1000_c16c,f1000_c180,f1000_c18e,f1000_c1a2,f1000_c1d6,f1000_c1ee,
 f1000_c206,f1000_c214,f1000_c22c,f1000_c244,f1000_c256,f1000_c264,f1000_c272,f1000_c280,f1000_c298,f1000_c2ce,f1000_c2f6,f1000_c308,f1000_c31a,
 f1000_d39c,f1000_d430,f1000_d43f,f1000_d44e,f1000_d512,f1000_d529,f1000_d56e,f1000_d59b,f1000_d5aa,f1000_d5be,f1000_d678,f1000_d6a0,
 f1000_d886,f1000_d9c2,f1000_d9ea,f1000_da0a,f1000_da2a,f1000_daa4,f1000_dc37,f1000_dc48,f1000_dd26,f1000_de1a,f1000_de4e,f1000_de60,
 f1000_dea6,f1000_def2,f1000_def6,f1000_df12,f1000_df1c,f1000_df34,f1000_e1d4,f1000_e350,f1000_e3d0,f1000_e430,f1000_e43c,f1000_e4da,
 f1000_e504,f1000_e546,f1000_e58e,f1000_e5a4,f1000_e614,f1000_e6cc,f1000_e704,f1000_e70b,f1000_e718,f1000_e740,f1000_e754,f1000_e7fe,
 f1000_e80c,f1000_e8a8,f1000_e8dc,f1000_e97e,f1000_e9a0,f1000_e9c0,f1000_ea22,f1000_ea8e,f1000_eaae,f1000_eab4,f1000_eaca,f1000_eaec,
 f1000_ec7a,f1000_ece8,f1000_ed13,f1000_ed5c,f1000_ed62,f1000_ed90,f1000_ee50,f1000_efa6,f1000_efd4,f1000_f040,f1000_f138,f1000_fa6e,
 f1000_faa8,f1000_fabd,f1000_fbfc,f1000_fc1c,f1000_fc5c,f1000_fc8e,f1000_fcaa,f1000_fcfe,f1000_fd0a,f1000_fd1c,f1000_fd64,f1000_fd90,
 f1000_fe1e,f1000_fe2a,f1000_fe6c,f1000_ff30,f1000_ff54});
