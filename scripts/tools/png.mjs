// Tiny PNG writer (RGB, no filtering) for debugging and evidence images.
import {deflateSync} from 'node:zlib';
const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^c>>>1:c>>>1;return c;});
const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^c>>>8;return (c^-1)>>>0;};
const chunk=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4,'ascii');d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b;};
export function png(w,h,rgb){
 const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;Buffer.from(rgb.buffer,rgb.byteOffset+y*w*3,w*3).copy(raw,y*(w*3+1)+1);}
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
