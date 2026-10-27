import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Effect} from '@babylonjs/core/Materials/effect';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {ParticleSystem} from '@babylonjs/core/Particles/particleSystem';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3,Color4} from '@babylonjs/core/Maths/math.color';

export const DAYTIMES=['day','auto','dawn','dusk','night'];
export const WEATHERS=['city','auto','clear','overcast','rain','fog'];
const C=Color3.FromHexString;
const TIMES={
 day:{top:'#477eac',horizon:'#bdced2',sun:'#fff0cc',direction:[-.45,-.8,.3],power:1.25,fill:.8},
 dawn:{top:'#526486',horizon:'#e5ae85',sun:'#ffba87',direction:[-.9,-.28,.3],power:.85,fill:.65},
 dusk:{top:'#384365',horizon:'#d59179',sun:'#ffad78',direction:[.9,-.25,-.3],power:.8,fill:.6},
 night:{top:'#090f24',horizon:'#34445d',sun:'#a9c6ed',direction:[-.5,-.65,.4],power:.3,fill:.48},
};
Effect.ShadersStore.atmosphereVertexShader=`precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 direction;
void main(){direction=position;gl_Position=worldViewProjection*vec4(position,1.0);}`;
Effect.ShadersStore.atmosphereFragmentShader=`precision highp float;
varying vec3 direction; uniform vec3 zenith,horizon,orb; uniform float cloud,night,clock,flash;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
void main(){vec3 d=normalize(direction);float h=max(d.y,0.0);vec3 col=mix(horizon,zenith,pow(h,.55));
vec2 p=d.xz/(.25+abs(d.y))*1.6+vec2(clock*.003,clock*.001);
float n=noise(p)*.57+noise(p*2.1)*.28+noise(p*4.3)*.15;
float cover=smoothstep(.65-cloud*.45,.84-cloud*.3,n)*smoothstep(-.02,.16,d.y);
col=mix(col,mix(horizon*.85,zenith*.6,n),cover*.85);
float disc=smoothstep(.9992,.9997,dot(d,orb));float halo=pow(max(dot(d,orb),0.0),32.0);
col+=mix(vec3(1.0,.8,.55),vec3(.65,.8,1.0),night)*(disc*.9+halo*.15)*(1.0-cloud*.92);
vec2 star=floor(d.xz/(.12+abs(d.y))*300.0);float stars=step(.9985,hash(star))*pow(max(d.y,0.0),.4)*night*(1.0-cloud)*.65;
gl_FragColor=vec4(col+stars+vec3(.55,.65,.8)*flash,1.0);}`;

// Presentation only: weather never changes grip, AI visibility or career state.
export function createAtmosphere({scene,sky,sun,hemi,asphalt,reflections,city,surface=()=>-1}){
 const material=new ShaderMaterial('weather sky',scene,'atmosphere',{attributes:['position'],uniforms:['worldViewProjection','zenith','horizon','orb','cloud','night','clock','flash']});
 material.backFaceCulling=false;sky.material=material;
 const texture=new DynamicTexture('rain streak', {width:16,height:64},scene,false),ctx=texture.getContext();ctx.clearRect(0,0,16,64);const g=ctx.createLinearGradient(0,0,0,64);g.addColorStop(0,'#d9edf500');g.addColorStop(.5,'#d9edf5bb');g.addColorStop(1,'#d9edf500');ctx.fillStyle=g;ctx.fillRect(7,0,2,64);texture.hasAlpha=true;texture.update();
 const rain=new ParticleSystem('local rain',400,scene);rain.particleTexture=texture;rain.emitter=new Vector3();rain.minEmitBox=new Vector3(-24,0,-24);rain.maxEmitBox=new Vector3(24,5,24);rain.direction1=new Vector3(-.15,-1,.05);rain.direction2=new Vector3(-.1,-1,.08);rain.minEmitPower=24;rain.maxEmitPower=30;rain.minLifeTime=.8;rain.maxLifeTime=1.1;rain.minSize=.7;rain.maxSize=1.1;rain.minScaleX=.8;rain.maxScaleX=1.2;rain.minScaleY=1.8;rain.maxScaleY=2.6;rain.color1=new Color4(.7,.8,.9,.65);rain.color2=new Color4(.6,.7,.8,.5);rain.colorDead=new Color4(.6,.7,.8,0);rain.blendMode=ParticleSystem.BLENDMODE_STANDARD;rain.emitRate=0;rain.start();
 // Fixed splash pool: translucent ground ripples, no per-impact mesh allocation.
 const ripple=new DynamicTexture('rain ripple',64,scene,false),rctx=ripple.getContext();rctx.clearRect(0,0,64,64);rctx.strokeStyle='#b8d9e9aa';rctx.lineWidth=3;rctx.beginPath();rctx.arc(32,32,23,0,Math.PI*2);rctx.stroke();ripple.hasAlpha=true;ripple.update();
 const splashMat=new StandardMaterial('rain splash',scene);splashMat.diffuseTexture=ripple;splashMat.useAlphaFromDiffuseTexture=true;splashMat.emissiveColor=new Color3(.2,.27,.3);splashMat.disableLighting=true;splashMat.backFaceCulling=false;
 const splashes=Array.from({length:32},()=>{const mesh=MeshBuilder.CreateGround('pooled rain splash',{width:1,height:1},scene);mesh.material=splashMat;mesh.isPickable=false;mesh.setEnabled(false);return {mesh,life:0};});
 let splashLimit=32,splashCursor=0,activeRain=false,exposure=1,flash=0,stormWait=25+Math.random()*25,thunderDelay=0,thunder=0,lightning=0;
 const updateRain=rain.updateFunction;
 rain.updateFunction=particles=>{updateRain(particles);if(!activeRain)return;for(const p of particles){const floor=surface(p.position.x,p.position.z);if(p.position.y>floor+.3)continue;
  // Drops spawned beneath tall cover disappear without making floating splashes.
  if(p.age>0&&p.position.y>floor-1&&floor<rain.emitter.y){const slot=splashes[splashCursor++%splashLimit];slot.life=.28;slot.mesh.position.set(p.position.x,floor+.035,p.position.z);slot.mesh.setEnabled(true);}
  p.age=p.lifeTime;p.color.a=0;
 }};
 const dryColor=asphalt.diffuseColor.clone(),drySpecular=asphalt.specularColor.clone();
 const weatherSequence=['clear','overcast','rain','overcast','fog'],daySequence=['day','dusk','night','dawn'];
 let weather='city',daytime='day',time=0,wasReduced=false,rendered=false;
 const w={value:null,index:city.id==='seattle'?1:0,hold:0,duration:0},d={value:null,index:0,hold:0,duration:0};
 function weatherState(actual){return {cloud:{clear:.1,overcast:.9,rain:1,fog:.8}[actual],fog:actual==='fog'?.007:actual==='rain'?.003:actual==='overcast'?.0018:.001,wet:actual==='rain'?1:0};}
 function dayState(actual){const t=TIMES[actual];return {top:C(t.top),horizon:C(t.horizon),sun:C(t.sun),direction:new Vector3(...t.direction).normalize(),fill:t.fill,power:t.power,night:actual==='night'?1:0,darkness:{day:0,dusk:.65,night:1,dawn:.45}[actual]};}
 function blend(a,b,t){const out={};for(const key of Object.keys(b))out[key]=typeof b[key]==='number'?a[key]+(b[key]-a[key])*t:key==='direction'?Vector3.Lerp(a[key],b[key],t).normalize():Color3.Lerp(a[key],b[key],t);return out;}
 function refresh(){reflections.refreshRate=0;reflections.cubeTexture.resetRefreshCounter();}
 function transition(track,value,seconds){track.from=track.value;track.target=value;track.elapsed=0;track.duration=seconds;track.hold=0;if(!track.value||!seconds){track.value=value;track.duration=0;}}
 function advance(track,dt,automatic,sequence,make,hold,seconds){
  if(track.duration){track.elapsed=Math.min(track.duration,track.elapsed+dt);const x=track.elapsed/track.duration;track.value=blend(track.from,track.target,x*x*(3-2*x));if(track.elapsed>=track.duration){track.duration=0;refresh();}}
  else if(automatic){track.hold+=dt;if(track.hold>=hold){track.index=(track.index+1)%sequence.length;transition(track,make(sequence[track.index]),seconds);}}
 }
 function apply(){
  const day=d.value,wet=w.value,cloud=wet.cloud,night=day.night;
  const top=Color3.Lerp(day.top,Color3.Lerp(C('#55656e'),C('#182333'),night),cloud*.85),horizon=Color3.Lerp(day.horizon,Color3.Lerp(C('#9ca9ac'),C('#344350'),night),cloud*.8);
  material.setColor3('zenith',top);material.setColor3('horizon',horizon);material.setFloat('cloud',cloud);material.setFloat('night',night);material.setFloat('clock',time);material.setFloat('flash',flash);
  sun.direction.copyFrom(day.direction);material.setVector3('orb',day.direction.scale(-1));sun.diffuse.copyFrom(day.sun);sun.intensity=day.power*(1-cloud*.65);hemi.intensity=day.fill+flash*.5;hemi.diffuse.copyFrom(Color3.Lerp(C('#b9d9e4'),day.sun,(1-cloud)*(1-night)*.25));
  scene.fogColor.copyFrom(horizon);scene.fogDensity=wet.fog;
  asphalt.diffuseColor.copyFrom(dryColor.scale(1-.28*wet.wet));asphalt.specularColor.copyFrom(Color3.Lerp(drySpecular,C('#a5b8c3'),wet.wet));asphalt.specularPower=32+64*wet.wet;
 }
 function set(options={}){
  const nextWeather=WEATHERS.includes(options.weather)?options.weather:'city',nextDay=DAYTIMES.includes(options.daytime)?options.daytime:'day';
  if(!w.value||weather!==nextWeather){weather=nextWeather;w.index=city.id==='seattle'?1:0;const actual=weather==='auto'?weatherSequence[w.index]:weather==='city'?(city.id==='seattle'?'overcast':'clear'):weather;transition(w,weatherState(actual),rendered?8:0);}
  if(!d.value||daytime!==nextDay){daytime=nextDay;d.index=0;transition(d,dayState(daytime==='auto'?'day':daytime),rendered?8:0);}
  apply();if(!rendered)refresh();
 }
 set();
 return {set,clear(){rain.reset();rain.emitRate=0;w.hold=d.hold=0;flash=0;thunderDelay=0;for(const s of splashes){s.life=0;s.mesh.setEnabled(false);}apply();},update(dt,position,running,quality,reduced,listener=position){
  rendered=true;
  if(running){
   flash=Math.max(0,flash-dt*2);
   if(w.value.wet>.65){stormWait-=dt;if(stormWait<=0){lightning++;flash=reduced?0:.7;thunderDelay=1.5+Math.random()*2.5;stormWait=35+Math.random()*40;}}
   if(thunderDelay>0){thunderDelay-=dt;if(thunderDelay<=0&&w.value.wet>.3)thunder++;}
   if(!reduced)time+=dt;advance(w,dt,weather==='auto',weatherSequence,weatherState,60,20);advance(d,dt,daytime==='auto',daySequence,dayState,45,45);apply();}
  material.setFloat('clock',time);
  if(reduced){flash=0;material.setFloat('flash',0);hemi.intensity=d.value.fill;}if(reduced&&!wasReduced){rain.reset();for(const s of splashes){s.life=0;s.mesh.setEnabled(false);}}wasReduced=reduced;
  activeRain=running&&!reduced;splashLimit=quality==='high'?32:12;for(let i=0;i<splashes.length;i++){const s=splashes[i];if(i>=splashLimit)s.life=0;if(activeRain)s.life=Math.max(0,s.life-dt);s.mesh.setEnabled(s.life>0);if(s.life>0){const f=1-s.life/.28;s.mesh.scaling.setAll(.15+f*.65);s.mesh.visibility=(1-f)*.55;}}
  if(listener)exposure=surface(listener.x,listener.z)>listener.y+1.2?.15:1;
  rain.emitRate=running&&!reduced?w.value.wet*(quality==='high'?420:160):0;rain.updateSpeed=running&&!reduced?.016:0;
  if(position)rain.emitter.set(position.x,position.y+10,position.z);
 },get darkness(){return Math.max(d.value.darkness,w.value.wet*.35);},get particles(){return rain.getActiveCount();},get status(){return {automatic:weather==='auto',target:weather==='auto'?weatherSequence[w.index]:weather,transition:w.duration?w.elapsed/w.duration:1,wetness:w.value.wet,exposure,thunder,lightning,splashes:splashes.filter(s=>s.life>0).length,hold:w.hold,dayTarget:daytime==='auto'?daySequence[d.index]:daytime,dayTransition:d.duration?d.elapsed/d.duration:1,dayHold:d.hold,darkness:d.value.darkness};}};
}
