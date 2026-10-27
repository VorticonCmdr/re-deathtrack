// Deterministic balance probe. Local original assets required; does not touch saves.
// Player waits protected in the pit, allowing rival pace/attrition to be compared.
import {readFileSync} from 'node:fs';
import {track} from '../src/viewer/decode.js';
import {unexepack} from '../src/engine/exepack.js';
import {prepareRoad} from '../src/remaster/road.js';
import {createRace} from '../src/remaster/race.js';
import {GUN_CAPACITY} from '../src/remaster/balance.js';
import {CITIES} from '../src/remaster/championship.js';
const laps=Number(process.argv[2]??1),seconds=Number(process.argv[3]??300);
if(!Number.isInteger(laps)||laps<1||laps>99||!Number.isFinite(seconds)||seconds<10||seconds>3600)throw Error('Usage: node scripts/measure-remaster-balance.mjs [laps 1..99] [seconds 10..3600]');
const {image}=unexepack(new Uint8Array(readFileSync(new URL('../game/DTRACK.EXE',import.meta.url))));
const exe=new DataView(image.buffer,image.byteOffset,image.byteLength),rows=[],input={steer:0,throttle:0,brake:1,fire:false};
const difficulties=process.argv[4]==='all'?[0,1,2,3]:[0,3];
for(const difficulty of difficulties)for(const [cityIndex,city] of CITIES.entries()){
 const points=prepareRoad(track(new Uint8Array(readFileSync(new URL('../game/'+city.id.toUpperCase()+'.TRK',import.meta.url)))).points.slice(0,-2).map(p=>({x:p.x*.05,y:p.z*.05,z:p.y*.05})),city.id);
 const damageByKind={};
 const pitIndex=exe.getUint16(0x26fa0+0x1d04+cityIndex*2,true),race=createRace(points,{career:true,laps,difficulty,pitIndex,onCombatEvent:e=>{damageByKind[e.kind]=(damageByKind[e.kind]??0)+e.damage;}});
 for(let i=0;i<181;i++)race.step(input);
 race.cars[0].reset(pitIndex+12,4.8);
 if(!race.enterPit())throw Error(city.name+': could not enter observation pit');
 for(let i=0;i<seconds*60;i++)race.step(input);
 const s=race.status,states=s.combat.states.slice(1),times=s.finishTimes.slice(1).filter(t=>t!==null);
 if(s.phase!=='racing'||race.cars.some(c=>!Number.isFinite(c.state.x+c.state.y+c.state.z+c.state.speed))||states.some(w=>w.ammo<0||w.ammo>GUN_CAPACITY[w.gun]||w.mineAmmo<0||w.missileAmmo<0||w.condition.some(n=>!Number.isFinite(n))))throw Error(city.name+': invalid simulation');
 rows.push({landings:race.cars.slice(1).reduce((n,c)=>n+c.state.landingCount,0),damageByKind:Object.fromEntries(Object.entries(damageByKind).map(([k,v])=>[k,Math.round(v)])),city:city.name,difficulty,laps,finished:times.length,wrecked:states.filter(w=>w.wrecked).length,stillRacing:states.filter((w,i)=>!w.wrecked&&s.finishTimes[i+1]===null).length,firstFinishSeconds:times.length?Math.round(Math.min(...times)):null,meanArmorPercent:Math.round(states.reduce((sum,w)=>sum+w.armor/w.maxArmor,0)/9*100)});
}
console.log(JSON.stringify(rows,null,2));
