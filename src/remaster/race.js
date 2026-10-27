import {rivalProfile} from './balance.js';
import {createDriving, angleDelta, STEP} from './driving.js';
import {createCombat} from './combat.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
import {DRIVER_NAMES,DRIVER_COLORS} from './championship.js';
export {DRIVER_NAMES,DRIVER_COLORS};
export function createRace(points, config = {}) {
  const laps=config.laps??3,difficulty=config.difficulty??0;
  const cars=DRIVER_NAMES.map((_,i)=>createDriving(points,110,i===0?config:{}));
  const combat=createCombat(cars,points,config);
  const lengths=points.map((p,i)=>Math.hypot(points[(i+1)%points.length].x-p.x,points[(i+1)%points.length].z-p.z));
  const cumulative=[0];for(const n of lengths)cumulative.push(cumulative.at(-1)+n);
  const length=cumulative.at(-1);
  let autopilot=false;
  let phase, countdown, elapsed, impact, finishTimes, stuck, lanes, laneGoals, laneUntil, recoveryCooldown, fuel, inPit, serviceJob, serviceMessage, outcome, contactCooldown;
  const pitIndex=config.pitIndex??1138;
  function sample(distance,lateral=0){
    const d=((distance%length)+length)%length;let lo=0,hi=points.length-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(cumulative[mid]<=d)lo=mid;else hi=mid-1;}
    const a=points[lo],b=points[(lo+1)%points.length],t=(d-cumulative[lo])/Math.max(.001,lengths[lo]);
    const yaw=Math.atan2(b.x-a.x,b.z-a.z);
    return {x:a.x+(b.x-a.x)*t+Math.cos(yaw)*lateral,z:a.z+(b.z-a.z)*t-Math.sin(yaw)*lateral,yaw};
  }
  function reset(){
    // Staggered grid before the same finish line. Grid offsets do not count as race progress.
    cars.forEach((c,i)=>c.reset(86+Math.floor(i/2)*5,i%2?-2.1:2.1));
    autopilot=false;combat.reset();fuel=config.fuel??62.5;inPit=false;serviceJob=null;serviceMessage='';outcome=null;contactCooldown=new Map();phase='countdown';countdown=3;elapsed=0;impact=0;finishTimes=Array(cars.length).fill(null);
    stuck=Array(cars.length).fill(0);lanes=cars.map((_,i)=>(i%3-1)*1.6);laneGoals=[...lanes];laneUntil=cars.map(()=>0);recoveryCooldown=0;
  }
  reset();
  function aiInput(id,dt){
    const car=cars[id],s=car.state,d=car.road.distance,v=s.speed;
    // Autopilot should benefit from installed engines without using their full racing limit.
    const cruise=34+Math.max(0,Math.min(24,(config.maxSpeed??50)-50))*.35;
    const profile=id===0?{speed:cruise,lane:0}:rivalProfile(id),condition=combat.states[id].condition;
    let lane=profile.lane,targetSpeed=(profile.speed+(id===0?0:difficulty*1.5))*(.7+.3*condition[0]);
    // Preview the full braking horizon so sharp corners are anticipated, not discovered at the apex.
    for(let ahead=0;ahead<=65;ahead+=5){const a=sample(d+ahead),b=sample(d+ahead+10),curvature=Math.abs(angleDelta(a.yaw,b.yaw))/10;
      const cornerSpeed=Math.min(38,Math.sqrt((5.2+difficulty*.3)*(.4+.6*condition[3])/Math.max(.001,curvature)));
      targetSpeed=Math.min(targetSpeed,Math.sqrt(cornerSpeed**2+2*14*Math.max(0,ahead-6)));
    }
    // Keep a chosen passing lane long enough to clear traffic instead of weaving back into its path.
    const lateral=(s.x-car.road.x)*car.road.tz-(s.z-car.road.z)*car.road.tx;
    const traffic=cars.map((c,j)=>{const dx=c.state.x-s.x,dz=c.state.z-s.z;return {id:j,s:c.state,forward:dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),side:dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw)};}).filter(t=>t.id!==id&&finishTimes[t.id]==null&&!combat.states[t.id].disabled&&Math.abs(t.s.y-s.y)<1.5);
    const lead=traffic.filter(t=>t.forward>0&&t.forward<26&&Math.abs(t.side)<2.6).sort((a,b)=>a.forward-b.forward)[0];
    const trap=combat.hazardThreat(id),attacker=traffic.find(t=>t.id===combat.states[id].lastAttacker);
    const threatened=!!trap||(combat.states[id].underFire>0&&attacker?.forward<-4&&Math.abs(attacker.side)<2.8);
    const safeLane=candidate=>!traffic.some(t=>t.forward>-9&&t.forward<14&&Math.abs(t.side-(candidate-lateral))<2.7);
    if(elapsed<laneUntil[id])lane=laneGoals[id];
    if((lead||threatened)&&elapsed>=laneUntil[id]){
      const choices=[-2.8,0,2.8].filter(c=>Math.abs(c-lateral)>2&&safeLane(c)&&(!trap||Math.abs(c-(lateral+trap.side))>2.8));
      if(choices.length){lane=choices.sort((a,b)=>Math.abs(a-lateral)-Math.abs(b-lateral))[0];laneGoals[id]=lane;laneUntil[id]=elapsed+2.5;}
    }
    if(lead&&(lead.forward<10||!safeLane(lane)))targetSpeed=Math.min(targetSpeed,Math.max(0,lead.s.speed+(lead.forward-10)*.7));
    if(trap&&Math.abs(lane-(lateral+trap.side))<2.8)targetSpeed=Math.min(targetSpeed,Math.sqrt(2*12*Math.max(0,trap.forward-4)));
    lanes[id]+=(lane-lanes[id])*(1-Math.exp(-2*dt));
    const look=7+v*.42,target=sample(d+look,lanes[id]),desired=Math.atan2(target.x-s.x,target.z-s.z);
    const error=angleDelta(s.yaw,desired);
    const steer=clamp(Math.atan(2*2.7*Math.sin(error)/look)*(1+v/24)/.48*1.35,-1,1);
    stuck[id]=v<2||s.offroad?stuck[id]+dt:0;
    if(id!==0&&stuck[id]>4&&!s.airborne){car.recover();stuck[id]=0;}
    if(!s.airborne&&combat.incoming(id)<70)targetSpeed=Math.min(targetSpeed,Math.max(0,v-12));
    return {steer,throttle:v<targetSpeed?1:0,brake:v>targetSpeed+1?clamp((v-targetSpeed)/5,0,1):0,handbrake:false};
  }
  function contacts(){
    // Two circles approximate each car's footprint; ignore vertically separated overpasses.
    for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
      if((inPit&&(i===0||j===0))||finishTimes[i]!=null||finishTimes[j]!=null||combat.states[i].disabled||combat.states[j].disabled||combat.states[i].shield||combat.states[j].shield)continue;
      const a=cars[i].state,b=cars[j].state;if(Math.abs(a.y-b.y)>1.5)continue;
      for(const oa of [-1.15,1.15])for(const ob of [-1.15,1.15]){
        const dx=b.x+Math.sin(b.yaw)*ob-a.x-Math.sin(a.yaw)*oa,dz=b.z+Math.cos(b.yaw)*ob-a.z-Math.cos(a.yaw)*oa;
        const distance=Math.hypot(dx,dz);if(distance>=2.4)continue;
        const nx=distance>.001?dx/distance:1,nz=distance>.001?dz/distance:0,push=(2.4-distance)*.5;
        a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;
        const closing=(a.vx-b.vx)*nx+(a.vz-b.vz)*nz;combat.contact(i,j,closing);
        const pair=i+':'+j;
        if(closing>4&&!contactCooldown.has(pair)){combat.damage(i,Math.min(15,(closing-4)*.6),j);combat.damage(j,Math.min(15,(closing-4)*.6),i);contactCooldown.set(pair,.5);}
        if(closing>0){const impulse=closing*.55;a.vx-=nx*impulse;a.vz-=nz*impulse;b.vx+=nx*impulse;b.vz+=nz*impulse;if(i===0||j===0)impact=Math.max(impact,Math.min(1,closing/12));}
      }
    }
  }
  function step(input,dt=STEP){
    if(autopilot&&(input.throttle||input.brake||input.steer||input.handbrake))autopilot=false;
    impact=Math.max(0,impact-dt*2);recoveryCooldown=Math.max(0,recoveryCooldown-dt);
    if(phase==='countdown'){countdown=Math.max(0,countdown-dt);if(countdown===0)phase='racing';return;}
    if(phase!=='racing')return;
    elapsed+=dt;combat.tickTimers(dt);for(const [pair,remaining] of contactCooldown){if(remaining<=dt)contactCooldown.delete(pair);else contactCooldown.set(pair,remaining-dt);}
    const w=combat.states[0];if(w.disabled)autopilot=false;
    if(!inPit){fuel=Math.max(0,fuel-dt*(.025+cars[0].state.speed*.004));if(cars[0].state.offroad&&cars[0].state.speed>1)w.condition[3]=Math.max(0,w.condition[3]-dt*.001);}
    if(serviceJob){serviceJob.remaining=Math.max(0,serviceJob.remaining-dt);if(serviceJob.remaining===0){const result=config.onService?.(serviceJob.kind,snapshot());serviceMessage=result?.message??'Service unavailable';if(result?.ok){combat.feedback('service',cars[0].state,{kind:serviceJob.kind});fuel=result.snapshot.fuel;w.ammo=result.snapshot.ammo;w.mineAmmo=result.snapshot.mineAmmo;w.caltropAmmo=result.snapshot.caltropAmmo;w.rocketAmmo=result.snapshot.rocketAmmo;w.missileAmmo=result.snapshot.missileAmmo;w.condition=[...result.snapshot.condition];w.armor=w.maxArmor*w.condition[5];}serviceJob=null;}}
    cars.forEach((car,i)=>car.setCondition(combat.states[i].condition));
    const playerInput=autopilot&&!inPit&&!w.disabled?{...input,...aiInput(0,dt)}:input;
    const previous=cars.map(c=>({...c.state}));
    for(let i=0;i<cars.length;i++)if(finishTimes[i]==null&&!combat.states[i].disabled&&!(i===0&&inPit)){cars[i].step(i===0?{...playerInput,throttle:fuel>0?playerInput.throttle:0,brake:fuel>0?playerInput.brake:1}:aiInput(i,dt),dt);if(cars[i].distance>=length*laps){finishTimes[i]=elapsed;cars[i].state.vx=cars[i].state.vz=cars[i].state.speed=0;}}else cars[i].hold(dt);
    cars.forEach((car,id)=>{if(car.state.landingCount!==previous[id].landingCount){const severity=car.state.landingSpeed;combat.states[id].condition[3]=Math.max(0,combat.states[id].condition[3]-Math.max(0,severity-9)*.003);if(severity>12)combat.damage(id,Math.min(18,(severity-12)*1.5),-1,'landing');if(id===0)impact=Math.max(impact,Math.min(.65,severity/20));}});
    contacts();if(finishTimes[0]!=null){phase='finished';outcome='finished';return;}
    combat.step(dt,cars.map((_,i)=>i===0?!!input.fire:combat.wantsFire(i,finishTimes,elapsed)),finishTimes,previous,playerInput);
    if(w.wrecked){phase='finished';outcome='wrecked';}else if(!inPit&&fuel===0&&cars[0].state.speed<.1){phase='finished';outcome='fuel';}
  }
  function recover(){autopilot=false;if(phase==='racing'&&!inPit&&recoveryCooldown===0&&!combat.states[0].disabled){cars[0].recover();recoveryCooldown=5;}}
  function order(){return cars.map((_,i)=>i).sort((a,b)=>{
    if(finishTimes[a]!=null||finishTimes[b]!=null)return (finishTimes[a]??Infinity)-(finishTimes[b]??Infinity);
    if(combat.states[a].wrecked!==combat.states[b].wrecked)return combat.states[a].wrecked?1:-1;return cars[b].distance-cars[a].distance||a-b;
  });}
  function snapshot(){const w=combat.states[0];return {mineAmmo:w.mineAmmo,caltropAmmo:w.caltropAmmo,ammo:w.ammo,rocketAmmo:w.rocketAmmo,missileAmmo:w.missileAmmo,battery:w.battery,selected:w.selected,condition:[...w.condition],fuel};}
  function pitInfo(){const car=cars[0],road=car.road,lateral=(car.state.x-road.x)*road.tz-(car.state.z-road.z)*road.tx;const window=road.i>pitIndex&&road.i<pitIndex+60;let distance=(cumulative[pitIndex]-road.distance+length)%length;return {inPit,window,distance,eligible:phase==='racing'&&!inPit&&window&&lateral>3.4&&!car.state.airborne&&car.state.speed<1&&!combat.states[0].disabled,service:serviceJob?{...serviceJob}:null,message:serviceMessage};}
  function enterPit(){if(!pitInfo().eligible)return false;autopilot=false;inPit=true;combat.states[0].servicing=true;cars[0].state.vx=cars[0].state.vz=cars[0].state.speed=0;return true;}
  function leavePit(){if(!inPit||serviceJob)return false;inPit=false;combat.states[0].servicing=false;combat.states[0].shield=2;serviceMessage='';return true;}
  function startService(kind){if(!inPit||serviceJob||phase!=='racing'||!['fuel','ammo','rocket','missile','mine','caltrop','repair-all','repair:5','repair:3'].includes(kind))return false;serviceJob={kind,remaining:['ammo','rocket','missile','mine','caltrop'].includes(kind)?2:5,total:['ammo','rocket','missile','mine','caltrop'].includes(kind)?2:5};serviceMessage='Crew at work';return true;}
  function abandon(){autopilot=false;if(phase==='finished')return;outcome='quit';phase='finished';inPit=false;serviceJob=null;combat.states[0].servicing=false;}
  return {drainFeedback:()=>combat.drainFeedback(),setAutopilot(value){autopilot=!!value&&phase!=='finished'&&!inPit&&!combat.states[0].disabled;stuck[0]=0;laneUntil[0]=0;lanes[0]=laneGoals[0]=0;return autopilot;},cycleTarget(){combat.cycleTarget();},selectWeapon(index){combat.selectWeapon(index);},step,reset,recover,cars,enterPit,leavePit,startService,abandon,get snapshot(){return snapshot();},get state(){return cars[0].state;},get telemetry(){return cars[0].telemetry;},
    interpolate(alpha){return {cars:cars.map((c,i)=>({...c.interpolate(alpha),finished:finishTimes[i]!=null})),impact:Math.max(impact,combat.view.hurt),combat:combat.view,running:phase==='racing'};},
    get status(){return {autopilot:autopilot&&phase!=='finished',city:config.city?.name??'Seattle',phase,countdown,elapsed,impact,fuel,outcome,pit:pitInfo(),id:config.eventId,contract:config.contract,position:order().indexOf(0)+1,order:order(),finishTimes:[...finishTimes],recoveryCooldown,combat:combat.view,
      totalLaps:laps,laps:Math.min(laps,Math.floor(Math.max(0,cars[0].distance)/length)+1)};}};
}
