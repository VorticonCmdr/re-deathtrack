// Runtime agent: MSC runtime (crt.js), timer ISR (timer.js), music/device layer (music.js), effects (sfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rw,rb,ww,wb,fwb,frw,fww,fp,gseg,putStr,DGROUP,PSP_SEG} from '../src/engine/mem.js';
import {state,register,interrupt,biosVector} from '../src/engine/host.js';
import {dosAlloc} from '../src/engine/dos.js';
import {DivideError} from '../src/engine/int.js';
import {chunks,unpack} from '../src/formats.js';
import {speaker,installBios} from '../src/game/bios.js';
import * as C from '../src/game/crt.js';
import * as T from '../src/game/timer.js';
import * as M from '../src/game/music.js';
import * as X from '../src/game/sfx.js';

const assets=await loadAssets();
const massets=assets;

test('rand sequence from the initial table after randReset',()=>{
 createMachine({assets});
 C.randReset();
 // Expected values computed once from the DGROUP bytes of DTRACK_U.EXE (table at DS:215a), independent of crt.js.
 const exp=[0xea0b,0x3f99,0xda3f,0x0918,0x9de1,0x0da5];
 assert.deepEqual(exp.map(()=>C.f1000_c144()),exp);
 for(let k=6;k<59;k++)C.rand();
 assert.equal(C.rand(),0x3330);
 assert.equal(rw(0x2158),0x3330);
});

test('long helpers take (lo,hi) words and return packed DX:AX',()=>{
 const W=v=>[v&0xffff,v>>>16&0xffff];
 const call=(f,a,b)=>f(...W(a|0),...W(b|0));
 assert.equal(call(C.f1000_e80c,-7,2),(-3)>>>0);
 assert.equal(call(C.f1000_e8dc,-7,2),(-1)>>>0);
 assert.equal(call(C.f1000_e80c,-0x80000000,-1),0x80000000); // wraps like the original
 assert.equal(call(C.f1000_e8a8,0x12345,0x10001),0x23462345);
 assert.equal(call(C.f1000_e9c0,0xffffffff,0x10),0x0fffffff);
 assert.equal(call(C.f1000_ea22,0xffffffff,0x10),0xf);
 assert.equal(C.f1000_c080(0,0x10,0,1),0x10);              // far uldiv
 assert.throws(()=>call(C.f1000_e80c,5,0),DivideError);
 createMachine({assets});
 ww(0x100,0xfff6);ww(0x102,0xffff);C.f1000_e97e(0x100,3,0); // -10 / 3 = -3
 assert.equal(rw(0x100),0xfffd);assert.equal(rw(0x102),0xffff);
 ww(0x100,0x0000);ww(0x102,0x8000);C.f1000_e9a0(0x100,4);   // unsigned shift
 assert.equal(rw(0x102),0x0800);
});

test('itoa / ultoa / atol edge cases',()=>{
 createMachine({assets});
 const s=o=>{let r='';for(let i=0;rb(o+i);i++)r+=String.fromCharCode(rb(o+i));return r;};
 assert.equal(C.f1000_def6(0x8000,0x200,10),0x200);assert.equal(s(0x200),'-32768');
 C.f1000_def6(0xffff,0x200,16);assert.equal(s(0x200),'ffff');      // unsigned, lower case for radix != 10
 C.f1000_def6(0xffff,0x200,10);assert.equal(s(0x200),'-1');
 C.f1000_def6(0,0x200,10);assert.equal(s(0x200),'0');
 C.f1000_df12(0xffff,0xffff,0x200,10);assert.equal(s(0x200),'4294967295'); // never '-'
 C.f1000_df12(0x5678,0x1234,0x200,16);assert.equal(s(0x200),'12345678');
 const atol=t=>{putStr(0x300,t);return C.f1000_fcaa(0x300);};
 assert.equal(atol(' \t-123x'),(-123)>>>0);
 assert.equal(atol('+42'),42);
 assert.equal(atol('4294967297'),1);          // 32-bit wraparound
 assert.equal(atol('abc'),0);
 assert.equal(C.f1000_def2(0x300),0);
 assert.equal(C.f1000_df1c(0x61),0x41);assert.equal(C.f1000_df1c(0x31),0x31);
});

test('stdio reads PALS.BLK through the original _iob entries and near heap',()=>{
 const m=createMachine({assets});
 // C startup state that malloc and fopen rely on (1000:d3d5-d410).
 ww(0x5378,0xba3e);ww(0x5374,0xba3e);ww(0x5372,0xffff);ww(0x53e9,PSP_SEG);
 C.f1000_d44e();
 assert.equal(rb(0x53eb),5);assert.equal(rb(0x53f2)&0x40,0x40); // handle 0 is a device
 putStr(0xa000,'PALS.BLK');putStr(0xa010,'rb');
 const f=C.f1000_c1a2(0xa000,0xa010);
 assert.equal(f,0x546e);                       // _iob[5]: entries 0-4 are the std streams
 assert.equal(rb(f+6),1);assert.equal(rb(f+7),5);assert.equal(rb(0x53f2+5),1); // _IOREAD, handle 5, binary
 const file=assets.get('PALS.BLK');
 assert.equal(C.f1000_c214(0xa100,1,10,f),10);
 for(let i=0;i<10;i++)assert.equal(rb(0xa100+i),file[i]);
 // First malloc: heap at the DGROUP top 0xba3e, 3-byte pad block, growth rounded to 0x2000 -> buffer 0xba46.
 assert.equal(rw(f+4),0xba46);assert.equal(rw(0x54e6+5*6+2),0x200);
 assert.equal(rw(0x5378),0xc000);
 assert.equal(C.f1000_c206(f),10);
 // Seek inside the buffered block reuses it, outside re-reads.
 assert.equal(C.f1000_c1d6(f,100,0,0),0);assert.equal(C.f1000_c206(f),100);
 assert.equal(C.f1000_c214(0xa100,2,2,f),2);
 for(let i=0;i<4;i++)assert.equal(rb(0xa100+i),file[100+i]);
 assert.equal(C.f1000_c1d6(f,600,0,0),0);assert.equal(C.f1000_c206(f),600);
 assert.equal(C.f1000_c31a(f),file[600]);
 assert.equal(C.f1000_c1d6(f,0,0,2),0);assert.equal(C.f1000_c206(f),file.length);
 assert.equal(C.f1000_c31a(f),-1);              // EOF (int -1)
 assert.equal(rb(f+6)&0x10,0x10);
 assert.equal(C.f1000_c264(f),0);assert.equal(rb(f+6),0);assert.equal(m.fs.handles.size,0);
 // calloc / free / malloc(0xffff)
 const p=C.f1000_c308(4,8);assert.ok(p);for(let i=0;i<32;i++)assert.equal(rb(p+i),0);
 C.f1000_c280(p);assert.equal(rb(p-2)&1,1);
 assert.equal(C.f1000_c272(0xffff),0);
});

test('timer ISR: 16 ticks at the base rate, then slot 8 at shift 1',()=>{
 createMachine({assets});installBios();
 const log=[];
 biosVector(0x1c,()=>log.push('bios'));
 const S=gseg(0x33ae);
 for(let n=1;n<=8;n++)register(0x33ae,0x10+n,()=>log.push(n));
 T.f1000_c442();
 assert.equal(frw(0,8*4),0xc356);assert.equal(frw(0,8*4+2),gseg(0x1000));
 assert.equal(state.pitDivisor,0x2000);
 for(let n=1;n<=7;n++)T.f1000_c4cc(n,0x10+n,S,0);
 T.f1000_c52d(0xa3be,gseg(0x1000));
 ww(0x5a9e,100);ww(0x365f,0);
 for(let i=0;i<16;i++)interrupt(8);
 assert.deepEqual(log,['bios',1,2,3,4,5,6,7,'bios',1,2,3,4,5,6,7]);
 assert.equal(T.f1000_c523(),16*0x1c2);
 assert.equal(rw(0x5a9e),100-14);
 assert.equal(frw(0x40,0x6c),2);
 // Slot 8 with shift 1: phase step 0x10, PIT ch0 divisor 0x1000, slot 8 on odd phases while [2d26] != 0.
 log.length=0;
 T.f1000_c4cc(8,0x18,S,1);
 assert.equal(state.pitDivisor,0x1000);
 for(let i=0;i<16;i++)interrupt(8);
 assert.deepEqual(log,['bios',8,1,8,2,8,3,8,4,8,5,8,6,8,7,8]);
 ww(0x2d26,0);log.length=0;
 for(let i=0;i<4;i++)interrupt(8);
 assert.deepEqual(log,['bios',1]);
 T.f1000_c48d();assert.equal(state.pitDivisor,0x10000);assert.equal(frw(0,8*4+2),0xf000);
});

test('timerWait yields once per poll until the counter is no longer positive',()=>{
 createMachine({assets});
 ww(0x5a9e,2);
 const g=T.f1000_a3aa(3);let n=0;
 for(let r=g.next();!r.done;r=g.next()){n++;if(n===4)ww(0x5a9e,0x8000);} // >= 0x8000 counts as not positive
 assert.equal(n,4);
});

test('effect interpreter: PALS.BLK stream 0, PIT ch2 divisor and gate per tick',()=>{
 createMachine({assets});
 const snd=chunks(assets.get('PALS.BLK'))[0];
 const ibm=unpack(snd.children.find(c=>c.name==='IBM:').data);
 const {seg}=dosAlloc(ibm.length+15>>4);
 for(let i=0;i<ibm.length;i++)fwb(seg,i,ibm[i]);
 for(let i=0;i<11;i++){const lo=frw(seg,4*i),hi=frw(seg,4*i+2);if(lo|hi)fww(seg,4*i+2,hi+seg);} // 32-bit add of seg:0000
 ww(0x2c2c,0);ww(0x2c2e,seg);ww(0x2c3c,11);ww(0x2c40,0);
 assert.equal(X.f32e3_05ba(1),1);assert.equal(rw(0x9a40),0);
 assert.equal(X.f32e3_043f(0,1),1);
 assert.equal(rw(0x3649),1);assert.equal(rw(0x3628),1);assert.equal(rw(0x3669),0x2c+8);
 const out=[];
 for(let t=1;t<=302;t++){speaker.divisor=-1;X.f334e_0000();out.push([speaker.divisor,speaker.gate]);}
 // Stream 0: freq=400 wave(0) depth=3000 gate=C350h fslide=100 dur=300 | gate=0 dur=0 (end).
 // The step runs before [4]+=[6], so tick k outputs 400+100k; the wave term is 0 (phase step 0).
 for(let k=1;k<=300;k++)assert.deepEqual(out[k-1],[400+100*k&0xffff,3],`tick ${k}`);
 assert.deepEqual(out[300],[30500,0]);         // tick 301: gate 0, voice ends after this output
 assert.equal(out[301][0],-1);                  // tick 302: no active voice, speaker untouched
 assert.equal(rw(0x3649),0);assert.equal(rw(0x3628),0);assert.equal(rw(0x3669),0);
 // Through the ISR on a speaker device: once the effect ended, the gate is reopened and ch2 restored to [3506].
 installBios();T.f1000_c442();
 ww(0x2d34,1);ww(0x3506,0x14);wb(0x1fb2,1);ww(0x365f,1);
 T.f1000_c356();
 assert.equal(speaker.divisor,0x14);assert.equal(speaker.gate,3);assert.equal(rw(0x2d26),1);
});
const dangerSmf=()=>unpack(chunks(massets.get('DANGER.MUS'))[0].data);
function loadSmf(bytes){const {seg}=dosAlloc(bytes.length+15>>4);for(let i=0;i<bytes.length;i++)fwb(seg,i,bytes[i]);return seg;}

test('musicPlay accepts the danger.mus SMF and rejects bad headers',()=>{
 createMachine({assets:massets});
 const smf=dangerSmf();
 assert.equal(M.f1000_c60a(0,loadSmf(smf),0),0);             // flags bit 0 clear: refused
 const bad=smf.slice();bad[13]=0x30;                               // division 0x30 instead of 0x60
 assert.equal(M.f1000_c60a(0,loadSmf(bad),1),0);assert.equal(rw(0x2d4e),0);
 const fmt1=smf.slice();fmt1[9]=1;                                 // format 1
 assert.equal(M.f1000_c60a(0,loadSmf(fmt1),1),0);
 const seg=loadSmf(smf);
 assert.equal(M.f1000_c60a(0,seg,1),1);
 // MThd(14) + "MTrk"+len(8) = 22; first delta 00 read -> event pointer 23, [2d50] = +0.
 assert.equal(rw(0x2d4e),1);assert.equal(rw(0x2d4a),23);assert.equal(rw(0x2d4c),seg);assert.equal(rw(0x2d50),0);
});

test('speaker device plays danger.mus: PIT ch2 divisors per sequencer tick',()=>{
 createMachine({assets:massets});
 state.log=[];
 try{
  M.f1000_cd72(0x34d6);
  // spkInit: ch2 divisor 14h, gate on; timerSetSlot(8, d19f, CS, 1) -> ch0 divisor 0x1000.
  assert.deepEqual(state.log.filter(e=>e.kind==='pit').map(e=>[e.ch,e.d]),[[2,0x14],[0,0x1000]]);
  assert.equal(speaker.gate,3);assert.equal(rw(0x30d2),0x34d6);assert.equal(rb(0x34ed),4);
  assert.equal(M.f1000_c60a(0,loadSmf(dangerSmf()),1),1);
  state.log=[];
  // MIDI ticks per call: (rem + 0x2d00) / 0x1110; the tempo meta in call 1 resets the remainder.
  // Cumulative ticks: c12 = 31, c13 = 33 (notes at t=33), c24 = 62, c25 = 65 (note-offs at t=64),
  // c32 = 83, c33 = 86 (notes at t=85). Speaker sysex at t=33 sets 1 voice, so d139/d159 write PIT ch2 directly.
  // Channel 1 transpose ([31ac]) = 4: notes 18h/24h -> keys 28/40 -> DS:3508[14] = 28958, DS:3508[26] = 14479.
  const perCall=[];
  for(let k=1;k<=33;k++){state.log=[];M.f1000_c731();perCall.push(state.log.filter(e=>e.kind==='pit'&&e.ch===2).map(e=>e.d));}
  perCall.forEach((w,i)=>{
   const k=i+1,exp=k===13||k===33?[28958,14479]:k===25?[0x14]:[];
   assert.deepEqual(w,exp,`call ${k}`);
  });
  assert.equal(speaker.gate,3);
  assert.equal(rb(0x34ed),1);assert.equal(rb(0x30e3),0x28);assert.equal(rw(0x30e4),14479);
  assert.equal(rw(0x2d42),0x2d00);assert.equal(rw(0x2d46),0x60);assert.equal(rw(0x2d48),4);
 }finally{state.log=null;}
});

test('udiv32 and the speaker tick round-robin',()=>{
 createMachine({assets:massets});
 assert.equal(M.f1000_d31e(0x8700,0x393,0xa120,0x07),120);   // 60000000 / 500000
 assert.equal(M.f1000_d31e(5,0,7,0),0);                      // divisor > dividend
 assert.equal(M.f1000_d31e(0,0,7,0),0);
 assert.equal(M.f1000_d31e(0xffff,0xffff,3,0),0x55555555);
 state.log=[];
 try{
  M.f1000_cd72(0x34d6);                                       // 4 voices, all at 14h
  ww4([0x1000,0x2000,0x14,0x3000]);
  state.log=[];
  const out=[];for(let i=0;i<10;i++){state.log=[];M.f1000_d19f();out.push(state.log.filter(e=>e.kind==='pit').map(e=>e.d));}
  // [3504] starts at 2: calls 2,4,6,8,10 act. Voice order 30da,30ec,30fe,3110; equal divisors are not rewritten.
  assert.deepEqual(out,[[],[0x1000],[],[0x2000],[],[0x14],[],[0x3000],[],[0x1000]]);
 }finally{state.log=null;}
});
function ww4(v){v.forEach((d,i)=>{fwb(0x28ef,0x30da+0x12*i+0xa,d&0xff);fwb(0x28ef,0x30da+0x12*i+0xb,d>>8);});}
