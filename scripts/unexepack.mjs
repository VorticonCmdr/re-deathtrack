// Reverses Microsoft EXEPACK so the static image can be compared with Ghidra and live memory.
import {readFile,writeFile} from 'node:fs/promises';
export function unexepack(f){
 const u16=p=>f[p]|f[p+1]<<8,hdr=u16(8)*16,cs=u16(0x16),h=hdr+cs*16;
 const ep={ip:u16(h),cs:u16(h+2),exepackSize:u16(h+6),sp:u16(h+8),ss:u16(h+10),destLen:u16(h+12),skipLen:u16(h+14),sig:String.fromCharCode(f[h+16],f[h+17])};
 if(ep.sig!=='RB')throw Error('Not EXEPACK');
 const packedLen=(cs-(ep.skipLen-1))*16,out=new Uint8Array(ep.destLen*16);out.set(f.subarray(hdr,hdr+packedLen));
 let src=packedLen-1,dst=ep.destLen*16-1;while(out[src]===0xff)src--;
 for(;;){const cmd=out[src--],len=out[src--]<<8|out[src--];
  if((cmd&0xfe)===0xb0){const v=out[src--];for(let i=0;i<len;i++)out[dst--]=v;}
  else if((cmd&0xfe)===0xb2){for(let i=0;i<len;i++)out[dst--]=out[src--];}
  else throw Error(`Bad EXEPACK command ${cmd.toString(16)} at ${src+1}`);
  if(cmd&1)break;}
 const s=f.subarray(h,h+ep.exepackSize),mark=Buffer.from(s).indexOf('Packed file is corrupt');if(mark<0)throw Error('No relocation table');
 let p=mark+22;const relocs=[];for(let seg=0;seg<16;seg++){const n=s[p]|s[p+1]<<8;p+=2;for(let i=0;i<n;i++,p+=2)relocs.push({seg:seg*0x1000,off:s[p]|s[p+1]<<8});}
 return {header:ep,image:out,relocs};
}
// Rebuilds a plain MZ (header + relocations + unpacked image) with the real entry point, for Ghidra.
export function toMz({header:h,image,relocs},orig){
 const relBytes=relocs.length*4,hdrSize=Math.ceil((0x1c+relBytes)/16)*16,total=hdrSize+image.length,o=new Uint8Array(total),v=new DataView(o.buffer);
 const w=(p,x)=>v.setUint16(p,x,true);o[0]=0x4d;o[1]=0x5a;w(2,total%512);w(4,Math.ceil(total/512));w(6,relocs.length);w(8,hdrSize/16);
 w(10,orig[10]|orig[11]<<8);w(12,0xffff);w(14,h.ss);w(16,h.sp);w(20,h.ip);w(22,h.cs);w(24,0x1c);
 relocs.forEach((r,i)=>{w(0x1c+i*4,r.off);w(0x1e+i*4,r.seg);});o.set(image,hdrSize);return o;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [input,output]=process.argv.slice(2);const r=unexepack(new Uint8Array(await readFile(input)));
 if(output)await writeFile(output,toMz(r,new Uint8Array(await readFile(input))));
 console.log(JSON.stringify({...r.header,imageBytes:r.image.length,relocations:r.relocs.length}));
}
