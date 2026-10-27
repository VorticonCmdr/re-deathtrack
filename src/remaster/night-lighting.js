import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {SpotLight} from '@babylonjs/core/Lights/spotLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';

// Fixed light budget: sun + sky + two player beams + one rival + three lamps.
// Slots remain allocated at zero intensity, avoiding shader recompilation as cars move.
export function createNightLighting(scene,lamps,cars,lensMaterial,roadBlockers=[]){
 function spot(name,color,angle,range){const l=new SpotLight(name,new Vector3(),new Vector3(0,-1,0),angle,angle<1?32:4,scene);l.diffuse=Color3.FromHexString(color);l.specular=l.diffuse.clone();l.range=range;l.innerAngle=angle*.55;l.intensity=0;return l;}
 const headlights=[-.6,.6].map((side,i)=>({light:spot('player headlight '+i,'#d7eaff',.85,65),side}));
 const rival=spot('nearby rival headlights','#e3edff',.9,50);let rivalId=-1,rivalStrength=0;
 const streets=Array.from({length:3},(_,i)=>({light:spot('nearby street light '+i,'#ffd399',2.3,24),lamp:null,strength:0}));
 const shadowSlots=[...headlights.map(h=>({light:h.light,owner:0})),{light:rival,owner:-1},...streets.map(s=>({light:s.light,owner:-1}))].map(slot=>{
  slot.light.shadowMinZ=.1;slot.light.shadowMaxZ=slot.light.range;
  const shadow=new ShadowGenerator(512,slot.light);shadow.usePercentageCloserFiltering=true;shadow.filteringQuality=ShadowGenerator.QUALITY_LOW;shadow.bias=.0005;shadow.normalBias=.015;
  shadow.getShadowMap().renderList=[];shadow.getShadowMap().refreshRate=0;
  return {...slot,shadow,active:false};
 });
 let shadowQuality='high',shadowsEnabled=true;
 for(const m of scene.materials)if('maxSimultaneousLights' in m)m.maxSimultaneousLights=8;
 function beam(light,car,side){
  const forward=new Vector3(Math.sin(car.yaw)*Math.cos(car.pitch),-Math.sin(car.pitch),Math.cos(car.yaw)*Math.cos(car.pitch));
  const right=new Vector3(Math.cos(car.yaw),0,-Math.sin(car.yaw));
  light.position.set(car.x,car.y+.65,car.z);light.position.addInPlace(forward.scale(1.65)).addInPlace(right.scale(side));
  light.direction.copyFrom(forward).addInPlace(new Vector3(0,-.09,0)).normalize();
 }
 return {setShadows(value){shadowsEnabled=!!value;for(const slot of shadowSlots)slot.light.shadowEnabled=shadowsEnabled;},update(dt,poses,focus,darkness,quality){
  const level=Math.max(0,Math.min(1,darkness)),high=quality==='high';
  for(const {light,side} of headlights){if(poses?.[0])beam(light,poses[0],side);light.intensity=poses?.[0]?level*6:0;}
  const nearest=poses?.slice(1).filter(c=>!c.finished).sort((a,b)=>Math.hypot(a.x-focus.x,a.z-focus.z)-Math.hypot(b.x-focus.x,b.z-focus.z))[0];
  const nextId=high&&nearest?poses.indexOf(nearest):-1;if(nextId!==rivalId){rivalStrength=Math.max(0,rivalStrength-dt*3);if(rivalStrength===0)rivalId=nextId;}else rivalStrength=Math.min(1,rivalStrength+dt*2);const litRival=poses?.[rivalId];if(litRival)beam(rival,litRival,0);rival.intensity=high&&litRival?level*6*rivalStrength*Math.max(0,1-Math.hypot(litRival.x-focus.x,litRival.z-focus.z)/65):0;
  const candidates=lamps.map(lamp=>({lamp,distance:Vector3.Distance(lamp.position,focus)})).filter(x=>x.distance<65).sort((a,b)=>a.distance-b.distance).slice(0,high?3:2);
  const desired=new Set(candidates.map(x=>x.lamp));
  // Balanced owns two street slots even while old lamps fade out. Letting
  // the third slot participate in handoffs exceeded its four-shadow budget.
  if(!high){streets[2].lamp=null;streets[2].strength=0;streets[2].light.intensity=0;}
  for(const slot of high?streets:streets.slice(0,2)){
   if(slot.lamp&&!desired.has(slot.lamp)){slot.strength=Math.max(0,slot.strength-dt*3);if(slot.strength===0)slot.lamp=null;}
   if(!slot.lamp){const next=candidates.find(x=>!streets.some(s=>s.lamp===x.lamp));if(next)slot.lamp=next.lamp;}
   if(slot.lamp&&desired.has(slot.lamp))slot.strength=Math.min(1,slot.strength+dt*2);
   if(slot.lamp){slot.light.position.copyFrom(slot.lamp.position);slot.light.direction.copyFrom(slot.lamp.direction);const distance=Vector3.Distance(slot.lamp.position,focus);slot.light.intensity=level*2*slot.strength*Math.max(0,Math.min(1,(65-distance)/20));}else slot.light.intensity=0;
  }
  if(quality!==shadowQuality){shadowQuality=quality;for(const slot of shadowSlots)slot.shadow.getShadowMap().resize(high?512:256);}
  shadowSlots[2].owner=rivalId;
  for(const slot of shadowSlots){
   const map=slot.shadow.getShadowMap(),active=shadowsEnabled&&slot.light.intensity>.001;
   // Rebuild this bounded list so garage/model changes never retain disposed meshes.
   // An emitting car is excluded: the lamps sit close to the original body shell.
   if(active){map.renderList=[...roadBlockers,...cars.filter((c,i)=>i!==slot.owner&&c.body.isEnabled()).map(c=>c.body)];if(!slot.active){map.refreshRate=1;map.resetRefreshCounter();}}
   else{map.renderList=[];if(slot.active)map.refreshRate=0;}
   slot.active=active;
  }
  lensMaterial.emissiveColor.set(.95*level,.64*level,.28*level);
  for(const car of cars)car.headMaterial.emissiveColor.set(.25+level*.8,.32+level,.4+level*1.2);
 },get shadows(){return shadowSlots.filter(s=>s.active).length;},get active(){return [...headlights.map(x=>x.light),rival,...streets.map(x=>x.light)].filter(l=>l.intensity>.01).length;}};
}
