// Original direct-fire roles, expressed in modern seconds and metres.
export const WEAPONS=[
 {id:'gun',name:'Machine gun',key:'1',color:'#ffbb61',description:'Rapid fire · finite rounds · manage heat'},
 {id:'laser',name:'Laser',key:'2',color:'#65e4ef',description:'Instant precision · 100 battery units per event'},
 {id:'beam',name:'Particle beam',key:'3',color:'#d5a3ff',description:'Heavy pulse · charges while selected · no ammunition'},
 {id:'rocket',name:'Terminator',key:'4',color:'#ff885d',description:'Straight rocket · explosive impact · finite rounds'},
 {id:'missile',name:'Homing missile',key:'5',color:'#f2d56b',description:'Track a target · lock before launch · T cycles targets'},
 {id:'mine',name:'Mines',key:'6',color:'#ff986d',description:'Rear deployment · arms after 0.6 seconds · explosive trap'},
 {id:'caltrop',name:'Caltrops',key:'7',color:'#b5d5df',description:'Rear deployment · punctures tyres · reduces grip'},
];
export const laserDamage=tier=>7+tier*5;
export const beamDamage=tier=>20+tier*12;
export const BEAM_SECONDS=2;

export const rocketDamage=tier=>[45,92,180][tier];
export const missileDamage=tier=>60+tier*80;
export const ROCKET_CAPACITY=[15,10,5],MISSILE_CAPACITY=[20,10,5];
export const LOCK_SECONDS=1.2;

export const MINE_CAPACITY=[30,15,7],CALTROP_CAPACITY=[30,20,10];
export const mineDamage=tier=>20+tier*13;
export const ORDNANCE_FAMILY={rocket:7,missile:4,mine:3,caltrop:0};
