// Dynamix resources use little-endian lengths and LSB-first LZW codes.
export const u16 = (b,p=0) => new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(p,true);
export const u32 = (b,p=0) => new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,true);
export const tag = b => String.fromCharCode(...b.slice(0,4));
export function chunks(b) {
 const out=[];
 for(let p=0;p<b.length;) {
  if(p+8>b.length) throw Error(`Truncated chunk at ${p}`);
  const name=tag(b.subarray(p)), flags=u32(b,p+4), size=flags&0x7fffffff;
  if(p+8+size>b.length) throw Error(`Invalid ${name} size`);
  const data=b.subarray(p+8,p+8+size);
  out.push({name,offset:p,size,data,children:flags>>>31?chunks(data):[]}); p+=8+size;
 } return out;
}
export function unpack(b) {
 const size=u32(b,1), method=b[0];
 if(size>16*1024*1024) throw Error('Resource exceeds 16 MB limit');
 const out=new Uint8Array(size); let o=0,p=5;
 if(method===0) {if(b.length-5<size)throw Error('Truncated raw data');return b.slice(5,5+size);}
 if(method===1) {
  while(o<size && p<b.length) {const n=b[p++];if(n>128){const v=b[p++];out.fill(v,o,o+(n&127));o+=n&127;}else if(n<128){out.set(b.subarray(p,p+n),o);p+=n;o+=n;}}
 } else if(method===2) {
  let bit=40,width=9,next=257,previous=null,cache=0,dict;
  const reset=()=>{dict=Array.from({length:4096},(_,i)=>i<256?Uint8Array.of(i):null);width=9;next=257;previous=null;cache=0;};reset();
  const read=n=>{if(bit+n>b.length*8)throw Error('Truncated LZW stream');let v=0;for(let i=0;i<n;i++,bit++)v|=((b[bit>>3]>>(bit&7))&1)<<i;return v;};
  while(o<size) {
   const code=read(width);cache=(cache+width)%(width*8);
   if(code===256){if(cache)bit+=width*8-cache;bit=Math.ceil(bit/8)*8;reset();continue;}
   let entry=dict[code];
   if(!entry && code===next && previous){entry=new Uint8Array(previous.length+1);entry.set(previous);entry[previous.length]=previous[0];}
   if(!entry)throw Error(`Invalid LZW code ${code} at ${o}`);
   if(o+entry.length>size)throw Error('LZW output overflow');out.set(entry,o);o+=entry.length;
   if(previous && next<4096){const item=new Uint8Array(previous.length+1);item.set(previous);item[previous.length]=entry[0];dict[next++]=item;cache=0;if(next===(1<<width)&&width<12)width++;}
   previous=entry;
  }
 } else throw Error(`Unknown compression ${method}`);
 if(o!==size)throw Error(`Decoded ${o}, expected ${size}`);return out;
}
export const EGA=['#000000','#0000aa','#00aa00','#00aaaa','#aa0000','#aa00aa','#aa5500','#aaaaaa','#555555','#5555ff','#55ff55','#55ffff','#ff5555','#ff55ff','#ffff55','#ffffff'];
export function images(nodes) {
 const result=[];
 for(const c of nodes){
  if(c.name==='BMP:'||c.name==='SCR:') {
   const bin=c.children.find(x=>x.name==='BIN:');if(!bin)continue;
   const data=unpack(bin.data),inf=c.children.find(x=>x.name==='INF:');
   const count=inf?u16(inf.data):1;let offset=0;
   for(let i=0;i<count;i++) {
    const width=inf?u16(inf.data,2+i*2):320,height=inf?u16(inf.data,2+count*2+i*2):200;
    const size=Math.ceil(width/2)*height;if(offset+size>data.length)throw Error('Image dimensions exceed pixels');
    const pixels=new Uint8Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=data[offset+y*Math.ceil(width/2)+(x>>1)];pixels[y*width+x]=x&1?v&15:v>>4;}
    result.push({width,height,pixels,label:`${c.name} frame ${i+1}`});offset+=size;
   }
   if(offset!==data.length)throw Error(`Unused bitmap bytes: ${data.length-offset}`);
  }else result.push(...images(c.children));
 }return result;
}
