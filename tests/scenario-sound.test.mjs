// Segment comparison of the music drivers against DOSBox: the MT-32 MIDI byte stream (1000:cbd0) and the AdLib register
// writes (1000:c8c6) from the program start, plus the OPL detection calibration. Docs: docs/scenarios/sound-startup.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {runUntil,PIT_HZ} from '../src/engine/host.js';
import {memoryStorage} from '../src/web/storage.js';
import {startGame} from '../src/game/boot.js';
import {mpu,opl} from '../src/game/devices.js';
import {rw} from '../src/engine/mem.js';
const sc=JSON.parse(await readFile(new URL('../docs/scenarios/sound-startup.json',import.meta.url),'utf8'));
let raw;try{raw=await readFile(new URL('../'+sc.storage,import.meta.url));}catch{throw Error(`SETUP FAILURE: capture ${sc.storage} missing; recreate with the recipe in docs/scenarios/sound-startup.json`);}
test('local capture matches the committed manifest',()=>{assert.equal(createHash('sha256').update(raw).digest('hex'),sc.sha256);});
const ref=JSON.parse(raw);
assert.equal(ref.mt32.queued.length,sc.expected.mt32Bytes);assert.equal(ref.adlib.writes.length,sc.expected.adlibWrites);
const assets=await loadAssets();
function run(sound,s){createMachine({assets,storage:memoryStorage(),strict:true});const g=startGame({sound});runUntil(g,s*PIT_HZ);}
const common=(a,b)=>{let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;return i;};
test('MT-32: the queued MIDI bytes equal DOSBox',()=>{
 run('mt32',6);
 const mine=mpu.events.map(e=>e.b),n=common(ref.mt32.queued,mine);
 assert.ok(n>=692,`only ${n} bytes match`);
});
test('AdLib: OPL writes and detection delays equal DOSBox',()=>{
 run('adlib',8);
 assert.deepEqual([rw(0x2dba),rw(0x2dbc)],ref.adlib.delays);
 // the direct OUT 389h of the detection (reg 4 = 21h) bypasses 1000:c8c6, where DOSBox was sampled
 const mine=opl.events.filter(e=>!(e.reg===4&&e.v===0x21)).map(e=>e.reg<<8|e.v);
 const want=ref.adlib.writes.map(([a,b])=>a<<8|b);
 assert.equal(common(want,mine),want.length);
});
test('negative control: a corrupted reference byte or register is detected',()=>{
 run('mt32',6);
 const bad=ref.mt32.queued.slice();bad[300]^=1;
 assert.ok(common(bad,mpu.events.map(e=>e.b))<692);
 run('adlib',8);
 const w=ref.adlib.writes.map(([a,b])=>a<<8|b);w[100]^=0x100;
 assert.ok(common(w,opl.events.filter(e=>!(e.reg===4&&e.v===0x21)).map(e=>e.reg<<8|e.v))<w.length);
});
test('speaker default: no MPU or OPL traffic',()=>{
 run('speaker',6);
 assert.equal(mpu.events.length,0);assert.equal(opl.events.length,0);
});
