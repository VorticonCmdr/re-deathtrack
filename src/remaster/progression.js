import {recordMoneyWinner} from './statistics.js';
import {ROCKET_CAPACITY,MISSILE_CAPACITY,MINE_CAPACITY,CALTROP_CAPACITY} from './weapons.js';
import {CITIES,newSeason,currentCity,recordRound} from './championship.js';
// Local race economy. A single profile write records both the payout and its receipt.
const PREFIX='deathtrack.remaster.';
export function freshProfile(mode='practice'){
 return {version:7,driverId:crypto.randomUUID(),driverName:mode==='career'?'Rookie':'Practice driver',season:newSeason(),practiceCity:6,difficulty:0,laps:3,mode,car:0,cash:10000,events:0,earnings:0,points:0,lockedCar:false,contract:false,active:null,lastResult:null,builds:[{parts:[1,0,1,0,0,0],ammo:300,gun:0},{parts:[0,0,0,0,1,1],ammo:100,gun:0},{parts:[0,0,0,0,0,2],ammo:100,gun:1}].map((b,i)=>({...b,laser:i===1?1:0,beam:0,selected:0,battery:100,rocket:0,missile:0,rocketAmmo:[2,0,3][i],missileAmmo:[0,3,1][i],mine:0,caltrop:0,mineAmmo:[0,1,3][i],caltropAmmo:0,ram:i===0?1:0,wheel:i===0?1:0,condition:Array(6).fill(1),fuel:62.5}))};
}
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function validate(p,mode){
 if(!p||p.mode!==mode)throw Error('This save belongs to another mode. Switch Championship / Practice before importing.');
 if(typeof p.driverId!=='string'||!/^[0-9a-f-]{36}$/i.test(p.driverId)||p.version!==7||typeof p.driverName!=='string'||!p.driverName.trim()||p.driverName.length>24||/[<>\x00-\x1f]/.test(p.driverName)||p.mode!==mode||!integer(p.car,0,2)||!integer(p.cash,0,1e9)||!integer(p.events,0,1e7)||!integer(p.earnings,0,1e12)||!integer(p.points,0,1e12)||typeof p.lockedCar!=='boolean'||typeof p.contract!=='boolean'||!Array.isArray(p.builds)||p.builds.length!==3)throw Error('Invalid profile');
 for(const b of p.builds)if(!Array.isArray(b.parts)||b.parts.length!==6||b.parts.some(v=>!integer(v,0,2))||!integer(b.gun,0,2)||!integer(b.laser,0,2)||!integer(b.beam,0,2)||!integer(b.rocket,0,2)||!integer(b.missile,0,2)||!integer(b.rocketAmmo,0,ROCKET_CAPACITY[b.rocket])||!integer(b.missileAmmo,0,MISSILE_CAPACITY[b.missile])||!integer(b.mine,0,2)||!integer(b.caltrop,0,2)||!integer(b.ram,0,2)||!integer(b.wheel,0,2)||!integer(b.mineAmmo,0,MINE_CAPACITY[b.mine])||!integer(b.caltropAmmo,0,CALTROP_CAPACITY[b.caltrop])||!integer(b.selected,0,6)||!integer(b.battery,0,100)||!integer(b.ammo,0,[1000,700,400][b.gun])||!Array.isArray(b.condition)||b.condition.length!==6||b.condition.some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isFinite(b.fuel)||b.fuel<0||b.fuel>100)throw Error('Invalid equipment');
 if(p.active!==null&&(!p.active||typeof p.active.id!=='string'||!integer(p.active.car,0,2)||!integer(p.active.target,0,9)||!integer(p.active.bounty,0,5000)))throw Error('Invalid event');
 if(p.lastResult!==null&&(!p.lastResult||typeof p.lastResult.id!=='string'||!integer(p.lastResult.prize,0,13000)||!integer(p.lastResult.bounty,0,5000)||!integer(p.lastResult.position,1,10)||!['finished','wrecked','fuel','quit','interrupted'].includes(p.lastResult.outcome)))throw Error('Invalid result');
 const s=p.season;if(!integer(p.practiceCity,0,9)||!integer(p.difficulty,0,3)||!integer(p.laps,1,99)||!s||!integer(s.number,1,100000)||!integer(s.round,0,10)||!['racing','won','lost'].includes(s.state)||!Array.isArray(s.history)||s.history.length!==s.round||!Array.isArray(s.points)||s.points.length!==10||s.points.some(v=>!integer(v,0,10000))||!Array.isArray(s.wins)||s.wins.length!==10||s.wins.some(v=>!integer(v,0,10))||(s.round===10)===(s.state==='racing'))throw Error('Invalid championship');
 for(const h of s.history)if(!integer(h.city,0,9)||!integer(h.position,1,10)||!validOrder(h.order)||h.order.indexOf(0)+1!==h.position||!['finished','wrecked','fuel','quit','interrupted'].includes(h.outcome)||!integer(h.prize,0,13000)||!integer(h.bounty,0,5000))throw Error('Invalid event history');
 if(p.active&&(!integer(p.active.round,0,9)||!integer(p.active.city,0,9)))throw Error('Invalid active round');
 return p;
}
function validOrder(order){return Array.isArray(order)&&order.length===10&&new Set(order).size===10&&order.every(v=>integer(v,0,9));}
export function decodeProfile(value,mode){
 if(!value||![6,7].includes(value.version))throw Error('Unsupported profile version.');
 const p=JSON.parse(JSON.stringify(value));if(p.version===6){p.version=7;p.driverName=mode==='career'?'Rookie':'Practice driver';}
 p.driverId??=crypto.randomUUID();validate(p,mode);
 const clean=Object.fromEntries(Object.keys(freshProfile(mode)).map(key=>[key,p[key]]));
 clean.builds=p.builds.map(b=>Object.fromEntries(Object.keys(freshProfile(mode).builds[0]).map(key=>[key,b[key]])));
 clean.season=Object.fromEntries(['number','round','state','points','wins','history'].map(key=>[key,p.season[key]]));
 clean.season.history=p.season.history.map(h=>Object.fromEntries(['city','position','order','outcome','prize','bounty'].filter(k=>Object.hasOwn(h,k)).map(k=>[k,h[k]])));
 for(const key of ['active','lastResult'])if(p[key])clean[key]=Object.fromEntries((key==='active'?['id','car','round','city','target','bounty']:['id','outcome','position','prize','bounty','city','round','order']).filter(k=>Object.hasOwn(p[key],k)).map(k=>[k,p[key][k]]));
 if(clean.active){clean.lastResult={id:clean.active.id,outcome:'interrupted',position:10,prize:0,bounty:0};clean.active=null;}
 return clean;
}
export function createProgression(){
 let profile,blocked=false,message='',mode='practice';
 try{mode=localStorage.getItem(PREFIX+'mode')==='career'?'career':'practice';}catch{}
 function load(next){mode=next;blocked=false;message='Saved on this device';try{
  const raw=localStorage.getItem(PREFIX+mode+'.v7')||localStorage.getItem(PREFIX+mode+'.v6');
  if(raw)profile=decodeProfile(JSON.parse(raw),mode);
  else {profile=freshProfile(mode);const previous=localStorage.getItem(PREFIX+mode+'.v5')||localStorage.getItem(PREFIX+mode+'.v4')||localStorage.getItem(PREFIX+mode+'.v3')||localStorage.getItem(PREFIX+mode+'.v2')||(mode==='practice'?localStorage.getItem(PREFIX+'practice.v1'):null);if(previous){const p=JSON.parse(previous);if(![1,2,3,4,5].includes(p.version)||p.mode!==mode)throw Error();profile=validate({...profile,...p,version:7,driverName:profile.driverName,season:p.season??newSeason(),points:p.version>=3?p.points:0,practiceCity:p.practiceCity??6,difficulty:p.difficulty??0,laps:p.laps??3,active:p.version>=3?p.active:null,builds:p.builds.map((b,i)=>({...b,laser:b.laser??(i===1?1:0),beam:b.beam??0,selected:b.selected??0,battery:b.battery??100,rocket:b.rocket??0,missile:b.missile??0,rocketAmmo:b.rocketAmmo??[2,0,3][i],missileAmmo:b.missileAmmo??[0,3,1][i],mine:0,caltrop:0,mineAmmo:[0,1,3][i],caltropAmmo:0,ram:i===0?1:0,wheel:i===0?1:0,condition:b.condition??Array(6).fill(1),fuel:b.fuel??62.5}))},mode);message=p.version>=3?'Championship and equipment retained. Rear hazards and contact weapons are ready.':'Previous equipment and balance retained. A new championship begins in Phoenix.';}}
  // Race snapshots are not resumed. A crash/reload retains checkpoints but never pays an unfinished event.
  if(profile.active){profile.lastResult={id:profile.active.id,outcome:'interrupted',position:10,prize:0,bounty:0};profile.active=null;save();}
 }catch{profile=freshProfile(mode);blocked=true;message='Save unreadable or newer than this game. Preserved; restore a recovery copy, import a valid save, or reset this profile to enable saving.';}}
 function save(){if(blocked)return false;try{
  const text=JSON.stringify(validate(profile,mode)),key=PREFIX+mode+'.v7',old=localStorage.getItem(key);
  if(old&&old!==text){decodeProfile(JSON.parse(old),mode);localStorage.setItem(key+'.backup',old);}
  localStorage.setItem(key,text);message=recordMoneyWinner(profile)?'Saved on this device':'Profile saved; local money-winner records could not be updated.';try{localStorage.setItem(PREFIX+'mode',mode);}catch{}return true;
 }catch{message='Storage unavailable or changed — this session is not saved. Export a copy before leaving.';return false;}}
 function replace(candidate){
  if(profile.active)throw Error('Finish or retire the event before replacing a save.');
  const next=decodeProfile(candidate,mode),key=PREFIX+mode+'.v7';
  // Preserve the exact existing bytes, even when unreadable. Do not replace on storage failure.
  try{const old=localStorage.getItem(key)||localStorage.getItem(PREFIX+mode+'.v6');if(old)localStorage.setItem(key+'.recovery',old);localStorage.setItem(key,JSON.stringify(next));}catch{throw Error('Could not preserve and write the save. Nothing was replaced.');}
  profile=next;blocked=false;message=recordMoneyWinner(profile)?'Profile saved. Previous save kept as a recovery copy.':'Profile saved; local money-winner records could not be updated.';return profile;
 }
 function recoverable(){for(const suffix of ['.recovery','.backup']){try{const raw=localStorage.getItem(PREFIX+mode+'.v7'+suffix);if(raw)return decodeProfile(JSON.parse(raw),mode);}catch{}}throw Error('No readable recovery copy is available. Import an exported save instead.');}

 load(mode);
 return {get profile(){return profile;},get message(){return message;},get blocked(){return blocked;},save,
  switchMode(next){if(!['practice','career'].includes(next))return;save();load(next);save();},
  rename(name){const next={...profile,driverName:name.trim()};validate(next,mode);profile.driverName=next.driverName;return save();},
  exportSave(){if(blocked)throw Error('The current save is unreadable. Restore a backup or import a valid save first.');return JSON.stringify({format:'deathtrack-remaster',version:1,exportedAt:new Date().toISOString(),profile:decodeProfile(profile,mode)},null,2);},
  previewImport(text){if(text.length>65536)throw Error('Save file is too large (maximum 64 KB).');let data;try{data=JSON.parse(text);}catch{throw Error('This is not a readable JSON save.');}if(data?.format!=='deathtrack-remaster'||data.version!==1)throw Error('Unsupported save format or newer version.');return decodeProfile(data.profile,mode);},
  replace,recoverable,newProfile(){return freshProfile(mode);},
  reset(){return replace(freshProfile(mode));},
  nextSeason(){if(profile.season.state!=='won')return false;profile.season=newSeason(profile.season.number+1);profile.difficulty=Math.min(3,profile.difficulty+1);profile.points=0;profile.lastResult=null;save();return true;},
  begin(){if(blocked)throw Error('Restore, import or reset the unreadable save in Driver & saves before racing.');if(mode==='career'&&profile.season.state!=='racing')throw Error('This championship is complete. Visit the garage for the season result.');if(profile.active)throw Error('An event is already running');const b=profile.builds[profile.car];if(b.condition[5]<=0||b.condition[3]<=.05)throw Error('Repair armor and tyres before entering the race.');b.fuel=62.5;b.battery=100;profile.lockedCar=mode==='career';profile.active={id:crypto.randomUUID(),car:profile.car,round:profile.season.round,city:CITIES.indexOf(currentCity(profile)),target:mode==='career'&&profile.contract?1+profile.events%9:0,bounty:2000+1000*(profile.events%4)};save();return {...profile.active};},
  checkpoint(snapshot){if(!profile.active)return;const b=profile.builds[profile.active.car];b.ammo=snapshot.ammo;b.mineAmmo=snapshot.mineAmmo??b.mineAmmo;b.caltropAmmo=snapshot.caltropAmmo??b.caltropAmmo;b.rocketAmmo=snapshot.rocketAmmo??b.rocketAmmo;b.missileAmmo=snapshot.missileAmmo??b.missileAmmo;b.battery=snapshot.battery??b.battery;b.selected=snapshot.selected??b.selected;b.condition=[...snapshot.condition];b.fuel=snapshot.fuel;},
  settle(result,prizes){const active=profile.active;if(!active||result.id!==active.id)return profile.lastResult;
   if(!validOrder(result.order)||result.order.indexOf(0)+1!==result.position)throw Error('Invalid finishing order');
   const finish=result.outcome==='finished',prize=mode==='career'&&finish?prizes[result.position-1]:0,bounty=mode==='career'&&finish&&active.target&&result.kills.includes(active.target)?active.bounty:0;
   const receipt={id:active.id,outcome:result.outcome,position:result.position,prize,bounty,city:active.city,round:active.round,order:[...result.order]};
   profile.cash=Math.min(1e9,profile.cash+prize+bounty);profile.earnings+=prize+bounty;if(mode==='career'){recordRound(profile,receipt);profile.events++;}profile.lastResult=receipt;profile.active=null;save();return profile.lastResult;},
 };
}
