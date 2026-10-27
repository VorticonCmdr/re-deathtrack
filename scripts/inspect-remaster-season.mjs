// Accelerated season diagnostic. In-memory storage never reads browser saves.
import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {track} from '../src/viewer/decode.js';
import {unexepack} from '../src/engine/exepack.js';
import {prepareRoad} from '../src/remaster/road.js';
import {createRace} from '../src/remaster/race.js';
import {CITIES,currentCity,seasonOrder} from '../src/remaster/championship.js';
import {createProgression} from '../src/remaster/progression.js';
import {vehicleSpec} from '../src/remaster/garage.js';
import {partRepairCost,serviceEquipment,upgradePart} from '../src/remaster/economy.js';
import {STEP,angleDelta} from '../src/remaster/driving.js';
const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
const carIndex=Number(process.argv[2]??0),strategy=process.argv[3]??'planned';
if(![0,1,2].includes(carIndex)||!['planned','no-pits'].includes(strategy))throw Error('Usage: inspect-remaster-season.mjs 0..2 planned|no-pits');
const read=name=>new Uint8Array(readFileSync(new URL('../game/'+name,import.meta.url)));
const {image}=unexepack(read('DTRACK.EXE')),exe=new DataView(image.buffer,image.byteOffset,image.byteLength),table=(off,n)=>Array.from({length:n},(_,i)=>exe.getUint16(0x26fa0+off+i*2,true));
const catalog={parts:table(0x1dda,18),weapons:table(0x1dfe,27),capacity:table(0x1e34,27),prizes:table(0xd2e,10),pits:table(0x1d04,10)};
let store=createProgression();store.switchMode('career');store.profile.car=carIndex;store.save();
const rows=[],issues=[],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
for(let round=0;round<10;round++){
 const p=store.profile,b=p.builds[p.car],city=currentCity(p),cashBefore=p.cash,transactions=[];
 const buy=(kind,where='garage')=>{const before=p.cash,result=serviceEquipment(p,catalog,kind);if(result.ok)transactions.push({where,kind,cost:before-p.cash});return result;};
 // Repair vital parts first, keep a pit reserve, prioritize armor then handling.
 for(const i of [5,3,0,2,1,4])if(b.condition[i]<(i===5?.9:i===3?.8:.7))buy('repair:'+i);
 for(const i of [5,5,3,1,2,0,4]){const cost=catalog.parts[i*3+b.parts[i]+1];if(b.parts[i]<2&&p.cash-cost>=(i===5?4000:6000)){const result=upgradePart(p,catalog,i);if(result.ok)transactions.push({where:'garage',kind:'upgrade:'+i,cost:result.cost});}}
 if(b.ammo<100&&p.cash>3000)buy('ammo');
 if(b.condition[5]<=0||b.condition[3]<=.05){issues.push('Cannot afford essential repair before '+city.id);break;}
 store.save();const active=store.begin(),startBuild=structuredClone(b);
 const points=prepareRoad(track(read(city.id.toUpperCase()+'.TRK')).points.slice(0,-2).map(p=>({x:p.x*.05,y:p.z*.05,z:p.y*.05})),city.id),pitIndex=catalog.pits[CITIES.indexOf(city)];
 let race,stage='drive',lastPitDistance=-Infinity,approachTime=0,pitDistance=0,rivalDistance=0,pits=0,queue=[],services=[],damage={};
 race=createRace(points,{...vehicleSpec(b),city,pitIndex,career:true,laps:p.laps,difficulty:p.difficulty,eventId:active.id,onService:(kind,snapshot)=>{store.checkpoint(snapshot);const result=buy(kind,'pit');store.save();services.push({kind,ok:result.ok,time:race.status.elapsed,message:result.message});return result;},onCombatEvent:e=>{if(e.victim===0)damage[e.kind]=(damage[e.kind]??0)+e.damage;}});
 race.setAutopilot(true);
 for(let steps=0;steps<900*60;steps++){
  const st=race.status;if(st.phase==='finished')break;const car=race.cars[0],s=car.state,w=st.combat.states[0];
  // Spend gun rounds, then the finite laser battery, then the charged particle beam.
  race.selectWeapon(race.snapshot.ammo>0?0:race.snapshot.battery>0?1:2);
  let input={steer:0,throttle:0,brake:0,fire:st.elapsed%3<.5};
  const repairQuote=partRepairCost({...b,condition:w.condition},catalog,5); const tyreQuote=partRepairCost({...b,condition:w.condition},catalog,3);
  const needsStop=st.fuel<15||p.cash>=repairQuote&&w.condition[5]<(st.laps===p.laps?.3:.6)||p.cash>=tyreQuote&&w.condition[3]<.35;
  if(strategy==='planned'&&stage==='drive'&&st.phase==='racing'&&needsStop&&st.pit.distance<85&&car.distance-lastPitDistance>car.length*.5&&car.distance>20){stage='approach';approachTime=0;race.setAutopilot(false);}
  if(stage==='approach'){
   const look=7+s.speed*.42;let i=car.road.i,travel=0;while(travel<look){const j=(i+1)%points.length;travel+=Math.hypot(points[j].x-points[i].x,points[j].z-points[i].z);i=j;}
   const a=points[i],next=points[(i+1)%points.length],yaw=Math.atan2(next.x-a.x,next.z-a.z),x=a.x+Math.cos(yaw)*4.8,z=a.z-Math.sin(yaw)*4.8,error=angleDelta(s.yaw,Math.atan2(x-s.x,z-s.z));
   const lateral=(s.x-car.road.x)*car.road.tz-(s.z-car.road.z)*car.road.tx,target=st.pit.window&&lateral>4?0:Math.min(9,Math.sqrt(Math.max(0,st.pit.distance)*8+9));
   input={steer:clamp(Math.atan(2*2.7*Math.sin(error)/look)*(1+s.speed/24)/.48*1.35,-1,1),throttle:s.speed<target?1:0,brake:s.speed>target+.2?1:0,fire:false};
   approachTime+=STEP;if(st.pit.eligible){race.enterPit();pits++;stage='service';pitDistance=car.distance;rivalDistance=race.cars.slice(1).reduce((n,c)=>n+c.distance,0);store.checkpoint(race.snapshot);queue=st.fuel<35?['fuel']:[];let budget=p.cash;for(const i of [5,3]){const cost=partRepairCost(b,catalog,i);if(b.condition[i]<(i===5?.8:.65)&&cost<=budget){queue.push('repair:'+i);budget-=cost;}}if(b.ammo<100&&budget>=catalog.weapons[6+b.gun]+1500)queue.push('ammo');}
   else if(approachTime>45){issues.push(city.id+': pit approach timeout');break;}
  }
  if(stage==='service'){
   input={steer:0,throttle:0,brake:1,fire:false};if(!race.status.pit.service){if(queue.length)race.startService(queue.shift());else{if(Math.abs(car.distance-pitDistance)>.001)issues.push('pit awarded progress');if(race.cars.slice(1).reduce((n,c)=>n+c.distance,0)<rivalDistance)issues.push('rivals lost progress');race.leavePit();lastPitDistance=car.distance;stage='drive';input={steer:0,throttle:0,brake:0,fire:false};race.setAutopilot(true);}}
  }
  race.step(input);race.drainFeedback();
  if(steps%600===0){store.checkpoint(race.snapshot);if(!store.save())issues.push('checkpoint failed');if(race.cars.some(c=>!Number.isFinite(c.state.x+c.state.y+c.state.z)))issues.push('nonfinite physics');}
 }
 const st=race.status;store.checkpoint(race.snapshot);if(!st.outcome){issues.push(city.id+': timeout');break;}
 const receipt=store.settle({id:active.id,outcome:st.outcome,position:st.position,order:st.order,kills:st.combat.stats.kills},catalog.prizes),cashAfter=p.cash;
 store.settle({id:active.id,outcome:st.outcome,position:st.position,order:st.order,kills:[]},catalog.prizes);if(p.cash!==cashAfter)issues.push('duplicate payout');
 if(cashBefore-transactions.reduce((n,t)=>n+t.cost,0)+receipt.prize+receipt.bounty!==cashAfter)issues.push('cash ledger mismatch');
 const serialized=structuredClone(p);store=createProgression();if(!isDeepStrictEqual(store.profile,serialized))issues.push('reload mismatch');
 rows.push({round:round+1,city:city.id,outcome:st.outcome,position:st.position,elapsed:st.elapsed,pits,services,damage,cashBefore,transactions,prize:receipt.prize,cashAfter,startBuild,endBuild:structuredClone(store.profile.builds[carIndex]),points:store.profile.points});
 console.error(city.id,st.outcome,st.position,'cash',cashAfter,'pits',pits);
}
const report={carIndex,strategy,rows,issues,season:store.profile.season,cash:store.profile.cash,rank:seasonOrder(store.profile.season).indexOf(0)+1,profile:structuredClone(store.profile)};
writeFileSync(new URL('../.local/season-'+carIndex+'-'+strategy+'.json',import.meta.url),JSON.stringify(report,null,2));
if(issues.length||rows.length!==10)process.exitCode=1;
console.log(JSON.stringify({carIndex,strategy,events:rows.length,finished:rows.filter(r=>r.outcome==='finished').length,cash:report.cash,rank:report.rank,issues}));
