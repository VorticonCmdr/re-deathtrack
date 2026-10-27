// Authored remaster personalities, not a reconstruction of the DOS AI tables.
// Difficulty changes pace, reaction and firing opportunities; it never teleports rivals.
export const RIVALS=[
 {speed:36,armor:160,weapon:0,gun:0,lane:-1.5}, // Sly
 {speed:35,armor:200,weapon:2,gun:0,lane:0}, // Megadeath
 {speed:37,armor:150,weapon:1,gun:0,lane:1.5}, // Killer Angel
 {speed:34,armor:180,weapon:0,gun:0,lane:-1.5,hazardInterval:5}, // Lurker
 {speed:36,armor:160,weapon:4,gun:0,lane:1.5}, // Preying Menace
 {speed:37,armor:170,weapon:1,gun:0,lane:0}, // Crimson Death
 {speed:38,armor:140,weapon:3,gun:0,lane:-1.5}, // Motor Maniac
 {speed:35,armor:200,weapon:0,gun:1,lane:1.5}, // Wrecker
 {speed:38,armor:150,weapon:4,gun:0,lane:0}, // Melissa
];
export const rivalProfile=id=>RIVALS[(id-1)%RIVALS.length];
export const gunDamage=tier=>3+tier*4;
export const GUN_CAPACITY=[1000,700,400];
// The original shop credits whole packs and replaces stock with one new pack.
export function gunUpgrade(build,prices){
 if(build.gun>=2)return null;
 const tier=build.gun+1,credit=Math.floor(build.ammo/100)*prices[6+build.gun];
 return {tier,credit,cost:prices[6+tier]-credit,ammo:100,capacity:GUN_CAPACITY[tier],damage:gunDamage(tier)};
}
