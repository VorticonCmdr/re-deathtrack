import {el,button,select,range,check,table,details,canvas,png,json,save} from './ui.js';
// Inspection renderer: orthographic camera / painter ordering, not the game's fixed-point rasterizer.
export function modelView(models,parent,name,palette,initial=0){
 const box=el('section',null,parent,{className:'panel wide'}),controls=el('div',null,box,{className:'controls'});
 let index=Math.max(0,Math.min(models.length-1,initial)),yaw=35,pitch=20,wire=false,spin=false,raf=0,last=0;
 const choice=select('Model',models.map(m=>[m.index,`${m.index} · ${m.vertices.length} vertices · radius ${m.radius}`]),controls,v=>{index=+v;update();});choice.value=String(index);
 button('Previous',controls,()=>{index=(index+models.length-1)%models.length;choice.value=index;update();});button('Next',controls,()=>{index=(index+1)%models.length;choice.value=index;update();});
 const yRange=range('Rotation',-180,180,yaw,controls,v=>{yaw=v;draw();});range('Tilt',-80,80,pitch,controls,v=>{pitch=v;draw();});check('Wireframe',controls,v=>{wire=v;draw();});
 const rotate=button('Auto rotate',controls,()=>{spin=!spin;rotate.textContent=spin?'Pause rotation':'Auto rotate';last=0;if(spin)raf=requestAnimationFrame(step);else cancelAnimationFrame(raf);});
 const c=canvas(box),ctx=c.getContext('2d'),stats=el('p','',box,{className:'muted'}),exportBar=el('div',null,box,{className:'controls'});c.setAttribute('aria-label','Rotatable 3D model');png(c,name+'-model',exportBar);
 button('Export model JSON',exportBar,()=>{save(JSON.stringify(models[index],null,2),`${name}-model-${index}.json`);});
 el('p','Orthographic inspection view. Faces use palette colors with painter ordering; the game’s clipping, dither patterns and fixed-point rasterization are not reproduced here.',box,{className:'muted'});
 const info=details('Model structure',box);
 function update(){info.querySelectorAll('pre').forEach(e=>e.remove());const m=models[index],d=m.details[0],faces=d?.groups.flatMap(g=>g.faces)||[];stats.textContent=`Model ${index} / ${models.length-1} · ${m.vertices.length} vertices (including normals) · ${d?.groups.length||0} groups · ${faces.length} faces · file offset 0x${m.offset.toString(16)}`;el('pre',JSON.stringify({radius:m.radius,details:m.details.map(d=>({threshold:d.threshold,flags:d.flags,reference:d.reference,groups:d.groups.length})),faces:faces.map(f=>({normal:f.normal,colors:f.colors,indices:f.indices}))},null,2),info);draw();}
 function draw(){
  const m=models[index],d=m.details[0],faces=d?.flags&128?[]:d?.groups.flatMap(g=>g.faces)||[];ctx.fillStyle='#0c1017';ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle='#202936';ctx.lineWidth=1;for(let x=0;x<c.width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}for(let y=0;y<c.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}
  const used=[...new Set(faces.flatMap(f=>f.indices))];if(!used.length){ctx.fillStyle='#b8c3d5';ctx.fillText('No visible faces in this detail level',30,40);return;}
  const vertices=used.map(i=>m.vertices[i]),bounds=['x','y','z'].map(k=>[Math.min(...vertices.map(v=>v[k])),Math.max(...vertices.map(v=>v[k]))]);
  const center=bounds.map(([a,b])=>(a+b)/2),radius=Math.max(...vertices.map(v=>Math.hypot(v.x-center[0],v.y-center[1],v.z-center[2])),1),scale=Math.min(c.width,c.height)*.4/radius;
  const a=yaw*Math.PI/180,b=pitch*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a),cp=Math.cos(b),sp=Math.sin(b);
  const points=m.vertices.map(v=>{const x=v.x-center[0],y=v.y-center[1],z=v.z-center[2],xx=x*cs-y*sn,yy=x*sn+y*cs;return {x:c.width/2+xx*scale,y:c.height/2-(z*cp-yy*sp)*scale,depth:yy*cp+z*sp};});
  const ordered=faces.filter(f=>f.indices.length).map(f=>({f,depth:f.indices.reduce((s,i)=>s+points[i].depth,0)/f.indices.length})).sort((a,b)=>b.depth-a.depth);
  for(const {f} of ordered){ctx.beginPath();f.indices.forEach((i,j)=>{const p=points[i];if(j)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});if(f.indices.length>2)ctx.closePath();const color=palette().colors[f.colors[0]&15];ctx.fillStyle=color;ctx.strokeStyle=wire?'#a1d6ef':color;ctx.lineWidth=wire?1:1.2;if(!wire&&f.indices.length>2)ctx.fill();if(f.indices.length===1){const p=points[f.indices[0]];ctx.fillRect(p.x,p.y,2,2);}else ctx.stroke();}
 }
 function step(t){if(!spin)return;if(last)yaw=(yaw+(t-last)*.025+180)%360-180;last=t;yRange.value=yaw;draw();raf=requestAnimationFrame(step);}
 update();return {redraw:draw,dispose:()=>{spin=false;cancelAnimationFrame(raf);}};
}
export function trackView(data,parent,name,onModel){
 const box=el('section',null,parent,{className:'panel wide'}),controls=el('div',null,box,{className:'controls'});let index=0,objects=true;
 const info=el('p','',box,{className:'muted'});range('Track point',0,data.points.length-1,0,controls,v=>{index=v;draw();});check('Roadside objects',controls,v=>{objects=v;draw();},true);
 const c=canvas(box,720,500),ctx=c.getContext('2d');c.setAttribute('aria-label','Track layout and roadside objects');png(c,name+'-layout',controls);json(data,name,controls);
 const points=data.points,xs=points.map(p=>p.x),ys=points.map(p=>p.y),zs=points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),minZ=Math.min(...zs),maxZ=Math.max(...zs),scale=Math.min(620/Math.max(1,maxX-minX),400/Math.max(1,maxY-minY));
 const xy=p=>[360+(p.x-(minX+maxX)/2)*scale,250-(p.y-(minY+maxY)/2)*scale];
 function draw(){ctx.fillStyle='#0c1017';ctx.fillRect(0,0,c.width,c.height);ctx.lineWidth=3;
  for(let i=1;i<points.length;i++){ctx.strokeStyle=`hsl(${190+(points[i].z-minZ)/Math.max(1,maxZ-minZ)*90} 75% 65%)`;ctx.beginPath();ctx.moveTo(...xy(points[i-1]));ctx.lineTo(...xy(points[i]));ctx.stroke();}
  if(objects){ctx.font='12px monospace';for(const o of data.objects){const [x,y]=xy(o);ctx.fillStyle='#ffba60';ctx.fillRect(x-3,y-3,6,6);ctx.fillText(String(o.shape),x+6,y-5);}}
  const [x,y]=xy(points[index]);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();const p=points[index];info.textContent=`${points.length} points · ${data.objects.length} objects · elevation ${minZ}…${maxZ} · point ${index}: (${p.x}, ${p.y}, ${p.z})`;
 }draw();
 el('p','Top-down centreline; color follows elevation. Orange labels are shape.tbl model indices. White marks the selected point.',box,{className:'muted'});
 const profile=canvas(box,720,130),pc=profile.getContext('2d');profile.setAttribute('aria-label','Track elevation profile');pc.fillStyle='#0c1017';pc.fillRect(0,0,720,130);pc.strokeStyle='#8cceee';pc.beginPath();points.forEach((p,i)=>{const x=10+i/(points.length-1)*700,y=110-(p.z-minZ)/Math.max(1,maxZ-minZ)*90;if(i)pc.lineTo(x,y);else pc.moveTo(x,y);});pc.stroke();
 const d=details('Roadside object placement',box);table(['Point','Model','Side','X','Y','Height'],data.objects.map(o=>[o.index,button(`Model ${o.shape}`,null,()=>onModel(o.shape)),o.side,o.x,o.y,o.z]),d);
}
