// Fixed-step, real AI/physics diagnostic using local originals. No save access.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {track} from '../src/viewer/decode.js';
import {unexepack} from '../src/engine/exepack.js';
import {prepareRoad} from '../src/remaster/road.js';
import {createRace} from '../src/remaster/race.js';
import {CITIES} from '../src/remaster/championship.js';
import {freshProfile} from '../src/remaster/progression.js';
import {vehicleSpec} from '../src/remaster/garage.js';
import {GUN_CAPACITY} from '../src/remaster/balance.js';
import {STEP,angleDelta} from '../src/remaster/driving.js';
const read=name=>new Uint8Array(readFileSync(new URL('../game/'+name,import.meta.url)));
const {image}=unexepack(read('DTRACK.EXE')),exe=new DataView(image.buffer,image.byteOffset,image.byteLength);
const mode=process.argv[2]??'baseline',difficulty=Number(process.argv[3]??0),filter=process.argv[4],carIndex=Number(process.argv[5]??0);
if(!['baseline','pits','career'].includes(mode)||![0,1,2,3].includes(difficulty)||![0,1,2].includes(carIndex))throw Error('Usage: inspect-remaster-races.mjs baseline|pits|career 0..3 [city] [car 0..2]');
if(filter&&!CITIES.some(city=>city.id===filter))throw Error('Unknown city: '+filter);
const spec=vehicleSpec(freshProfile().builds[carIndex]);
const rows=[],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
for(const [ci,city] of CITIES.entries()){
 if(filter&&city.id!==filter)continue;
 const points=prepareRoad(track(read(city.id.toUpperCase()+'.TRK')).points.slice(0,-2).map(p=>({x:p.x*.05,y:p.z*.05,z:p.y*.05})),city.id),pitIndex=exe.getUint16(0x26fa0+0x1d04+ci*2,true);
 const damage={},events={},recoveries=Array(10).fill(0),issues=[],services=[],start=performance.now();let steps=0,autoRestarts=0,lastDistance=0,noProgress=0,maxStepMs=0,totalStepMs=0,pitStage='drive',pitAttempts=0,pitElapsed=0,pitStartDistance=0,rivalAtEntry=0,rivalDuringService=0;
 // Service adapter supplies purchased resources; garage pricing/save persistence is separate.
 const onService=(kind,snapshot)=>{const next=structuredClone(snapshot);if(kind==='fuel')next.fuel=100;else if(kind==='repair-all')next.condition.fill(1);else if(kind==='ammo')next.ammo=Math.min(GUN_CAPACITY[spec.gun],next.ammo+100);else next[kind+'Ammo']++;services.push({kind,time:race.status.elapsed});return {ok:true,message:'Diagnostic service complete',snapshot:next};};
 const race=createRace(points,{...spec,city,pitIndex,laps:3,difficulty,career:mode==='career',ammo:300,rocketAmmo:2,missileAmmo:2,mineAmmo:3,caltropAmmo:3,ram:1,wheel:1,onService,onCombatEvent:e=>{damage[e.kind]=(damage[e.kind]??0)+e.damage;}});
 race.cars.forEach((car,id)=>{const recover=car.recover;car.recover=()=>{recoveries[id]++;return recover();};});race.setAutopilot(true);
 const kinds=['fuel','ammo','rocket','missile','mine','caltrop','repair-all'];let serviceIndex=0;
 for(;steps<900*60;steps++){
  const status=race.status;if(status.phase==='finished')break;
  const car=race.cars[0],s=car.state;let input={steer:0,throttle:0,brake:0,fire:status.elapsed%3<.45};
  race.selectWeapon(Math.floor(status.elapsed/12)%7);
  if(mode==='pits'&&pitStage==='drive'&&status.phase==='racing'&&status.pit.distance<85&&car.distance>20){pitStage='approach';race.setAutopilot(false);pitAttempts++;}
  if(pitStage==='approach'){
   // Follow the right-hand pit lane with physical steering and braking, no reset/teleport.
   const look=7+s.speed*.42;let i=car.road.i,travel=0;while(travel<look){const j=(i+1)%points.length;travel+=Math.hypot(points[j].x-points[i].x,points[j].z-points[i].z);i=j;}
   const a=points[i],b=points[(i+1)%points.length],yaw=Math.atan2(b.x-a.x,b.z-a.z),x=a.x+Math.cos(yaw)*4.8,z=a.z-Math.sin(yaw)*4.8,error=angleDelta(s.yaw,Math.atan2(x-s.x,z-s.z));
   const lateral=(s.x-car.road.x)*car.road.tz-(s.z-car.road.z)*car.road.tx;
   const stop=status.pit.window&&lateral>4;const target=stop?0:Math.min(9,Math.sqrt(Math.max(0,status.pit.distance)*8+9));
   input={steer:clamp(Math.atan(2*2.7*Math.sin(error)/look)*(1+s.speed/24)/.48*1.35,-1,1),throttle:s.speed<target?1:0,brake:s.speed>target+.2?1:0,fire:false};
   pitElapsed+=STEP;if(status.pit.eligible){if(!race.enterPit())issues.push('eligible pit entry rejected');pitStage='service';pitStartDistance=car.distance;rivalAtEntry=race.cars.slice(1).reduce((n,c)=>n+c.distance,0);}else if(pitElapsed>45){issues.push('pit approach timed out');break;}
  }
  if(pitStage==='service'){
   input={steer:0,throttle:0,brake:1,fire:false};
   if(!race.status.pit.service){if(serviceIndex<kinds.length)race.startService(kinds[serviceIndex++]);else{rivalDuringService=race.cars.slice(1).reduce((n,c)=>n+c.distance,0)-rivalAtEntry;if(Math.abs(car.distance-pitStartDistance)>.001)issues.push('pit awarded race progress');if(!race.leavePit())issues.push('pit exit rejected');pitStage='done';race.setAutopilot(true);}}
  }
  if((pitStage==='drive'||pitStage==='done')&&!status.autopilot&&!status.combat.states[0].disabled){race.setAutopilot(true);autoRestarts++;}
  const t=performance.now();race.step(input);const cost=performance.now()-t;totalStepMs+=cost;maxStepMs=Math.max(maxStepMs,cost);
  for(const e of race.drainFeedback())events[e.type]=(events[e.type]??0)+1;
  if(steps%60===0){const st=race.status;
   if(race.cars.some(c=>['x','y','z','vx','vz','vy','speed','yaw'].some(k=>!Number.isFinite(c.state[k]))))issues.push('non-finite physics');
   if(st.combat.states.some(w=>w.armor<0||w.condition.some(v=>!Number.isFinite(v)||v<0||v>1)||['ammo','rocketAmmo','missileAmmo','mineAmmo','caltropAmmo'].some(k=>w[k]<0)))issues.push('invalid combat resource');
   if(car.distance-lastDistance<.2&&!st.combat.states[0].disabled&&!st.pit.inPit&&pitStage!=='approach')noProgress++;else noProgress=0;lastDistance=car.distance;
   if(noProgress>30){issues.push('player autopilot stalled >30 seconds');break;}if(issues.length)break;
  }
 }
 const s=race.status;rows.push({city:city.id,mode,difficulty,carIndex,outcome:s.outcome??'timeout',elapsed:s.elapsed,laps:s.laps,progressLaps:race.cars[0].distance/race.cars[0].length,position:s.position,finished:s.finishTimes.filter(v=>v!==null).length,wrecked:s.combat.states.filter(w=>w.wrecked).length,recoveries,autoRestarts,landings:race.cars.map(c=>c.state.landingCount),fuel:s.fuel,damage,events,pitStage,pitAttempts,services,rivalDuringService,issues,meanStepMs:totalStepMs/Math.max(1,steps),maxStepMs,wallSeconds:(performance.now()-start)/1000});
 console.error(city.id,mode,difficulty,rows.at(-1).outcome,Math.round(s.elapsed)+'s',issues.join('; '));
 writeFileSync(new URL('../.local/full-races-'+mode+'-'+difficulty+'-car'+carIndex+(filter?'-'+filter:'')+'.json',import.meta.url),JSON.stringify(rows,null,2));
}
console.log(JSON.stringify(rows,null,2));

if(rows.some(r=>r.issues.length||r.outcome==='timeout'||mode!=='career'&&r.outcome!=='finished'||mode==='pits'&&(r.services.length!==7||r.rivalDuringService<=0)))process.exitCode=1;
