export const CITIES=[
 {id:'orlando',name:'Orlando',region:'SUNSHINE DIVISION',ground:'#4a6547',sky:'#729bac',water:true},
 {id:'bay_area',name:'Bay Area',region:'GOLDEN COAST',ground:'#465b50',sky:'#81969b',water:true},
 {id:'phoenix',name:'Phoenix',region:'DESERT DIVISION',ground:'#8c6747',sky:'#b09175',water:false},
 {id:'nyc',name:'New York',region:'ATLANTIC DIVISION',ground:'#414650',sky:'#627d91',water:true},
 {id:'st_louis',name:'St Louis',region:'GATEWAY DIVISION',ground:'#5d6250',sky:'#8c9d99',water:false},
 {id:'la',name:'Los Angeles',region:'PACIFIC DIVISION',ground:'#766b54',sky:'#b49b8e',water:true},
 {id:'seattle',name:'Seattle',region:'PACIFIC NORTHWEST',ground:'#293b40',sky:'#738b96',water:true},
 {id:'houston',name:'Houston',region:'GULF DIVISION',ground:'#5d6650',sky:'#829c9b',water:false},
 {id:'boston',name:'Boston',region:'NEW ENGLAND',ground:'#615b51',sky:'#7b909a',water:true},
 {id:'chicago',name:'Chicago',region:'GREAT LAKES',ground:'#505d62',sky:'#8298a9',water:true},
];
export const CIRCUIT=[2,4,6,9,0,1,3,5,7,8];
export const DRIVER_NAMES=['YOU','SLY','MEGADEATH','KILLER ANGEL','LURKER','PREYING MENACE','CRIMSON DEATH','MOTOR MANIAC','WRECKER','MELISSA'];
export const DRIVER_COLORS=['#cce77a','#f16c49','#e7c856','#579dce','#bc81bd','#e5ddc1','#4dc3bb','#d74664','#8c9ee5','#eaa773'];
export const DIFFICULTIES=['Punk','Gambler','Warrior','Mega Destroyer'];
export const newSeason=(number=1)=>({number,round:0,points:Array(10).fill(0),wins:Array(10).fill(0),history:[],state:'racing'});
export function seasonOrder(season){return Array.from({length:10},(_,i)=>i).sort((a,b)=>season.points[b]-season.points[a]||season.wins[b]-season.wins[a]||a-b);}
export function currentCity(p){return CITIES[p.mode==='career'?CIRCUIT[Math.min(9,p.season.round)]:p.practiceCity];}
export function recordRound(p,result){const s=p.season;const order=result.order;for(let place=0;place<10;place++){const id=order[place];if(id!==0||result.outcome==='finished')s.points[id]+=(10-place)*100;}if(order[0]!==0||result.outcome==='finished')s.wins[order[0]]++;
 s.history.push({city:CIRCUIT[s.round],position:result.position,outcome:result.outcome,order:[...order],prize:result.prize,bounty:result.bounty});s.round++;p.points=s.points[0];if(s.round===10)s.state=seasonOrder(s)[0]===0?'won':'lost';
}
