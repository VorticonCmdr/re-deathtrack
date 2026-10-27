// Local deterministic crossing probes, independent of profiles and saves.
import {readFileSync} from 'node:fs';
import {track} from '../src/viewer/decode.js';
import {prepareRoad,smoothRoad,CROSSING_REPAIRS} from '../src/remaster/road.js';
import {createDriving,angleDelta} from '../src/remaster/driving.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),reports=[];
for(const city of ['nyc','boston']){
 const raw=track(new Uint8Array(readFileSync('game/'+city.toUpperCase()+'.TRK'))).points.slice(0,-2).map(p=>({x:p.x*.05,y:p.z*.05,z:p.y*.05})),points=prepareRoad(raw,city),original=smoothRoad(raw),repair=CROSSING_REPAIRS[city];
 const runs=[];
 for(const route of ['lower','upper'])for(const speed of [10,25,40,60])for(const lane of [-4,0,4]){
  const index=repair[route],car=createDriving(points),s=car.state;car.reset(index-115,lane);car.state.vx=Math.sin(car.state.yaw)*speed;car.state.vz=Math.cos(car.state.yaw)*speed;car.state.speed=speed;
  let maxStep=0,minBodyGap=Infinity,minCameraGap=Infinity,passed=false,wrongBranch=false;
  for(let frame=0;frame<3600;frame++){
   const c=car.state,oldY=c.y,look=Math.max(6,Math.round((7+c.speed*.42)/1.5)),target=points[(car.road.i+look)%points.length],next=points[(car.road.i+look+1)%points.length],yaw=Math.atan2(next.x-target.x,next.z-target.z),tx=target.x+Math.cos(yaw)*lane,tz=target.z-Math.sin(yaw)*lane,error=angleDelta(c.yaw,Math.atan2(tx-c.x,tz-c.z)),distance=Math.max(1,Math.hypot(tx-c.x,tz-c.z));
   car.step({throttle:c.speed<speed?1:0,brake:c.speed>speed+1?.5:0,steer:clamp(Math.atan(2*2.7*Math.sin(error)/distance)*(1+c.speed/24)/.48*1.35,-1,1)});
   maxStep=Math.max(maxStep,Math.abs(c.y-oldY));wrongBranch ||= Math.abs(car.road.i-index)>160;
   if(route==='lower')for(const [kind,offset,height] of [['body',0,1.8],['camera',-(10+Math.min(c.speed/25,2)),4.5]]){
    const x=c.x+Math.sin(c.yaw)*offset,z=c.z+Math.cos(c.yaw)*offset;
    for(let i=repair.upper-14;i<repair.upper+14;i++){const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=((x-a.x)*dx+(z-a.z)*dz)/l2;if(t<0||t>1)continue;const side=Math.abs((x-a.x-t*dx)*dz-(z-a.z-t*dz)*dx)/Math.sqrt(l2);if(side>(kind==='body'?8.9:7.6))continue;const gap=a.y+(b.y-a.y)*t-.35-(c.y+height);if(kind==='body')minBodyGap=Math.min(minBodyGap,gap);else minCameraGap=Math.min(minCameraGap,gap);}
   }
   if(car.road.i>=index+115){passed=true;break;}
  }
  runs.push({route,speedKmh:speed*3.6,lane,passed,wrongBranch,maxVerticalStep:+maxStep.toFixed(3),minimumBodyClearance:Number.isFinite(minBodyGap)?+minBodyGap.toFixed(2):null,minimumChaseCameraClearance:Number.isFinite(minCameraGap)?+minCameraGap.toFixed(2):null});
 }
 reports.push({city,originalUpperSampleHeight:+original[repair.upper].y.toFixed(3),newUpperSampleHeight:+points[repair.upper].y.toFixed(3),indicesAndXYUnchanged:points.length===raw.length&&points.every((p,i)=>p.x===raw[i].x&&p.z===raw[i].z),runs});
}
console.log(JSON.stringify({scope:'48 fixed-step approach probes; 1.8m body envelope and nominal chase camera. Not headroom proof for arbitrary jumps/collisions.',reports},null,2));
if(reports.some(r=>!r.indicesAndXYUnchanged||r.runs.some(s=>!s.passed||s.wrongBranch||s.minimumBodyClearance!==null&&s.minimumBodyClearance<=0||s.minimumChaseCameraClearance!==null&&s.minimumChaseCameraClearance<=0)))process.exitCode=1;
