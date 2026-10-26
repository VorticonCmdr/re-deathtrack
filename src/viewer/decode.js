// Read-only inspector layouts, grounded in docs/re/resources.md and the translated loaders.
import {u16,u32,tag,unpack,EGA} from '../formats.js';
const s16=(b,p)=>u16(b,p)<<16>>16;
const need=(b,p,n)=>{if(!Number.isInteger(p)||p<0||p+n>b.length)throw Error(`Truncated resource at 0x${p.toString(16)}`);};
const wordList=(b,p,base)=>{const out=[];for(;;p+=2){need(b,p,2);const v=u16(b,p);if(v===65535)return out;need(b,base+v,2);out.push(base+v);}};
export function packedImage(b,width,height,label){
 if(!width||!height||width*height>4e6)throw Error('Invalid image dimensions');
 need(b,0,Math.ceil(width/2)*height);const pixels=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=b[y*Math.ceil(width/2)+(x>>1)];pixels[y*width+x]=x&1?v&15:v>>4;}
 return {width,height,pixels,label};
}
export function skyline(b){
 const data=unpack(b),count=u16(data);if(count>256)throw Error('Too many skyline strips');need(data,2,count*4);
 let p=2+count*4;const strips=[];
 for(let i=0;i<count;i++){const width=u16(data,2+2*i)*2,height=u16(data,2+2*count+2*i),size=width/2*height;need(data,p,size);strips.push(packedImage(data.subarray(p,p+size),width,height,`Strip ${i}`));p+=size;}
 if(p!==data.length)throw Error('Unexpected skyline data');
 const width=strips.reduce((n,s)=>n+s.width,0),height=Math.max(...strips.map(s=>s.height)),pixels=new Uint8Array(width*height);let x=0;
 for(const s of strips){for(let y=0;y<s.height;y++)pixels.set(s.pixels.subarray(y*s.width,(y+1)*s.width),y*width+x);x+=s.width;}
 return {data,strips,panorama:{width,height,pixels,label:'Full skyline · wraps horizontally'}};
}
export function track(b){
 if(tag(b)!=='TRK:')throw Error('Missing TRK signature');const n=u16(b,4);need(b,6,n*4);let p=6+n*4;
 if((b.length-p)%6)throw Error('Incomplete track point');const points=[],objects=[];
 for(let i=0;p<b.length;p+=6,i++){const point={x:s16(b,p),y:s16(b,p+2),z:s16(b,p+4)};if(i>=2&&!point.x&&!point.y&&!point.z)continue;points.push(point);}
 for(let i=0;i<n;i++){const index=u16(b,6+4*i),shape=s16(b,8+4*i),a=points[index],next=points[index+1];if(!a||!next)throw Error('Roadside point out of range');const side=shape>0?1:-1;objects.push({index,shape:Math.abs(shape),side:side>0?'left':'right',x:a.x+side*8*(a.y-next.y),y:a.y+side*8*(next.x-a.x),z:a.z});}
 return {points,objects};
}
export function models(b){
 const offsets=[];for(let p=0;;p+=4){need(b,p,4);const off=u16(b,p)+u16(b,p+2)*16;if(!off)break;need(b,off,6);offsets.push(off);if(offsets.length>4096)throw Error('Too many models');}
 return offsets.map((base,index)=>{
  const count=b[base+3],vp=base+u16(b,base+4);need(b,vp,count*6);
  const vertices=Array.from({length:count},(_,i)=>({x:s16(b,vp+i*6),y:s16(b,vp+i*6+2),z:s16(b,vp+i*6+4)}));
  const details=[];
  for(let p=base+6;;p+=4){need(b,p,2);if(u16(b,p)===65535)break;need(b,p,4);const dp=base+u16(b,p+2);need(b,dp,2);
   const groups=wordList(b,dp+2,base).map(gp=>({flags:b[gp],sortVertex:b[gp+1],faces:wordList(b,gp+2,base).map(fp=>{
    need(b,fp,4);const indices=[];let q=fp+3;for(;;q++){need(b,q,1);if(b[q]===255)break;if(b[q]>=count)throw Error('Face vertex out of range');indices.push(b[q]);}
    if(b[fp]!==255&&b[fp]>=count)throw Error('Normal vertex out of range');
    return {offset:fp-base,normal:b[fp],colors:[b[fp+1],b[fp+2]],indices};
   })}));
   details.push({threshold:s16(b,p),flags:b[dp],reference:b[dp+1],groups});
  }
  return {index,offset:base,radius:s16(b,base),vertices,details};
 });
}
export function palettes(nodes){
 return nodes.filter(c=>c.name==='PAL:').map((c,i)=>{
  const ega=c.children.find(c=>c.name==='EGA:');if(!ega)return null;need(ega.data,0,128);
  const words=Array.from({length:64},(_,j)=>u16(ega.data,2*j));
  return {name:`Palette ${i+1}`,words,colors:words.slice(0,16).map(w=>EGA[w&15]),cga:c.children.find(c=>c.name==='CGA:')?.data};
 }).filter(Boolean);
}
export function soundBank(nodes){
 const snd=nodes.find(c=>c.name==='SND:'&&c.children.length);if(!snd)return null;
 const inf=snd.children.find(c=>c.name==='INF:'),ibm=snd.children.find(c=>c.name==='IBM:');if(!inf||!ibm)return null;
 const count=u16(inf.data,2),data=unpack(ibm.data);need(data,0,count*4);
 const offsets=Array.from({length:count},(_,i)=>u32(data,i*4));
 const names={2:'duration',4:'PIT divisor',6:'pitch slide',10:'gate',12:'gate slide',28:'phase step',30:'wave depth',32:'loop count',46:'wave select',122:'relative call',124:'hold',126:'relative loop'};
 const effects=offsets.map((offset,index)=>{
  need(data,offset,8);const end=offsets[index+1]??data.length,commands=[];let p=offset+8;
  while(p<end){const start=p,raw=data[p++],op=raw&126;const value=op===124?null:(need(data,p,2),u16(data,p));if(value!==null)p+=2;
   commands.push({offset:start,op,name:names[op]||`field 0x${op.toString(16)}`,value,signed:value===null?null:value<<16>>16});if(op===2&&value===0)break;
  }
  return {index,offset,type:u16(data,offset),length:u16(data,offset+2),commands,trailing:end-p};
 });return {data,effects};
}
const TTM_NAMES={'1':'Load screen','2':'Load bitmap','4':'Load font','7':'Load palette','8':'Select bitmap slot','9':'Select palette slot',';':'Set frame delay','?':'Clip rectangle','@':'Select frame','B':'Draw frame','C':'Circle outline','D':'Filled circle','L':'Line','R':'Fill rectangle','S':'Fill rectangle (solid)','^':'Set foreground/background','`':'Select font slot','&':'Border color','*':'Activision logo','+':'Present page','-':'No-op','#':'Dissolve screen','$':'Set step delay','/':'End part','\v':'Free palette','\f':'Free bitmap','\r':'Free font'};
export function titleScript(data){
 let p=0,part=0;const commands=[];
 while(p<data.length){const offset=p,code=data[p++],op=String.fromCharCode(code);let args=[];
  if((code>=49&&code<=52)||(code>=1&&code<=9)||code===55||code===108){let end=data.indexOf(0,p);if(end<0)throw Error('Unterminated TTM string');args=[new TextDecoder().decode(data.subarray(p,end))];p=end+1;}
  else{let words;if([43,58,35,104,114,47].includes(code)||code<=13)words=0;else if([45,38,36,64,59,56,57,96].includes(code))words=1;else if([42,94].includes(code))words=2;else if((code>=66&&code<=92)||code===63)words=4;else throw Error(`Unknown TTM opcode 0x${code.toString(16)} at ${offset}`);need(data,p,words*2);args=Array.from({length:words},(_,i)=>s16(data,p+2*i));p+=words*2;}
  commands.push({offset,part,op:code<32?`0x${code.toString(16).padStart(2,'0')}`:op,name:TTM_NAMES[op]||(code>=71&&code<=81?'Screen transition':'Indexed opcode; runtime may stop'),args});if(code===47)part++;
 }return commands;
}
export function highScores(b){if(b.length!==190)throw Error('Expected ten 19-byte high-score records');return Array.from({length:10},(_,i)=>{const bytes=b.subarray(i*19,i*19+15),end=bytes.indexOf(0);return {slot:i,name:new TextDecoder('windows-1252').decode(bytes.subarray(0,end<0?15:end)),winnings:u32(b,i*19+15)};});}
