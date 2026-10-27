import {exportTBL,transformOriginalNormals} from './original.js';
export const clone=x=>structuredClone(x);
export const uid=()=>crypto.randomUUID();
export const bounds=p=>{const v=p.vertices;const min=[0,1,2].map(k=>Math.min(...v.map(a=>a[k]))),max=[0,1,2].map(k=>Math.max(...v.map(a=>a[k])));return {min,max,center:min.map((n,k)=>(n+max[k])/2),size:min.map((n,k)=>max[k]-n)};};
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000);
export function validate(doc){
 if(!doc||doc.format!=='deathtrack-vehicle'||doc.version!==1||typeof doc.name!=='string'||!doc.name.trim()||doc.name.length>80||!Array.isArray(doc.parts)||doc.parts.length>80)throw Error('Invalid vehicle document (maximum 80 components).');
 const ids=new Set();let total=0;
 for(const p of doc.parts){if(typeof p.id!=='string'||p.id.length>80||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!/^#[0-9a-f]{6}$/i.test(p.color)||typeof p.visible!=='boolean')throw Error('Invalid component identity or appearance.');ids.add(p.id);
 if(!Array.isArray(p.vertices)||p.vertices.length<3||p.vertices.length>2048||!p.vertices.every(vector)||!Array.isArray(p.faces)||p.faces.length>4096)throw Error('Invalid mesh coordinates or size.');total+=p.vertices.length;
 for(const f of p.faces)if(!Array.isArray(f)||f.length<(doc.original?1:3)||f.length>32||(!doc.original&&new Set(f).size!==f.length)||f.some(i=>!Number.isInteger(i)||i<0||i>=p.vertices.length))throw Error('A face references invalid or repeated vertices.');
 }
 if(total>10000)throw Error('Vehicle exceeds 10,000 vertices.');return doc;
}
export function primitive(kind='box',name=kind,size=[1,1,1],position=[0,0,0],color='#bdc5cc'){
 if(!vector(size)||size.some(n=>n<=0)||!vector(position))throw Error('Size must be positive; coordinates must be finite.');
 let vertices=[],faces=[];
 if(kind==='wheel'){
  for(const x of [-.5,.5])for(let i=0;i<12;i++){const a=i*Math.PI/6;vertices.push([x,Math.cos(a)*.5,Math.sin(a)*.5]);}
  faces=[Array.from({length:12},(_,i)=>11-i),Array.from({length:12},(_,i)=>12+i)];for(let i=0;i<12;i++)faces.push([i,(i+1)%12,(i+1)%12+12,i+12]);
 }else if(kind==='box'||kind==='wedge'){
  vertices=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5],[-.5,.5,-.5],[.5,.5,-.5],[.5,.5,.5],[-.5,.5,.5]];
  if(kind==='wedge'){vertices[4]=[-.36,.5,-.22];vertices[5]=[.36,.5,-.22];vertices[6]=[.36,.5,.12];vertices[7]=[-.36,.5,.12];}
  faces=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
 }else throw Error('Choose box, wedge or wheel.');
 return {id:uid(),name,color,visible:true,vertices:vertices.map(v=>v.map((n,k)=>n*size[k]+position[k])),faces};
}
export function newVehicle(name='Interceptor / 01',preset='interceptor'){
 const doc={format:'deathtrack-vehicle',version:1,name,parts:[]};if(preset==='blank')return doc;
 const add=(...a)=>doc.parts.push(primitive(...a));
 add('box','Lower chassis',[1.86,.26,4.4],[0,.5,0],'#53616b');add('wedge','Armored body',[1.95,.62,4.25],[0,.84,0],'#b8c4bf');add('wedge','Cockpit',[1.53,.62,1.8],[0,1.43,-.25],'#416b79');
 add('box','Front splitter',[2.1,.12,.45],[0,.48,2.18],'#e3a16b');add('box','Rear bumper',[1.97,.22,.25],[0,.6,-2.2],'#596b75');
 for(const side of [-1,1]){add('box',side<0?'Left headlamp':'Right headlamp',[.55,.12,.08],[side*.62,.91,2.12],'#e8d8a4');add('box',side<0?'Left wing mount':'Right wing mount',[.10,.4,.16],[side*.68,1.05,-1.85],'#53616b');for(const z of [-1.4,1.38])add('wheel',(side<0?'Left':'Right')+(z<0?' rear wheel':' front wheel'),[.29,.85,.85],[side*1.0,.46,z],'#434c58');}
 add('box','Rear wing',[2.18,.12,.44],[0,1.3,-1.85],'#e3a16b');return doc;
}
export function applyOperation(document,op){
 const d=clone(document);const p=d.parts.find(p=>p.id===op.partId);
 if(d.original&&['add','mesh','remove','duplicate'].includes(op.type))throw Error('Original TBL mode keeps topology intact. Create a custom project to add components.');
 if(op.type==='rename'){d.name=op.name;}
 else if(op.type==='add'){d.parts.push(primitive(op.kind,op.name??op.kind,op.size??[1,1,1],op.position??[0,1,0],op.color??'#b8c4bf'));}
 else if(op.type==='mesh'){d.parts.push({id:uid(),name:op.name,color:op.color??'#b8c4bf',visible:true,vertices:op.vertices,faces:op.faces});}
 else{if(!p)throw Error('Select an existing component.');
 if(op.type==='update'){if(op.name!==undefined)p.name=op.name;if(op.color!==undefined){p.color=op.color;delete p.faceColors;if(d.original)p.originalRecolor=true;}if(op.visible!==undefined)p.visible=op.visible;}
 else if(op.type==='remove')d.parts=d.parts.filter(v=>v.id!==p.id);
 else if(op.type==='duplicate'){const q=clone(p);q.id=uid();q.name=p.name+' copy';if(op.mirror){q.vertices=q.vertices.map(v=>[-v[0],v[1],v[2]]);q.faces=q.faces.map(f=>[...f].reverse());q.name=p.name+' mirrored';}else q.vertices=q.vertices.map(v=>[v[0]+.3,v[1],v[2]]);d.parts.push(q);}
 else if(op.type==='vertex'){if(!Number.isInteger(op.index)||!p.vertices[op.index]||!vector(op.position))throw Error('Invalid vertex.');p.vertices[op.index]=op.position;}
 else if(op.type==='transform'){
 const t=op.translate??[0,0,0],s=op.scale??[1,1,1],r=op.rotate??[0,0,0];if(!vector(t)||!vector(s)||s.some(v=>v<=0)||!vector(r))throw Error('Invalid transform.');if(d.original)transformOriginalNormals(d,s,r);const c=bounds(p).center;
 p.vertices=p.vertices.map(v=>{let a=v.map((n,k)=>(n-c[k])*s[k]);for(let k=0;k<3;k++){const i=(k+1)%3,j=(k+2)%3,rad=r[k]*Math.PI/180,x=a[i],y=a[j];a[i]=x*Math.cos(rad)-y*Math.sin(rad);a[j]=x*Math.sin(rad)+y*Math.cos(rad);}return a.map((n,k)=>n+c[k]+t[k]);});if(d.original)d.original.normalBaseline=p.vertices.map(v=>[v[0]/.05,v[2]/.05,v[1]/.05].map(Math.round));
 }else throw Error('Unknown operation.');}
 if(d.original)exportTBL(d);
 return validate(d);
}
export function toOBJ(doc){validate(doc);let offset=1;const lines=['# Vehicle Foundry · metres · Y up · +Z forward'];for(const p of doc.parts.filter(p=>p.visible)){lines.push('o '+p.name.replace(/[^a-z0-9_-]/gi,'_'));for(const v of p.vertices)lines.push('v '+v.map(n=>Number(n.toFixed(6))).join(' '));for(const f of p.faces)lines.push((f.length===1?'p ':f.length===2?'l ':'f ')+f.map(i=>i+offset).join(' '));offset+=p.vertices.length;}return lines.join('\n')+'\n';}
export function summary(doc){return {parts:doc.parts.length,vertices:doc.parts.reduce((n,p)=>n+p.vertices.length,0),faces:doc.parts.reduce((n,p)=>n+p.faces.length,0)};}
