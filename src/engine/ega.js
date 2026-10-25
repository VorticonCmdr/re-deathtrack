// EGA graphics hardware model for mode 0Dh: four 64 KiB planes, latches, write modes 0-2, read modes 0-1,
// sequencer map mask, graphics controller, CRTC start address and the attribute-controller palette.
export const planes=[new Uint8Array(0x10000),new Uint8Array(0x10000),new Uint8Array(0x10000),new Uint8Array(0x10000)];
export const regs={
 mapMask:0xf, setReset:0, enableSetReset:0, colorCompare:0, rotate:0, func:0, readMap:0,
 writeMode:0, readMode:0, colorDontCare:0xf, bitMask:0xff,
 start:0, palette:[0,1,2,3,4,5,20,7,56,57,58,59,60,61,62,63], overscan:0,
 seqIndex:0, gcIndex:0, crtcIndex:0, attrIndex:0, attrFlip:false, mode:3,
};
const latch=new Uint8Array(4);
const ror=(v,n)=>((v>>n)|(v<<(8-n)))&0xff;
function alu(v,l){switch(regs.func){case 1:return v&l;case 2:return v|l;case 3:return v^l;default:return v;}}

// Counts video memory accesses for the work-cost model (src/game/pacing.js).
export const work={vram:0};
// CPU write to A000:off.
export function wr(off,v){
 work.vram++;off&=0xffff;
 const mm=regs.mapMask,bm=regs.bitMask;
 if(regs.writeMode===1){for(let p=0;p<4;p++)if(mm&1<<p)planes[p][off]=latch[p];return;}
 const d=regs.writeMode===0?ror(v&0xff,regs.rotate):0;
 for(let p=0;p<4;p++){
  if(!(mm&1<<p))continue;
  let x;
  if(regs.writeMode===2)x=v&1<<p?0xff:0;
  else x=regs.enableSetReset&1<<p?(regs.setReset&1<<p?0xff:0):d;
  x=alu(x,latch[p]);
  planes[p][off]=(x&bm)|(latch[p]&~bm);
 }
}
// CPU read from A000:off (loads latches).
export function rd(off){
 work.vram++;off&=0xffff;
 for(let p=0;p<4;p++)latch[p]=planes[p][off];
 if(regs.readMode===0)return latch[regs.readMap&3];
 let r=0xff;
 for(let p=0;p<4;p++){if(!(regs.colorDontCare&1<<p))continue;const want=regs.colorCompare&1<<p?0xff:0;r&=~(latch[p]^want);}
 return r&0xff;
}
// Word OUT DX,AX: index from AL, data from AH (the data write happens even when AH is 0).
export function outw(port,v){out(port,v&0xff);out(port+1,v>>8&0xff);}
// Byte OUT. For backward compatibility a value above 0xFF is treated as a word OUT.
export function out(port,v){
 if(v>0xff){outw(port,v);return;}
 switch(port){
  case 0x3c4:regs.seqIndex=v&0xff;break;
  case 0x3c5:seq(regs.seqIndex,v);break;
  case 0x3ce:regs.gcIndex=v&0xff;break;
  case 0x3cf:gc(regs.gcIndex,v);break;
  case 0x3d4:regs.crtcIndex=v&0xff;break;
  case 0x3d5:crtc(regs.crtcIndex,v);break;
  case 0x3c0:if(!regs.attrFlip)regs.attrIndex=v&0x3f;else{if(regs.attrIndex<16)regs.palette[regs.attrIndex]=v&0x3f;else if(regs.attrIndex===0x11)regs.overscan=v&0x3f;}regs.attrFlip=!regs.attrFlip;break;
  default:break;
 }
}
function seq(i,v){if(i===2)regs.mapMask=v&0xf;}
function gc(i,v){
 switch(i){case 0:regs.setReset=v&0xf;break;case 1:regs.enableSetReset=v&0xf;break;case 2:regs.colorCompare=v&0xf;break;
  case 3:regs.rotate=v&7;regs.func=v>>3&3;break;case 4:regs.readMap=v&3;break;case 5:regs.writeMode=v&3;regs.readMode=v>>3&1;break;
  case 7:regs.colorDontCare=v&0xf;break;case 8:regs.bitMask=v&0xff;break;}
}
function crtc(i,v){if(i===0x0c)regs.start=regs.start&0xff|(v&0xff)<<8;else if(i===0x0d)regs.start=regs.start&0xff00|v&0xff;}
// Reading 3DA resets the attribute flip-flop.
export function resetAttrFlip(){regs.attrFlip=false;}
// INT 10h AH=00h mode 0Dh: clears video memory and resets registers like the BIOS.
export function setMode(mode){
 regs.mode=mode;for(const p of planes)p.fill(0);
 Object.assign(regs,{mapMask:0xf,setReset:0,enableSetReset:0,colorCompare:0,rotate:0,func:0,readMap:0,writeMode:0,readMode:0,colorDontCare:0xf,bitMask:0xff,start:0,overscan:0});
 // The BIOS loads 200-line attribute values for modes 0Dh/0Eh (bit 4 = intensity), 350-line values otherwise.
 regs.palette=mode===0x0d||mode===0x0e?[0,1,2,3,4,5,6,7,16,17,18,19,20,21,22,23]:[0,1,2,3,4,5,20,7,56,57,58,59,60,61,62,63];
}
// 200-line modes (0Dh): the monitor (and the VGA BIOS DAC table for these modes) uses bits 0-2 as RGB and
// bit 4 as intensity, like a CGA display; colour 6 shows as brown. The game relies on this (docs/re/graphics.md).
const CGA=[0x000000,0x0000aa,0x00aa00,0x00aaaa,0xaa0000,0xaa00aa,0xaa5500,0xaaaaaa,0x555555,0x5555ff,0x55ff55,0x55ffff,0xff5555,0xff55ff,0xffff55,0xffffff];
export const rgb200=c=>CGA[(c&7)|(c&0x10?8:0)];
// 6-bit EGA colour (rgbRGB, 350-line interpretation) to 0xRRGGBB.
export function egaRgb(c){const r=(c>>2&1)*0xaa+(c>>5&1)*0x55,g=(c>>1&1)*0xaa+(c>>4&1)*0x55,b=(c&1)*0xaa+(c>>3&1)*0x55;return r<<16|g<<8|b;}
// Chunky 4-bit pixels of the page starting at `start` (bytes), 320x200, 40 bytes per line.
export function pageIndices(start=regs.start,out=new Uint8Array(320*200)){
 for(let y=0;y<200;y++)for(let xb=0;xb<40;xb++){
  const o=start+y*40+xb&0xffff,a=planes[0][o],b=planes[1][o],c=planes[2][o],d=planes[3][o];
  for(let bit=0;bit<8;bit++){const s=7-bit;out[y*320+xb*8+bit]=(a>>s&1)|(b>>s&1)<<1|(c>>s&1)<<2|(d>>s&1)<<3;}
 }
 return out;
}
export function resetEga(){setMode(3);}
