import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
export function carTextures(scene,id){
 const paint=new DynamicTexture('worn livery '+id,{width:768,height:512},scene,true),surface=new DynamicTexture('paint roughness '+id,{width:768,height:512},scene,true),c=paint.getContext(),r=surface.getContext(),random=rng(1907+id*83);
 c.fillStyle='#c8c9bf';c.fillRect(0,0,768,512);r.fillStyle='rgb(255,180,35)';r.fillRect(0,0,768,512);
 for(let panel=0;panel<3;panel++){
  const x=panel*256;
  // Independently mapped roof/hood, flanks and ends. Borders become panel seams.
  c.fillStyle='#30383a';c.fillRect(x+10,0,3,512);c.fillRect(x+243,0,3,512);c.fillRect(x,125,256,3);c.fillRect(x,370,256,3);
  c.fillStyle='#777e78';c.fillRect(x+15,131,227,2);
  c.fillStyle='#28353a';c.fillRect(x+92,0,25,512);c.fillStyle='#737b73';c.fillRect(x+121,0,7,512);
  c.fillStyle='#1a2529';c.fillRect(x+148,181,85,86);c.fillStyle='#e5e5d6';c.font='bold 62px monospace';c.textAlign='center';c.fillText(String(id+1).padStart(2,'0'),x+190,247);
  for(let j=0;j<6;j++){c.fillStyle='#252f32';c.fillRect(x+25,283+j*10,52,5);}
  c.fillStyle='#393d37';c.font='bold 12px monospace';c.fillText('DTRACK',x+193,322);
  for(const py of [16,116,380,493])for(const px of [19,236]){c.fillStyle='#4b5354';c.beginPath();c.arc(x+px,py,2.5,0,Math.PI*2);c.fill();}
 }
 for(let i=0;i<2200;i++){const x=random()*768,y=random()*512,w=1+random()*5,h=.5+random()*2;c.fillStyle=random()>.6?'#626963':'#a2a59a';c.fillRect(x,y,w,h);r.fillStyle='rgb(255,225,180)';r.fillRect(x,y,w,h);}
 for(let i=0;i<95;i++){const x=random()*768,y=random()*512;c.strokeStyle='#737a72';c.lineWidth=.5+random();c.beginPath();c.moveTo(x,y);c.lineTo(x+random()*34,y+random()*7);c.stroke();}
 for(let panel=0;panel<3;panel++){const g=c.createLinearGradient(0,360,0,512);g.addColorStop(0,'#292b2600');g.addColorStop(1,'#292b26aa');c.fillStyle=g;c.fillRect(panel*256,360,256,152);}
 paint.update();surface.update();return {paint,surface};
}
export function asphaltTexture(scene){
 const t=new DynamicTexture('patched asphalt',{width:512,height:1024},scene,true),c=t.getContext(),random=rng(8763);c.fillStyle='#727774';c.fillRect(0,0,512,1024);
 for(let i=0;i<65000;i++){const g=Math.floor(55+random()*90);c.fillStyle=`rgba(${g},${g},${g},.3)`;c.fillRect(random()*512,random()*1024,1+random(),1+random());}
 for(let i=0;i<14;i++){const x=random()*512,y=random()*1024;c.fillStyle='#3b444133';c.fillRect(x,y,20+random()*80,35+random()*110);c.strokeStyle='#3d46484d';c.strokeRect(x,y,20+random()*80,35+random()*110);}
 for(const x of [80,162,350,432]){const g=c.createLinearGradient(x-12,0,x+12,0);g.addColorStop(0,'#111a1900');g.addColorStop(.5,'#111a1945');g.addColorStop(1,'#111a1900');c.fillStyle=g;c.fillRect(x-12,0,24,1024);}
 for(let i=0;i<22;i++){let x=random()*512,y=random()*1024;c.strokeStyle='#252c2d99';c.lineWidth=1;c.beginPath();c.moveTo(x,y);for(let j=0;j<6;j++){x+=random()*28-14;y+=random()*18;c.lineTo(x,y);}c.stroke();}
 t.update();return t;
}
export function cloudTexture(scene,name='smoke sprite'){
 const t=new DynamicTexture(name,128,scene,true),c=t.getContext(),random=rng(33);c.clearRect(0,0,128,128);
 for(let i=0;i<20;i++){const x=40+random()*48,y=40+random()*48,r=16+random()*22,g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#ffffff28');g.addColorStop(.5,'#ffffff18');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(0,0,128,128);}
 t.hasAlpha=true;t.update();return t;
}
