// BIOS, DOS and mouse-driver services as seen by the game, at register level.
// Translated code passes a register object {ax,bx,cx,dx,si,di,ds,es}; results come back in it, CF in `cf`.
import {B,frb,fwb,frw,fww,fstrAt,DGROUP,PSP_SEG} from '../engine/mem.js';
import {dosAlloc,dosFree,dosResize} from '../engine/dos.js';
import {machine} from '../engine/machine.js';
import {state,getVector,setVector,unsupported,inRetrace,onInput,interrupt,record,setPitDivisor,biosVector} from '../engine/host.js';
import * as ega from '../engine/ega.js';

const lo=x=>x&0xff, hi=x=>x>>8&0xff;
const setAX=(r,v)=>{r.ax=v&0xffff;};
const fail=(r,code)=>{r.ax=code;r.cf=1;return r;};
const ok=r=>{r.cf=0;return r;};

// ---- INT 10h (EGA BIOS) ----
export function int10(r){
 const ah=hi(r.ax),al=lo(r.ax);
 switch(ah){
  case 0x00:ega.setMode(al&0x7f);fwb(0x40,0x49,al&0x7f);return r;
  case 0x0f:r.ax=frw(0x40,0x4a)<<8|frb(0x40,0x49);r.bx=r.bx&0xff;return r;
  case 0x10:
   if(al===0x00){if(lo(r.bx)<16)ega.regs.palette[lo(r.bx)]=hi(r.bx)&0x3f;else if(lo(r.bx)===0x11)ega.regs.overscan=hi(r.bx)&0x3f;return r;}
   if(al===0x01){ega.regs.overscan=hi(r.bx)&0x3f;return r;}
   if(al===0x02){for(let i=0;i<16;i++)ega.regs.palette[i]=frb(r.es,r.dx+i)&0x3f;ega.regs.overscan=frb(r.es,r.dx+16)&0x3f;return r;}
   return unsupported(`INT 10h AX=${r.ax.toString(16)}`),r;
  case 0x12:if(lo(r.bx)===0x10){r.bx=0x0003;r.cx=0x0009;return r;}return r; // EGA, 256K, colour monitor
  case 0x1a:return r; // EGA BIOS has no display combination call: AL unchanged
  default:unsupported(`INT 10h AH=${ah.toString(16)}`);return r;
 }
}

// ---- INT 21h (DOS) ----
let dta={seg:PSP_SEG,off:0x80},find=null;
export function int21(r){
 const ah=hi(r.ax),al=lo(r.ax),fs=machine.fs;
 switch(ah){
  case 0x09:{let s='';for(let i=0;i<4096;i++){const c=frb(r.ds,r.dx+i);if(c===0x24)break;s+=String.fromCharCode(c);}record('dosPrint',{text:s});return r;}
  case 0x0e:r.ax=r.ax&0xff00|3;return r;
  case 0x19:r.ax=r.ax&0xff00|2;return r; // current drive C:
  case 0x1a:dta={seg:r.ds,off:r.dx};return r;
  case 0x2f:r.es=dta.seg;r.bx=dta.off;return r;
  case 0x25:setVector(al,(r.ds<<16|r.dx)>>>0);return r;
  case 0x35:{const v=getVector(al);r.es=v>>>16;r.bx=v&0xffff;return r;}
  case 0x30:r.ax=0x0005;r.bx=0;r.cx=0;return r; // DOS 5.0 (DOSBox reports 5.0)
  case 0x36:r.ax=1;r.bx=0x7fff;r.cx=512;r.dx=0xffff;return r; // plenty of free space; DOSBox reports a fixed large value
  case 0x3b:return ok(r); // chdir: the game directory is the only directory
  case 0x47:fwb(r.ds,r.si,0);return ok(r); // getcwd: root of C:
  case 0x3c:{const h=fs.open(fstrAt(r.ds,r.dx),0x302);if(h<0)return fail(r,-h);r.ax=h;return ok(r);}
  case 0x3d:{const h=fs.open(fstrAt(r.ds,r.dx),al&3);if(h<0)return fail(r,-h);r.ax=h;return ok(r);}
  case 0x3e:{const e=fs.close(r.bx);return e<0?fail(r,-e):ok(r);}
  case 0x3f:{const n=fs.read(r.bx,r.ds,r.dx,r.cx);if(n<0)return fail(r,-n);r.ax=n;return ok(r);}
  case 0x40:{if(r.bx<=4){r.ax=r.cx;return ok(r);}const n=fs.write(r.bx,r.ds,r.dx,r.cx);if(n<0)return fail(r,-n);r.ax=n;return ok(r);}
  case 0x41:return fail(r,5); // the port never deletes original files
  case 0x42:{const off=(r.cx<<16|r.dx)|0,p=fs.seek(r.bx,off,al);if(p<0)return fail(r,-p);r.dx=p>>>16;r.ax=p&0xffff;return ok(r);}
  case 0x43:{if(!fs.exists(fstrAt(r.ds,r.dx)))return fail(r,2);r.cx=0x20;return ok(r);}
  case 0x44:if(al===0){r.dx=r.bx<=2?0x80d3:0x0002;return ok(r);}return fail(r,1);
  case 0x48:{const a=dosAlloc(r.bx);if(a.error){r.bx=a.largest;return fail(r,8);}r.ax=a.seg;return ok(r);}
  case 0x49:{const e=dosFree(r.es);return e.error?fail(r,e.error):ok(r);}
  case 0x4a:{if(r.es===PSP_SEG)return ok(r);const e=dosResize(r.es,r.bx);if(e.error){r.bx=e.largest;return fail(r,e.error);}return ok(r);}
  case 0x4c:throw new GameExit(al);
  case 0x4e:{const pat=fstrAt(r.ds,r.dx).replace(/^.*[\\/:]/,'').toUpperCase(),re=new RegExp('^'+pat.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$');find=fs.list().filter(n=>re.test(n));return findNext(r);}
  case 0x4f:return findNext(r);
  default:unsupported(`INT 21h AH=${ah.toString(16)}`);return r;
 }
}
function findNext(r){
 if(!find||!find.length)return fail(r,18);
 const name=find.shift(),size=machine.fs.lookup(name).length,{seg,off}=dta;
 fwb(seg,off+0x15,0x20);fww(seg,off+0x16,0);fww(seg,off+0x18,0x21);fww(seg,off+0x1a,size&0xffff);fww(seg,off+0x1c,size>>>16);
 for(let i=0;i<13;i++)fwb(seg,off+0x1e+i,i<name.length?name.charCodeAt(i):0);
 return ok(r);
}
export class GameExit extends Error{constructor(code){super(`Game exited with code ${code}`);this.code=code;}}

// ---- INT 33h (mouse driver) ----
// Mode 0Dh: the driver's virtual screen is 640x200, so X is doubled. Position limits per AX=7/8 defaults.
export const mouse={present:true,x:320,y:100,buttons:0,minX:0,maxX:639,minY:0,maxY:199};
onInput('mouse',e=>{mouse.x=Math.max(mouse.minX,Math.min(mouse.maxX,e.x*2));mouse.y=Math.max(mouse.minY,Math.min(mouse.maxY,e.y));mouse.buttons=e.buttons;});
export function int33(r){
 switch(r.ax){
  case 0x00:if(!mouse.present){r.ax=0;return r;}r.ax=0xffff;r.bx=2;mouse.x=320;mouse.y=100;mouse.buttons=0;return r;
  case 0x03:r.bx=mouse.buttons;r.cx=mouse.x;r.dx=mouse.y;record('mouse',{x:mouse.x,y:mouse.y,b:mouse.buttons});return r;
  case 0x04:mouse.x=Math.max(mouse.minX,Math.min(mouse.maxX,r.cx));mouse.y=Math.max(mouse.minY,Math.min(mouse.maxY,r.dx));return r;
  case 0x0f:return r;
  default:unsupported(`INT 33h AX=${r.ax.toString(16)}`);return r;
 }
}

// ---- Ports ----
// 3DAh: bit 3 vertical retrace, bit 0 display disabled; reading resets the attribute flip-flop.
export function vstatus(){ega.resetAttrFlip();return inRetrace()?0x09:0x00;}
const pit={mode:[0,0,0],latch:[null,null,null],write:[[],[],[]],reload:[0x10000,0x10000,0x14]};
export const speaker={gate:0,divisor:0x14};
export function outp(port,v){
 v&=0xff;
 if(port>=0x3c0&&port<=0x3df){ega.out(port,v);return;}
 switch(port){
  case 0x20:case 0x21:return; // PIC: EOI and mask writes have no effect in the virtual machine
  case 0x43:{const ch=v>>6;if(ch===3)return;if((v&0x30)===0){pit.latch[ch]=0;return;}pit.mode[ch]=v;pit.write[ch]=[];return;}
  case 0x40:case 0x42:{const ch=port-0x40;pit.write[ch].push(v);if(pit.write[ch].length===2){const d=pit.write[ch][0]|pit.write[ch][1]<<8;pit.write[ch]=[];pit.reload[ch]=d||0x10000;if(ch===0)setPitDivisor(d);else speaker.divisor=d||0x10000;record('pit',{ch,d});}return;}
  case 0x61:speaker.gate=v&3;return;
  default:unsupported(`OUT ${port.toString(16)}`);
 }
}
export function inp(port){
 if(port===0x3da)return vstatus();
 if(port===0x60)return state.port60;
 if(port===0x61)return speaker.gate;
 if(port===0x201)return 0xff;   // no joystick
 if(port===0x331||port===0x388)return 0xff; // no MPU-401, no AdLib
 unsupported(`IN ${port.toString(16)}`);return 0xff;
}

// ---- Emulated BIOS interrupt handlers (targets of vectors the game chains to) ----
export function installBios(){
 // INT 8: BIOS tick count and INT 1Ch.
 biosVector(8,()=>{const t=(frw(0x40,0x6c)|frw(0x40,0x6e)<<16)+1>>>0;fww(0x40,0x6c,t&0xffff);fww(0x40,0x6e,t>>>16);interrupt(0x1c);});
 biosVector(0x1c,()=>{});
 // INT 9 before the game hooks the keyboard: drop the key (no game code reads the BIOS buffer before kbdInstall).
 biosVector(9,()=>{});
}
// Keyboard hardware: a key event latches the scancode in port 60h and raises IRQ 1.
onInput('key',e=>{state.port60=e.down?e.code:e.code|0x80;interrupt(9);});
