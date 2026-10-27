// Read-only local asset inspection. Reports measurements, not a human playtest verdict.
import {readFileSync} from 'node:fs';
import {track,models} from '../src/viewer/decode.js';
import {unexepack} from '../src/engine/exepack.js';
import {prepareRoad,clearsRoad} from '../src/remaster/road.js';
import {cityScenery} from '../src/remaster/city-style.js';
import {CITIES} from '../src/remaster/championship.js';
import {createRace} from '../src/remaster/race.js';
const load=name=>new Uint8Array(readFileSync(new URL('../game/'+name,import.meta.url)));
const {image}=unexepack(load('DTRACK.EXE')),exe=new DataView(image.buffer,image.byteOffset,image.byteLength),shapes=models(load('SHAPE.TBL'));
const report=[];
for(const [cityIndex,city] of CITIES.entries()){
 const decoded=track(load(city.id.toUpperCase()+'.TRK')),pts=prepareRoad(decoded.points.slice(0,-2).map(p=>({x:p.x*.05,y:p.z*.05,z:p.y*.05})),city.id),scenery=cityScenery(pts,city);
 let length=0,maxGrade=0,minSegment=Infinity,zeroSpans=0;const crossings=[];
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);length+=d;if(d<1e-6)zeroSpans++;else minSegment=Math.min(minSegment,d);maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/Math.max(.001,d));
  for(let j=i+3;j<pts.length;j++){if(i===0&&j>pts.length-3)continue;const c=pts[j],e=pts[(j+1)%pts.length],ex=e.x-c.x,ez=e.z-c.z,det=dx*ez-dz*ex;if(Math.abs(det)<1e-8)continue;const cx=c.x-a.x,cz=c.z-a.z,t=(cx*ez-cz*ex)/det,u=(cx*dz-cz*dx)/det;if(t>=0&&t<1&&u>=0&&u<1)crossings.push({segments:[i,j],heightGapMeters:+Math.abs(a.y+(b.y-a.y)*t-c.y-(e.y-c.y)*u).toFixed(2)});}
 }
 let retained=0,relocated=0,omitted=0;
 for(const o of decoded.objects){const src=shapes[o.shape];if(!src)continue;const xs=src.vertices.map(v=>v.x*.05),zs=src.vertices.map(v=>v.y*.05),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,radius=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))/2;
  const index=Math.min(o.index,pts.length-1),p=pts[index],x=o.x*.05,z=o.y*.05;let dx=x-p.x,dz=z-p.z;if(Math.hypot(dx,dz)<.032){const a=pts[(index+1)%pts.length],b=pts[(index+pts.length-1)%pts.length];dx=-(a.z-b.z);dz=a.x-b.x;}const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;let found=false;for(let d=0;d<=100;d+=2)if(clearsRoad(pts,x+dx*d+cx,z+dz*d+cz,radius)){d?relocated++:retained++;found=true;break;}if(!found)omitted++;
 }
 const pitIndex=exe.getUint16(0x26fa0+0x1d04+cityIndex*2,true),race=createRace(pts,{pitIndex});for(let i=0;i<181;i++)race.step({throttle:0,brake:1,steer:0});race.cars[0].reset(pitIndex+12,4.8);const pitEntry=race.enterPit();
 const scenicClear=[...scenery.buildings,...scenery.plants,scenery.landmark].every(p=>clearsRoad(pts,p.x,p.z,p.radius));
 report.push({city:city.name,style:scenery.style.landmark,samples:pts.length,lengthMeters:Math.round(length),maxGradePercent:+(maxGrade*100).toFixed(1),minimumSegmentMeters:+minSegment.toFixed(3),coincidentSamples:zeroSpans,crossings,pitIndex,pitEntry,sceneryFootprintsClear:scenicClear,buildings:scenery.buildings.length,plants:scenery.plants.length,sourceScenery:{retained,relocated,omitted},finite:pts.every(p=>Number.isFinite(p.x+p.y+p.z))});
}
console.log(JSON.stringify({scope:'Geometry, decoration footprints and pit entry; not full visual/human driving acceptance.',circuits:report},null,2));
if(report.some(r=>!r.finite||!r.pitEntry||!r.sceneryFootprintsClear||r.minimumSegmentMeters<=0))process.exitCode=1;
