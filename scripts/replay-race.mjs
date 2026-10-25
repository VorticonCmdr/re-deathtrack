// Closed-loop race replay against DOSBox checkpoints: load checkpoint k, run the translated loop body,
// carry the port's own state forward, and compare every following checkpoint.
// Usage: node scripts/replay-race.mjs [captureDir] [startIndex] [count] [--strict]
// Evidence level: conditional on the injected start state (the checkpoint), independent afterwards.
import {readFile} from 'node:fs/promises';
import {loadAssets} from '../tests/assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {state} from '../src/engine/host.js';
import {setStack} from '../src/engine/mem.js';
import {loadCheckpoint,diffMemory,diffPlanes,raceReplayExclusions,describe} from '../src/engine/checkpoint.js';
import {F} from '../src/game/link.js';
import '../src/game/modules.js';

export async function replay({dir='.local/captures/demo-race',start=0,count=1,log=console.log}={}){
 const manifest=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
 const cps=manifest.checkpoints;
 if(start+count>=cps.length)throw Error(`Need checkpoints ${start}..${start+count}, capture has ${cps.length}`);
 createMachine({assets:await loadAssets(),strict:true});
 const first=new Uint8Array(await readFile(`${dir}/${cps[start].file}`));
 loadCheckpoint(first,cps[start].vga);
 setStack(cps[start].cpu.esp&0xffff); // emulated stack continues below the original's live frames
 state.nextTick=Infinity; // timer interrupts disabled: the race reads no time (docs/re/race.md)
 const results=[];
 for(let i=start;i<start+count;i++){
  const gen=F.f1000_04ed();
  for(let r=gen.next();!r.done;r=gen.next())state.clock+=state.quantum;
  const exp=new Uint8Array(await readFile(`${dir}/${cps[i+1].file}`));
  const sp=cps[i+1].cpu.esp&0xffff;
  const mem=diffMemory(exp,raceReplayExclusions(sp)),vram=diffPlanes(exp);
  results.push({index:i+1,frame:cps[i+1].frame,mem,vram});
  log(`checkpoint ${i+1} (race frame ${cps[i+1].frame}): ${mem.count} memory bytes differ in ${mem.total} ranges, ${vram.count} VRAM bytes differ`);
  for(const r of mem.ranges.slice(0,12))log(`  ${describe(r.from)} .. +${r.to-r.from}`);
 }
 return results;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [dir,start='0',count='1']=process.argv.slice(2).filter(a=>!a.startsWith('--'));
 const res=await replay({dir:dir||undefined,start:+start,count:+count});
 if(process.argv.includes('--strict')&&res.some(r=>r.mem.count||r.vram.count))process.exitCode=1;
}
