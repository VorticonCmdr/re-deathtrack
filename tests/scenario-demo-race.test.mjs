// Acceptance: closed-loop race replay against DOSBox checkpoints (docs/scenarios/demo-race-start.json).
// Level: closed-loop replay from an injected start state (conditional on checkpoint 0), then independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {replay} from '../scripts/replay-race.mjs';
import {ww,rw} from '../src/engine/mem.js';

const scenario=JSON.parse(await readFile(new URL('../docs/scenarios/demo-race-start.json',import.meta.url),'utf8'));
const dir=new URL('../'+scenario.storage.split(' ')[0]+'/',import.meta.url).pathname.replace(/\/$/,'');
try{await access(`${dir}/manifest.json`);}catch{throw Error(`SETUP FAILURE: capture ${dir} is missing; recreate it with the recipe in docs/scenarios/demo-race-start.json`);}
const local=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8'));

test('local capture matches the committed scenario manifest',()=>{
 assert.equal(local.checkpoints.length,scenario.expected.checkpoints);
 local.checkpoints.forEach((c,i)=>{assert.equal(c.sha256,scenario.checkpoints[i].sha256,`checkpoint ${i} hash`);assert.equal(c.stale9542,scenario.checkpoints[i].stale9542);});
});

test(`race loop matches DOSBox exactly for ${scenario.expected.comparedFrames} consecutive frames`,async()=>{
 const res=await replay({dir,start:0,count:scenario.expected.comparedFrames,log:()=>{}});
 assert.equal(res.exited,undefined,'race loop must not exit inside the capture');
 assert.equal(res.length,scenario.expected.comparedFrames,'every checkpoint compared');
 const bad=res.filter(r=>r.mem.count||r.vram.count);
 assert.deepEqual(bad.map(r=>`frame ${r.frame}: ${r.mem.count} mem, ${r.vram.count} vram`),[]);
});

// Negative controls: the comparison must detect a missing RNG call and a single altered byte.
test('negative control: one skipped RNG step is detected',async()=>{
 const res=await replay({dir,start:0,count:40,log:()=>{},beforeFrame:i=>{if(i===10){const bx=rw(0x2154)-2&0xffff;ww(0x2154,bx&0x8000?0x6e:bx);}}});
 assert.ok(res.some(r=>r.mem.count>0),'replay with a perturbed RNG index must differ');
});
test('negative control: one altered expected byte is detected',async()=>{
 const res=await replay({dir,start:0,count:3,log:()=>{},expectedHook:(i,exp)=>{if(i===2)exp[0x28ef0+0x96f2]^=1;}});
 assert.equal(res[1].mem.count,1);
});
