// Loads a DOSBox checkpoint (conventional memory + EGA planes + register state) into the virtual machine,
// and compares machine state against a checkpoint under explicit, documented exclusion rules.
import {B,DGROUP,LOAD_SEG} from './mem.js';
import {planes,regs} from './ega.js';

export const MEM_SIZE=0xa0000, PLANE_BASE=0xa0000;
export function loadCheckpoint(blob,vga){
 if(blob.length!==MEM_SIZE+0x40000)throw Error(`Checkpoint has ${blob.length} bytes, expected ${MEM_SIZE+0x40000}`);
 B.fill(0);B.set(blob.subarray(0,MEM_SIZE));
 for(let p=0;p<4;p++)planes[p].set(blob.subarray(PLANE_BASE+p*0x10000,PLANE_BASE+(p+1)*0x10000));
 if(vga){
  const g=vga.gc;
  Object.assign(regs,{setReset:g[0]&15,enableSetReset:g[1]&15,colorCompare:g[2]&15,rotate:g[3]&7,func:g[3]>>3&3,readMap:g[4]&3,
   writeMode:g[5]&3,readMode:g[5]>>3&1,colorDontCare:g[7]&15,bitMask:g[8],mapMask:vga.mapMask&15,start:vga.start,palette:vga.palette.map(v=>v&0x3f),mode:0x0d});
 }
}
const lin=(seg,off)=>seg*16+off;
const DS=DGROUP*16;
// Exclusions for race replay with timer interrupts disabled. Each names the writer that runs between
// checkpoints in DOSBox but not in the replay. Ranges are [start,end) linear addresses.
export function raceReplayExclusions(sp){
 return [
  {from:0,to:lin(LOAD_SEG-0x10,0),why:'IVT, BIOS data and DOS internals (BIOS INT 8 tick 0040:006C, DOS state); not modelled'},
  {from:lin(LOAD_SEG-0x10,0),to:lin(LOAD_SEG,0),why:'PSP (DOSBox command tail and DOS bookkeeping)'},
  {from:lin(LOAD_SEG,0xc328),to:lin(LOAD_SEG,0xc32c),why:'timer ISR 32-bit counter CS:c328'},
  {from:lin(LOAD_SEG,0xc355),to:lin(LOAD_SEG,0xc356),why:'timer ISR phase CS:c355'},
  {from:DS+0x5a9e,to:DS+0x5aa0,why:'tick callback down-counter [5a9e] (1000:a3be)'},
  {from:DS+0x2d26,to:DS+0x2d5b,why:'music sequencer and timer-slot state (1000:c731, ISR)'},
  {from:DS+0x2efe,to:DS+0x3004,why:'MT-32 output queue (DOSBox reference uses the MT-32 driver)'},
  {from:DS+0x30d2,to:DS+0x34d6,why:'synth voices, channel table and sysex state (driven by the sequencer tick)'},
  {from:DS+0x35ef,to:DS+0x37c4,why:'sound-effect voices and MIDI parser state (ISR effect tick 334e:0000)'},
  {from:DS+0x3502,to:DS+0x3508,why:'speaker round-robin state'},
  {from:DS+0xaaa0,to:DS+sp,why:'stack below SP at the checkpoint (dead data); the stack occupies DS:aaa0-ba40'},
 ];
}
// Returns differing ranges outside the exclusions, merged when closer than `gap` bytes.
export function diffMemory(expected,exclusions,gap=4,limit=50){
 const ex=exclusions.slice().sort((a,b)=>a.from-b.from);
 const out=[];let cur=null,ei=0,count=0;
 for(let a=0;a<MEM_SIZE;a++){
  while(ei<ex.length&&ex[ei].to<=a)ei++;
  if(ei<ex.length&&ex[ei].from<=a){a=ex[ei].to-1;continue;}
  if(B[a]!==expected[a]){count++;if(cur&&a-cur.to<=gap)cur.to=a+1;else{if(cur)out.push(cur);cur={from:a,to:a+1};}}
 }
 if(cur)out.push(cur);
 return {count,ranges:out.slice(0,limit),total:out.length};
}
export function diffPlanes(blob){
 let count=0;const first=[];
 for(let p=0;p<4;p++)for(let o=0;o<0x10000;o++)if(planes[p][o]!==blob[PLANE_BASE+p*0x10000+o]){count++;if(first.length<10)first.push({plane:p,off:o});}
 return {count,first};
}
export function describe(addr){
 const ds=addr-DS;if(ds>=0&&ds<0x10000)return `DS:${ds.toString(16).padStart(4,'0')}`;
 return `${(addr>>4).toString(16)}:${(addr&15).toString(16)} (lin ${addr.toString(16)})`;
}
