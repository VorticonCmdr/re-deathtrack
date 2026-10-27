// Editor data and TRK writer. Layout: docs/re/resources.md, 1000:4fae / 2524:18f4.
import {track} from '../viewer/decode.js';
import {u16} from '../formats.js';
export const MAX_POINTS=1908,MAX_OBJECTS=20;
export const copy=d=>structuredClone(d);
export const coreCount=d=>d.points.length-2;
export function importTrack(bytes,name){
 const parsed=track(bytes),padding=[];let kept=0;
 for(let p=6+u16(bytes,4)*4,raw=0;p<bytes.length;p+=6,raw++){
  if(raw>=2&&bytes.subarray(p,p+6).every(v=>v===0))padding.push(kept);else kept++;
 }
 const d={version:1,name:name.replace(/\.trk$/i,''),filename:name,points:parsed.points,objects:parsed.objects.map(({index,shape,side})=>({index,shape,side})),padding};validateProject(d);return d;
}
export function validateProject(d){
 if(!d||d.version!==1||typeof d.name!=='string'||typeof d.filename!=='string')throw Error('This is not a Circuit Lab project.');
 if(!Array.isArray(d.points)||d.points.length<5||d.points.length>MAX_POINTS)throw Error(`Tracks need 5–${MAX_POINTS} points.`);
 if(!Array.isArray(d.objects)||d.objects.length>MAX_OBJECTS)throw Error(`The editor supports up to ${MAX_OBJECTS} roadside objects.`);
 for(const p of d.points)for(const key of ['x','y','z'])if(!Number.isInteger(p?.[key])||p[key]<-32768||p[key]>32767)throw Error('Coordinates must be signed 16-bit whole numbers.');
 for(const o of d.objects){if(!Number.isInteger(o.index)||o.index<0||o.index>=d.points.length-1)throw Error('An object refers to a missing road point.');if(!Number.isInteger(o.shape)||o.shape<0||o.shape>123)throw Error('Choose a scenery model from 0–123.');if(!['left','right'].includes(o.side)||(!o.shape&&o.side==='left'))throw Error('Model 0 can only be placed on the right (TRK sign encoding).');}
 if(d.padding&&!Array.isArray(d.padding))throw Error('Invalid preserved track padding.');
 if((d.padding?.length||0)>10000||d.padding?.some(p=>!Number.isInteger(p)||p<2||p>d.points.length))throw Error('Invalid preserved zero records.');
 return d;
}
export function inspect(d){
 const errors=[],warnings=[];try{validateProject(d);}catch(e){errors.push(e.message);return {errors,warnings,length:0,minZ:0,maxZ:0,longest:0};}
 let length=0,longest=0;for(let i=1;i<coreCount(d);i++){const a=d.points[i-1],b=d.points[i],n=Math.hypot(a.x-b.x,a.y-b.y);length+=n;longest=Math.max(longest,n);}
 const a=d.points[coreCount(d)-1],b=d.points[0];const closing=Math.hypot(a.x-b.x,a.y-b.y);length+=closing;longest=Math.max(longest,closing);
 if(d.points.slice(2).some(p=>!p.x&&!p.y&&!p.z))errors.push('A point at (0, 0, 0) would be discarded by the game. Move it away from the origin.');
 if(longest>75)warnings.push(`Longest road segment is ${Math.round(longest)} units. Redistribute points for smoother spacing.`);
 const tail=Math.hypot(d.points.at(-2).x-b.x,d.points.at(-2).y-b.y);
 if(tail>90)warnings.push('The end of the circuit is far from the start. Check the closing bend.');
 if(d.points.some(p=>p.z<0||p.z>200))warnings.push('Some elevations exceed the original tracks’ 0–200 range.');
 return {errors,warnings,length,longest,minZ:Math.min(...d.points.map(p=>p.z)),maxZ:Math.max(...d.points.map(p=>p.z))};
}
export function exportTrack(d){
 const status=inspect(d);if(status.errors.length)throw Error(status.errors[0]);
 const padding=new Map();for(const i of d.padding||[])padding.set(i,(padding.get(i)||0)+1);
 const b=new Uint8Array(6+d.objects.length*4+(d.points.length+(d.padding?.length||0))*6),v=new DataView(b.buffer);b.set([84,82,75,58]);v.setUint16(4,d.objects.length,true);let p=6;
 for(const o of d.objects){v.setUint16(p,o.index,true);v.setInt16(p+2,o.shape*(o.side==='left'?1:-1),true);p+=4;}
 for(let i=0;i<=d.points.length;i++){p+=(padding.get(i)||0)*6;if(i===d.points.length)break;for(const key of ['x','y','z']){v.setInt16(p,d.points[i][key],true);p+=2;}}
 return b;
}
export function objectPosition(d,o){const p=d.points[o.index],q=d.points[o.index+1],side=o.side==='left'?1:-1;return {x:p.x+side*8*(p.y-q.y),y:p.y+side*8*(q.x-p.x),z:p.z};}
const clamp=v=>Math.max(-32768,Math.min(32767,Math.round(v)));
export function deform(d,original,index,radius,delta){
 const n=coreCount(d);for(let i=0;i<n;i++){const distance=Math.min(Math.abs(i-index),n-Math.abs(i-index)),t=Math.max(0,1-distance/Math.max(1,radius)),weight=t*t*(3-2*t);for(const k of ['x','y','z'])d.points[i][k]=clamp(original.points[i][k]+(delta[k]||0)*weight);}
 // Preserve each source's original continuation offset as the start moves.
 for(let i=0;i<2;i++)for(const k of ['x','y','z'])d.points[n+i][k]=clamp(original.points[n+i][k]+d.points[i][k]-original.points[i][k]);
}
export function smooth(d,index,radius){const old=copy(d),n=coreCount(d);for(let i=0;i<n;i++){const distance=Math.min(Math.abs(i-index),n-Math.abs(i-index)),w=Math.max(0,1-distance/Math.max(1,radius))*.65;for(const k of ['x','y','z'])d.points[i][k]=clamp(old.points[i][k]*(1-w)+(old.points[(i+n-3)%n][k]+old.points[(i+3)%n][k])/2*w);}for(let i=0;i<2;i++)for(const k of ['x','y','z'])d.points[n+i][k]=clamp(d.points[n+i][k]+d.points[i][k]-old.points[i][k]);}
export function redistribute(d,spacing=30){
 const old=d.points.slice(0,coreCount(d)),segments=old.map((p,i)=>Math.hypot(p.x-old[(i+1)%old.length].x,p.y-old[(i+1)%old.length].y)),total=segments.reduce((a,b)=>a+b,0);if(total<120)throw Error('The circuit is too short to redistribute.');
 const count=Math.max(8,Math.ceil(total/spacing));if(count+2>MAX_POINTS)throw Error(`This layout needs ${count+2} points at 30-unit spacing; shorten it before redistributing.`);
 const points=[];let seg=0,run=0;for(let i=0;i<count;i++){const t=i/count*total;while(seg<segments.length-1&&run+segments[seg]<t){run+=segments[seg++];}const f=segments[seg]?((t-run)/segments[seg]):0,a=old[seg],b=old[(seg+1)%old.length];points.push(Object.fromEntries(['x','y','z'].map(k=>[k,clamp(a[k]+(b[k]-a[k])*f)])));}
 const cumulative=[0];for(const len of segments)cumulative.push(cumulative.at(-1)+len);
 d.objects=d.objects.map(o=>({...o,index:Math.min(count-1,Math.round(cumulative[Math.min(o.index,old.length)]/total*count))}));
 // The game's loader drops zero triples after point 1. A one-unit translation avoids a zero closing sample.
 if(points.some(p=>!p.x&&!p.y&&!p.z))for(const p of points)p.x=clamp(p.x+1);
 d.points=[...points,copy(points[0]),copy(points[1])];d.padding=[];return d;
}
export function newCircuit(){
 const points=[];for(let i=0;i<400;i++){const t=i/400*Math.PI*2,r=1+.16*Math.sin(3*t)+.12*Math.cos(2*t);points.push({x:Math.round(6000+3700*r*Math.cos(t)),y:Math.round(5000+2400*r*Math.sin(t)),z:Math.round(35+35*Math.sin(t)**2)});}
 const d={version:1,name:'Untitled circuit',filename:'custom.trk',points:[...points,copy(points[0]),copy(points[1])],objects:[],padding:[]};return redistribute(d);
}
export function projectJSON(d){return JSON.stringify({app:'Deathtrack Circuit Lab',...d},null,2);}
