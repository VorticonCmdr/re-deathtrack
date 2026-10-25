// Writes a plain MZ (header + relocations + unpacked image) with the real entry point, for Ghidra.
import {readFile,writeFile} from 'node:fs/promises';
import {unexepack} from '../src/engine/exepack.js';
export function toMz({header:h,image,relocs}){
 const hdrSize=Math.ceil((0x1c+relocs.length*4)/16)*16,total=hdrSize+image.length,o=new Uint8Array(total),v=new DataView(o.buffer);
 const w=(p,x)=>v.setUint16(p,x,true);o[0]=0x4d;o[1]=0x5a;w(2,total%512);w(4,Math.ceil(total/512));w(6,relocs.length);w(8,hdrSize/16);
 w(10,h.minAlloc);w(12,0xffff);w(14,h.ss);w(16,h.sp);w(20,h.ip);w(22,h.cs);w(24,0x1c);
 relocs.forEach((r,i)=>{w(0x1c+i*4,r.off);w(0x1e+i*4,r.seg);});o.set(image,hdrSize);return o;
}
const [input,output]=process.argv.slice(2);
const r=unexepack(new Uint8Array(await readFile(input)));
if(output)await writeFile(output,toMz(r));
console.log(JSON.stringify({...r.header,imageBytes:r.image.length,relocations:r.relocs.length}));
