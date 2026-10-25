// Segment comparisons of the CGA path against DOSBox (docs/scenarios/cga-segments.json): driver init, hardware init,
// ground fill and sky strip, each from an injected entry checkpoint. Memory, B800 RAM and the EGA planes are compared.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {replaySegment} from '../scripts/replay-segment.mjs';
const sc=JSON.parse(await readFile(new URL('../docs/scenarios/cga-segments.json',import.meta.url),'utf8'));
const root=new URL('../.local/captures/',import.meta.url).pathname;
for(const s of sc.segments){
 const dir=`${root}seg-${s.name}`;
 try{await access(`${dir}/manifest.json`);}catch{throw Error(`SETUP FAILURE: capture ${dir} missing; recreate with the recipe in docs/scenarios/cga-segments.json`);}
 const local=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
 const ex=(s.exclusions||[]).map(e=>{const a=e.lin.split('+').reduce((x,y)=>x+Number(y),0);return {from:a,to:a+e.len,why:e.why};});
 test(`${s.name}: local capture matches the manifest`,()=>{local.checkpoints.forEach((c,i)=>assert.equal(c.sha256,s.sha256[i]));});
 test(`${s.name} (${s.what}) matches DOSBox`,async()=>{
  const r=await replaySegment({dir,fname:s.function,nargs:s.args,log:()=>{},cmdArgs:['GC'],extraExclusions:ex});
  assert.ok(r.cga.present);assert.equal(r.mem.count,0);assert.equal(r.vram.count,0);assert.equal(r.cga.count,0);
 });
}
test('negative control: without its exclusions the hardware-init comparison reports the sound/joystick differences',async()=>{
 const r=await replaySegment({dir:`${root}seg-cga-hwinit`,fname:'f2524_0260',nargs:0,log:()=>{},cmdArgs:['GC']});
 assert.ok(r.mem.count>0);
});
