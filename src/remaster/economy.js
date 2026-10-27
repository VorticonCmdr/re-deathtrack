import {ORDNANCE_FAMILY,WEAPONS} from './weapons.js';
export function partRepairCost(b,catalog,i){const price=catalog.parts[i*3+b.parts[i]];
  // Ignore binary round-off (e.g. 500 * (1 - .7) = 150.00000000000003),
  // while still rounding genuine fractional repair costs up to whole dollars.
  return Math.ceil(Math.max(0,price*(1-b.condition[i])-price*Number.EPSILON*4));
}
export function serviceEquipment(profile,catalog,kind){const b=profile.builds[profile.car];let cost=0,message='';
  if(kind==='fuel'){b.fuel=100;message='Tank full · No charge';}
  else if(Object.hasOwn(ORDNANCE_FAMILY,kind)){const family=ORDNANCE_FAMILY[kind],tier=b[kind],key=kind+'Ammo',capacity=catalog.capacity[family*3+tier];cost=catalog.weapons[family*3+tier];if(b[key]>=capacity)return {ok:false,message:'Ammunition already full'};if(profile.cash<cost)return {ok:false,message:'Insufficient funds'};b[key]++;message=WEAPONS.find(w=>w.id===kind).name+' loaded';}
  else if(kind==='ammo'){const capacity=catalog.capacity[6+b.gun];if(b.ammo>=capacity)return {ok:false,message:'Ammunition already full'};cost=catalog.weapons[6+b.gun];if(profile.cash<cost)return {ok:false,message:'Insufficient funds'};b.ammo=Math.min(capacity,b.ammo+100);message='Ammunition loaded';}
  else {const indices=kind==='repair-all'?[0,1,2,3,4,5]:[/^repair:[0-5]$/.test(kind)?Number(kind.split(':')[1]):-1];if(indices.includes(-1))return {ok:false,message:'Unknown service'};cost=indices.reduce((n,i)=>n+partRepairCost(b,catalog,i),0);if(!cost)return {ok:false,message:'No repairs needed'};if(profile.cash<cost)return {ok:false,message:'Insufficient funds'};indices.forEach(i=>b.condition[i]=1);message='Repairs complete';}
  profile.cash-=cost;return {ok:true,message:message+(cost?' · '+'$'+cost.toLocaleString('en-US'):''),snapshot:{condition:[...b.condition],mineAmmo:b.mineAmmo,caltropAmmo:b.caltropAmmo,ammo:b.ammo,rocketAmmo:b.rocketAmmo,missileAmmo:b.missileAmmo,fuel:b.fuel,battery:b.battery,selected:b.selected}};
 }
export function upgradePart(profile,catalog,i){
 if(!Number.isInteger(i)||i<0||i>5)return {ok:false,message:'Unknown part'};
 const b=profile.builds[profile.car],level=b.parts[i];if(level>=2)return {ok:false,message:'Maximum tier'};
 const cost=catalog.parts[i*3+level+1];if(profile.cash<cost)return {ok:false,message:'Insufficient funds'};
 profile.cash-=cost;b.parts[i]++;b.condition[i]=1;return {ok:true,cost,level:level+1};
}
