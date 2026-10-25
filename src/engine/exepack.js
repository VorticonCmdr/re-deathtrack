// Microsoft EXEPACK reversal and relocation, shared by the browser runtime and Node tools.
export function unexepack(f){
 const u16=p=>f[p]|f[p+1]<<8,hdr=u16(8)*16,cs=u16(0x16),h=hdr+cs*16;
 const ep={ip:u16(h),cs:u16(h+2),exepackSize:u16(h+6),sp:u16(h+8),ss:u16(h+10),destLen:u16(h+12),skipLen:u16(h+14),minAlloc:u16(10)};
 if(f[h+16]!==0x52||f[h+17]!==0x42)throw Error('Not an EXEPACK executable');
 const packedLen=(cs-(ep.skipLen-1))*16,out=new Uint8Array(ep.destLen*16);out.set(f.subarray(hdr,hdr+packedLen));
 let src=packedLen-1,dst=ep.destLen*16-1;while(out[src]===0xff)src--;
 for(;;){const cmd=out[src--],len=out[src--]<<8|out[src--];
  if((cmd&0xfe)===0xb0){const v=out[src--];for(let i=0;i<len;i++)out[dst--]=v;}
  else if((cmd&0xfe)===0xb2){for(let i=0;i<len;i++)out[dst--]=out[src--];}
  else throw Error(`Bad EXEPACK command ${cmd.toString(16)} at ${src+1}`);
  if(cmd&1)break;}
 const s=f.subarray(h,h+ep.exepackSize),mark=indexOf(s,'Packed file is corrupt');if(mark<0)throw Error('No EXEPACK relocation table');
 let p=mark+22;const relocs=[];for(let seg=0;seg<16;seg++){const n=s[p]|s[p+1]<<8;p+=2;for(let i=0;i<n;i++,p+=2)relocs.push({seg:seg*0x1000,off:s[p]|s[p+1]<<8});}
 return {header:ep,image:out,relocs};
}
function indexOf(b,text){outer:for(let i=0;i+text.length<=b.length;i++){for(let j=0;j<text.length;j++)if(b[i+j]!==text.charCodeAt(j))continue outer;return i;}return -1;}
// Copies the image to linear memory at loadSeg and adds loadSeg to every relocated segment word.
export function loadImage(mem,{image,relocs},loadSeg){
 const base=loadSeg*16;mem.set(image,base);
 for(const r of relocs){const p=base+r.seg*16+r.off;const v=(mem[p]|mem[p+1]<<8)+loadSeg;mem[p]=v&255;mem[p+1]=v>>8&255;}
}
