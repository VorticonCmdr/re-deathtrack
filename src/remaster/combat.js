import {rivalProfile,gunDamage,GUN_CAPACITY} from './balance.js';
import {laserDamage,beamDamage,BEAM_SECONDS,rocketDamage,missileDamage,mineDamage,LOCK_SECONDS} from './weapons.js';
// Deterministic, fixed-step combat. Shots are swept against moving 3D car volumes.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
function intersection(a,b,r){const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},A=dot(d,d),B=2*dot(a,d),C=dot(a,a)-r*r;if(C<=0)return 0;if(A<1e-9)return null;const disc=B*B-4*A*C;if(disc<0)return null;const t=(-B-Math.sqrt(disc))/(2*A);return t>=0&&t<=1?t:null;}
function triangleHit(origin,end,a,b,c){
 const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
 const d=sub(end,origin),e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-8)return null;
 const inv=1/det,s=sub(origin,a),u=dot(s,h)*inv;if(u<0||u>1)return null;const q=cross(s,e1),v=dot(d,q)*inv;if(v<0||u+v>1)return null;const t=dot(e2,q)*inv;return t>=0&&t<=1?t:null;
}
export function createCombat(cars,points=[],config={}){
 const edges=points.map((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length],len=Math.hypot(b.x-a.x,b.z-a.z);return [-1,1].map(side=>({x:p.x-(b.z-a.z)/len*7.6*side,y:p.y,z:p.z+(b.x-a.x)/len*7.6*side}));});
 const surfaces=edges.map((e,i)=>{const next=edges[(i+1)%edges.length],v=[...e,...next];return {v,minX:Math.min(...v.map(p=>p.x)),maxX:Math.max(...v.map(p=>p.x)),minZ:Math.min(...v.map(p=>p.z)),maxZ:Math.max(...v.map(p=>p.z))};});
 let hazards,pairCooldown,events=[];
 function feedback(type,position,extra={}){events.push({type,x:position.x,y:position.y??0,z:position.z,...extra});if(events.length>128)events.shift();}
 let states,shots,effects,beams,projectiles,lastFinished,evaded,serial,stats,hitMarker,hurt;
 function reset(){events=[];hazards=[];pairCooldown=new Map();states=cars.map((_,i)=>({armor:i===0?(config.armor??100)*(config.condition?.[5]??1):rivalProfile(i).armor,condition:i===0?[...(config.condition??Array(6).fill(1))]:Array(6).fill(1),wrecked:false,killer:null,servicing:false,maxArmor:i===0?(config.armor??100):rivalProfile(i).armor,ammo:i===0?(config.ammo??1000):GUN_CAPACITY[rivalProfile(i).gun],gun:i===0?(config.gun??0):rivalProfile(i).gun,laser:i===0?(config.laser??0):0,beam:i===0?(config.beam??0):0,rocket:i===0?(config.rocket??0):0,missile:i===0?(config.missile??0):0,rocketAmmo:i===0?(config.rocketAmmo??0):2,missileAmmo:i===0?(config.missileAmmo??0):2,mine:i===0?(config.mine??0):0,caltrop:i===0?(config.caltrop??0):0,ram:i===0?(config.ram??0):0,wheel:i===0?(config.wheel??0):0,mineAmmo:i===0?(config.mineAmmo??0):3,caltropAmmo:i===0?(config.caltropAmmo??0):3,underFire:0,lastAttacker:-1,tyreHit:0,target:-1,lockProgress:0,aimTarget:-1,aimTime:0,nextHazard:10+i*.7,selected:i===0?(config.selected??0):rivalProfile(i).weapon,battery:i===0?(config.battery??100):100,charge:0,heat:0,locked:false,cooldown:0,disabled:0,shield:0,flash:0}));shots=[];effects=[];beams=[];projectiles=[];lastFinished=Array(cars.length).fill(null);evaded=0;serial=0;stats={shots:0,hits:0,disables:0,kills:[]};hitMarker=hurt=0;}
 reset();
 const center=(s,offset)=>({x:s.x+Math.sin(s.yaw)*offset,y:s.y+.65,z:s.z+Math.cos(s.yaw)*offset});
 function wantsFire(id,finished,time){const s=cars[id].state,w=states[id],profile=rivalProfile(id),difficulty=config.difficulty??0;
  if(w.disabled||w.shield||w.servicing||finished[id]!=null)return false;
  const eligible=j=>j!==id&&finished[j]==null&&!states[j].disabled&&!states[j].servicing&&!states[j].shield;
  if(time>=w.nextHazard&&w.cooldown===0){const behind=cars.some((c,j)=>{if(!eligible(j))return false;const dx=c.state.x-s.x,dz=c.state.z-s.z,f=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),side=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw);return f<-6&&f>-26&&Math.abs(side)<2.2&&Math.abs(c.state.y-s.y)<1.2;});if(behind&&(w.mineAmmo||w.caltropAmmo)){w.selected=w.mineAmmo?5:6;w.nextHazard=time+(profile.hazardInterval??8)-difficulty*.5;return true;}}
  if(w.selected>=5){w.selected=profile.weapon;w.target=-1;w.lockProgress=0;}
  if(w.selected===4)return time>10&&w.lockProgress>=1;
  let victim=-1,nearest=Infinity;for(let j=0;j<cars.length;j++){if(!eligible(j))continue;const t=cars[j].state,dx=t.x-s.x,dz=t.z-s.z,f=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),side=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw);if(f>5&&f<75&&Math.abs(side)<1.1&&Math.abs((t.y-s.y)+Math.sin(s.pitch)*f)<1.3&&f<nearest&&roadHit(center(s,0),center(t,0))>1){victim=j;nearest=f;}}
  if(victim!==w.aimTarget){w.aimTarget=victim;w.aimTime=time;}
  return time>8&&victim>=0&&time-w.aimTime>.45-difficulty*.07&&((time+id*.53)%(3.8-difficulty*.35))<(.22+difficulty*.04);
 }
 function tickTimers(dt){for(const [key,time] of pairCooldown){if(time<=dt)pairCooldown.delete(key);else pairCooldown.set(key,time-dt);}evaded=Math.max(0,evaded-dt);hitMarker=Math.max(0,hitMarker-dt);hurt=Math.max(0,hurt-dt);effects=effects.filter(e=>(e.life-=dt)>0);beams=beams.filter(e=>(e.life-=dt)>0);
  states.forEach((s,id)=>{s.underFire=Math.max(0,s.underFire-dt);s.tyreHit=Math.max(0,s.tyreHit-dt);if(s.selected===2&&!s.disabled&&!s.servicing&&!s.shield)s.charge=Math.min(1,s.charge+dt/BEAM_SECONDS);if(id>0&&(s.selected===1&&s.battery===0||s.selected===3&&s.rocketAmmo===0||s.selected===4&&s.missileAmmo===0))s.selected=0;s.flash=Math.max(0,s.flash-dt);s.cooldown=Math.max(0,s.cooldown-dt);s.heat=Math.max(0,s.heat-.24*dt);s.shield=Math.max(0,s.shield-dt);if(s.locked&&s.heat<=.25)s.locked=false;if(s.disabled>0&&!s.wrecked){s.disabled=Math.max(0,s.disabled-dt);if(s.disabled===0){cars[id].recover();s.armor=s.maxArmor;s.condition[5]=1;s.shield=2;}}});
 }
 function damage(id,amount,owner=-1,kind='collision'){const w=states[id];if(w.wrecked||w.disabled||w.shield||w.servicing||amount<=0)return;
  if(owner>=0&&owner!==id){w.underFire=2;w.lastAttacker=owner;}
  config.onCombatEvent?.({kind,victim:id,owner,damage:Math.min(w.armor,amount),x:cars[id].state.x,z:cars[id].state.z});
  w.armor=Math.max(0,w.armor-amount);w.condition[5]=w.armor/w.maxArmor;
  // Modern component distribution: bullet/contact damage also wears mechanical parts.
  const component=(serial+id)%5;w.condition[component]=Math.max(0,w.condition[component]-amount/w.maxArmor*.4);w.condition[0]=Math.min(w.condition[0],.5+.5*w.condition[5]);
  feedback('hit',cars[id].state,{victim:id,owner,kind,damage:amount});
  if(id===0)hurt=.4;
  if(w.armor===0){feedback('wreck',cars[id].state,{victim:id,owner});w.disabled=4;w.wrecked=!!config.career;w.killer=owner;cars[id].state.vx=cars[id].state.vz=cars[id].state.speed=0;effects.push({id:++serial,...center(cars[id].state,0),life:.7,big:true});if(owner===0&&id!==0){stats.disables++;if(w.wrecked&&!stats.kills.includes(id))stats.kills.push(id);}}
 }
 function roadHit(a,b){let nearest=Infinity;for(const s of surfaces){if(Math.max(a.x,b.x)<s.minX||Math.min(a.x,b.x)>s.maxX||Math.max(a.z,b.z)<s.minZ||Math.min(a.z,b.z)>s.maxZ)continue;const [v,w,x,y]=s.v;for(const tri of [[v,w,x],[w,y,x]]){const t=triangleHit(a,b,...tri);if(t!==null)nearest=Math.min(nearest,t);}}return nearest;}
 function targets(id,finished){const s=cars[id].state,a=center(s,0);return cars.map((c,j)=>({id:j,p:center(c.state,0)})).filter(t=>{if(t.id===id||finished[t.id]!=null||states[t.id].disabled||states[t.id].shield||states[t.id].servicing)return false;const dx=t.p.x-a.x,dy=t.p.y-a.y,dz=t.p.z-a.z,d=Math.hypot(dx,dy,dz),ahead=(dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw))/Math.max(.001,d);return d>5&&d<150&&ahead>.9&&roadHit(a,t.p)>1;}).sort((a,b)=>Math.hypot(a.p.x-s.x,a.p.z-s.z)-Math.hypot(b.p.x-s.x,b.p.z-s.z)).map(t=>t.id);}
 function cycleTarget(){const w=states[0],ids=targets(0,lastFinished);if(w.selected!==4||!ids.length)return;w.target=ids[(ids.indexOf(w.target)+1)%ids.length];w.lockProgress=0;}
 function updateLocks(dt,finished){lastFinished=finished;states.forEach((w,id)=>{if(w.selected!==4||w.disabled||w.shield||w.servicing||finished[id]!=null||w.missileAmmo===0){w.target=-1;w.lockProgress=0;return;}const ids=targets(id,finished);if(!ids.includes(w.target)){w.target=ids[0]??-1;w.lockProgress=0;}if(w.target>=0)w.lockProgress=Math.min(1,w.lockProgress+dt/LOCK_SECONDS);});}
 function incoming(id){let distance=Infinity;for(const p of projectiles)if(p.life>0&&p.kind===4&&p.target===id)distance=Math.min(distance,Math.hypot(p.x-cars[id].state.x,p.y-cars[id].state.y,p.z-cars[id].state.z));return distance;}
 function launch(id){const w=states[id],s=cars[id].state,kind=w.selected,key=kind===3?'rocketAmmo':'missileAmmo';if(w[key]<=0||projectiles.length>=32||kind===4&&(w.target<0||w.lockProgress<1))return;
  w[key]--;w.cooldown=kind===3?1.1:2;w.flash=.15;
  const dir={x:Math.sin(s.yaw)*Math.cos(s.pitch),y:-Math.sin(s.pitch),z:Math.cos(s.yaw)*Math.cos(s.pitch)},speed=(kind===3?65:45)+s.speed*.5,a=center(s,0);
  projectiles.push({id:++serial,owner:id,kind,tier:w[kind===3?'rocket':'missile'],x:a.x,y:a.y,z:a.z,vx:dir.x*speed,vy:dir.y*speed,vz:dir.z*speed,speed,life:kind===3?3:6,age:0,target:kind===4?w.target:-1,targetSpeed:kind===4?cars[w.target].state.speed:0,braking:0});feedback('shot',cars[id].state,{owner:id,weapon:w.selected});if(id===0)stats.shots++;
  if(kind===4)w.lockProgress=0;
 }
 function intercept(p){feedback('intercept',p);p.life=0;effects.push({id:++serial,x:p.x,y:p.y,z:p.z,life:.25,big:false});if(p.target===0)evaded=1.5;}
 function explode(p,finished){feedback('explosion',p);p.life=0;effects.push({id:++serial,x:p.x,y:p.y,z:p.z,life:.7,big:true});const radius=p.kind===3?5:4,amount=p.kind===3?rocketDamage(p.tier):missileDamage(p.tier);let hits=0;
  cars.forEach((c,id)=>{const w=states[id];if(finished[id]!=null||w.disabled||w.shield||w.servicing)return;const a=center(c.state,0),d=Math.hypot(a.x-p.x,a.y-p.y,a.z-p.z);if(d>radius||roadHit({...p,y:p.y+.04},a)<.999)return;damage(id,amount*Math.max(0,1-Math.max(0,d-2)/(radius-2)),p.owner,p.kind===3?'rocket':'missile');if(id!==p.owner)hits++;});if(p.owner===0&&hits){stats.hits+=hits;hitMarker=.18;}
 }
 function moveProjectiles(dt,finished,previous,input){for(const p of projectiles){if(p.life<=0)continue;p.age+=dt;p.life-=dt;if(p.life<=0)continue;const old={x:p.x,y:p.y,z:p.z};
   if(p.target>=0){const w=states[p.target],s=cars[p.target].state;if(w.disabled||w.shield||w.servicing||finished[p.target]!=null){p.target=-1;}else{
    const d=Math.hypot(p.x-s.x,p.y-s.y,p.z-s.z),braking=p.target===0?input.brake>.6:s.speed<(previous[p.target].speed??s.speed)-.05;
    p.braking=braking&&!s.airborne&&d<80?p.braking+dt:0;
    if(p.braking>=.45&&s.speed<=Math.max(5,p.targetSpeed*.82)){if(p.target===0)evaded=1.5;p.target=-1;p.vy=p.speed*.8;p.life=Math.min(p.life,1);}
    else{const lead=Math.min(.5,d/p.speed),target={x:s.x+(s.vx||0)*lead,y:s.y+.65,z:s.z+(s.vz||0)*lead},dx=target.x-p.x,dy=target.y-p.y,dz=target.z-p.z,len=Math.max(.001,Math.hypot(dx,dy,dz));
     // Bounded turn rate: missiles cannot instantly reverse onto a passing car.
     const a={x:p.vx/p.speed,y:p.vy/p.speed,z:p.vz/p.speed},b={x:dx/len,y:dy/len,z:dz/len},angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b)))),t=angle>.0001?Math.min(1,(1.1+p.tier*.15)*dt/angle):1;
     const nx=a.x+(b.x-a.x)*t,ny=a.y+(b.y-a.y)*t,nz=a.z+(b.z-a.z)*t,n=Math.max(.001,Math.hypot(nx,ny,nz));p.vx=nx/n*p.speed;p.vy=ny/n*p.speed;p.vz=nz/n*p.speed;
    }
   }}
   p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;let nearest=roadHit(old,p),hit=Number.isFinite(nearest);
   cars.forEach((c,id)=>{if(id===p.owner||finished[id]!=null||states[id].disabled||states[id].servicing)return;for(const offset of [-1.05,1.05]){const a=center(previous[id],offset),b=center(c.state,offset),t=intersection({x:old.x-a.x,y:old.y-a.y,z:old.z-a.z},{x:p.x-b.x,y:p.y-b.y,z:p.z-b.z},1.3);if(t!==null&&t<nearest){nearest=t;hit=true;}}});
   if(hit){p.x=old.x+(p.x-old.x)*nearest;p.y=old.y+(p.y-old.y)*nearest;p.z=old.z+(p.z-old.z)*nearest;explode(p,finished);}
  }projectiles=projectiles.filter(p=>p.life>0);
 }


 function deploy(id){const w=states[id],s=cars[id].state,kind=w.selected,key=kind===5?'mine':'caltrop';if(s.airborne||w[key+'Ammo']<=0||hazards.length>=64)return;
  const x=s.x-Math.sin(s.yaw)*3.5,z=s.z-Math.cos(s.yaw)*3.5;
  // Search only the local vertical band: elevated roads must not drop traps onto a lower deck.
  const top={x,y:s.y+2,z},bottom={x,y:s.y-2,z},t=roadHit(top,bottom);if(!Number.isFinite(t))return;
  hazards.push({id:++serial,owner:id,kind,tier:w[key],x,y:top.y-4*t+.12,z,age:0,life:kind===5?20:50});w[key+'Ammo']--;w.cooldown=1.2;feedback('shot',cars[id].state,{owner:id,weapon:w.selected});if(id===0)stats.shots++;
 }
 function stepHazards(dt,finished,previous){for(const h of hazards){h.age+=dt;h.life-=dt;if(h.age<.6||h.life<=0)continue;
  for(let id=0;id<cars.length;id++){const w=states[id];if(w.disabled||w.shield||w.servicing||finished[id]!=null||(id===h.owner&&h.age<1.5))continue;
   let touched=false;for(const offset of [-1.05,1.05]){const a=center(previous[id],offset),b=center(cars[id].state,offset);if(intersection({x:a.x-h.x,y:a.y-h.y,z:a.z-h.z},{x:b.x-h.x,y:b.y-h.y,z:b.z-h.z},1.25)!==null)touched=true;}
   if(!touched)continue;feedback(h.kind===5?'explosion':'tyres',h,{victim:id,owner:h.owner});h.life=0;effects.push({id:++serial,x:h.x,y:h.y,z:h.z,life:h.kind===5?.7:.25,big:h.kind===5});
   if(h.kind===5)damage(id,mineDamage(h.tier),h.owner,'mine');else{w.condition[3]=Math.max(0,w.condition[3]-(.12+h.tier*.06));w.tyreHit=2;const s=cars[id].state;s.vx*=.8;s.vz*=.8;s.speed*=.8;if(id===0)hurt=.4;}
   if(h.owner===0&&id!==0){stats.hits++;hitMarker=.18;}break;
  }
 }hazards=hazards.filter(h=>h.life>0);}
 function rearAwareness(){const s=cars[0].state,origin=center(s,0);let nearest=null;for(let id=1;id<cars.length;id++){if(states[id].disabled||states[id].servicing||lastFinished[id]!=null)continue;const t=cars[id].state,dx=t.x-s.x,dz=t.z-s.z,f=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),side=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw),distance=Math.hypot(dx,dz);if(f>=-3||f<-100||Math.abs(side)>12||Math.abs(t.y-s.y)>4||roadHit(origin,center(t,0))<1)continue;if(!nearest||distance<nearest.distance)nearest={id,distance,side,closing:((t.vx-s.vx)*Math.sin(s.yaw)+(t.vz-s.vz)*Math.cos(s.yaw))>2,firing:states[id].flash>0};}return nearest;}
 function hazardThreat(id){const s=cars[id].state;let nearest=null;for(const h of hazards){if(h.life<=0||h.owner===id&&h.age<1.5)continue;const dx=h.x-s.x,dz=h.z-s.z,forward=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),side=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw);if(forward<4||forward>32||Math.abs(side)>2.5||Math.abs(h.y-s.y)>1.5||nearest&&forward>=nearest.forward)continue;if(roadHit(center(s,0),{x:h.x,y:h.y+.4,z:h.z})<1)continue;nearest={forward,side};}return nearest;}
 function contact(a,b,closing){const key=Math.min(a,b)+':'+Math.max(a,b);if(pairCooldown.has(key))return;let struck=false;
  for(const [owner,victim] of [[a,b],[b,a]]){let hit=false;const s=cars[owner].state,t=cars[victim].state,w=states[owner],v=states[victim];if(w.disabled||v.disabled||w.shield||v.shield||w.servicing||v.servicing)return;const dx=t.x-s.x,dz=t.z-s.z,len=Math.max(.001,Math.hypot(dx,dz)),front=(dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw))/len,side=Math.abs(dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw))/len;
   if(front>.65&&closing>2){damage(victim,(w.ram+1)*Math.min(8,closing*.6),owner,'ram');struck=hit=true;}
   else if(side>.7&&Math.max(s.speed,t.speed)>3){damage(victim,(w.wheel+1),owner,'wheel');v.condition[3]=Math.max(0,v.condition[3]-.0075*(w.wheel+1));v.tyreHit=1;struck=hit=true;}
   if(hit&&owner===0){stats.hits++;hitMarker=.18;}
  }if(struck)pairCooldown.set(key,1.2);
 }

 function selectWeapon(index){if(!Number.isInteger(index)||index<0||index>6)return;const w=states[0];if(w.selected!==index){w.selected=index;w.charge=0;w.target=-1;w.lockProgress=0;}}
 function fireEnergy(id,finished){
  const w=states[id],s=cars[id].state,kind=w.selected;
  if(kind===1&&w.battery===0||kind===2&&w.charge<1)return;
  if(kind===1)w.battery--;else w.charge=0;
  w.cooldown=kind===1?.35:.25;w.flash=.12;
  const dir={x:Math.sin(s.yaw)*Math.cos(s.pitch),y:-Math.sin(s.pitch),z:Math.cos(s.yaw)*Math.cos(s.pitch)},range=kind===1?100:130;
  // Cast from the car centre so a close obstacle cannot be skipped by a muzzle offset.
  const start=center(s,0),end={x:start.x+dir.x*range,y:start.y+dir.y*range,z:start.z+dir.z*range};let nearest=1,victim=-1,intercepted=null;
  for(let j=0;j<cars.length;j++){if(j===id||finished[j]!=null||states[j].disabled||states[j].servicing)continue;for(const offset of [-1.05,1.05]){const c=center(cars[j].state,offset),t=intersection({x:start.x-c.x,y:start.y-c.y,z:start.z-c.z},{x:end.x-c.x,y:end.y-c.y,z:end.z-c.z},1.15);if(t!==null&&t<nearest){nearest=t;victim=j;}}}
  for(const surface of surfaces){if(Math.max(start.x,end.x)<surface.minX||Math.min(start.x,end.x)>surface.maxX||Math.max(start.z,end.z)<surface.minZ||Math.min(start.z,end.z)>surface.maxZ)continue;const [a,b,c,d]=surface.v;for(const tri of [[a,b,c],[b,d,c]]){const t=triangleHit(start,end,...tri);if(t!==null&&t<nearest){nearest=t;victim=-1;}}}
  for(const p of projectiles){if(p.life<=0||p.owner===id)continue;const t=intersection({x:start.x-p.x,y:start.y-p.y,z:start.z-p.z},{x:end.x-p.x,y:end.y-p.y,z:end.z-p.z},.7);if(t!==null&&t<nearest){nearest=t;victim=-1;intercepted=p;}}
  if(intercepted)intercept(intercepted);
  const hit={x:start.x+(end.x-start.x)*nearest,y:start.y+(end.y-start.y)*nearest,z:start.z+(end.z-start.z)*nearest};
  beams.push({id:++serial,kind,start,end:hit,life:.14});beams=beams.slice(-24);
  feedback('shot',cars[id].state,{owner:id,weapon:w.selected});if(id===0)stats.shots++;
  if(victim>=0&&!states[victim].shield){damage(victim,kind===1?laserDamage(w.laser):beamDamage(w.beam),id,kind===1?'laser':'beam');effects.push({id:++serial,...hit,life:.25,big:false});if(id===0){stats.hits++;hitMarker=.18;}}
 }
 function step(dt,requests,finished,previous,input={}){
  updateLocks(dt,finished);
  for(let id=0;id<cars.length;id++){const w=states[id],s=cars[id].state;if(w.servicing||w.wrecked||!requests[id]||w.disabled||w.shield||finished[id]!=null||w.cooldown>1e-6)continue;
   if(w.selected>=5){deploy(id);continue;}if(w.selected>=3){launch(id);continue;}if(w.selected!==0){fireEnergy(id,finished);continue;}if(w.locked||w.ammo<=0)continue;
   w.ammo--;w.cooldown=.1;w.heat=Math.min(1,w.heat+.115);if(w.heat>=.99)w.locked=true;w.flash=.055;
   const dir={x:Math.sin(s.yaw)*Math.cos(s.pitch),y:-Math.sin(s.pitch),z:Math.cos(s.yaw)*Math.cos(s.pitch)},speed=190+s.speed;
   shots.push({id:++serial,owner:id,damage:gunDamage(w.gun),x:s.x+dir.x*2.7,y:s.y+.65+dir.y*2.7,z:s.z+dir.z*2.7,vx:dir.x*speed,vy:dir.y*speed,vz:dir.z*speed,life:90/speed});feedback('shot',cars[id].state,{owner:id,weapon:w.selected});if(id===0)stats.shots++;
  }
  for(const shot of shots){const old={x:shot.x,y:shot.y,z:shot.z};shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;shot.z+=shot.vz*dt;shot.life-=dt;let nearest=Infinity,victim=-1;
   for(let id=0;id<cars.length;id++){if(id===shot.owner||finished[id]!=null||states[id].disabled||states[id].servicing)continue;
    for(const offset of [-1.05,1.05]){const before=center(previous[id],offset),after=center(cars[id].state,offset);
     const t=intersection({x:old.x-before.x,y:old.y-before.y,z:old.z-before.z},{x:shot.x-after.x,y:shot.y-after.y,z:shot.z-after.z},1.15);
     if(t!=null&&t<nearest){nearest=t;victim=id;}
    }
   }
   let ground=false;
   for(const surface of surfaces){if(Math.max(old.x,shot.x)<surface.minX||Math.min(old.x,shot.x)>surface.maxX||Math.max(old.z,shot.z)<surface.minZ||Math.min(old.z,shot.z)>surface.maxZ)continue;
    const [a,b,c,d]=surface.v;for(const tri of [[a,b,c],[b,d,c]]){const t=triangleHit(old,shot,...tri);if(t!=null&&t<nearest){nearest=t;ground=true;}}
   }
   let intercepted=null;for(const p of projectiles){if(p.life<=0||p.owner===shot.owner)continue;const t=intersection({x:old.x-p.x,y:old.y-p.y,z:old.z-p.z},{x:shot.x-p.x,y:shot.y-p.y,z:shot.z-p.z},.7);if(t!==null&&t<nearest){nearest=t;victim=-1;ground=false;intercepted=p;}}
   if(intercepted){shot.life=0;intercept(intercepted);continue;}
   if(ground){shot.life=0;continue;}
   if(victim>=0){shot.life=0;const w=states[victim];effects.push({id:++serial,x:old.x+(shot.x-old.x)*nearest,y:old.y+(shot.y-old.y)*nearest,z:old.z+(shot.z-old.z)*nearest,life:.25,big:false});
    if(w.shield>0)continue;damage(victim,shot.damage,shot.owner,'gun');if(shot.owner===0){stats.hits++;hitMarker=.18;}

   }
  }
  moveProjectiles(dt,finished,previous,input);stepHazards(dt,finished,previous);
  shots=shots.filter(s=>s.life>0);effects=effects.slice(-32);
 }
 return {feedback,drainFeedback(){const batch=events;events=[];return batch;},hazardThreat,contact,reset,tickTimers,step,wantsFire,damage,selectWeapon,cycleTarget,incoming,get states(){return states;},get view(){return {rear:rearAwareness(),hazard:hazardThreat(0),hazards:hazards.map(h=>({...h})),projectiles:projectiles.map(p=>({...p})),incoming:incoming(0),evaded,states:states.map(s=>({...s,condition:[...s.condition]})),shots:shots.map(s=>({...s})),effects:effects.map(e=>({...e})),beams:beams.map(e=>({...e,start:{...e.start},end:{...e.end}})),stats:{...stats,kills:[...stats.kills]},hitMarker,hurt};}};
}
