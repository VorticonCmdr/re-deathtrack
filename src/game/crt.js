// Microsoft C runtime functions used by the game, reimplemented over DGROUP near pointers.
// Each keeps the exact return conventions of the original (static, from disassembly).
import {rb,wb,rw,ww} from '../engine/mem.js';

// 1000:c058 strlen
export function strlen(s){let n=0;while(rb(s+n))n++;return n;}
// 1000:c2ce strcpy(dst,src) -> dst
export function strcpy(d,s){let i=0;for(;;i++){const c=rb(s+i);wb(d+i,c);if(!c)break;}return d;}
// 1000:c298 strcat(dst,src) -> dst
export function strcat(d,s){strcpy(d+strlen(d),s);return d;}
// 1000:c2f6 -> 1000:e4da strchr(s,c): first occurrence including the terminator, else 0
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
