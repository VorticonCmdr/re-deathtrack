// Flow checks: the 56 dialog pages built by 1000:070a, dispatcher routing, results/prizes, the menu key hook,
// and generator discipline against src/game/blocking.json. Calls outside 1000:0000-6dbb are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadAssets} from './assets.mjs';
import {createMachine} from '../src/engine/machine.js';
import {rb,rw,rsw,rd,wb,ww,wd,strAt,gseg,gaddr,frw,resetStack} from '../src/engine/mem.js';
import {callFar,register,lookup} from '../src/engine/host.js';
import {F,provide} from '../src/game/link.js';
import * as crt from '../src/game/crt.js';

const SRC=readFileSync(new URL('../src/game/flow.js',import.meta.url),'utf8');
const BLOCKING=JSON.parse(readFileSync(new URL('../src/game/blocking.json',import.meta.url),'utf8'));
// 1000:04ed is one race-loop iteration split out of 047c at the main session's request (a generator, not in blocking.json).
const GEN=new Set([...Object.keys(BLOCKING).map(a=>'f'+a.replace(':','_')),'f1000_04ed']);

// ---- stubs: one trampoline per external function; tests swap behaviour in `impl` ----
const calls=[];             // log of [name,...args]
const impl={};              // name -> fn(...args) returning AX (or a value)
const defaults={};
const ext=[...new Set([...SRC.matchAll(/F\.(f[0-9a-f]{4}_[0-9a-f]{4})/g)].map(m=>m[1]))];
const stubs={};
for(const n of ext){
 const run=(...a)=>{calls.push([n,...a]);const f=impl[n]??defaults[n];return f?f(...a):0;};
 stubs[n]=GEN.has(n)?function*(...a){const r=run(...a);if(r&&typeof r.next==='function')return yield* r;return r;}:run;
}
provide(stubs);

// Near heap: bump allocator in the unused top of DGROUP (zero in a fresh image).
let heap=0xc000;
// Requests that do not fit return NULL like MSC malloc (4778/47be call malloc(0xffff) and discard it).
defaults.f1000_de60=n=>{if(heap+n+1>0xfff0)return 0;const p=heap;heap=heap+n+1&~1;return p;};
defaults.f1000_de4e=()=>0;
defaults.f1000_c058=s=>crt.strlen(s);
defaults.f1000_c2ce=(d,s)=>crt.strcpy(d,s);
defaults.f1000_c298=(d,s)=>crt.strcat(d,s);
defaults.f1000_c10c=(a,b)=>crt.strcmp(a,b);
defaults.f1000_a3ca=()=>crt.rand();

const flow=await import('../src/game/flow.js');
const assets=await loadAssets();
function fresh(){createMachine({assets});resetStack();heap=0xc000;calls.length=0;for(const k of Object.keys(impl))delete impl[k];}
function run(g){let r;for(;;){r=g.next();if(r.done)return r.value;}}

// ---- page list walkers (record layouts per docs/re/gameflow.md §2) ----
function pages(){const out=[];for(let n=rw(0x9bcc);n;n=rw(n+2))out.push(rw(n));return out;}
function lines(rec){const out=[];for(let l=rw(rec);l;l=rw(l+2))out.push({str:rw(l),text:strAt(rw(l)),cap:rb(l+0xc),editable:rb(l+0xd)});return out;}
function buttons(rec){const out=[];for(let b=rw(rec+2);b;b=rw(b+2))out.push({str:rw(b),text:strAt(rw(b))});return out;}

test('generator discipline matches blocking.json',()=>{
 for(const [k,v] of Object.entries(flow)){
  if(!/^f1000_[0-9a-f]{4}$/.test(k)||typeof v!=='function')continue;
  assert.equal(v.constructor.name==='GeneratorFunction',GEN.has(k),`${k} generator status`);
 }
 const bad=[];
 SRC.split('\n').forEach((l,i)=>{if(/^\s*\/\//.test(l))return;for(const m of l.matchAll(/(yield\*\s*)?(?:F\.)?(f[0-9a-f]{4}_[0-9a-f]{4})\s*\(/g)){
  if(/function\*?\s*$/.test(l.slice(0,m.index)))continue;
  if(GEN.has(m[2])!==!!m[1])bad.push(`${i+1}:${m[2]}`);}});
 assert.deepEqual(bad,[]);
});

const qsortStub=(base,n,size,cmp)=>{ // stable insertion sort calling the registered comparator, size 1
 assert.equal(size,1);const tmpA=0xbf00,tmpB=0xbf01;
 for(let i=1;i<n;i++)for(let j=i;j>0;j--){
  wb(tmpA,rb(base+j-1));wb(tmpB,rb(base+j));
  if((callFar(gaddr(0x1000,cmp),tmpA,tmpB)<<16>>16)<=0)break;
  const t=rb(base+j);wb(base+j,rb(base+j-1));wb(base+j-1,t);
 }
};
function buildPages(){flow.f1000_070a();}

test('070a builds 56 pages with the documented structure',()=>{
 fresh();buildPages();
 const p=pages();
 assert.equal(p.length,56);
 // Page 5 main menu: 9 buttons, no lines counted as choices.
 const main=buttons(p[4]).map(b=>b.text.trim());
 assert.deepEqual(main,['FULL CIRCUIT RUN','RUN A TRACK','RUN OLD CIRCUIT','THE SHOPS','SCOPE THE STATS','SET YOUR LIMITS','SOUNDS','RESTART','BAIL OUT']);
 // Page 7 stats: 4 buttons ending with OUT'A HERE; page 8: 10 cities + OUT'A HERE.
 assert.equal(buttons(p[6]).length,4);
 assert.equal(buttons(p[7]).length,11);
 // Page 0x15 sign-up: editable line bound to DS:1792, capacity 14 (string emptied after creation), button GO FOR IT!
 const signLines=lines(p[0x14]);const ed=signLines.filter(l=>l.editable);
 assert.equal(ed.length,1);assert.equal(ed[0].str,0x1792);assert.equal(ed[0].cap,14);assert.equal(rb(0x1792),0);
 assert.deepEqual(buttons(p[0x14]).map(b=>b.text.trim()),['GO FOR IT!']);
 // Page 0x16 exit: style 1, NO / YES. Pages 1-4 are warning style.
 assert.equal(rb(p[0x15]+0xc),1);assert.deepEqual(buttons(p[0x15]).map(b=>b.text.trim()),['NO','YES']);
 for(let i=0;i<4;i++)assert.equal(rb(p[i]+0xc),1);
 // Page 0x34 quiz and 0x06/0x19 empty pages.
 assert.equal(buttons(p[5]).length+lines(p[5]).length,0);
 // selectPage returns -1 past the end.
 assert.equal(flow.f1000_3ab8(57),-1);assert.equal(flow.f1000_3ab8(5),0);assert.equal(rw(0x8a48),p[4]);
});

function dispatch(screen,choice){fresh();buildPages();calls.length=0;run(flow.f1000_2766(screen,choice));}
test('dispatcher routing',()=>{
 dispatch(5,2);assert.equal(rw(0xd24),0);assert.equal(rw(0x9018),8);
 dispatch(7,4);assert.equal(rw(0x9018),5);
 dispatch(5,9);assert.equal(rw(0x9018),0x16);
 dispatch(7,2);assert.equal(rw(0x9018),0x10);
 // Laps clamp: atoi (def2) result 150 -> 99, difficulty = choice-1.
 fresh();buildPages();impl.f1000_def2=()=>150;run(flow.f1000_2766(0x0f,3));
 assert.equal(rw(0x8eb8),99);assert.equal(rw(0xd28),2);assert.equal(rw(0x9018),5);
 // Screen below 5: back to the main menu through 39ae; HI_SCORE probe fails -> INSERT DISK #2.
 fresh();buildPages();impl.f1000_daa4=()=>0xffff;run(flow.f1000_2766(2,1));
 assert.equal(rw(0x9b22),5);assert.equal(rw(0x9018),0x0d);
 // QUIRK 0x21 falls through into 0x23: two disk probes, final target new game (0x0b).
 fresh();buildPages();impl.f1000_daa4=()=>0xffff;run(flow.f1000_2766(0x21,1));
 assert.equal(rw(0x9b22),0x0b);assert.equal(calls.filter(c=>c[0]==='f1000_daa4').length,2);
 // Quiz answer: the patched JMP never sets the protection flag, even for a wrong answer.
 fresh();buildPages();ww(0x1fb6,1);run(flow.f1000_2766(0x34,3));assert.equal(rw(0x1fb8),0);
 // RUN OLD CIRCUIT opens the load dialog.
 dispatch(5,3);assert.equal(rw(0x1f2a),1);
});

test('results 34b0: places, wreck penalty and prizes on a constructed standings table',()=>{
 fresh();buildPages();
 impl.f1000_e5a4=qsortStub;
 impl.f1000_e9a0=(p,n)=>{wd(p,rd(p)>>>n);};
 ww(0xd24,2);
 const prog=[5000,9000,1000,8000,7000,6000,4000,3000,2000,100];
 for(let k=0;k<10;k++){wd(0xa678+4*k,prog[k]);wb(0x8a54+k,1);wd(0xa22a+4*k,10000);}
 wb(0x8a54,0);       // the player is wrecked: progress >>10, paid nothing, shown OUT
 wd(0xa678,prog[0]<<10|5); // after >>10 the player has 5000 again
 run(flow.f1000_34b0());
 const order=[1,3,4,5,0,6,7,8,2,9];
 for(let i=0;i<10;i++)assert.equal(rb(0x8eda+i),order[i],`order ${i}`);
 assert.equal(rd(0xa678),5000);
 for(let i=0;i<10;i++){
  const k=order[i];
  assert.equal(rb(0x9926+k*10),k===0?0:i+1,`place of ${k}`);
  assert.equal(rd(0xa22a+4*k),k===0?10000:10000+rsw(0xd2e+2*i),`cash of ${k}`);
 }
 assert.equal(rsw(0xd2e),13000);assert.equal(rsw(0xd2e+2),9500); // prize table from the image
 assert.equal(rw(0x1f28),1);
});

test('menu key hook 66d2: Tab selects the next button, Enter presses, rand advances once per poll',()=>{
 fresh();buildPages();run(flow.f1000_6d76(5,0));calls.length=0;
 let key=0x0f09;
 impl.f1ff8_4457=()=>{const k=key;key=0;return k;};
 impl.f1ff8_44a0=sc=>sc===0x1c?1:0;
 ww(0x9aee,0);
 run(flow.f1000_66d2());
 assert.equal(calls.filter(c=>c[0]==='f2524_4584').length,1);
 assert.equal(calls.filter(c=>c[0]==='f1000_a3ca').length,1);
 assert.equal(rw(0x9aee),1);
 // No key, Enter released: no button step, no press.
 calls.length=0;ww(0x9aee,0);impl.f1ff8_44a0=()=>0;
 run(flow.f1000_66d2());
 assert.equal(calls.filter(c=>c[0]==='f2524_4584').length,0);assert.equal(rw(0x9aee),0);
 // Autoplay skips key handling entirely.
 calls.length=0;ww(0x1fa6,1);key=0x0f09;
 run(flow.f1000_66d2());
 assert.equal(calls.filter(c=>c[0]==='f1ff8_4457').length,0);
 assert.equal(calls.filter(c=>c[0]==='f1000_a3ca').length,1);
});

test('66d2 is registered as the per-poll callback and 67e8 installs it',()=>{
 const e=lookup(gaddr(0x1000,0x66d2));assert.ok(e&&e.gen&&e.fn===flow.f1000_66d2);
 assert.ok(lookup(gaddr(0x1000,0x2678)));
});
