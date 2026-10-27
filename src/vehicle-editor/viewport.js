import {bounds} from './model.js';
export class Viewports{
 constructor(getState,onSelect,onDrag,onCommit){this.getState=getState;this.onSelect=onSelect;this.onDrag=onDrag;this.onCommit=onCommit;this.zoom=1;this.yaw=-.66;this.pitch=.36;this.canvases=[...document.querySelectorAll('canvas[data-view]')];this.cache=new Map();
 for(const c of this.canvases){c.oncontextmenu=e=>e.preventDefault();new ResizeObserver(()=>this.draw()).observe(c);c.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.3,Math.min(4,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();},{passive:false});c.onpointerdown=e=>this.down(e,c);c.onpointermove=e=>this.move(e,c);c.onpointerup=e=>this.up(e,c);c.onpointercancel=e=>this.up(e,c,true);}
 }
 fit(){this.zoom=1;this.center=null;this.draw();}
 project(v,c){const w=c.clientWidth,h=c.clientHeight,kind=c.dataset.view;let x,y,z=0;
 const center=this.center??[0,.7,0],a=v.map((n,i)=>n-center[i]);
 if(kind==='perspective'){x=a[0]*Math.cos(this.yaw)+a[2]*Math.sin(this.yaw);z=-a[0]*Math.sin(this.yaw)+a[2]*Math.cos(this.yaw);y=a[1]*Math.cos(this.pitch)-z*Math.sin(this.pitch);z=a[1]*Math.sin(this.pitch)+z*Math.cos(this.pitch);}
 else if(kind==='top'){x=a[0];y=a[2];}else if(kind==='front'){x=a[0];y=a[1];}else{x=a[2];y=a[1];}
 const scale=Math.min(w/(this.extent*1.35),h/(this.extent*(kind==='perspective'?.84:1.1)))*this.zoom;
 return {x:w/2+x*scale,y:h/2-y*scale,z,scale};
 }
 draw(){const {doc,selected,vertex,mode,wire}=this.getState();if(!doc)return;const all=doc.parts.flatMap(p=>p.vertices);const b=all.length?bounds({vertices:all}):{center:[0,.7,0],size:[2,2,5]};if(!this.center){this.center=b.center;this.extent=Math.max(2,...b.size);}
 for(const c of this.canvases){const dpr=Math.min(devicePixelRatio,2),w=c.clientWidth,h=c.clientHeight;if(!w||!h)continue;c.width=w*dpr;c.height=h*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 ctx.lineWidth=1;const line=(a,b,color)=>{const p=this.project(a,c),q=this.project(b,c);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();};
 const n=Math.ceil(this.extent*1.2);for(let i=-n;i<=n;i++){const k=c.dataset.view;let a,b,d,e;if(k==='perspective'||k==='top'){a=[i,0,-n];b=[i,0,n];d=[-n,0,i];e=[n,0,i];}else if(k==='front'){a=[i,-n,0];b=[i,n,0];d=[-n,i,0];e=[n,i,0];}else{a=[0,-n,i];b=[0,n,i];d=[0,i,-n];e=[0,i,n];}line(a,b,i===0?'#314451':'#1b2a35');line(d,e,i===0?'#314451':'#1b2a35');}
 const faces=[],verts=[];for(const p of doc.parts.filter(p=>p.visible)){const projected=p.vertices.map(v=>this.project(v,c));for(const [fi,f] of p.faces.entries())faces.push({p,color:p.faceColors?.[fi]??p.color,points:f.map(i=>projected[i]),depth:f.reduce((s,i)=>s+projected[i].z,0)/f.length});if(p.id===selected)projected.forEach((v,index)=>verts.push({...v,index}));}
 faces.sort((a,b)=>a.depth-b.depth);for(const f of faces){const is=f.p.id===selected;ctx.beginPath();f.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=wire?'#111f2a99':f.color+(is?'cc':'b0');ctx.fill();ctx.strokeStyle=is?'#f4b57b':wire?'#81a6ad99':'#15232cbb';ctx.lineWidth=is?1.3:.8;ctx.stroke();}
 if(mode==='vertex'){for(const v of verts){ctx.beginPath();ctx.arc(v.x,v.y,v.index===vertex?5:3,0,Math.PI*2);ctx.fillStyle=v.index===vertex?'#fff2cd':'#ecb17b';ctx.fill();}}
 this.cache.set(c,{faces,verts});ctx.font='10px ui-monospace, monospace';ctx.fillStyle='#72909d';ctx.fillText('1 GRID = 1 m',15,h-14);
 }
 }
 down(e,c){if(e.button!==0&&e.button!==2)return;c.setPointerCapture(e.pointerId);const rect=c.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const state=this.getState(),cache=this.cache.get(c);if(!cache)return;let picked=null,index=null;
 if(state.mode==='vertex')for(const v of [...cache.verts].sort((a,b)=>b.z-a.z))if(Math.hypot(v.x-x,v.y-y)<9){picked=state.selected;index=v.index;break;}
 if(!picked){const contains=pts=>{let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};for(const f of [...cache.faces].reverse())if(contains(f.points)){picked=f.p.id;break;}}
 if(e.button===2)picked=null;if(picked)this.onSelect(picked,index);
 this.drag={x:e.clientX,y:e.clientY,kind:c.dataset.view,orbit:c.dataset.view==='perspective',picked,index,scale:this.project([0,0,0],c).scale,moved:false,yaw:this.yaw,pitch:this.pitch};
 }
 move(e,c){const d=this.drag;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)<3&&!d.moved)return;d.moved=true;
 if(d.orbit){this.yaw=d.yaw+dx*.008;this.pitch=Math.max(-1.1,Math.min(1.1,d.pitch+dy*.006));this.draw();return;}
 if(!d.picked)return;let delta=d.kind==='top'?[dx/d.scale,0,-dy/d.scale]:d.kind==='front'?[dx/d.scale,-dy/d.scale,0]:[0,-dy/d.scale,dx/d.scale];this.onDrag(d.picked,d.index,delta);
 }
 up(e,c,cancel=false){if(!this.drag)return;const d=this.drag;this.drag=null;if(c.hasPointerCapture(e.pointerId))c.releasePointerCapture(e.pointerId);if(d.moved&&!d.orbit&&d.picked)this.onCommit(cancel);}
}
