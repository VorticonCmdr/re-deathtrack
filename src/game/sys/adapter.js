// Segment 1ff8 adapter selection (EGA path), shutdown, BIOS video helpers and the divide-overflow handler.
// Static, from the raw-byte disassembly.
import {rb,rw,wb,ww,frb,fwb,fww,gseg,DGROUP} from '../../engine/mem.js';
import {register,unsupported} from '../../engine/host.js';
import {int10} from '../bios.js';
import {F,provide} from '../link.js';
import {f1ff8_418c,f1ff8_4014} from './input.js';

// 1ff8:20fe nullSlot: lone RETF; DS:4924 holds 35 far pointers to it until 20ff copies an adapter table.
// UNKNOWN: AX is whatever the caller left; 0 is returned.
export function f1ff8_20fe(){return 0;}
// 1ff8:20ff gfxSelectAdapter(req, mask): req != 0 selects the mask DS:49b6[req]; otherwise `mask` is used. Detects the
// adapter (21f5), copies its driver table to DS:4924 and calls its init. Only the EGA path (id 2: table DS:4d9c,
// init 29f6:13b5) is translated. Writes DS to 0000:04F0, sets [3856] = [3854] and [3858] = [3852]. Returns the id.
export function f1ff8_20ff(req,mask){
 const al=req&0xff;
 wb(0x49b5,al?rb(0x49b6+al):mask&0xff);
 wb(0x49b4,f1ff8_23a2());
 const id=f1ff8_21f5();wb(0x385d,id);
 if(id===2){f1ff8_21bc(0x4d9c);F.f29f6_13b5(0);} // slot 0 relies on CX = 0 left by 21bc's REP MOVSW
 else if(id===1||id===3||id===4||id===5||id===8)unsupported(`1ff8:20ff adapter ${id}`);
 else wb(0x385d,0);
 fww(0,0x4f0,DGROUP);
 ww(0x3856,rw(0x3854));ww(0x3858,rw(0x3852));
 return rb(0x385d);
}
// 1ff8:21bc copyDriverTable(si) (near, SI = source): 0x23 far pointers from DS:si to DS:4924.
export function f1ff8_21bc(si){for(let i=0;i<0x46;i++)ww(0x4924+2*i,rw(si+2*i));}
// 1ff8:21f5 gfxDetect (near): adapter id from the request mask DS:49b5. Translated: the EGA test (mask bit 1) through
// INT 10h AH=12h BL=10h and 0040:0087 bit 3. VGA/MCGA (mask FF or bit 7, bit 4), CGA, Hercules and Tandy probing are not.
export function f1ff8_21f5(){
 const m=rb(0x49b5);
 if(m===0xff||(m&0x80)||(m&0x10)){unsupported('1ff8:21f5 VGA/MCGA detection (INT 10h 1A00h)');return 0;}
 if(!(m&2)){unsupported('1ff8:21f5 CGA/Hercules/Tandy detection');return 0;}
 const r={ax:0x1200,bx:0x10};int10(r);
 if(r.bx===0x10){unsupported('1ff8:21f5 no EGA BIOS: CGA/Hercules/Tandy detection');return 0;}
 if(frb(0x40,0x87)&8){
  // EGA present but not the active display: switch the equipment bits to 80x25 colour and set mode 3.
  fwb(0x40,0x10,frb(0x40,0x10)&0xcf|0x20);int10({ax:3,bx:3});
 }
 return 2;
}
// 1ff8:21cd shutdown: kbdRestore, mouseShutdown, sound/timer shutdown (2524:4a94), divide-handler restore (3b56).
export function f1ff8_21cd(){f1ff8_418c();f1ff8_4014();F.f2524_4a94();f1ff8_3b56();}
// 1ff8:21e2 gfxRestoreMode: when DS:49b4 != FF, restores the BIOS equipment video bits and sets text mode 3.
export function f1ff8_21e2(){const al=rb(0x49b4);if(al===0xff)return al;f1ff8_237f(al);return al;}
// 1ff8:237f setEquipmentVideo(bits) (near): 0040:0010 = (& 0xcf) | bits << 4, then INT 10h AX=0003h.
export function f1ff8_237f(bits){fwb(0x40,0x10,frb(0x40,0x10)&0xcf|(bits<<4&0xff));int10({ax:3,bx:3});}
// 1ff8:23a2 getEquipmentVideo (near): (0040:0010 & 0x30) >> 4.
export function f1ff8_23a2(){return (frb(0x40,0x10)&0x30)>>4;}
// 1ff8:3af2 divInstall: saves INT 0 into DS:4b35 (offset) / 4b33 (segment), sets [4b32] = 1 and points INT 0 at 1ff8:3b1c.
export function f1ff8_3af2(){
 wb(0x4b32,1);ww(0x4b35,rw0(0));ww(0x4b33,rw0(2));
 fww(0,0,0x3b1c);fww(0,2,gseg(0x1ff8));
}
const rw0=o=>frb(0,o)|frb(0,o+1)<<8;
// 1ff8:3b1c divOverflowHandler (INT 0 ISR): on a divide fault it halves the dividend (word DIV/IDIV: SAR DX / RCR AX;
// byte form: SAR AX) and IRETs to retry the division (backing IP up by 2 when the return IP is past the instruction,
// as on an 8086). So after 2524:0260, an overflowing DIV/IDIV retries with dividend >> 1 until it fits; a divide by
// zero (or dividend -1/0 with divisor 0) loops forever. This needs CPU state and is modelled in the integer helpers
// (engine need); reaching it as a function is a port error.
export function f1ff8_3b1c(){unsupported('1ff8:3b1c divide-overflow handler must be modelled by the integer helpers');}
// 1ff8:3b56 divRestore: clears [4b32]. QUIRK: the restore reads ES:[0]/[2] instead of writing them (MOV AX,ES:[0],
// bytes 26 a1 00 00), so INT 0 stays pointed at 3b1c after exit.
export function f1ff8_3b56(){if(rb(0x4b32))wb(0x4b32,0);}
export {f1ff8_20ff as gfxSelectAdapter,f1ff8_21cd as sysShutdown,f1ff8_21e2 as gfxRestoreMode};
provide({f1ff8_20fe,f1ff8_20ff,f1ff8_21bc,f1ff8_21f5,f1ff8_21cd,f1ff8_21e2,f1ff8_237f,f1ff8_23a2,f1ff8_3af2,f1ff8_3b1c,f1ff8_3b56});
register(0x1ff8,0x20fe,f1ff8_20fe);
register(0x1ff8,0x3b1c,f1ff8_3b1c);
