// Captures consecutive race-loop checkpoints from a running DOSBox (scenario: docs/scenarios/demo-race.md).
// Usage: node scripts/dosbox/capture-race.mjs <outDir> <frames>
// Each checkpoint: conventional memory 0..A0000, four EGA planes, CPU registers. Stored locally only.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {api,readPlanes,readVgaRegs} from './client.mjs';
const [out='.local/captures/demo-race',frames='30']=process.argv.slice(2);
const LOAD=0x01f5, LOOP_HEAD=0x04ed; // Ghidra 1000:04ed, top of the race loop body (docs/re/race.md)
await mkdir(out,{recursive:true});
const paused=await api.pause();await api.clearBreaks();
await api.addBreak({type:'execute',segment:LOAD,offset:LOOP_HEAD});
let stop=paused.stop?.stop_id??(await api.debugStatus()).stop?.stop_id??0;
const manifest={scenario:'demo-race',breakpoint:`${LOAD.toString(16)}:${LOOP_HEAD.toString(16)}`,checkpoints:[]};
await api.cont();
for(let i=0;i<+frames;i++){
 let w;for(let tries=0;;tries++){w=await api.wait(stop,15000);if(w.stop_id>stop)stop=w.stop_id;if(w.reason==='breakpoint')break;if(tries>8)throw Error(`Breakpoint not reached for checkpoint ${i}: ${JSON.stringify(w)}`);}
 const cpu=await api.cpu(),mem=await api.read(0,0xa0000),regs=await readVgaRegs(),vga=await readPlanes();
 const blob=new Uint8Array(0xa0000+0x40000);blob.set(mem);vga.planes.forEach((p,k)=>blob.set(p,0xa0000+k*0x10000));
 const name=`cp${String(i).padStart(4,'0')}.bin`;await writeFile(`${out}/${name}`,blob);
 const frame=mem[0x28ef0+0x924e]|mem[0x28ef0+0x924f]<<8;
 manifest.checkpoints.push({file:name,sha256:createHash('sha256').update(blob).digest('hex'),frame,cpu:cpu.registers??cpu,vga:regs});
 console.log(`checkpoint ${i}: race frame ${frame}`);
 await api.cont();
}
await api.pause();await api.clearBreaks();await api.cont();
await writeFile(`${out}/manifest.json`,JSON.stringify(manifest,null,1));
console.log(`wrote ${manifest.checkpoints.length} checkpoints to ${out}`);
