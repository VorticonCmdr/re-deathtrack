// Lossless TBL editing: keep the container and patch only the selected model.
import {models} from '../viewer/decode.js';
export const palette=['#000000','#0000aa','#00aa00','#00aaaa','#aa0000','#aa00aa','#aa5500','#aaaaaa','#555555','#5555ff','#55ff55','#55ffff','#ff5555','#ff55ff','#ffff55','#ffffff'];
const facesOf=m=>[...new Map(m.details.flatMap(d=>d.groups.flatMap(g=>g.faces)).map(f=>[f.offset,f])).values()];
const vec=v=>[v.x,v.y,v.z],equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function inspectTBL(bytes){return models(bytes).map(m=>({index:m.index,vertices:m.vertices.length,faces:facesOf(m).length}));}
export function importTBL(bytes,filename='vehicle.tbl',index=0){
 const m=models(bytes)[index];if(!m)throw Error('Model index is out of range.');
 const faces=facesOf(m),slots=[...new Set(faces.flatMap(f=>f.indices))].sort((a,b)=>a-b);
 if(slots.length<3)throw Error('This model has fewer than three geometry vertices.');
 return {format:'deathtrack-vehicle',version:1,name:filename.replace(/\.tbl$/i,'')+(index?' / '+index:''),original:{filename,modelIndex:index,bytes:Array.from(bytes)},parts:[{id:crypto.randomUUID(),name:'Original mesh',color:'#aaaaaa',visible:true,vertices:slots.map(i=>{const v=m.vertices[i];return [v.x*.05,v.z*.05,v.y*.05];}),faces:faces.map(f=>f.indices.map(i=>slots.indexOf(i))),faceColors:faces.map(f=>palette[f.colors[0]&15])}]};
}
function normal(points){const n=[0,0,0];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);}return n;}
export function exportTBL(doc){
 const o=doc.original;if(!o||!Array.isArray(o.bytes)||o.bytes.length>1e6||!o.bytes.every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw Error('A valid original TBL source is required.');
 const bytes=Uint8Array.from(o.bytes),m=models(bytes)[o.modelIndex];if(!m)throw Error('Invalid original model index.');
 const source=importTBL(bytes,o.filename,o.modelIndex).parts[0],p=doc.parts[0];
 if(doc.parts.length!==1||!p||p.vertices.length!==source.vertices.length||!equal(p.faces,source.faces))throw Error('Original TBL mode preserves topology. Edit existing vertices, dimensions and colors; adding/removing components requires a custom project.');
 const faces=facesOf(m),slots=[...new Set(faces.flatMap(f=>f.indices))].sort((a,b)=>a-b),dv=new DataView(bytes.buffer),vp=m.offset+dv.getUint16(m.offset+4,true),changed=new Set();
 const write=(i,v)=>v.forEach((x,k)=>{if(!Number.isFinite(x)||x<-32768||x>32767)throw Error('Coordinates exceed the original signed 16-bit range.');dv.setInt16(vp+i*6+k*2,Math.round(x),true);});
 const next=m.vertices.map(vec);
 p.vertices.forEach((v,i)=>{const xyz=[v[0]/.05,v[2]/.05,v[1]/.05].map(Math.round);if(!equal(xyz,next[slots[i]])){changed.add(slots[i]);next[slots[i]]=xyz;write(slots[i],xyz);}});
 // Preserve the source normal's sign and length, while correcting edited face planes.
 const baseline=m.vertices.map(vec);if(o.normalBaseline){if(!Array.isArray(o.normalBaseline)||o.normalBaseline.length!==slots.length||!o.normalBaseline.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('Invalid normal baseline');slots.forEach((slot,i)=>baseline[slot]=o.normalBaseline[i]);}
 const normals=new Map();for(const f of faces){if(f.normal===255||f.indices.length<3||!f.indices.some(i=>changed.has(i)))continue;const old=normal(f.indices.map(i=>baseline[i])),now=normal(f.indices.map(i=>next[i])),n=o.normalOverrides?.[f.normal]??vec(m.vertices[f.normal]),length=Math.hypot(...now);if(length<1e-8&&Math.hypot(...old)<1e-8)continue;if(length<1e-8)throw Error('An edited face collapsed. Undo or move its vertices apart.');if(Math.hypot(...old)>0&&old.reduce((s,x,k)=>s+x*now[k],0)/(Math.hypot(...old)*length)>1-1e-10)continue;const sign=old.reduce((s,x,k)=>s+x*n[k],0)<0?-1:1,value=now.map(x=>x/length*Math.hypot(...n)*sign);const prior=normals.get(f.normal);if(prior&&prior.some((x,k)=>Math.abs(x-value[k])>2))throw Error('These faces share a normal but now have different planes. Keep shared faces aligned.');normals.set(f.normal,value);}
 for(const [i,v] of Object.entries(o.normalOverrides??{})){if(!Number.isInteger(+i)||+i<0||+i>=m.vertices.length||slots.includes(+i)||!Array.isArray(v)||v.length!==3)throw Error('Invalid normal override');write(+i,v);}
 for(const [i,v] of normals)write(i,v);
 if(changed.size){const radius=Math.ceil(Math.max(...slots.map(i=>Math.hypot(...next[i]))));if(radius>32767)throw Error('Model radius exceeds original format.');dv.setInt16(m.offset,Math.max(m.radius,radius),true);}
 if(p.originalRecolor||p.color!==source.color){const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),c=rgb(p.color),nearest=palette.map((h,i)=>({i,d:rgb(h).reduce((s,v,k)=>s+(v-c[k])**2,0)})).sort((a,b)=>a.d-b.d)[0].i;for(const f of faces)for(const k of [1,2])bytes[m.offset+f.offset+k]=(bytes[m.offset+f.offset+k]&240)|nearest;}
 models(bytes);return bytes;
}
export function transformOriginalNormals(doc,scale,rotation){
 const m=models(exportTBL(doc))[doc.original.modelIndex],indices=new Set(m.details.flatMap(d=>d.groups.flatMap(g=>[g.sortVertex,...g.faces.map(f=>f.normal)])).filter(i=>i!==255));
 doc.original.normalOverrides={};for(const i of indices){const v=m.vertices[i];if(!v)continue;const length=Math.hypot(v.x,v.y,v.z);let a=[v.x/scale[0],v.z/scale[1],v.y/scale[2]];for(let k=0;k<3;k++){const j=(k+1)%3,l=(k+2)%3,r=rotation[k]*Math.PI/180,x=a[j],y=a[l];a[j]=x*Math.cos(r)-y*Math.sin(r);a[l]=x*Math.sin(r)+y*Math.cos(r);}const n=Math.hypot(...a)||1;doc.original.normalOverrides[i]=[a[0],a[2],a[1]].map(x=>x/n*length);}
}
