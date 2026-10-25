// Segment comparison: load a DOSBox function-entry checkpoint, run the translated function with the arguments
// found on the captured stack, and compare the machine with the DOSBox checkpoint taken at its return.
// Usage: node scripts/replay-segment.mjs <captureDir> <fname> <nargs>
// Evidence level: routine/segment comparison (start state injected; timer interrupts not replayed).
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadAssets} from '../tests/assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {state} from '../src/engine/host.js';
import {setStack,ww,B} from '../src/engine/mem.js';
import {loadCheckpoint,diffMemory,diffPlanes,diffCga,raceReplayExclusions,describe} from '../src/engine/checkpoint.js';
import {F} from '../src/game/link.js';
import '../src/game/modules.js';
async function loadCp(dir,cp){const b=new Uint8Array(gunzipSync(await readFile(`${dir}/${cp.file}`)));const h=createHash('sha256').update(b).digest('hex');if(h!==cp.sha256)throw Error(`${cp.file} corrupt`);return b;}
export async function replaySegment({dir,fname,nargs=0,log=console.log,cmdArgs=[],extraExclusions=[]}){
 const m=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
 const [entry,exit]=m.checkpoints;
 createMachine({assets:await loadAssets(),strict:true,args:cmdArgs});
 loadCheckpoint(await loadCp(dir,entry),entry.vga);
 setStack(entry.cpu.esp&0xffff);
 ww(0x2d32,0x34d6);ww(0x30d2,0x34d6);ww(0x2d34,1); // INJECTION (sound only), as in replay-race.mjs
 state.nextTick=Infinity;
 const fn=F[fname],args=m.stackWords.slice(0,nargs);
 let r;if(fn.constructor.name==='GeneratorFunction'){const g=fn(...args);for(let s=g.next();!s.done;s=g.next())state.clock+=state.quantum;}else r=fn(...args);
 const exp=await loadCp(dir,exit);
 const mem=diffMemory(exp,raceReplayExclusions(exit.cpu.esp&0xffff).concat(extraExclusions)),vram=diffPlanes(exp),cga=diffCga(exp);
 log(`${m.name}: ${mem.count} memory bytes differ in ${mem.total} ranges, ${vram.count} VRAM bytes differ${cga.present?`, ${cga.count} B800 bytes differ`:''}`);
 const hx=(a,n,src)=>[...Array(n)].map((_,k)=>src[a+k].toString(16).padStart(2,'0')).join(' ');
 for(const q of mem.ranges.slice(0,15))log(`  ${describe(q.from)} +${q.to-q.from} expected ${hx(q.from,Math.min(12,q.to-q.from),exp)} port ${hx(q.from,Math.min(12,q.to-q.from),B)}`);
 return {mem,vram,cga};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [dir,fname,nargs='0']=process.argv.slice(2);
 const r=await replaySegment({dir,fname,nargs:+nargs});if(r.mem.count||r.vram.count||r.cga.count)process.exitCode=1;
}
