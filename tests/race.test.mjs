// Race simulation (src/game/race.js). Expected values are hand-executed from the disassembly; addresses cited.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rb,rw,rsw,rsb,wb,ww,rd} from '../src/engine/mem.js';
import {provide,provided} from '../src/game/link.js';
import '../src/game/crt.js';
import * as R from '../src/game/race.js';

const assets=await loadAssets();
// Stubs for other modules, dispatched through a mutable table so each test can change them.
const calls=[];
const S={
 f1000_a166:()=>0, f1000_a294:(a,b)=>rsw(0x96f2+2*b)-rsw(0x96f2+2*a), f1000_a2ac:()=>0,
 f1000_a14c:()=>calls.push('a14c'), f1000_b6a2:()=>0, f1000_be7e:()=>rsw(0x9bca),
 f2c46_3220:()=>0, f2c46_311a:()=>0,
 f1000_def6:(v,buf)=>{wb(buf,0x31);wb(buf+1,0);return buf;},
};
const record=['f2524_041a','f2524_406e','f2524_42f0','f2524_44d6','f2524_44fc','f2524_4528','f2524_4542','f2524_4556',
 'f2524_456a','f1ff8_3692','f1ff8_23ba','f1000_026a','f1000_0278','f1ff8_2545'];
for(const k of record)S[k]=(...a)=>{calls.push(a.length?`${k.slice(1)}(${a.join(',')})`:k.slice(1));};
// rand (1000:a3ca) is the runtime's real function (crt.js); calls are counted from its table index DS:2154,
// which steps by -2 per call and wraps from below 0 to 0x6e.
assert.ok(provided().includes('f1000_a3ca'));
const randSteps=(from,to)=>{let n=0;while(from!==to){from=from-2;if(from<0)from=0x6e;n++;if(n>100)throw Error('bad');}return n;};
// Functions another module already provides (crt.js: itoa) are used as is.
const have=new Set(provided());
const table={};for(const k of Object.keys(S))if(!have.has(k))table[k]=(...a)=>S[k](...a);
provide(table);
// Drives a translated generator that must not block.
const run=g=>{for(;;){const r=g.next();if(r.done)return r.value;throw Error('unexpected yield');}};
const fresh=()=>{createMachine({assets});calls.length=0;};

// 1000:7a9c, 7c23-7c45: t = speed+sub (16-bit), CWD, IDIV 30 -> pos += AX, sub = DX; lap wrap at 7c49-7c62.
test('7a9c position and sub-step advance truncates toward zero',()=>{
 const i=3,I=6;
 const cases=[
  // speed, vmax, sub, pos -> pos, sub, speed
  [47,47,20,100, 102,7,47],        // t=67: 2 r 7
  [-40,-40,-5,100, 99,-15,-40],    // t=-45: IDIV gives -1 r -15 (floor would give -2 r 15)
  [-29,-29,0,100, 100,-29,-29],    // t=-29: 0 r -29
  [30000,30000,29999,100, -84,-17,30000], // t=59999 wraps to -5537: -184 r -17
  [10,20,0,100, 100,13,13],        // 7ac4: speed < vmax, speed += accel[3] (DS:1c20+6 = 3) -> t=13
  [25,20,0,100, 100,23,23],        // 7ae1: speed > vmax, speed -= 2
 ];
 for(const [sp,vm,sub,pos,ep,es,esp] of cases){
  fresh();
  assert.equal(rw(0x1c20+I),3);
  ww(0x8988,1000);ww(0x8eb8,5);wb(0x98e0+i,0);
  ww(0x8926+I,sp);ww(0x9b6c+I,vm);ww(0x9b90+I,sub);ww(0x96f2+I,pos);
  run(R.f1000_7a9c(i));
  assert.deepEqual([rsw(0x96f2+I),rsw(0x9b90+I),rsw(0x8926+I)],[ep,es,esp],`speed ${sp} sub ${sub}`);
 }
 // Lap wrap: pos 999 + 88/30 = 1001 > len 1000 -> pos 1, lap+1 (7c50-7c62).
 fresh();ww(0x8988,1000);ww(0x8eb8,5);ww(0x8926+I,59);ww(0x9b6c+I,59);ww(0x9b90+I,29);ww(0x96f2+I,999);
 run(R.f1000_7a9c(i));
 assert.deepEqual([rsw(0x96f2+I),rsw(0x9b90+I),rsw(0x8ec4+I)],[1,28,1]);
});

// 1000:8008 on a constructed record: car 2, ahead = car 5 (DS:9af4+4), gap via a294.
test('8008 AI steering: gap<20 double decrement, lane choice and lateral easing',()=>{
 fresh();
 ww(0x924e,200);                       // frame > 100 (80b7)
 ww(0x9af4+4,5);ww(0x8926+4,3);ww(0x8926+10,1);
 ww(0x96f2+4,100);ww(0x96f2+10,110);   // gap 10 < 0x14 (8083)
 ww(0xa97a+4,0);ww(0x5c84+4,0);ww(0x9636,1);
 R.f1000_8008(2);
 // 8089: 3-2=1 >= 0 -> 8094: 1-2 = -1
 assert.equal(rsw(0x8926+4),-1);
 // 80ca: lat == target, |lat| <= 16, DS:9636 bit 0 set -> target -0x20 (80f8); 8128: lat -= 2
 assert.equal(rsw(0x5c84+4),-0x20);
 assert.equal(rsw(0xa97a+4),-2);
 // gap 2 < 3 (805d): speed = max(speed[ahead]-3,0) and 9e90(ahead,-8): type 8 adds DS:1fe0+1 (9fb6).
 fresh();
 ww(0x924e,200);ww(0x8eb8,3);ww(0x1fe0,4);
 ww(0x9af4+4,5);ww(0x8926+4,9);ww(0x8926+10,7);ww(0x96f2+4,100);ww(0x96f2+10,102);
 ww(0xa97a+4,0);ww(0x5c84+4,10);ww(0x9aa6+10,0);
 R.f1000_8008(2);
 assert.equal(rsw(0x8926+4),4);
 assert.equal(rsw(0x9aa6+10),5);
 assert.equal(rsw(0x5c84+4),10);       // no lane change on this path (8076 -> 810b)
 assert.equal(rsw(0xa97a+4),2);        // 811c: lat += 2 toward the target
});

// 1000:9e90 with its tails 9fe0 (player) and a010 (death check).
test('9e90 damage: AI victims, kill credit, player effects, early return',()=>{
 // AI victim 4 hit by player mine e=12 (type 6): +13*1fda+20 (9f5a/9f54); destroyed; kill to owner 0.
 fresh();
 const max4=rsw(0x1c5c+8);assert.equal(max4,88);
 ww(0x8eb8,3);wb(0x8a54+4,1);wb(0x8a54+12,6);ww(0x95c2+4,0);ww(0x1fda,2);ww(0x9aa6+8,max4-40);
 R.f1000_9e90(4,12);
 assert.equal(rsw(0x9aa6+8),max4);      // a022 clamp
 assert.equal(rw(0x5c6e),1);            // a044 kills[owner 0]
 assert.equal(rb(0x8a54+4),0xfb);       // a121
 assert.equal(rb(0x8a54+12),0);         // a141 slot freed
 assert.deepEqual(calls,[]);
 // Terminator e=13 fired by AI car 3: +1000 (9ef9) + 92 (DS:1fe2=1, 9fa6), not destroyed below max.
 fresh();
 ww(0x8eb8,3);wb(0x8a54+4,1);wb(0x8a54+13,4);ww(0x95c2+6,3);ww(0x1fe2,1);ww(0x1c5c+8,2000);ww(0x9aa6+8,0);
 R.f1000_9e90(4,13);
 assert.equal(rsw(0x9aa6+8),1092);assert.equal(rb(0x8a54+4),1);assert.equal(rb(0x8a54+13),0);
 // Beam (src -3) kill on bounty target: state 0xdd (a117), kills[0] (a0c0), bounty flag DS:901a (a101).
 fresh();
 ww(0x8eb8,3);wb(0x8a54+4,1);ww(0x9a84,4);ww(0x1fde,1);ww(0x9aa6+8,80);
 R.f1000_9e90(4,-3);
 assert.equal(rsw(0x9aa6+8),88);assert.equal(rb(0x8a54+4),0xdd);assert.equal(rw(0x5c6e),1);assert.equal(rw(0x901a),1);
 // Player victim, AI missile attack (-5): 44d6(70) (a004), not dead, damage bar redraw (a133).
 fresh();ww(0x8eb8,3);wb(0x8a54,1);
 R.f1000_9e90(0,-5);
 assert.deepEqual(calls,['2524_44d6(70)','2524_406e']);
 // Player barrier (-11): a062 -> a083 -> a09e fall-through order.
 fresh();ww(0x8eb8,3);wb(0x8a54,1);
 R.f1000_9e90(0,-11);
 assert.deepEqual(calls,[`2524_44d6(${rw(0x1c5c)})`,'2524_44fc(0)','2524_4542','2524_4556','2524_44d6(60)','2524_4542',
  '2524_456a','2524_4528','2524_44fc(0)','2524_406e']);
 // Player at max damage: a14c then the bar.
 fresh();ww(0x8eb8,3);wb(0x8a54,1);ww(0x9aa6,rw(0x1c5c));
 R.f1000_9e90(0,-1);
 assert.deepEqual(calls,['a14c','2524_406e']);
 assert.equal(rb(0x8a54),0xdd);
 // 9e9f: victim already finished -> returns at once, projectile slot not freed.
 fresh();ww(0x8eb8,3);ww(0x8ec4+8,3);wb(0x8a54+12,6);ww(0x9aa6+8,0);
 R.f1000_9e90(4,12);
 assert.equal(rsw(0x9aa6+8),0);assert.equal(rb(0x8a54+12),6);
});

function setupCars(f){
 fresh();
 wd32(0x924e,f);
 ww(0x8988,1000);ww(0x8eb8,3);ww(0x96a0,0x800);ww(0x9a82,0);ww(0x9bca,0);
 for(let i=0;i<10;i++){wb(0x8a54+i,1);wb(0x8e9c+i,0);ww(0x9af4+2*i,0xffff);ww(0x96f2+2*i,500);ww(0x8926+2*i,0);ww(0x9b6c+2*i,0);}
 for(let e=10;e<40;e++)wb(0x8a54+e,0);
 ww(0x9636,0);ww(0x8954,0);ww(0x8f0a,0);ww(0x1fbc,0);
}
function wd32(o,v){ww(o,v&0xffff);ww(o+2,v>>>16);}

// RNG call count for one frame of 7982 with rendering stubbed (docs/re/race.md RNG).
test('7982 RNG call count per frame',()=>{
 // Frame 5 (79cc-79f2): every AI car gets 42f0 and 85b4, which calls rand once (85bb). 9 calls.
 setupCars(5);
 let i0=rw(0x2154);
 run(R.f1000_7982());
 assert.equal(randSteps(i0,rw(0x2154)),9);
 assert.equal(calls.filter(c=>c==='2524_42f0').length,9);
 // Frame 0x100 (&7 == 0): 7daa for cars 9..1. Car 3 at rel -100 with a missile and r=0 < 1be4[3]+8954
 // arms the attack (7df9: one rand); DS:1fbc is then non-zero, so no other car draws. 1 call.
 setupCars(0x100);
 ww(0x96f2+6,400);ww(0x9a86+6,1);
 i0=rw(0x2154);
 run(R.f1000_7982());
 assert.equal(randSteps(i0,rw(0x2154)),1);
 assert.equal(rsw(0x89cc+6),-100);
 assert.equal(rw(0x1fbe),3);
 assert.ok(rw(0x1fbc)>=10&&rw(0x1fbc)<=41);
 assert.ok(calls.includes('2524_041a(4)'));
 // 85f0 ran (frame & 15 == 0): progress of car 3 = lap 0 * len + 400.
 assert.equal(rd(0xa678+12),400);
});

// 1000:9542 at 9807: a flying Terminator in slot j re-reduces car j's sub (index 2j), not its own.
test('9542 Terminator flight uses the 2j sub index quirk',()=>{
 fresh();
 wd32(0x924e,0x200);ww(0x8988,1000);
 for(let i=0;i<10;i++)wb(0x8a54+i,0);
 wb(0x8a54+11,4);ww(0x8926+22,100);ww(0x9b90+22,10);ww(0x8970+2,50);ww(0xa97a+22,0);
 ww(0x8926+2,7);ww(0x9b90+2,40);  // car 1
 R.f1000_9542();
 assert.equal(rsw(0x893a+2),103);           // 97bc speed += 3
 assert.equal(rsw(0x8970+2),50+3);          // (103+10)/30 = 3
 assert.equal(rsw(0x9b90+22),10);           // projectile sub unchanged
 assert.equal(rsw(0x9b90+2),(7+40)%30);     // car 1 sub = 17
 assert.equal(R.staleStack.bpm4,0);         // 95b1: |lat| of the Terminator
});
