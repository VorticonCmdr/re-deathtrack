// Segment comparison: translated 1000:32b8 (race setup: track, map, shapes, bitmaps, DOS allocations) against DOSBox.
// Level: routine/segment comparison from an injected entry checkpoint (docs/scenarios/segment-race-setup.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {replaySegment} from '../scripts/replay-segment.mjs';
const sc=JSON.parse(await readFile(new URL('../docs/scenarios/segment-race-setup.json',import.meta.url),'utf8'));
const dir=new URL('../'+sc.storage+'/',import.meta.url).pathname.replace(/\/$/,'');
try{await access(`${dir}/manifest.json`);}catch{throw Error(`SETUP FAILURE: capture ${dir} missing; recreate with the recipe in docs/scenarios/segment-race-setup.json`);}
const local=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
test('local capture matches the committed manifest',()=>{local.checkpoints.forEach((c,i)=>assert.equal(c.sha256,sc.checkpoints[i].sha256,`checkpoint ${i}`));});
test('race setup matches DOSBox exactly (memory and VRAM)',async()=>{
 const r=await replaySegment({dir,fname:'f1000_32b8',nargs:0,log:()=>{}});
 assert.equal(r.mem.count,0);assert.equal(r.vram.count,0);
});
test('negative control: an altered expected gameplay byte is detected by the comparison rules',async()=>{
 await replaySegment({dir,fname:'f1000_32b8',nargs:0,log:()=>{}}); // leaves the port state at the function's return
 const {gunzipSync}=await import('node:zlib');
 const cp=local.checkpoints[1],raw=new Uint8Array(gunzipSync(await readFile(`${dir}/${cp.file}`)));
 raw[0x28ef0+0x96f2]^=1; // a gameplay variable must be compared
 const {loadCheckpoint,diffMemory,raceReplayExclusions}=await import('../src/engine/checkpoint.js');
 const d=diffMemory(raw,raceReplayExclusions(cp.cpu.esp&0xffff));
 assert.ok(d.count>0);
});
