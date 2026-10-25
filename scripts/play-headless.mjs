// Headless player bot: drives the port through its real input path (scancodes, mouse events) in virtual time.
// Route: title -> sign-up -> quiz -> dealer -> hub -> FULL CIRCUIT RUN -> GO RACIN' -> race with the throttle held
// until the race ends -> results and following screens. Prints the page-id timeline; screenshots go to --out.
// Usage: node scripts/play-headless.mjs [--sound speaker|adlib|mt32] [--races 1] [--out .local/play] [--minutes 12]
import {writeFile,mkdir} from 'node:fs/promises';
import {loadAssets} from '../tests/assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {runUntil,state,PIT_HZ,queueEvent} from '../src/engine/host.js';
import {pageIndices,regs,rgb200} from '../src/engine/ega.js';
import {memoryStorage} from '../src/web/storage.js';
import {startGame} from '../src/game/boot.js';
import {rw,rsw,rb} from '../src/engine/mem.js';
import {png} from './tools/png.mjs';
const opt=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d;};
const out=opt('out','.local/play'),races=+opt('races','1'),limit=+opt('minutes','12')*60*PIT_HZ;
await mkdir(out,{recursive:true});
const storage=memoryStorage();
createMachine({assets:await loadAssets(),storage,strict:true});
const gen=startGame({sound:opt('sound','speaker')});
let shotN=0;
async function shot(tag){const idx=pageIndices(regs.start),rgb=new Uint8Array(320*200*3),pal=regs.palette.map(rgb200);idx.forEach((c,i)=>{rgb[i*3]=pal[c]>>16;rgb[i*3+1]=pal[c]>>8&255;rgb[i*3+2]=pal[c]&255;});await writeFile(`${out}/${String(shotN++).padStart(2,'0')}-${tag}.png`,png(320,200,rgb));}
const run=s=>{const r=runUntil(gen,state.clock+s*PIT_HZ);if(r.done)throw Error('game exited');if(state.clock>limit)throw Error('time limit');};
const key=(code,down)=>queueEvent({t:state.clock,type:'key',code,down});
function tap(code,s=0.1){key(code,true);run(s);key(code,false);run(0.1);}
function click(x,y){queueEvent({t:state.clock,type:'mouse',x,y,buttons:0});run(0.2);queueEvent({t:state.clock,type:'mouse',x,y,buttons:1});run(0.15);queueEvent({t:state.clock,type:'mouse',x,y,buttons:0});run(0.2);}
function menu(pred,desc,maxS=60){for(let t=0;t<maxS*10;t++){const k=rw(0x1f2e);run(0.1);if(pred(rw(0x9018))&&rw(0x1f2e)!==k)return rw(0x9018);}throw Error(`${desc} not reached (page ${rw(0x9018)})`);}
const log=[];const note=m=>{log.push(`${(state.clock/PIT_HZ).toFixed(1)}s ${m}`);console.log(log.at(-1));};
try{
 run(6);tap(0x1c);
 menu(p=>p===21,'sign-up');key(0x2a,true);for(const c of [0x1e,0x2e,0x12])tap(c);key(0x2a,false);await shot('signup');click(160,174);note('signed up');
 menu(p=>p===52,'quiz');click(160,142);
 menu(p=>p===11,'dealer');await shot('dealer');click(160,181);
 menu(p=>p===5,'hub');click(160,60);
 for(let r=0;r<races;r++){
  menu(p=>p===12,'circuit');await shot(`circuit${r}`);note(`circuit page, cash ${rw(0xa22a)|rw(0xa22c)<<16}`);click(160,150);
  // 32b8 resets the race frame counter DS:924e; wait for the reset, then for the race to run.
  for(let t=0;rw(0x924e)>=30;t++){
   const k=rw(0x1f2e);run(0.1);
   // An interactive menu before the race (e.g. the mafioso contract offer): accept with Enter.
   if(t%20===19&&rw(0x1f2e)!==k){note(`menu page ${rw(0x9018)} before the race: Enter`);await shot(`prerace${r}-${rw(0x9018)}`);tap(0x1c,0.15);}
   if(t>900)throw Error('race setup not reached');}
  for(let t=0;rw(0x924e)<30;t++){run(0.1);if(t>600)throw Error('race did not start');}
  note(`race ${r} started, city ${rw(0x9808)}`);key(0x48,true);
  let last=-1,end=null;
  for(let t=0;;t++){run(1);const f=rw(0x924e);if(t%30===0){await shot(`race${r}-${t}`);note(`frame ${f} pos ${rsw(0x96f2)} lap ${rw(0x8ec4)}/${rw(0x8eb8)} speed ${rsw(0x8926)} alive ${rb(0x8a54)}`);}
   if(f===last){end=f;break;}last=f;}
  key(0x48,false);note(`race ${r} ended at frame ${end}, exit ${rsw(0x924c)}, page ${rw(0x9018)}`);
  const p=menu(p=>p!==0,'post-race screen',120);await shot(`after-race${r}`);note(`post-race page ${p}`);
  // Advance through post-race pages by clicking the first button until a circuit page or the hub appears.
  for(let i=0;i<8&&rw(0x9018)!==12;i++){tap(0x1c,0.15);run(2.5);const q=rw(0x9018);note(`page ${q}`);await shot(`page${q}`);}
 }
}catch(e){note(`STOP: ${e.message}`);await shot('stop');process.exitCode=1;}
console.log(`diagnostics ${state.diagnostics.length}; saved files: ${[...storage.map.keys()].join(',')||'none'}`);
