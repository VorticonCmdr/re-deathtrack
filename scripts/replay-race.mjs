// Closed-loop race replay against DOSBox checkpoints: load checkpoint k, run the translated loop body,
// carry the port's own state forward, and compare every following checkpoint.
// Usage: node scripts/replay-race.mjs [captureDir] [startIndex] [count] [--strict]
// Evidence level: conditional on the injected start state (the checkpoint), independent afterwards.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
// Checkpoints may be raw or gzip-compressed; the sha256 in the manifest is of the raw bytes.
async function loadCp(dir,cp){let b=new Uint8Array(await readFile(`${dir}/${cp.file}`));if(cp.file.endsWith('.gz'))b=new Uint8Array(gunzipSync(b));const h=createHash('sha256').update(b).digest('hex');if(cp.sha256&&h!==cp.sha256)throw Error(`Checkpoint ${cp.file} is corrupt (sha256 ${h})`);return b;}
import {loadAssets} from '../tests/assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {state} from '../src/engine/host.js';
import {setStack,ww,B} from '../src/engine/mem.js';
import {loadCheckpoint,diffMemory,diffPlanes,raceReplayExclusions,describe} from '../src/engine/checkpoint.js';
import {F} from '../src/game/link.js';
import '../src/game/modules.js';
import {raceFrame} from '../src/game/flow.js';
import {staleStack} from '../src/game/race.js';

export async function replay({dir='.local/captures/demo-race',start=0,count=1,log=console.log,stopOnDiff=false,beforeFrame=null,expectedHook=null}={}){
 const manifest=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
 const cps=manifest.checkpoints;
 if(start+count>=cps.length)throw Error(`Need checkpoints ${start}..${start+count}, capture has ${cps.length}`);
 createMachine({assets:await loadAssets(),strict:true});
 const first=await loadCp(dir,cps[start]);
 loadCheckpoint(first,cps[start].vga);
 setStack(cps[start].cpu.esp&0xffff); // emulated stack continues below the original's live frames
 // INJECTION (sound only): the reference run detected MT-32; the port supports the PC speaker. Point the
 // selected/current device descriptors at the speaker so music calls run. Sound state is excluded from comparison
 // and never read by gameplay (docs/re/input-timer-sound.md).
 ww(0x2d32,0x34d6);ww(0x30d2,0x34d6);ww(0x2d34,1);
 raceFrame.bp=cps[start].cpu.ebp&0xffff;
 state.nextTick=Infinity; // timer interrupts disabled: the race reads no time (docs/re/race.md)
 const results=[];
 for(let i=start;i<start+count;i++){
  // Recorded environment input for this frame (interrupt-dependent stack garbage), when the capture has it.
  staleStack.entry9542=cps[i].stale9542!==undefined?(()=>cps[i].stale9542):null;
  beforeFrame?.(i);
  const gen=F.f1000_04ed();
  let r;for(r=gen.next();!r.done;r=gen.next())state.clock+=state.quantum;
  if(r.value!==undefined){log(`race loop exited after checkpoint ${i}`);results.exited=i;break;}
  const exp=await loadCp(dir,cps[i+1]);expectedHook?.(i+1,exp);
  const sp=cps[i+1].cpu.esp&0xffff;
  const mem=diffMemory(exp,raceReplayExclusions(sp)),vram=diffPlanes(exp);
  results.push({index:i+1,frame:cps[i+1].frame,mem,vram});
  log(`checkpoint ${i+1} (race frame ${cps[i+1].frame}): ${mem.count} memory bytes differ in ${mem.total} ranges, ${vram.count} VRAM bytes differ`);
  const hexs=(a,n,src)=>[...Array(n)].map((_,k)=>src[a+k].toString(16).padStart(2,'0')).join(' ');
  for(const r of mem.ranges.slice(0,12))log(`  ${describe(r.from)} .. +${r.to-r.from}  expected ${hexs(r.from,Math.min(16,r.to-r.from),exp)}  port ${hexs(r.from,Math.min(16,r.to-r.from),B)}`);
  if(stopOnDiff&&(mem.count||vram.count))break;
 }
 return results;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [dir,start='0',count='1']=process.argv.slice(2).filter(a=>!a.startsWith('--'));
 const res=await replay({dir:dir||undefined,start:+start,count:+count,stopOnDiff:process.argv.includes('--stop')});
 if(process.argv.includes('--strict')&&res.some(r=>r.mem.count||r.vram.count))process.exitCode=1;
}
