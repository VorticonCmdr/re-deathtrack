// Runs the port headlessly from boot with the real environment providers (virtual time, no input unless given).
// Usage: node scripts/run-headless.mjs [--sound speaker|adlib|mt32] [--args "demo"] [--seconds 30] [--shots 5] [--out dir] [--events file.json]
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {loadAssets} from '../tests/assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {runUntil,state,PIT_HZ,queueEvent} from '../src/engine/host.js';
import {pageIndices,regs,rgb200} from '../src/engine/ega.js';
import {memoryStorage} from '../src/web/storage.js';
import {startGame} from '../src/game/boot.js';
import {rw} from '../src/engine/mem.js';
import {png} from './tools/png.mjs';
import {cga,cgaFrame,RGBI} from '../src/engine/cga.js';

const opt=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d;};
const args=opt('args','')?opt('args','').split(' '):[];
const seconds=+opt('seconds','30'),shots=+opt('shots','6'),out=opt('out','.local/headless');
await mkdir(out,{recursive:true});
createMachine({assets:await loadAssets(),storage:memoryStorage(),strict:true,args});
if(opt('events',null))for(const e of JSON.parse(await readFile(opt('events'),'utf8')))queueEvent({...e,t:Math.round(e.s*PIT_HZ)});
const gen=startGame({sound:opt('sound','speaker')});
function shot(name){
 if(cga.active){const f=cgaFrame(),rgb=new Uint8Array(f.w*f.h*3);f.idx.forEach((c,i)=>{rgb[i*3]=RGBI[c]>>16;rgb[i*3+1]=RGBI[c]>>8;rgb[i*3+2]=RGBI[c];});return writeFile(`${out}/${name}.png`,png(f.w,f.h,rgb));}
 const idx=pageIndices(regs.start),rgb=new Uint8Array(320*200*3),pal=regs.palette.map(rgb200);
 idx.forEach((c,i)=>{rgb[i*3]=pal[c]>>16;rgb[i*3+1]=pal[c]>>8&255;rgb[i*3+2]=pal[c]&255;});
 return writeFile(`${out}/${name}.png`,png(320,200,rgb));
}
const step=seconds/shots;let failed=null;const t0=Date.now();
for(let i=1;i<=shots;i++){
 try{const r=runUntil(gen,Math.round(i*step*PIT_HZ));await shot(`t${String(Math.round(i*step*10)).padStart(4,'0')}`);
  console.log(`t=${(state.clock/PIT_HZ).toFixed(2)}s  race frame=${rw(0x924e)} page=${rw(0x9018)} event=${rw(0x9b82)}`);
  if(r.done){console.log('game exited',r.value);break;}}
 catch(e){failed=e;await shot('failure');console.error(`FAILED at t=${(state.clock/PIT_HZ).toFixed(3)}s: ${e.stack.split('\n').slice(0,8).join('\n')}`);break;}
}
console.log(`wall ${(Date.now()-t0)/1000}s, diagnostics ${state.diagnostics.length}`);
if(failed)process.exitCode=1;
