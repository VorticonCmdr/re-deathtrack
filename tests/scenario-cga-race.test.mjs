// Closed-loop race replay on the CGA adapter against DOSBox (docs/scenarios/cga-race-start.json): conventional memory and B800 RAM.
// Level: closed-loop replay from an injected start state (conditional on checkpoint 0), then independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {replay} from '../scripts/replay-race.mjs';
import {ww,rw} from '../src/engine/mem.js';
const sc=JSON.parse(await readFile(new URL('../docs/scenarios/cga-race-start.json',import.meta.url),'utf8'));
const dir=new URL('../'+sc.storage.split(' ')[0]+'/',import.meta.url).pathname.replace(/\/$/,'');
try{await access(`${dir}/manifest.json`);}catch{throw Error(`SETUP FAILURE: capture ${dir} is missing; recreate it with the recipe in docs/scenarios/cga-race-start.json`);}
const local=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));
const cmdArgs=['GC'];
test('local capture matches the committed scenario manifest',()=>{
 assert.equal(local.checkpoints.length,sc.expected.checkpoints);
 local.checkpoints.forEach((c,i)=>{assert.equal(c.sha256,sc.checkpoints[i].sha256,`checkpoint ${i} hash`);assert.equal(c.stale9542,sc.checkpoints[i].stale9542);});
});
test(`CGA race loop matches DOSBox exactly for ${sc.expected.comparedFrames} frames (memory and B800)`,async()=>{
 const res=await replay({dir,start:0,count:sc.expected.comparedFrames,log:()=>{},cmdArgs});
 assert.equal(res.exited,undefined);assert.equal(res.length,sc.expected.comparedFrames);
 assert.ok(res.every(r=>r.cga.present),'checkpoints must carry B800 RAM');
 assert.deepEqual(res.filter(r=>r.mem.count||r.vram.count||r.cga.count).map(r=>`frame ${r.frame}: ${r.mem.count}/${r.vram.count}/${r.cga.count}`),[]);
});
test('negative control: one altered expected B800 byte is detected',async()=>{
 const res=await replay({dir,start:0,count:3,log:()=>{},cmdArgs,expectedHook:(i,exp)=>{if(i===2)exp[0xa0000+0x40000+100]^=1;}});
 assert.equal(res[1].cga.count,1);
});
test('negative control: one skipped RNG step is detected',async()=>{
 const res=await replay({dir,start:0,count:40,log:()=>{},cmdArgs,beforeFrame:i=>{if(i===10){const bx=rw(0x2154)-2&0xffff;ww(0x2154,bx&0x8000?0x6e:bx);}}});
 assert.ok(res.some(r=>r.mem.count>0||r.cga.count>0));
});
