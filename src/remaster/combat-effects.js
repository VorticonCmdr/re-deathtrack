import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {cloudTexture} from './surface-textures.js';
export function createCombatEffects(scene){
 const texture=cloudTexture(scene),smoke=[],bursts=[];let serials=new Set(),cursor=0,wasReduced=false;
 function system(name,capacity){const p=new ParticleSystem(name,capacity,scene);p.particleTexture=texture;p.emitter=new Vector3();p.minEmitBox=new Vector3(-.2,0,-.2);p.maxEmitBox=new Vector3(.2,.2,.2);p.blendMode=ParticleSystem.BLENDMODE_STANDARD;p.emitRate=0;p.updateSpeed=.016;p.minAngularSpeed=-.35;p.maxAngularSpeed=.35;p.minInitialRotation=0;p.maxInitialRotation=Math.PI*2;p.start();return p;}
 for(let i=0;i<10;i++){const p=system('damage trail '+i,32);p.minLifeTime=1.4;p.maxLifeTime=2.5;p.minSize=.55;p.maxSize=1;p.direction1=new Vector3(-.4,1,-.2);p.direction2=new Vector3(.5,1.8,.4);p.minEmitPower=.6;p.maxEmitPower=1;p.gravity=new Vector3(.1,.15,0);p.addColorGradient(0,new Color4(.17,.18,.18,.7));p.addColorGradient(.65,new Color4(.25,.27,.27,.32));p.addColorGradient(1,new Color4(.3,.32,.32,0));p.addSizeGradient(0,.6);p.addSizeGradient(1,2.8);smoke.push(p);}
 for(let i=0;i<6;i++){
  const fire=system('explosion cloud '+i,64);fire.minLifeTime=.7;fire.maxLifeTime=2.2;fire.minSize=.5;fire.maxSize=1.1;fire.direction1=new Vector3(-1,.2,-1);fire.direction2=new Vector3(1,1.2,1);fire.minEmitPower=1;fire.maxEmitPower=3;fire.gravity=new Vector3(0,.3,0);fire.addColorGradient(0,new Color4(2,1,.25,.95));fire.addColorGradient(.12,new Color4(1,.32,.055,.85));fire.addColorGradient(.38,new Color4(.16,.17,.18,.65));fire.addColorGradient(1,new Color4(.25,.26,.27,0));fire.addSizeGradient(0,.7);fire.addSizeGradient(1,3);
  const sparks=system('impact sparks '+i,24);sparks.minLifeTime=.15;sparks.maxLifeTime=.45;sparks.minSize=.05;sparks.maxSize=.17;sparks.direction1=new Vector3(-1,.1,-1);sparks.direction2=new Vector3(1,1.3,1);sparks.minEmitPower=5;sparks.maxEmitPower=12;sparks.gravity=new Vector3(0,-15,0);sparks.color1=new Color4(2,1,.3,1);sparks.color2=new Color4(1,.4,.1,1);sparks.colorDead=new Color4(.3,.1,0,0);bursts.push({fire,sparks});
 }
 const all=[...smoke,...bursts.flatMap(p=>[p.fire,p.sparks])];
 function clear(){for(const p of all){p.reset();p.emitRate=0;p.manualEmitCount=0;}serials.clear();}
 return {update(frame,quality,reduced){
  if(!frame){clear();return;}
  if(reduced){if(!wasReduced)clear();wasReduced=true;for(const p of all)p.updateSpeed=0;return;}
  wasReduced=false;for(const p of all)p.updateSpeed=frame.running?.016:0;
  smoke.forEach((p,i)=>{p.manualEmitCount=-1;const c=frame.cars[i],w=frame.combat?.states[i],active=c&&!c.finished&&w&&(w.disabled||w.condition[0]<.35||w.condition[5]<.3);p.emitRate=frame.running&&active?(quality==='high'?10:4):0;if(c)p.emitter.set(c.x+Math.sin(c.yaw),c.y+1,c.z+Math.cos(c.yaw));});
  const effects=frame.combat?.effects??[],next=new Set(effects.map(e=>e.id));
  if(frame.running)for(const e of effects){if(serials.has(e.id))continue;const pool=bursts[cursor++%bursts.length];for(const p of [pool.fire,pool.sparks]){p.reset();p.emitter.set(e.x,e.y+.15,e.z);p.updateSpeed=.016;}
   pool.fire.manualEmitCount=e.big?(quality==='high'?32:16):0;pool.sparks.manualEmitCount=quality==='high'?12:6;
  }
  serials=next;
 },clear,get activeParticles(){return all.reduce((n,p)=>n+p.getActiveCount(),0);}};
}
