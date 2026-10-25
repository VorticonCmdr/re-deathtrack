// Captures consecutive race-loop checkpoints from a running DOSBox (scenario: docs/scenarios/demo-race.json).
// Usage: node scripts/dosbox/capture-race.mjs <outDir> <frames> [--from-start]
// --from-start waits for the race loop to be entered (047c) before capturing, so checkpoint 0 is race frame 0.
// Each checkpoint: conventional memory 0..A0000, four EGA planes, register state; gzip-compressed, local only.
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {api,readPlanes,readVgaRegs} from './client.mjs';
const args=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const [out='.local/captures/demo-race',frames='30']=args;
const LOAD=0x01f5, LOOP_HEAD=0x04ed, LOOP_ENTRY=0x047c, STALE_READ=0x9778; // Ghidra 1000:04ed / 1000:047c (docs/re/race.md)
await mkdir(out,{recursive:true});
const paused=await api.pause();await api.clearBreaks();
let stop=paused.stop?.stop_id??(await api.debugStatus()).stop?.stop_id??0;
// Waits for a stop exactly at seg:off; other stops (DOSBox may report spurious ones) are continued past.
async function waitAt(seg,off,budgetMs=15000){
 const until=Date.now()+budgetMs;
 for(let tries=0;tries<50;){
  const w=await api.wait(stop,15000);
  // A wait that returns while the machine is still running (not debugging) is a timeout: keep waiting.
  if(!w.debugging||w.stop_id<=stop){if(Date.now()>until)throw Error(`No stop at ${seg.toString(16)}:${off.toString(16)} within ${budgetMs} ms`);continue;}
  stop=w.stop_id;tries++;
  const r=w.registers||{};
  if(w.reason==='breakpoint'&&r.cs===seg&&(r.eip&0xffff)===off)return w;
  await api.cont();
 }
 throw Error('Too many unrelated stops');
}
if(process.argv.includes('--from-start')){
 await api.addBreak({type:'execute',segment:LOAD,offset:LOOP_ENTRY});await api.cont();
 await waitAt(LOAD,LOOP_ENTRY,240000);await api.clearBreaks();
}
await api.addBreak({type:'execute',segment:LOAD,offset:LOOP_HEAD});
await api.addBreak({type:'execute',segment:LOAD,offset:STALE_READ});
const manifest={scenario:'demo-race',breakpoint:`${LOAD.toString(16)}:${LOOP_HEAD.toString(16)}`,checkpoints:[]};
await api.cont();
// Waits for the next loop head, recording any stale-slot reads seen on the way into the previous checkpoint.
async function nextLoopHead(prev){
 for(;;){
  let w;for(;;){w=await api.wait(stop,15000);if(w.debugging&&w.stop_id>stop){stop=w.stop_id;break;}}
  const r=w.registers;
  if(w.reason==='breakpoint'&&r.cs===LOAD&&(r.eip&0xffff)===LOOP_HEAD)return w;
  if(w.reason==='breakpoint'&&r.cs===LOAD&&(r.eip&0xffff)===STALE_READ&&prev&&prev.stale9542===undefined){
   const v=await api.read(r.ss*16+((r.ebp&0xffff)-4&0xffff),2);prev.stale9542=v[0]|v[1]<<8;
  }
  await api.cont();
 }
}
for(let i=0;i<+frames;i++){
 await nextLoopHead(manifest.checkpoints[i-1]);
 const cpu=await api.cpu(),mem=await api.read(0,0xa0000),regs=await readVgaRegs(),vga=await readPlanes();
 const blob=new Uint8Array(0xa0000+0x40000);blob.set(mem);vga.planes.forEach((p,k)=>blob.set(p,0xa0000+k*0x10000));
 const regsNow=cpu.registers??cpu;
 if(regsNow.cs!==LOAD||(regsNow.eip&0xffff)!==LOOP_HEAD)throw Error(`Checkpoint ${i} not at the loop head: ${JSON.stringify(regsNow)}`);
 const name=`cp${String(i).padStart(4,'0')}.bin.gz`;await writeFile(`${out}/${name}`,gzipSync(blob,{level:6}));
 const frame=mem[0x28ef0+0x924e]|mem[0x28ef0+0x924f]<<8;
 manifest.checkpoints.push({file:name,sha256:createHash('sha256').update(blob).digest('hex'),frame,cpu:regsNow,vga:regs});
 if(i%25===0)console.log(`checkpoint ${i}: race frame ${frame}`);
 await api.cont();
 // Environment input: 9542's stale [BP-4] at its first consumption (1000:9778, MOV BX,[BP-4]) in this frame.
 // The value can be a CS word pushed by an IRQ landing in 9542's prologue (docs/re/environment.md).
 // Stops at the read are recorded until the next loop head.

}
await api.pause();await api.clearBreaks();await api.cont();
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,1));
console.log(`wrote ${manifest.checkpoints.length} checkpoints to ${out}`);
