// CGA graphics hardware model: colour/graphics adapter at B800:0000 (16 KB, plain RAM in the memory image), mode control 3D8,
// colour select 3D9, 6845 CRTC 3D4/3D5. The frame buffer needs no model of its own: the driver (src/game/cgadrv.js) writes it
// through the normal memory image and cgaFrame() reads it back for display.
// Frame buffer layout (static, driver row table 2fd2:0252): even scanlines at +0, odd scanlines at +0x2000, 80 bytes per line.
import {B,fwb} from './mem.js';

export const VRAM=0xb8000;
// Hardware options. noEga: the machine has no EGA BIOS (INT 10h AH=12h BL=10h leaves BX unchanged), so detection falls
// to the CGA probe. Not reset by createMachine; the host/test sets it before the machine starts.
export const hw={noEga:false};
export const cga={mode:3,active:false,modeCtl:0x29,colorSel:0x30,crtcIndex:0,crtc:new Uint8Array(32),border:0};

// IBM BIOS mode table values (mode control, colour select). Modes 0..7.
const MODE_CTL=[0x2c,0x28,0x2d,0x29,0x2a,0x2e,0x1e,0x29];
export function resetCga(){
 Object.assign(cga,{mode:3,active:false,modeCtl:0x29,colorSel:0x30,crtcIndex:0,border:0});cga.crtc.fill(0);
}
// INT 10h AH=00h for a CGA: programs 3D8/3D9, clears the 16 KB frame buffer (zeros in graphics modes, 0720h in text modes),
// and updates the BIOS data area (0040:0049 mode, 004A columns, 0065 3D8 copy, 0066 3D9 copy). `clear` false = AL bit 7.
// Modes 4 and 5 are 320x200 x 4 colours (2 bits per pixel), mode 6 is 640x200 x 2 colours (1 bit per pixel).
export function setMode(m,clear=true){
 m&=0x7f;cga.mode=m;cga.active=m>=4&&m<=6;
 if(m>7)return;                                     // EGA-only modes (0Dh, ...): nothing on the CGA side
 cga.modeCtl=MODE_CTL[m]??0x29;cga.colorSel=m===6?0x3f:0x30;
 if(clear){
  if(m>=4&&m<=6)B.fill(0,VRAM,VRAM+0x4000);
  else for(let i=0;i<0x4000;i+=2){B[VRAM+i]=0x20;B[VRAM+i+1]=7;}
 }
 fwb(0x40,0x4a,m<2||m===4||m===5?40:80);fwb(0x40,0x65,cga.modeCtl);fwb(0x40,0x66,cga.colorSel);
}
// INT 10h AH=0Bh: BH=0 sets the background/border colour (colour select bits 0-4), BH=1 selects the palette (bit 5).
export function setPalette(bh,bl){
 if(bh===0)cga.colorSel=cga.colorSel&0xe0|bl&0x1f;else if(bh===1)cga.colorSel=cga.colorSel&0xdf|(bl&1)<<5;
 fwb(0x40,0x66,cga.colorSel);
}
// Port writes. The 6845 index/data pair stores registers 0-31 (only R14-R17 are readable on real hardware).
export function out(port,v){
 v&=0xff;
 switch(port){
  case 0x3d4:cga.crtcIndex=v&0x1f;break;
  case 0x3d5:cga.crtc[cga.crtcIndex]=v;break;
  case 0x3d8:cga.modeCtl=v;break;
  case 0x3d9:cga.colorSel=v;cga.border=v&0xf;break;
 }
}
export function inp(port){
 switch(port){
  case 0x3d5:{const i=cga.crtcIndex;return i>=14&&i<=17?cga.crtc[i]:0xff;}
  default:return 0xff;
 }
}

// RGBI -> 0xRRGGBB (IBM colour monitor: colour 6 is brown).
export const RGBI=[0x000000,0x0000aa,0x00aa00,0x00aaaa,0xaa0000,0xaa00aa,0xaa5500,0xaaaaaa,0x555555,0x5555ff,0x55ff55,0x55ffff,0xff5555,0xff55ff,0xffff55,0xffffff];
// The three non-background colours of the 320x200 modes: colour select bit 5 picks cyan/magenta/white over green/red/brown;
// mode control bit 2 (mode 5, colour burst off) picks cyan/red/white; colour select bit 4 adds the intensity bit.
function palette4(){
 const hi=cga.colorSel&0x10?8:0;
 const base=cga.modeCtl&4?[3,4,7]:cga.colorSel&0x20?[3,5,7]:[2,4,6];
 return [cga.colorSel&0xf,base[0]|hi,base[1]|hi,base[2]|hi];
}
// The displayed frame as RGBI indices: {w,h,idx}. Mode 4/5: 320x200; mode 6: 640x200 (foreground = colour select bits 0-3,
// background black). APPROX: the CRTC start address (R12/R13) is ignored (the driver never sets it) and the overscan border is not drawn;
// video-enable off (3D8 bit 3) shows black. Other modes return an all-black 320x200.
export function cgaFrame(out){
 const g=cga.active;
 const w=g&&cga.mode===6?640:320;
 const idx=out&&out.length>=w*200?out:new Uint8Array(w*200);
 if(!g||!(cga.modeCtl&8)){idx.fill(0);return {w,h:200,idx};}
 if(cga.mode===6){
  const fg=cga.colorSel&0xf;
  for(let y=0;y<200;y++){const row=VRAM+(y&1)*0x2000+(y>>1)*80;
   for(let xb=0;xb<80;xb++){const v=B[row+xb];for(let k=0;k<8;k++)idx[y*640+xb*8+k]=v>>(7-k)&1?fg:0;}}
 }else{
  const p=palette4();
  for(let y=0;y<200;y++){const row=VRAM+(y&1)*0x2000+(y>>1)*80;
   for(let xb=0;xb<80;xb++){const v=B[row+xb];for(let k=0;k<4;k++)idx[y*320+xb*4+k]=p[v>>(6-2*k)&3];}}
 }
 return {w,h:200,idx};
}
