// Engine checks: identity, unpacking and relocation, memory/integer semantics, DOS arena, EGA write modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine,REFERENCE_EXE_SHA256} from '../src/engine/machine.js';
import {sha256} from '../src/engine/sha256.js';
import {rw,rb,frw,DGROUP,LOAD_SEG,gseg,ww,rsw} from '../src/engine/mem.js';
import {idiv16,imod16,s16,DivideError} from '../src/engine/int.js';
import {dosAlloc,dosFree,arenaBlocks} from '../src/engine/dos.js';
import * as ega from '../src/engine/ega.js';

const assets=await loadAssets();
test('sha256 matches node crypto for the reference executable',()=>{assert.equal(sha256(assets.get('DTRACK.EXE')),REFERENCE_EXE_SHA256);});
test('image is relocated to the DOSBox load segment',()=>{
 createMachine({assets});
 // Entry code: mov ah,30h; int 21h ... mov di,DGROUP (observed live bytes b4 30 cd 21 3c 02 73 02 cd 20 bf ef 28)
 assert.equal(frw(LOAD_SEG,0xd39c),0x30b4);assert.equal(frw(LOAD_SEG,0xd39c+11),DGROUP);assert.equal(DGROUP,0x28ef);
 assert.equal(rw(0x215a),0xdd23);           // RNG table head, observed live
 assert.equal(rb(0x1f4),0x44);              // "DEMO" argument string
 assert.equal(frw(gseg(0x1000),0x28fb),0x06eb); // crack-patched JMP
});
test('IDIV truncates toward zero and traps',()=>{
 assert.equal(idiv16(-7,2),-3);assert.equal(imod16(-7,2),-1);assert.throws(()=>idiv16(1,0),DivideError);assert.throws(()=>idiv16(-32768,-1),DivideError);
 ww(0x100,0xfffe);assert.equal(rsw(0x100),-2);assert.equal(s16(0x18000),-32768);
});
test('DOS arena allocates first fit with MCB headers like DOSBox',()=>{
 createMachine({assets});
 // Observed first DTRACK allocation in DOSBox is MCB 0x38ef -> block 0x38f0.
 const a=dosAlloc(32),b=dosAlloc(50);assert.equal(a.seg,0x38f0);assert.equal(b.seg,0x38f0+33);
 dosFree(a.seg);assert.equal(dosAlloc(20).seg,0x38f0);
 assert.ok(dosAlloc(0xffff).error);
 assert.equal(arenaBlocks().at(-1).type,0x5a);
});
test('EGA write mode 2 with bit mask and latches',()=>{
 ega.setMode(0x0d);ega.out(0x3ce,0x0205);ega.out(0x3ce,0x8008);ega.wr(0,0xf);ega.out(0x3ce,0x4008);ega.rd(1);ega.wr(1,0x5);
 assert.deepEqual([...ega.pageIndices(0).slice(0,10)],[15,0,0,0,0,0,0,0,0,5]);
});
